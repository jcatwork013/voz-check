// Package httpapi exposes the dashboard REST API: auth, settings, logs, strikes,
// stats and the backfill trigger. All mutating/reading routes (except login and
// health) require a Bearer JWT.
package httpapi

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"vozcheck/internal/ai"
	"vozcheck/internal/auth"
	"vozcheck/internal/flarum"
	"vozcheck/internal/forum"
	"vozcheck/internal/moderation"
	"vozcheck/internal/store"
	"vozcheck/internal/xenforo"
)

type Server struct {
	st     *store.Store
	auth   *auth.Authenticator
	worker *moderation.Worker
	log    *log.Logger
	cors   string
}

func New(st *store.Store, a *auth.Authenticator, w *moderation.Worker, logger *log.Logger, corsOrigin string) *Server {
	return &Server{st: st, auth: a, worker: w, log: logger, cors: corsOrigin}
}

// Handler builds the full router.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Public.
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("POST /api/auth/login", s.login)
	// Ingest login is public (validates the shared ingest key); the add-on then
	// uses the returned token as a Bearer for /api/ingest/moderate.
	mux.HandleFunc("POST /api/ingest/login", s.ingestLogin)
	mux.Handle("POST /api/ingest/moderate", s.auth.Middleware(http.HandlerFunc(s.ingestModerate)))

	// Protected (wrapped individually so we can keep a flat mux).
	protected := map[string]http.HandlerFunc{
		"GET /api/auth/me":              s.me,
		"POST /api/auth/change-password": s.changePassword,
		"GET /api/users":                s.listUsers,
		"POST /api/users":               s.createUser,
		"GET /api/settings":             s.getSettings,
		"GET /api/settings/defaults":    s.getDefaults,
		"PUT /api/settings":             s.updateSettings,
		"POST /api/settings/flarum/connect":  s.connectFlarum,
		"POST /api/settings/xenforo/connect": s.connectXenforo,
		"POST /api/settings/ai/test":     s.testAI,
		"POST /api/settings/ai/validate": s.validateAI,
		"GET /api/integration":          s.getIntegration,
		"POST /api/integration/regenerate-key": s.regenerateIngestKey,
		"GET /api/logs":                 s.listLogs,
		"GET /api/logs/{id}":            s.getLogDetail,
		"POST /api/logs/{id}/hide":      s.hideLog,
		"POST /api/logs/{id}/unhide":    s.unhideLog,
		"GET /api/strikes":              s.listStrikes,
		"POST /api/strikes/{userId}/status": s.setStrikeStatus,
		"POST /api/strikes/{userId}/reset":  s.resetStrike,
		"POST /api/scan/backfill":       s.backfill,
		"POST /api/scan/url":            s.scanURL,
		"POST /api/scan/post-action":    s.scanPostAction,
		"POST /api/scan/full/start":     s.fullScanStart,
		"POST /api/scan/full/stop":      s.fullScanStop,
		"GET /api/scan/full/status":     s.fullScanStatus,
		"GET /api/stats":                s.stats,
		"GET /api/stats/tokens":         s.tokenStats,
	}
	for pattern, h := range protected {
		mux.Handle(pattern, s.auth.Middleware(h))
	}

	return s.withCORS(mux)
}

// ── middleware / helpers ──────────────────────────────────────────────────────

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cors != "" {
			w.Header().Set("Access-Control-Allow-Origin", s.cors)
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	return dec.Decode(v)
}

// ── handlers: health + auth ───────────────────────────────────────────────────

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "time": time.Now().UTC()})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	u, err := s.st.GetUserByUsername(strings.TrimSpace(req.Username))
	if err != nil || !auth.CheckPassword(u.PasswordHash, req.Password) {
		writeErr(w, http.StatusUnauthorized, "Sai tài khoản hoặc mật khẩu")
		return
	}
	token, err := s.auth.Issue(u.ID, u.Username)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  map[string]any{"id": u.ID, "username": u.Username},
	})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"id": p.UserID, "username": p.Username})
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if len(req.NewPassword) < 6 {
		writeErr(w, http.StatusBadRequest, "Mật khẩu mới tối thiểu 6 ký tự")
		return
	}
	u, err := s.st.GetUserByID(p.UserID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	if !auth.CheckPassword(u.PasswordHash, req.OldPassword) {
		writeErr(w, http.StatusUnauthorized, "Mật khẩu cũ không đúng")
		return
	}
	hash, _ := auth.HashPassword(req.NewPassword)
	if err := s.st.UpdatePassword(u.ID, hash); err != nil {
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.st.ListUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": users})
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || len(req.Password) < 6 {
		writeErr(w, http.StatusBadRequest, "Username bắt buộc, mật khẩu tối thiểu 6 ký tự")
		return
	}
	hash, _ := auth.HashPassword(req.Password)
	id, err := s.st.CreateUser(req.Username, hash)
	if err != nil {
		writeErr(w, http.StatusConflict, "Username đã tồn tại")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "username": req.Username})
}

