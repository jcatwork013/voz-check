// Package forum provides the adapter abstraction so the dashboard can act on
// either a Flarum or a XenForo forum through one interface. Two adapters exist:
//   - flarum  (pull model: backend polls + enforces)
//   - xenforo (push model: add-on intercepts + enforces; this client also covers
//     direct actions like manual hide/restore and on-demand thread scans)
package forum

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"vozcheck/internal/flarum"
	"vozcheck/internal/store"
	"vozcheck/internal/xenforo"
)

// ScannedPost is a platform-agnostic view of one post in a thread.
type ScannedPost struct {
	PostID         int64
	ThreadID       int64
	AuthorID       int64
	AuthorUsername string
	Content        string
	IsFirstPost    bool
	IsHidden       bool
	Pending        bool // awaiting moderation/approval (mod queue)
}

// Thread is a fetched discussion/thread with all of its posts.
type Thread struct {
	ID    int64
	Title string
	Posts []ScannedPost
}

// Actor is the set of read + enforcement actions the dashboard performs on a forum.
type Actor interface {
	Platform() string
	// FetchThread loads a whole thread (opening post + replies) for scanning.
	FetchThread(ctx context.Context, threadID int64) (Thread, error)
	// IterateThreads walks EVERY thread on the forum (paginated), calling fn with
	// each fully-loaded thread. Used by the full-forum scan. Honours ctx cancel.
	IterateThreads(ctx context.Context, fn func(Thread) error) error
	SetHidden(ctx context.Context, postID int64, hidden bool) error
	// Approve publishes a post awaiting moderation (and un-hides it).
	Approve(ctx context.Context, postID int64) error
	Reply(ctx context.Context, threadID int64, content string) (int64, error)
	MentionTag(username string, userID int64) string
}

// NewActor builds the adapter for the configured forum type.
func NewActor(set store.Settings) (Actor, error) {
	return NewActorForPlatform(set, set.ForumType)
}

// NewActorForPlatform builds the adapter for an explicit platform ("flarum" |
// "xenforo"), regardless of the configured default. Used by the scan-by-URL
// feature so a Flarum link works even when XenForo is the primary forum (and
// vice-versa), as long as that platform's credentials are present.
func NewActorForPlatform(set store.Settings, platform string) (Actor, error) {
	switch platform {
	case "flarum", "":
		if set.FlarumToken == "" {
			return nil, fmt.Errorf("Flarum chưa kết nối")
		}
		return flarumActor{flarum.New(set.FlarumBaseURL, set.FlarumToken, set.FlarumBotUserID)}, nil
	case "xenforo":
		key := set.XenforoToken
		if key == "" {
			key = set.XenforoAPIKey
		}
		if key == "" || set.XenforoBaseURL == "" {
			return nil, fmt.Errorf("XenForo chưa kết nối")
		}
		return xenForoActor{xenforo.New(set.XenforoBaseURL, key, set.XenforoBotUserID)}, nil
	default:
		return nil, fmt.Errorf("forum_type không hợp lệ: %q", platform)
	}
}

var (
	reFlarumDiscussion = regexp.MustCompile(`/d/(\d+)`)
	// XenForo accepts both the full /threads/ route and the short /t/ alias
	// (used by big forums like voz.vn), with or without a slug before the id.
	reXenforoThread = regexp.MustCompile(`/t(?:hreads)?/(?:[^/]*\.)?(\d+)`)
)

// ParseURL detects the platform and thread/discussion id from a forum URL.
//   - Flarum:  https://host/d/6-some-slug          → ("flarum", 6)
//   - XenForo: https://host/threads/some-slug.42/   → ("xenforo", 42)
//   - XenForo: https://voz.vn/t/some-slug.805478/   → ("xenforo", 805478)
func ParseURL(raw string) (platform string, threadID int64, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", 0, fmt.Errorf("link trống")
	}
	if m := reFlarumDiscussion.FindStringSubmatch(raw); m != nil {
		return "flarum", atoi64(m[1]), nil
	}
	if m := reXenforoThread.FindStringSubmatch(raw); m != nil {
		return "xenforo", atoi64(m[1]), nil
	}
	return "", 0, fmt.Errorf("không nhận ra link diễn đàn (cần dạng .../d/{id}-... cho Flarum hoặc .../threads/...{id}/ cho XenForo)")
}

// ── flarum adapter ────────────────────────────────────────────────────────────

type flarumActor struct{ c *flarum.Client }

