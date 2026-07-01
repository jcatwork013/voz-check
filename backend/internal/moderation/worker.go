// Package moderation contains the shared moderation engine plus the Flarum live
// poller. The engine (ModerateItem + RecordOutcome) is platform-agnostic so both
// the Flarum poller (pull) and the XenForo add-on ingest endpoint (push) reuse
// the exact same AI judging, logging and strike accounting.
package moderation

import (
	"context"
	"errors"
	"fmt"
	"html"
	"log"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"vozcheck/internal/ai"
	"vozcheck/internal/flarum"
	"vozcheck/internal/forum"
	"vozcheck/internal/store"
)

const maxPerCycle = 25 // bound AI calls per live poll

// ContentItem is a platform-agnostic piece of content to moderate.
type ContentItem struct {
	Platform       string // "flarum" | "xenforo"
	PostID         int64  // external post id on the source forum
	ThreadID       int64  // discussion/thread id
	ThreadTitle    string
	AuthorID       int64
	AuthorUsername string
	Content        string
	IsFirstPost    bool
	Source         string // "live" | "backfill" | "xenforo-ingest"
}

func (c ContentItem) postTypeLabel() string {
	if c.IsFirstPost {
		return "Bài viết mới (chủ đề)"
	}
	return "Bình luận"
}

type Worker struct {
	st  *store.Store
	log *log.Logger
	mu  sync.Mutex // serialises Flarum live/backfill passes

	running atomic.Bool
	lastErr atomic.Value // string

	// Full-forum scan (background job).
	fullRunning atomic.Bool
	fullState   atomic.Value // FullScanState
	fullMu      sync.Mutex   // guards fullCancel
	fullCancel  context.CancelFunc
}

func New(st *store.Store, logger *log.Logger) *Worker {
	w := &Worker{st: st, log: logger}
	w.lastErr.Store("")
	w.fullState.Store(FullScanState{})
	return w
}

// FullScanState is the live progress of a whole-forum scan. The scan walks every
// thread on each connected platform and processes each one exactly like the
// scan-by-link feature (moderate OP + comments, hide violations / approve clean
// pending) — identical behaviour for Flarum and XenForo.
type FullScanState struct {
	Running       bool   `json:"running"`
	Done          bool   `json:"done"`
	Stopped       bool   `json:"stopped"`
	Platform      string `json:"platform"`
	Threads       int64  `json:"threads"`
	Scanned       int64  `json:"scanned"`
	Violations    int64  `json:"violations"`
	Hidden        int64  `json:"hidden"`
	Approved      int64  `json:"approved"`
	CurrentThread string `json:"current_thread"`
	StartedAt     string `json:"started_at"`
	LastError     string `json:"last_error"`
}

func flarumConnected(set store.Settings) bool {
	return set.FlarumToken != "" && set.FlarumBaseURL != ""
}

func xenforoConnected(set store.Settings) bool {
	key := set.XenforoToken
	if key == "" {
		key = set.XenforoAPIKey
	}
	return key != "" && set.XenforoBaseURL != ""
}

func (w *Worker) FullScanStatus() FullScanState {
	s, _ := w.fullState.Load().(FullScanState)
	return s
}