// ── handlers: settings ────────────────────────────────────────────────────────

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	set, err := s.st.GetSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, redactSettings(set))
}

// getDefaults returns the shipped default prompt/rules so the UI can restore them.
func (s *Server) getDefaults(w http.ResponseWriter, r *http.Request) {
	rules, prompt, notify := store.Defaults()
	writeJSON(w, http.StatusOK, map[string]any{
		"rules":           rules,
		"system_prompt":   prompt,
		"notify_template": notify,
	})
}

func redactSettings(set store.Settings) map[string]any {
	return map[string]any{
		"forum_type": set.ForumType,
		"flarum": map[string]any{
			"base_url":    set.FlarumBaseURL,
			"bot_user_id": set.FlarumBotUserID,
			"connected":   set.FlarumToken != "",
		},
		"xenforo": map[string]any{
			"base_url":    set.XenforoBaseURL,
			"bot_user_id": set.XenforoBotUserID,
			"connected":   set.XenforoToken != "" || set.XenforoAPIKey != "",
		},
		"ai": map[string]any{
			"provider": set.AIProvider,
			"model":    set.AIModel,
			"has_key":  set.AIAPIKey != "",
		},
		"moderation": map[string]any{
			"enabled":                  set.Enabled,
			"auto_hide":                set.AutoHide,
			"notify_user":              set.NotifyUser,
			"violation_threshold":      set.ViolationThresh,
			"poll_interval_seconds":    set.PollIntervalSec,
			"strike_suspend_threshold": set.StrikeSuspendAt,
		},
		"rules":           set.Rules,
		"system_prompt":   set.SystemPrompt,
		"notify_template": set.NotifyTemplate,
	}
}

// updateSettings accepts a flat partial JSON object. Secret keys are only
// updated when a non-empty value is supplied.
func (s *Server) updateSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	updates := map[string]string{}
	put := func(key, val string) { updates[key] = val }

	strKeys := map[string]string{
		"forum_type":       "forum_type",
		"flarum_base_url":  "flarum_base_url",
		"xenforo_base_url": "xenforo_base_url",
		"ai_provider":      "ai_provider",
		"ai_model":         "ai_model",
		"rules":            "rules",
		"system_prompt":    "system_prompt",
		"notify_template":  "notify_template",
	}
	for in, k := range strKeys {
		if v, ok := body[in]; ok {
			if sv, ok := v.(string); ok {
				put(k, sv)
			}
		}
	}
	// Secret: only if non-empty.
	if v, ok := body["ai_api_key"].(string); ok && strings.TrimSpace(v) != "" {
		put("ai_api_key", v)
	}
	boolKeys := map[string]string{
		"moderation_enabled": "moderation_enabled",
		"auto_hide":          "auto_hide",
		"notify_user":        "notify_user",
	}
	for in, k := range boolKeys {
		if v, ok := body[in]; ok {
			if bv, ok := v.(bool); ok {
				put(k, boolStr(bv))
			}
		}
	}
	intKeys := map[string]string{
		"violation_threshold":      "violation_threshold",
		"poll_interval_seconds":    "poll_interval_seconds",
		"strike_suspend_threshold": "strike_suspend_threshold",
		"flarum_bot_user_id":       "flarum_bot_user_id",
		"xenforo_bot_user_id":      "xenforo_bot_user_id",
	}
	for in, k := range intKeys {
		if v, ok := body[in]; ok {
			if fv, ok := v.(float64); ok {
				put(k, strconv.Itoa(int(fv)))
			}
		}
	}
	if len(updates) == 0 {
		writeErr(w, http.StatusBadRequest, "no recognised fields")
		return
	}
	if err := s.st.SetSettings(updates); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	set, _ := s.st.GetSettings()
	writeJSON(w, http.StatusOK, redactSettings(set))
}

