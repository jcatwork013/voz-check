// Package flarum is a small JSON:API client for the Flarum forum, covering the
// few operations the moderation bot needs: discover new posts, read a post with
// its author + discussion, hide/unhide a post, and reply (to @mention a user).
//
// All endpoints/shapes here were verified against a live Flarum 1.x instance.
package flarum

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	base      string
	token     string
	botUserID int
	hc        *http.Client
}

func New(baseURL, token string, botUserID int) *Client {
	return &Client{
		base:      strings.TrimRight(baseURL, "/"),
		token:     token,
		botUserID: botUserID,
		hc:        &http.Client{Timeout: 20 * time.Second},
	}
}

// Post is a flattened view of a Flarum post resource.
type Post struct {
	ID                int64
	Number            int
	ContentType       string
	ContentHTML       string
	Content           string // markdown source (admin-visible)
	IsHidden          bool
	IsApproved        bool // false ⇒ awaiting approval (mod queue)
	CreatedAt         string
	AuthorID          int64
	AuthorUsername    string
	AuthorDisplayName string
	DiscussionID      int64
	DiscussionTitle   string
}

// IsFirstPost reports whether this is the opening post of its discussion.
func (p Post) IsFirstPost() bool { return p.Number == 1 }

func (c *Client) authHeader() string {
	return fmt.Sprintf("Token %s; userId=%d", c.token, c.botUserID)
}

func (c *Client) do(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", c.authHeader())
	}
	return c.hc.Do(req)
}

func decodeError(resp *http.Response) error {
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return fmt.Errorf("flarum %s: %s", resp.Status, strings.TrimSpace(string(b)))
}

// ── JSON:API wire types ───────────────────────────────────────────────────────

type resource struct {
	Type       string                     `json:"type"`
	ID         string                     `json:"id"`
	Attributes map[string]json.RawMessage `json:"attributes"`
	// Data is kept raw because JSON:API relationships are either a single ref
	// (to-one, e.g. user) or an array (to-many, e.g. posts/tags). Decoding into a
	// fixed shape would fail on the array form; use relRef() to read a to-one.
	Relationships map[string]struct {
		Data json.RawMessage `json:"data"`
	} `json:"relationships"`
}

type relRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// relOne returns the to-one ref of a named relationship, or nil (handles absent
// relationships and silently ignores to-many arrays).
func (r resource) relOne(name string) *relRef {
	rel, ok := r.Relationships[name]
	if !ok || len(rel.Data) == 0 {
		return nil
	}
	var ref relRef
	if json.Unmarshal(rel.Data, &ref) != nil || ref.ID == "" {
		return nil
	}
	return &ref
}

type doc struct {
	Data     json.RawMessage `json:"data"`
	Included []resource      `json:"included"`
	Errors   []struct {
		Status string `json:"status"`
		Code   string `json:"code"`
		Detail string `json:"detail"`
	} `json:"errors"`
}

func attrString(r resource, key string) string {
	if raw, ok := r.Attributes[key]; ok {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
	}
	return ""
}

func attrBool(r resource, key string) bool {
	if raw, ok := r.Attributes[key]; ok {
		var b bool
		if json.Unmarshal(raw, &b) == nil {
			return b
		}
	}
	return false
}

func attrInt(r resource, key string) int {
	if raw, ok := r.Attributes[key]; ok {
		var n int
		if json.Unmarshal(raw, &n) == nil {
			return n
		}
	}
	return 0
}

func atoi64(s string) int64 { n, _ := strconv.ParseInt(s, 10, 64); return n }

// ── Token ─────────────────────────────────────────────────────────────────────