// StartFullScan launches a background pass over EVERY post on the Flarum forum,
// in batches, auto-hiding violations per settings. It runs on its own background
// context so it survives the HTTP request, until completion or StopFullScan.
func (w *Worker) StartFullScan(startedAt string) error {
	if !w.fullRunning.CompareAndSwap(false, true) {
		return fmt.Errorf("đang có một lần quét toàn bộ chạy — dừng nó trước đã")
	}
	set, err := w.st.GetSettings()
	if err != nil {
		w.fullRunning.Store(false)
		return err
	}
	if !flarumConnected(set) && !xenforoConnected(set) {
		w.fullRunning.Store(false)
		return fmt.Errorf("chưa kết nối Flarum hoặc XenForo")
	}
	prov, err := ai.New(set.AIProvider, set.AIAPIKey, set.AIModel)
	if err != nil {
		w.fullRunning.Store(false)
		return fmt.Errorf("AI: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	w.fullMu.Lock()
	w.fullCancel = cancel
	w.fullMu.Unlock()
	w.fullState.Store(FullScanState{Running: true, StartedAt: startedAt})
	go w.runFullScan(ctx, set, prov)
	return nil
}

// StopFullScan signals the running full scan to stop after the current post.
func (w *Worker) StopFullScan() {
	w.fullMu.Lock()
	if w.fullCancel != nil {
		w.fullCancel()
	}
	w.fullMu.Unlock()
}

func (w *Worker) runFullScan(ctx context.Context, set store.Settings, prov ai.Provider) {
	defer w.fullRunning.Store(false)

	var platforms []string
	if flarumConnected(set) {
		platforms = append(platforms, "flarum")
	}
	if xenforoConnected(set) {
		platforms = append(platforms, "xenforo")
	}

	for _, name := range platforms {
		select {
		case <-ctx.Done():
			w.finishFull(true)
			return
		default:
		}
		actor, err := forum.NewActorForPlatform(set, name)
		if err != nil {
			st := w.FullScanStatus()
			st.LastError = err.Error()
			w.fullState.Store(st)
			continue
		}
		st := w.FullScanStatus()
		st.Platform = name
		w.fullState.Store(st)

		ierr := actor.IterateThreads(ctx, func(t forum.Thread) error {
			s := w.FullScanStatus()
			s.Threads++
			s.CurrentThread = t.Title
			w.fullState.Store(s)
			for _, p := range t.Posts {
				select {
				case <-ctx.Done():
					return ctx.Err()
				default:
				}
				if strings.TrimSpace(p.Content) == "" || p.IsHidden {
					continue
				}
				ci := ContentItem{
					Platform: name, PostID: p.PostID, ThreadID: p.ThreadID, ThreadTitle: t.Title,
					AuthorID: p.AuthorID, AuthorUsername: p.AuthorUsername, Content: p.Content,
					IsFirstPost: p.IsFirstPost, Source: "full-scan",
				}
				v, act, merr := w.ModerateItem(ctx, set, ci, prov)
				s := w.FullScanStatus()
				s.Scanned++
				if merr == nil {
					switch {
					case act:
						s.Violations++
						if set.AutoHide {
							w.ActOnViolation(ctx, set, actor, ci, v, prov.Name(), prov.Model(), true)
							s.Hidden++
						} else {
							_, _ = w.RecordOutcome(set, ci, v, prov.Name(), prov.Model(), "flagged_only")
						}
					case p.Pending:
						// Clean post waiting in the queue → publish it (same as scan-by-link).
						if aerr := actor.Approve(ctx, p.PostID); aerr == nil {
							_, _ = w.RecordOutcome(set, ci, v, prov.Name(), prov.Model(), "auto_approved")
							s.Approved++
						}
					}
				}
				w.fullState.Store(s)
			}
			return nil
		})
		if errors.Is(ierr, context.Canceled) {
			w.finishFull(true)
			return
		}
		if ierr != nil {
			st := w.FullScanStatus()
			st.LastError = ierr.Error()
			w.fullState.Store(st)
		}
	}
	w.finishFull(false)
}

func (w *Worker) finishFull(stopped bool) {
	st := w.FullScanStatus()
	st.Running, st.Done, st.Stopped = false, true, stopped
	w.fullState.Store(st)
}

func (w *Worker) Running() bool { return w.running.Load() }
func (w *Worker) LastError() string {
	s, _ := w.lastErr.Load().(string)
	return s
}

// ── Shared engine ─────────────────────────────────────────────────────────────

// ModerateItem runs the AI verdict for one item and reports whether the
// configured threshold says to act. It performs no side effects (no logging,
// no enforcement) so callers stay in control of platform-specific actions.
func (w *Worker) ModerateItem(ctx context.Context, set store.Settings, item ContentItem, prov ai.Provider) (ai.Result, bool, error) {
	text := strings.TrimSpace(item.Content)
	if text == "" {
		return ai.Result{Severity: "none"}, false, nil
	}
	in := ai.Input{
		SystemPrompt: set.SystemPrompt,
		Rules:        set.Rules,
		Title:        item.ThreadTitle,
		Content:      text,
		Author:       item.AuthorUsername,
		PostType:     item.postTypeLabel(),
	}
	v, err := prov.Moderate(ctx, in)
	if err != nil {
		return ai.Result{}, false, err
	}
	_ = w.st.AddTokenUsage(prov.Name(), prov.Model(), v.PromptTokens, v.CompletionTokens, v.TotalTokens)
	act := v.Violation && v.Confidence >= float64(set.ViolationThresh)
	return v, act, nil
}

// RecordOutcome persists the moderation log row and updates the author's strike
// count (flagging them once the suspend threshold is reached). actionTaken is the
// caller-supplied summary of what enforcement actually happened.
func (w *Worker) RecordOutcome(set store.Settings, item ContentItem, v ai.Result, providerName, model, actionTaken string) (int64, error) {
	entry := store.LogEntry{
		PostID:          item.PostID,
		DiscussionID:    item.ThreadID,
		DiscussionTitle: item.ThreadTitle,
		AuthorUserID:    item.AuthorID,
		AuthorUsername:  item.AuthorUsername,
		PostType:        item.postTypeLabel(),
		ContentExcerpt:  excerpt(item.Content, 500),
		Violation:       v.Violation,
		Confidence:      v.Confidence,
		Severity:        v.Severity,
		Categories:      strings.Join(v.Categories, ","),
		Reason:          v.Reason,
		MessageToUser:   v.MessageToUser,
		ActionTaken:     actionTaken,
		Source:          item.Source,
		Platform:        item.Platform,
		AIProvider:      providerName,
		AIModel:         model,
	}
	id, err := w.st.InsertLog(entry)
	if err != nil {
		return 0, err
	}
	// Strike accounting only when we actually acted on a violation.
	acted := actionTaken != "" && actionTaken != "none" && !strings.HasPrefix(actionTaken, "error")
	if acted && v.Violation && item.AuthorID > 0 {
		count, serr := w.st.AddStrike(item.AuthorID, item.AuthorUsername)
		if serr == nil && set.StrikeSuspendAt > 0 && count >= set.StrikeSuspendAt {
			note := fmt.Sprintf("Đạt %d strikes (ngưỡng %d) — đề xuất xử lý nguội.", count, set.StrikeSuspendAt)
			_ = w.st.SetStrikeStatus(item.AuthorID, "flagged", note)
		}
	}
	return id, nil
}

// ── Flarum live poller ────────────────────────────────────────────────────────

func (w *Worker) Run(ctx context.Context) {
	w.log.Println("moderation worker started")
	for {
		interval := w.pollInterval()
		select {
		case <-ctx.Done():
			w.log.Println("moderation worker stopped")
			return
		case <-time.After(interval):
			w.tick(ctx)
		}
	}
}

func (w *Worker) pollInterval() time.Duration {
	set, err := w.st.GetSettings()
	if err != nil {
		return 15 * time.Second
	}
	n := set.PollIntervalSec
	if n < 5 {
		n = 5
	}
	return time.Duration(n) * time.Second
}

func (w *Worker) tick(ctx context.Context) {
	if !w.mu.TryLock() {
		return
	}
	defer w.mu.Unlock()
	if err := w.livePass(ctx); err != nil {
		w.lastErr.Store(err.Error())
		_ = w.st.SetPollResult(err.Error())
		w.log.Printf("live pass error: %v", err)
		return
	}
	w.lastErr.Store("")
	_ = w.st.SetPollResult("")
}

func (w *Worker) livePass(ctx context.Context) error {
	w.running.Store(true)
	defer w.running.Store(false)

	set, err := w.st.GetSettings()
	if err != nil {
		return fmt.Errorf("load settings: %w", err)
	}
	// The live poller only drives Flarum. XenForo is push-based via the add-on.
	if !set.Enabled || set.ForumType != "flarum" {
		return nil
	}
	if set.FlarumToken == "" {
		return fmt.Errorf("flarum token chưa cấu hình")
	}
	prov, err := ai.New(set.AIProvider, set.AIAPIKey, set.AIModel)
	if err != nil {
		return fmt.Errorf("ai provider: %w", err)
	}
	fc := flarum.New(set.FlarumBaseURL, set.FlarumToken, set.FlarumBotUserID)

	newest, err := fc.NewestPostID(ctx)
	if err != nil {
		return fmt.Errorf("newest post id: %w", err)
	}
	ps, err := w.st.GetPollerState()
	if err != nil {
		return err
	}
	if newest == 0 {
		return nil
	}
	if ps.LastPostID == 0 {
		w.log.Printf("initialising high-water mark at post %d (skipping backlog)", newest)
		return w.st.SetLastPostID(newest)
	}
	if newest <= ps.LastPostID {
		return nil
	}

	from := ps.LastPostID + 1
	to := newest
	if to-from+1 > maxPerCycle {
		to = from + maxPerCycle - 1
	}
	ids := make([]int64, 0, to-from+1)
	for id := from; id <= to; id++ {
		ids = append(ids, id)
	}
	posts, err := fc.FetchPosts(ctx, ids)
	if err != nil {
		return fmt.Errorf("fetch posts: %w", err)
	}
	for _, p := range posts {
		if _, err := w.processFlarumPost(ctx, fc, prov, set, p, "live"); err != nil {
			w.log.Printf("post %d: %v", p.ID, err)
		}
	}
	return w.st.SetLastPostID(to)
}

// processFlarumPost moderates one Flarum post and enforces hide + @mention.
// Returns whether the post was acted on as a violation.
func (w *Worker) processFlarumPost(ctx context.Context, fc *flarum.Client, prov ai.Provider, set store.Settings, p flarum.Post, source string) (bool, error) {
	if p.AuthorID == int64(set.FlarumBotUserID) || p.IsHidden {
		return false, nil
	}
	item := ContentItem{
		Platform:       "flarum",
		PostID:         p.ID,
		ThreadID:       p.DiscussionID,
		ThreadTitle:    p.DiscussionTitle,
		AuthorID:       p.AuthorID,
		AuthorUsername: p.AuthorUsername,
		Content:        postText(p),
		IsFirstPost:    p.IsFirstPost(),
		Source:         source,
	}
	v, act, err := w.ModerateItem(ctx, set, item, prov)
	if err != nil {
		_, _ = w.RecordOutcome(set, item, ai.Result{}, prov.Name(), prov.Model(), "error: "+err.Error())
		return false, err
	}
	if !act {
		_, _ = w.RecordOutcome(set, item, v, prov.Name(), prov.Model(), "none")
		return false, nil
	}
	var actions []string
	if set.AutoHide {
		if err := fc.SetHidden(ctx, p.ID, true); err != nil {
			w.log.Printf("hide post %d failed: %v", p.ID, err)
			actions = append(actions, "hide_failed")
		} else {
			actions = append(actions, "hidden")
		}
	}
	if set.NotifyUser && p.AuthorUsername != "" {
		msg := buildNotify(set.NotifyTemplate, v, p.AuthorUsername, p.AuthorID)
		if _, err := fc.Reply(ctx, p.DiscussionID, msg); err != nil {
			w.log.Printf("notify post %d failed: %v", p.ID, err)
			actions = append(actions, "notify_failed")
		} else {
			actions = append(actions, "notified")
		}
	}
	if len(actions) == 0 {
		actions = append(actions, "flagged_only")
	}
	_, _ = w.RecordOutcome(set, item, v, prov.Name(), prov.Model(), strings.Join(actions, "+"))
	return true, nil
}

// ActOnViolation enforces a confirmed violation through any forum Actor: hides
// the post (when doHide), @mention-notifies the author (when NotifyUser is on),
// then records the outcome + strike. Platform-agnostic — used by the scan-by-URL
// feature for both Flarum and XenForo. Returns the human-readable action list.
func (w *Worker) ActOnViolation(ctx context.Context, set store.Settings, actor forum.Actor, item ContentItem, v ai.Result, providerName, model string, doHide bool) []string {
	var actions []string
	if doHide {
		if err := actor.SetHidden(ctx, item.PostID, true); err != nil {
			w.log.Printf("scan hide post %d failed: %v", item.PostID, err)
			actions = append(actions, "hide_failed")
		} else {
			actions = append(actions, "hidden")
		}
	}
	if set.NotifyUser && item.AuthorUsername != "" {
		msg := buildNotify(set.NotifyTemplate, v, item.AuthorUsername, item.AuthorID)
		if _, err := actor.Reply(ctx, item.ThreadID, msg); err != nil {
			w.log.Printf("scan notify post %d failed: %v", item.PostID, err)
			actions = append(actions, "notify_failed")
		} else {
			actions = append(actions, "notified")
		}
	}
	if len(actions) == 0 {
		actions = append(actions, "flagged_only")
	}
	_, _ = w.RecordOutcome(set, item, v, providerName, model, strings.Join(actions, "+"))
	return actions
}

// ── Backfill ("phạt nguội") ───────────────────────────────────────────────────

type BackfillResult struct {
	Scanned    int   `json:"scanned"`
	Violations int   `json:"violations"`
	FromID     int64 `json:"from_id"`
	ToID       int64 `json:"to_id"`
}

func (w *Worker) Backfill(ctx context.Context, limit int) (BackfillResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.running.Store(true)
	defer w.running.Store(false)

	var res BackfillResult
	set, err := w.st.GetSettings()
	if err != nil {
		return res, err
	}
	if set.ForumType != "flarum" {
		return res, fmt.Errorf("backfill chỉ áp dụng cho Flarum (XenForo dùng add-on)")
	}
	if set.FlarumToken == "" {
		return res, fmt.Errorf("flarum token chưa cấu hình")
	}
	prov, err := ai.New(set.AIProvider, set.AIAPIKey, set.AIModel)
	if err != nil {
		return res, err
	}
	fc := flarum.New(set.FlarumBaseURL, set.FlarumToken, set.FlarumBotUserID)
	newest, err := fc.NewestPostID(ctx)
	if err != nil {
		return res, err
	}
	if newest == 0 {
		return res, nil
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	from := newest - int64(limit) + 1
	if from < 1 {
		from = 1
	}
	res.FromID, res.ToID = from, newest

	for start := from; start <= newest; start += 50 {
		end := start + 49
		if end > newest {
			end = newest
		}
		ids := make([]int64, 0, end-start+1)
		for id := start; id <= end; id++ {
			ids = append(ids, id)
		}
		posts, err := fc.FetchPosts(ctx, ids)
		if err != nil {
			return res, fmt.Errorf("fetch posts: %w", err)
		}
		for _, p := range posts {
			if p.AuthorID == int64(set.FlarumBotUserID) || p.IsHidden {
				continue
			}
			violated, err := w.processFlarumPost(ctx, fc, prov, set, p, "backfill")
			if err != nil {
				w.log.Printf("backfill post %d: %v", p.ID, err)
				continue
			}
			res.Scanned++
			if violated {
				res.Violations++
			}
		}
	}
	return res, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

var tagRe = regexp.MustCompile(`(?s)<[^>]*>`)
var wsRe = regexp.MustCompile(`[ \t\r\f\v]+`)

func postText(p flarum.Post) string {
	if s := strings.TrimSpace(p.Content); s != "" {
		return s
	}
	return stripHTML(p.ContentHTML)
}

func stripHTML(s string) string {
	s = strings.ReplaceAll(s, "</p>", "\n")
	s = strings.ReplaceAll(s, "<br>", "\n")
	s = strings.ReplaceAll(s, "<br/>", "\n")
	s = tagRe.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	s = wsRe.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

func excerpt(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func buildNotify(tmpl string, v ai.Result, username string, userID int64) string {
	body := strings.ReplaceAll(tmpl, "{reason}", v.Reason)
	return flarum.Mention(username, userID) + "\n\n" + body
}