// connectFlarum exchanges admin credentials for an access token and stores it.
func (s *Server) connectFlarum(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BaseURL  string `json:"base_url"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	if req.BaseURL == "" || req.Username == "" {
		writeErr(w, http.StatusBadRequest, "base_url và username bắt buộc")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	token, userID, err := flarum.CreateToken(ctx, req.BaseURL, req.Username, req.Password)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "Kết nối Flarum thất bại: "+err.Error())
		return
	}
	if err := s.st.SetSettings(map[string]string{
		"flarum_base_url":    req.BaseURL,
		"flarum_token":       token,
		"flarum_bot_user_id": strconv.Itoa(userID),
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"connected": true, "bot_user_id": userID})
}

// testAI runs a real sample moderation using the SAME provider path as the
// production worker (ai.New → Moderate) so the result reflects exactly how the
// bot would judge a live post, applying the configured system prompt + rules.
//
// It ALWAYS responds 200 with an `ok` flag. A failure must never be a 5xx: a
// reverse proxy (Cloudflare / nginx) replaces 5xx bodies with its own error
// page, which would hide the real reason (e.g. "API key not valid") and leave
// the UI showing a useless "HTTP 502".
func (s *Server) testAI(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Sample string `json:"sample"`
	}
	_ = readJSON(r, &req)
	set, err := s.st.GetSettings()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	prov, err := ai.New(set.AIProvider, set.AIAPIKey, set.AIModel)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "provider": set.AIProvider, "model": set.AIModel, "error": err.Error(),
		})
		return
	}
	sample := req.Sample
	if strings.TrimSpace(sample) == "" {
		sample = "Thằng này ngu vãi, viết bài như rác, biến đi."
	}
	ctx, cancel := context.WithTimeout(r.Context(), 50*time.Second)
	defer cancel()
	res, err := prov.Moderate(ctx, ai.Input{
		SystemPrompt: set.SystemPrompt,
		Rules:        set.Rules,
		Content:      sample,
		PostType:     "Bình luận",
	})
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "provider": prov.Name(), "model": prov.Model(),
			"error": "AI test thất bại: " + err.Error(),
		})
		return
	}
	_ = s.st.AddTokenUsage(prov.Name(), prov.Model(), res.PromptTokens, res.CompletionTokens, res.TotalTokens)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"provider": prov.Name(),
		"model":    prov.Model(),
		"verdict":  verdictJSON(res),
	})
}

// verdictJSON normalises an ai.Result for the dashboard. Critically it joins
// Categories ([]string) into a comma string so the verdict shape matches the
// log rows (store.LogEntry.Categories is already a joined string) and the
// frontend AiVerdict type — otherwise the UI's categories.split(',') blows up.
func verdictJSON(res ai.Result) map[string]any {
	return map[string]any{
		"violation":       res.Violation,
		"confidence":      res.Confidence,
		"severity":        res.Severity,
		"categories":      strings.Join(res.Categories, ","),
		"reason":          res.Reason,
		"message_to_user": res.MessageToUser,
	}
}

// validateAI is a lightweight connectivity check for the provider + model + key.
// It makes one minimal real call so it genuinely proves the credentials work
// (not just a format check). Values may be supplied in the body to validate the
// config the user is editing BEFORE saving; any omitted field falls back to the
// stored settings (notably api_key, so the existing key can be re-tested without
// retyping it). Always returns 200 with an `ok` flag (see testAI for why).
func (s *Server) validateAI(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider string `json:"provider"`
		Model    string `json:"model"`
		APIKey   string `json:"api_key"`
	}
	_ = readJSON(r, &req)

	set, err := s.st.GetSettings()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	provider := firstNonEmpty(strings.TrimSpace(req.Provider), set.AIProvider)
	model := firstNonEmpty(strings.TrimSpace(req.Model), set.AIModel)
	apiKey := firstNonEmpty(strings.TrimSpace(req.APIKey), set.AIAPIKey)

	prov, err := ai.New(provider, apiKey, model)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "provider": provider, "model": model, "error": err.Error(),
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	start := time.Now()
	vres, mErr := prov.Moderate(ctx, ai.Input{
		SystemPrompt: "Bạn là bộ kiểm tra kết nối. Trả về một object JSON bất kỳ.",
		Rules:        "(phép thử kết nối — không có nội quy)",
		Content:      "ping",
		PostType:     "Bình luận",
	})
	latencyMs := time.Since(start).Milliseconds()
	if mErr != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "provider": prov.Name(), "model": prov.Model(),
			"latency_ms": latencyMs, "error": mErr.Error(),
		})
		return
	}
	_ = s.st.AddTokenUsage(prov.Name(), prov.Model(), vres.PromptTokens, vres.CompletionTokens, vres.TotalTokens)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "provider": prov.Name(), "model": prov.Model(), "latency_ms": latencyMs,
	})
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// ── handlers: scan by URL ─────────────────────────────────────────────────────

// scanURL fetches a whole forum thread (Flarum discussion or XenForo thread)
// from a pasted link, runs every post (opening post + comments) through the AI,
// and returns a per-post report. With auto_hide it also hides + notifies each
// violation on the spot; otherwise the operator decides per post via
// scanPostAction. Always 200 with an `ok` flag so proxies never hide the reason.
func (s *Server) scanURL(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL  string `json:"url"`
		Auto bool   `json:"auto"` // auto-process: hide violations + approve clean pending
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	platform, threadID, err := forum.ParseURL(req.URL)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	set, err := s.st.GetSettings()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	actor, err := forum.NewActorForPlatform(set, platform)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	prov, err := ai.New(set.AIProvider, set.AIAPIKey, set.AIModel)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "AI: " + err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	thread, err := actor.FetchThread(ctx, threadID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Không tải được thread: " + err.Error()})
		return
	}
	items := make([]map[string]any, 0, len(thread.Posts))
	scanned, violations, hidden, approved := 0, 0, 0, 0
	for _, p := range thread.Posts {
		it := map[string]any{
			"post_id": p.PostID, "thread_id": p.ThreadID, "platform": platform,
			"is_first_post": p.IsFirstPost, "author_id": p.AuthorID,
			"author_username": p.AuthorUsername, "excerpt": clip(p.Content, 280),
			"already_hidden": p.IsHidden, "pending": p.Pending, "violation": false,
		}
		// On-demand scans check every real post (unlike the live poller, there's
		// no reply-loop risk here, so we don't skip the bot's own account).
		if strings.TrimSpace(p.Content) == "" {
			it["skipped"] = true
			items = append(items, it)
			continue
		}
		ci := moderation.ContentItem{
			Platform: platform, PostID: p.PostID, ThreadID: p.ThreadID, ThreadTitle: thread.Title,
			AuthorID: p.AuthorID, AuthorUsername: p.AuthorUsername, Content: p.Content,
			IsFirstPost: p.IsFirstPost, Source: "scan-url",
		}
		v, act, mErr := s.worker.ModerateItem(ctx, set, ci, prov)
		if mErr != nil {
			it["error"] = mErr.Error()
			items = append(items, it)
			continue
		}
		scanned++
		it["violation"] = v.Violation
		it["confidence"] = v.Confidence
		it["severity"] = v.Severity
		it["categories"] = strings.Join(v.Categories, ",")
		it["reason"] = v.Reason
		it["message_to_user"] = v.MessageToUser
		switch {
		case act:
			violations++
			if req.Auto && !p.IsHidden {
				acts := s.worker.ActOnViolation(ctx, set, actor, ci, v, prov.Name(), prov.Model(), true)
				it["action"] = strings.Join(acts, "+")
				it["hidden"] = true
				hidden++
			}
		case req.Auto && p.Pending:
			// Clean post waiting in the moderation queue → publish it.
			if err := actor.Approve(ctx, p.PostID); err != nil {
				it["action"] = "approve_failed"
			} else {
				it["action"] = "approved"
				it["pending"] = false
				_, _ = s.worker.RecordOutcome(set, ci, v, prov.Name(), prov.Model(), "auto_approved")
				approved++
			}
		}
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "platform": platform, "thread_id": threadID, "title": thread.Title,
		"total": len(thread.Posts), "scanned": scanned, "violations": violations,
		"hidden": hidden, "approved": approved, "auto": req.Auto, "items": items,
	})
}

// scanPostAction hides (and notifies + records) or restores a single post from a
// scan report. The report item is passed back so the log + @mention reflect the
// AI verdict. Works for whichever platform the post belongs to.
func (s *Server) scanPostAction(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action         string  `json:"action"` // "hide" | "approve" | "restore"
		Platform       string  `json:"platform"`
		PostID         int64   `json:"post_id"`
		ThreadID       int64   `json:"thread_id"`
		AuthorID       int64   `json:"author_id"`
		AuthorUsername string  `json:"author_username"`
		Content        string  `json:"content"`
		Confidence     float64 `json:"confidence"`
		Severity       string  `json:"severity"`
		Categories     string  `json:"categories"`
		Reason         string  `json:"reason"`
		MessageToUser  string  `json:"message_to_user"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.PostID == 0 {
		writeErr(w, http.StatusBadRequest, "post_id bắt buộc")
		return
	}
	set, err := s.st.GetSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	actor, err := forum.NewActorForPlatform(set, req.Platform)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	ci := moderation.ContentItem{
		Platform: actor.Platform(), PostID: req.PostID, ThreadID: req.ThreadID,
		AuthorID: req.AuthorID, AuthorUsername: req.AuthorUsername, Content: req.Content,
		Source: "scan-url",
	}
	switch req.Action {
	case "hide":
		v := ai.Result{
			Violation: true, Confidence: req.Confidence, Severity: req.Severity,
			Categories: splitCSV(req.Categories), Reason: req.Reason, MessageToUser: req.MessageToUser,
		}
		acts := s.worker.ActOnViolation(ctx, set, actor, ci, v, set.AIProvider, set.AIModel, true)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "action": strings.Join(acts, "+")})
	case "approve":
		if err := actor.Approve(ctx, req.PostID); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		v := ai.Result{Violation: false, Confidence: req.Confidence, Severity: req.Severity, Reason: req.Reason}
		_, _ = s.worker.RecordOutcome(set, ci, v, set.AIProvider, set.AIModel, "approved")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "action": "approved"})
	case "restore":
		if err := actor.SetHidden(ctx, req.PostID, false); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "action": "restored"})
	default:
		writeErr(w, http.StatusBadRequest, "action không hợp lệ (hide|approve|restore)")
	}
}