func (f flarumActor) Platform() string { return f.c.Platform() }
func (f flarumActor) SetHidden(ctx context.Context, postID int64, hidden bool) error {
	return f.c.SetHidden(ctx, postID, hidden)
}
func (f flarumActor) Approve(ctx context.Context, postID int64) error {
	return f.c.Approve(ctx, postID)
}
func (f flarumActor) Reply(ctx context.Context, threadID int64, content string) (int64, error) {
	return f.c.Reply(ctx, threadID, content)
}
func (f flarumActor) MentionTag(username string, userID int64) string {
	return f.c.MentionTag(username, userID)
}
func (f flarumActor) FetchThread(ctx context.Context, threadID int64) (Thread, error) {
	posts, err := f.c.FetchDiscussionPosts(ctx, threadID)
	if err != nil {
		return Thread{}, err
	}
	t := Thread{ID: threadID, Posts: make([]ScannedPost, 0, len(posts))}
	for _, p := range posts {
		if t.Title == "" && p.DiscussionTitle != "" {
			t.Title = p.DiscussionTitle
		}
		t.Posts = append(t.Posts, ScannedPost{
			PostID:         p.ID,
			ThreadID:       p.DiscussionID,
			AuthorID:       p.AuthorID,
			AuthorUsername: p.AuthorUsername,
			Content:        flarumText(p),
			IsFirstPost:    p.IsFirstPost(),
			IsHidden:       p.IsHidden,
			Pending:        !p.IsApproved,
		})
	}
	return t, nil
}

func (f flarumActor) IterateThreads(ctx context.Context, fn func(Thread) error) error {
	const limit = 50
	for offset := 0; ; offset += limit {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		ids, err := f.c.ListDiscussions(ctx, offset, limit)
		if err != nil {
			return err
		}
		for _, id := range ids {
			t, ferr := f.FetchThread(ctx, id)
			if ferr != nil {
				continue
			}
			if err := fn(t); err != nil {
				return err
			}
		}
		if len(ids) < limit {
			return nil
		}
	}
}

// flarumText prefers the markdown source, falling back to stripped HTML.
func flarumText(p flarum.Post) string {
	if s := strings.TrimSpace(p.Content); s != "" {
		return s
	}
	return strings.TrimSpace(stripTags(p.ContentHTML))
}

var reTags = regexp.MustCompile(`(?s)<[^>]*>`)

func stripTags(s string) string { return reTags.ReplaceAllString(s, " ") }

// ── xenforo adapter ───────────────────────────────────────────────────────────

// xenForoActor adapts *xenforo.Client to the Actor interface (method name parity).
type xenForoActor struct{ c *xenforo.Client }

func (x xenForoActor) Platform() string { return x.c.Platform() }
func (x xenForoActor) SetHidden(ctx context.Context, postID int64, hidden bool) error {
	return x.c.SetHidden(ctx, postID, hidden)
}
func (x xenForoActor) Approve(ctx context.Context, postID int64) error {
	return x.c.Approve(ctx, postID)
}
func (x xenForoActor) Reply(ctx context.Context, threadID int64, content string) (int64, error) {
	return x.c.Reply(ctx, threadID, content)
}
func (x xenForoActor) MentionTag(username string, userID int64) string {
	return x.c.Mention(username, userID)
}
func (x xenForoActor) FetchThread(ctx context.Context, threadID int64) (Thread, error) {
	posts, err := x.c.FetchThreadPosts(ctx, threadID)
	if err != nil {
		return Thread{}, err
	}
	t := Thread{ID: threadID, Posts: make([]ScannedPost, 0, len(posts))}
	for _, p := range posts {
		if t.Title == "" && p.ThreadTitle != "" {
			t.Title = p.ThreadTitle
		}
		t.Posts = append(t.Posts, ScannedPost{
			PostID:         p.ID,
			ThreadID:       p.ThreadID,
			AuthorID:       p.UserID,
			AuthorUsername: p.Username,
			Content:        strings.TrimSpace(p.Message),
			IsFirstPost:    p.IsFirstPost(),
			IsHidden:       p.MessageState == "deleted",
			Pending:        p.MessageState == "moderated",
		})
	}
	return t, nil
}

func (x xenForoActor) IterateThreads(ctx context.Context, fn func(Thread) error) error {
	for page := 1; ; page++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		ids, last, err := x.c.ListThreads(ctx, page)
		if err != nil {
			return err
		}
		for _, id := range ids {
			t, ferr := x.FetchThread(ctx, id)
			if ferr != nil {
				continue
			}
			if err := fn(t); err != nil {
				return err
			}
		}
		if len(ids) == 0 || page >= last {
			return nil
		}
	}
}

func atoi64(s string) int64 {
	var n int64
	for _, r := range s {
		if r < '0' || r > '9' {
			break
		}
		n = n*10 + int64(r-'0')
	}
	return n
}