// CreateToken exchanges admin credentials for a long-lived access token. Used by
// the "test/connect Flarum" dashboard action so operators never paste raw tokens.
func CreateToken(ctx context.Context, baseURL, identification, password string) (token string, userID int, err error) {
	body, _ := json.Marshal(map[string]string{"identification": identification, "password": password})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(baseURL, "/")+"/api/token", bytes.NewReader(body))
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	hc := &http.Client{Timeout: 20 * time.Second}
	resp, err := hc.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", 0, decodeError(resp)
	}
	var out struct {
		Token  string `json:"token"`
		UserID int    `json:"userId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", 0, err
	}
	return out.Token, out.UserID, nil
}

// ── Discovery ─────────────────────────────────────────────────────────────────

// NewestPostID returns the highest post id currently on the forum. Flarum sorts
// discussions by most-recent activity, so the top discussion's lastPost is the
// global newest post. Returns 0 when the forum has no posts.
func (c *Client) NewestPostID(ctx context.Context) (int64, error) {
	resp, err := c.do(ctx, http.MethodGet, "/api/discussions?page%5Blimit%5D=1&include=lastPost", nil)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, decodeError(resp)
	}
	var d doc
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return 0, err
	}
	var list []resource
	if err := json.Unmarshal(d.Data, &list); err != nil || len(list) == 0 {
		return 0, nil
	}
	lp := list[0].relOne("lastPost")
	if lp == nil {
		return 0, nil
	}
	return atoi64(lp.ID), nil
}

// FetchPosts loads posts by id with their author + discussion, flattened.
func (c *Client) FetchPosts(ctx context.Context, ids []int64) ([]Post, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	strs := make([]string, len(ids))
	for i, id := range ids {
		strs[i] = strconv.FormatInt(id, 10)
	}
	path := "/api/posts?include=user,discussion&filter%5Bid%5D=" + strings.Join(strs, ",")
	resp, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, decodeError(resp)
	}
	var d doc
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return nil, err
	}
	return flattenPosts(d)
}

// flattenPosts turns a JSON:API posts document (data + included users/discussions)
// into the flat Post view. Shared by FetchPosts and FetchDiscussionPosts.
func flattenPosts(d doc) ([]Post, error) {
	var raw []resource
	if err := json.Unmarshal(d.Data, &raw); err != nil {
		return nil, err
	}

	users := map[string]resource{}
	discs := map[string]resource{}
	for _, inc := range d.Included {
		switch inc.Type {
		case "users":
			users[inc.ID] = inc
		case "discussions":
			discs[inc.ID] = inc
		}
	}

	out := make([]Post, 0, len(raw))
	for _, r := range raw {
		p := Post{
			ID:          atoi64(r.ID),
			Number:      attrInt(r, "number"),
			ContentType: attrString(r, "contentType"),
			ContentHTML: attrString(r, "contentHtml"),
			Content:     attrString(r, "content"),
			IsHidden:    attrBool(r, "isHidden"),
			// Default approved=true; only the Approval extension emits isApproved,
			// and absence means the post is live.
			IsApproved: true,
			CreatedAt:  attrString(r, "createdAt"),
		}
		if raw, ok := r.Attributes["isApproved"]; ok {
			var b bool
			if json.Unmarshal(raw, &b) == nil {
				p.IsApproved = b
			}
		}
		if rf := r.relOne("user"); rf != nil {
			p.AuthorID = atoi64(rf.ID)
			if u, ok := users[rf.ID]; ok {
				p.AuthorUsername = attrString(u, "username")
				p.AuthorDisplayName = attrString(u, "displayName")
			}
		}
		if rf := r.relOne("discussion"); rf != nil {
			p.DiscussionID = atoi64(rf.ID)
			if ds, ok := discs[rf.ID]; ok {
				p.DiscussionTitle = attrString(ds, "title")
			}
		}
		out = append(out, p)
	}
	return out, nil
}

// ListDiscussions returns up to `limit` discussion ids from the given offset.
// Used by the full-forum scan to walk every thread (paginated).
func (c *Client) ListDiscussions(ctx context.Context, offset, limit int) ([]int64, error) {
	path := fmt.Sprintf("/api/discussions?page%%5Blimit%%5D=%d&page%%5Boffset%%5D=%d", limit, offset)
	resp, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, decodeError(resp)
	}
	// Minimal decode: we only need discussion ids. Decoding the full resource
	// would choke on to-many relationships (e.g. `posts.data` is an array).
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(out.Data))
	for _, r := range out.Data {
		ids = append(ids, atoi64(r.ID))
	}
	return ids, nil
}

// FetchDiscussionPosts loads every (comment-type) post of a discussion, ordered
// by number, paging through the JSON:API result. Capped at maxScanPosts to bound
// AI usage on very long threads.
func (c *Client) FetchDiscussionPosts(ctx context.Context, discussionID int64) ([]Post, error) {
	const pageLimit = 50
	const maxScanPosts = 300
	var all []Post
	for offset := 0; offset < maxScanPosts; offset += pageLimit {
		path := fmt.Sprintf(
			"/api/posts?filter%%5Bdiscussion%%5D=%d&include=user,discussion&sort=number&page%%5Blimit%%5D=%d&page%%5Boffset%%5D=%d",
			discussionID, pageLimit, offset)
		resp, err := c.do(ctx, http.MethodGet, path, nil)
		if err != nil {
			return nil, err
		}
		var d doc
		if resp.StatusCode != http.StatusOK {
			e := decodeError(resp)
			resp.Body.Close()
			return nil, e
		}
		derr := json.NewDecoder(resp.Body).Decode(&d)
		resp.Body.Close()
		if derr != nil {
			return nil, derr
		}
		page, err := flattenPosts(d)
		if err != nil {
			return nil, err
		}
		// Keep only real comment posts (skip events like "discussionRenamed").
		for _, p := range page {
			if p.ContentType == "" || p.ContentType == "comment" {
				all = append(all, p)
			}
		}
		if len(page) < pageLimit {
			break
		}
	}
	return all, nil
}

// ── Actions ───────────────────────────────────────────────────────────────────

// SetHidden hides or unhides a post.
func (c *Client) SetHidden(ctx context.Context, postID int64, hidden bool) error {
	body := map[string]any{"data": map[string]any{
		"type":       "posts",
		"id":         strconv.FormatInt(postID, 10),
		"attributes": map[string]any{"isHidden": hidden},
	}}
	resp, err := c.do(ctx, http.MethodPatch, "/api/posts/"+strconv.FormatInt(postID, 10), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return decodeError(resp)
	}
	return nil
}

// Approve publishes a post awaiting moderation (and un-hides it if hidden).
func (c *Client) Approve(ctx context.Context, postID int64) error {
	body := map[string]any{"data": map[string]any{
		"type":       "posts",
		"id":         strconv.FormatInt(postID, 10),
		"attributes": map[string]any{"isApproved": true, "isHidden": false},
	}}
	resp, err := c.do(ctx, http.MethodPatch, "/api/posts/"+strconv.FormatInt(postID, 10), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return decodeError(resp)
	}
	return nil
}

// Reply posts a comment into a discussion and returns the new post id. Used to
// @mention an offending user, which triggers Flarum's native notification.
func (c *Client) Reply(ctx context.Context, discussionID int64, content string) (int64, error) {
	body := map[string]any{"data": map[string]any{
		"type":       "posts",
		"attributes": map[string]any{"content": content},
		"relationships": map[string]any{
			"discussion": map[string]any{"data": map[string]any{
				"type": "discussions", "id": strconv.FormatInt(discussionID, 10),
			}},
		},
	}}
	resp, err := c.do(ctx, http.MethodPost, "/api/posts", body)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return 0, decodeError(resp)
	}
	var d doc
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return 0, err
	}
	var r resource
	if err := json.Unmarshal(d.Data, &r); err != nil {
		return 0, err
	}
	return atoi64(r.ID), nil
}

// Mention builds the Flarum mention source token for a user: @"username"#id.
func Mention(username string, userID int64) string {
	return fmt.Sprintf("@\"%s\"#%d", username, userID)
}

// Platform identifies this adapter.
func (c *Client) Platform() string { return "flarum" }

// MentionTag is the method form of Mention (satisfies the forum.Actor interface).
func (c *Client) MentionTag(username string, userID int64) string {
	return Mention(username, userID)
}