// tokenStats returns accumulated AI token usage per provider+model plus totals.
func (s *Server) tokenStats(w http.ResponseWriter, r *http.Request) {
	rows, err := s.st.ListTokenUsage()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rows == nil {
		rows = []store.TokenUsage{}
	}
	var tp, tc, tt, calls int64
	for _, u := range rows {
		tp += u.PromptTokens
		tc += u.CompletionTokens
		tt += u.TotalTokens
		calls += u.Calls
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": rows,
		"totals": map[string]any{
			"prompt_tokens": tp, "completion_tokens": tc, "total_tokens": tt, "calls": calls,
		},
	})
}

// ── handlers: full-forum scan ─────────────────────────────────────────────────

// fullScanStart kicks off a background pass over every post on the forum. It
// pages by post id (batch of 25) from 1 → newest, so it covers all posts across
// thousands of threads without thread-level pagination. Always 200 + ok flag.
func (s *Server) fullScanStart(w http.ResponseWriter, r *http.Request) {
	if err := s.worker.StartFullScan(time.Now().UTC().Format(time.RFC3339)); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) fullScanStop(w http.ResponseWriter, r *http.Request) {
	s.worker.StopFullScan()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) fullScanStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.worker.FullScanStatus())
}

// clip trims s to at most n runes, appending an ellipsis when truncated.
func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n])) + "…"
}

func splitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// connectXenforo validates the XenForo API key (login check) and stores it as
// the reusable token for subsequent calls.
func (s *Server) connectXenforo(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BaseURL   string `json:"base_url"`
		APIKey    string `json:"api_key"`
		BotUserID int    `json:"bot_user_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	if req.BaseURL == "" || strings.TrimSpace(req.APIKey) == "" {
		writeErr(w, http.StatusBadRequest, "base_url và api_key bắt buộc")
		return
	}
	if req.BotUserID <= 0 {
		req.BotUserID = 1
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	xc := xenforo.New(req.BaseURL, req.APIKey, req.BotUserID)
	uid, err := xc.Connect(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "Kết nối XenForo thất bại: "+err.Error())
		return
	}
	if err := s.st.SetSettings(map[string]string{
		"forum_type":          "xenforo",
		"xenforo_base_url":    req.BaseURL,
		"xenforo_api_key":     req.APIKey,
		"xenforo_token":       req.APIKey, // XF keys don't expire; reuse as token
		"xenforo_bot_user_id": strconv.Itoa(req.BotUserID),
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"connected": true, "me_user_id": uid})
}

// getIntegration returns the ingest key + hints for configuring the XenForo add-on.
func (s *Server) getIntegration(w http.ResponseWriter, r *http.Request) {
	set, err := s.st.GetSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"forum_type":     set.ForumType,
		"ingest_api_key": set.IngestAPIKey,
		"ingest_login":   "/api/ingest/login",
		"ingest_moderate": "/api/ingest/moderate",
		"xenforo": map[string]any{
			"connected":   set.XenforoToken != "" || set.XenforoAPIKey != "",
			"base_url":    set.XenforoBaseURL,
			"bot_user_id": set.XenforoBotUserID,
		},
	})
}

func (s *Server) regenerateIngestKey(w http.ResponseWriter, r *http.Request) {
	key := store.NewIngestKey()
	if err := s.st.SetSetting("ingest_api_key", key); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ingest_api_key": key})
}

// ── handlers: ingest (XenForo add-on) ─────────────────────────────────────────

// ingestLogin validates the shared ingest key and returns a Bearer token the
// add-on caches and reuses for /api/ingest/moderate.
func (s *Server) ingestLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		APIKey string `json:"api_key"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	set, err := s.st.GetSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if set.IngestAPIKey == "" || req.APIKey != set.IngestAPIKey {
		writeErr(w, http.StatusUnauthorized, "ingest api key không hợp lệ")
		return
	}
	token, err := s.auth.Issue(0, "ingest")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "expires_in_days": 7})
}

// ingestModerate is called by the XenForo add-on for each new post/comment. It
// runs the same AI engine + logging + strike accounting as the Flarum poller and
// returns the recommended action for the add-on to enforce.
func (s *Server) ingestModerate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Platform       string `json:"platform"`
		PostID         int64  `json:"post_id"`
		ThreadID       int64  `json:"thread_id"`
		ThreadTitle    string `json:"thread_title"`
		AuthorID       int64  `json:"author_id"`
		AuthorUsername string `json:"author_username"`
		Content        string `json:"content"`
		Type           string `json:"type"` // "thread" | "comment"
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	set, err := s.st.GetSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !set.Enabled {
		writeJSON(w, http.StatusOK, map[string]any{"action": "allow", "violation": false, "skipped": true})
		return
	}
	prov, err := ai.New(set.AIProvider, set.AIAPIKey, set.AIModel)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	platform := req.Platform
	if platform == "" {
		platform = "xenforo"
	}
	item := moderation.ContentItem{
		Platform:       platform,
		PostID:         req.PostID,
		ThreadID:       req.ThreadID,
		ThreadTitle:    req.ThreadTitle,
		AuthorID:       req.AuthorID,
		AuthorUsername: req.AuthorUsername,
		Content:        req.Content,
		IsFirstPost:    req.Type == "thread",
		Source:         platform + "-ingest",
	}
	ctx, cancel := context.WithTimeout(r.Context(), 55*time.Second)
	defer cancel()
	verdict, act, err := s.worker.ModerateItem(ctx, set, item, prov)
	if err != nil {
		_, _ = s.worker.RecordOutcome(set, item, ai.Result{}, prov.Name(), prov.Model(), "error: "+err.Error())
		writeErr(w, http.StatusBadGateway, "AI lỗi: "+err.Error())
		return
	}

	action := "allow"
	if act {
		if set.AutoHide {
			action = "reject" // add-on hides/holds the post
		} else {
			action = "flag"
		}
	}
	taken := "none"
	if act {
		taken = platform + ":" + action
	}
	_, _ = s.worker.RecordOutcome(set, item, verdict, prov.Name(), prov.Model(), taken)

	writeJSON(w, http.StatusOK, map[string]any{
		"violation":       verdict.Violation,
		"confidence":      verdict.Confidence,
		"severity":        verdict.Severity,
		"categories":      verdict.Categories,
		"reason":          verdict.Reason,
		"message_to_user": verdict.MessageToUser,
		"action":          action, // allow | flag | reject
		"should_hide":     act && set.AutoHide,
		"should_notify":   act && set.NotifyUser,
	})
}

// ── handlers: logs ────────────────────────────────────────────────────────────

func (s *Server) listLogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.LogFilter{
		OnlyViolations: q.Get("violation") == "1" || q.Get("violation") == "true",
		Query:          q.Get("q"),
		Limit:          atoiDefault(q.Get("limit"), 50),
		Offset:         atoiDefault(q.Get("offset"), 0),
	}
	items, total, err := s.st.ListLogs(f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if items == nil {
		items = []store.LogEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

func (s *Server) getLogDetail(w http.ResponseWriter, r *http.Request) {
	id := atoi64(r.PathValue("id"))
	e, err := s.st.GetLog(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) hideLog(w http.ResponseWriter, r *http.Request)   { s.toggleHide(w, r, true) }
func (s *Server) unhideLog(w http.ResponseWriter, r *http.Request) { s.toggleHide(w, r, false) }

func (s *Server) toggleHide(w http.ResponseWriter, r *http.Request, hidden bool) {
	id := atoi64(r.PathValue("id"))
	e, err := s.st.GetLog(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	set, err := s.st.GetSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "settings error")
		return
	}
	actor, err := forum.NewActor(set)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if err := actor.SetHidden(ctx, e.PostID, hidden); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	action := "manual_unhide"
	if hidden {
		action = "manual_hide"
	}
	_ = s.st.UpdateLogAction(id, action)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "hidden": hidden})
}

// ── handlers: strikes ─────────────────────────────────────────────────────────

func (s *Server) listStrikes(w http.ResponseWriter, r *http.Request) {
	items, err := s.st.ListStrikes()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if items == nil {
		items = []store.Strike{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) setStrikeStatus(w http.ResponseWriter, r *http.Request) {
	userID := atoi64(r.PathValue("userId"))
	var req struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	switch req.Status {
	case "active", "flagged", "suspended":
	default:
		writeErr(w, http.StatusBadRequest, "status không hợp lệ")
		return
	}
	if err := s.st.SetStrikeStatus(userID, req.Status, req.Note); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) resetStrike(w http.ResponseWriter, r *http.Request) {
	userID := atoi64(r.PathValue("userId"))
	if err := s.st.ResetStrikes(userID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ── handlers: backfill + stats ────────────────────────────────────────────────

func (s *Server) backfill(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Limit int `json:"limit"`
	}
	_ = readJSON(r, &req)
	if s.worker.Running() {
		writeErr(w, http.StatusConflict, "Đang có tác vụ quét chạy, thử lại sau")
		return
	}
	go func(limit int) {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		res, err := s.worker.Backfill(ctx, limit)
		if err != nil {
			s.log.Printf("backfill error: %v", err)
			return
		}
		s.log.Printf("backfill done: scanned=%d violations=%d range=%d-%d",
			res.Scanned, res.Violations, res.FromID, res.ToID)
	}(req.Limit)
	writeJSON(w, http.StatusAccepted, map[string]any{"started": true})
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	platform := r.URL.Query().Get("platform") // "" = tất cả, "flarum" | "xenforo"
	st, err := s.st.GetStats(platform)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	set, _ := s.st.GetSettings()
	xenKey := set.XenforoToken
	if xenKey == "" {
		xenKey = set.XenforoAPIKey
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"stats": st,
		"worker": map[string]any{
			"running":    s.worker.Running(),
			"last_error": s.worker.LastError(),
		},
		"status": map[string]any{
			"enabled":           set.Enabled,
			"flarum_connected":  set.FlarumToken != "",
			"xenforo_connected": xenKey != "" && set.XenforoBaseURL != "",
			"ai_configured":     set.AIAPIKey != "",
			"provider":          set.AIProvider,
			"model":             set.AIModel,
			"threshold":         set.ViolationThresh,
			"poll_interval":     set.PollIntervalSec,
			"platform":          platform,
		},
	})
}

// ── small helpers ─────────────────────────────────────────────────────────────

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func atoiDefault(s string, def int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return def
}

func atoi64(s string) int64 { n, _ := strconv.ParseInt(s, 10, 64); return n }
