// Package xenforo is a thin client for the XenForo 2.2+ REST API. The primary
// XenForo integration is the push-based add-on (it intercepts post saves and
// calls our ingest API), but this client lets the backend validate the API key
// ("login → save token → reuse") and act directly when needed (hide/restore a
// post, reply to @mention a user).
//
// NOTE: endpoints/fields follow the official XenForo REST docs but have not yet
// been verified against a live instance — connect/validate before relying on
// write actions.
package xenforo

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	base      string // API root, e.g. https://forum.tld/api
	apiKey    string
	botUserID int
	hc        *http.Client
}

func New(baseURL, apiKey string, botUserID int) *Client {
	return &Client{
		base:      normaliseBase(baseURL),
		apiKey:    apiKey,
		botUserID: botUserID,
		hc:        &http.Client{Timeout: 20 * time.Second},
	}
}

// normaliseBase ensures the URL ends with "/api" (XenForo's REST root).
func normaliseBase(u string) string {
	u = strings.TrimRight(u, "/")
	if !strings.HasSuffix(u, "/api") {
		u += "/api"
	}
	return u
}

func (c *Client) Platform() string { return "xenforo" }

func (c *Client) newReq(ctx context.Context, method, path string, form url.Values) (*http.Request, error) {
	var body io.Reader
	full := c.base + path
	if method == http.MethodGet && form != nil {
		full += "?" + form.Encode()
	} else if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, full, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("XF-Api-Key", c.apiKey)
	if c.botUserID > 0 {
		req.Header.Set("XF-Api-User", strconv.Itoa(c.botUserID))
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	return req, nil
}

func (c *Client) do(req *http.Request) ([]byte, int, error) {
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return b, resp.StatusCode, nil
}

// Connect validates the API key + bot user by calling GET /me. On success the
// caller persists the key as the reusable "token".
func (c *Client) Connect(ctx context.Context) (int, error) {
	req, err := c.newReq(ctx, http.MethodGet, "/me", nil)
	if err != nil {
		return 0, err
	}
	b, code, err := c.do(req)
	if err != nil {
		return 0, err
	}
	if code != http.StatusOK {
		return 0, fmt.Errorf("xenforo /me HTTP %d: %.200s", code, string(b))
	}
	var out struct {
		Me struct {
			UserID int `json:"user_id"`
		} `json:"me"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return 0, fmt.Errorf("decode /me: %w", err)
	}
	return out.Me.UserID, nil
}

// Post is the subset of a XenForo post we use.
type Post struct {
	ID           int64
	ThreadID     int64
	ThreadTitle  string
	Position     int
	UserID       int64
	Username     string
	Message      string // bbcode source
	MessageState string // visible | moderated | deleted
}

func (p Post) IsFirstPost() bool { return p.Position == 0 }

// FetchPost loads a single post by id.
func (c *Client) FetchPost(ctx context.Context, postID int64) (Post, error) {
	req, err := c.newReq(ctx, http.MethodGet, "/posts/"+strconv.FormatInt(postID, 10), nil)
	if err != nil {
		return Post{}, err
	}
	b, code, err := c.do(req)
	if err != nil {
		return Post{}, err
	}
	if code != http.StatusOK {
		return Post{}, fmt.Errorf("xenforo get post HTTP %d: %.200s", code, string(b))
	}
	var out struct {
		Post struct {
			PostID       int64  `json:"post_id"`
			ThreadID     int64  `json:"thread_id"`
			Position     int    `json:"position"`
			UserID       int64  `json:"user_id"`
			Username     string `json:"username"`
			Message      string `json:"message"`
			MessageState string `json:"message_state"`
			Thread       struct {
				Title string `json:"title"`
			} `json:"Thread"`
		} `json:"post"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return Post{}, err
	}
	p := out.Post
	return Post{
		ID: p.PostID, ThreadID: p.ThreadID, ThreadTitle: p.Thread.Title,
		Position: p.Position, UserID: p.UserID, Username: p.Username,
		Message: p.Message, MessageState: p.MessageState,
	}, nil
}

// FetchThreadPosts loads every post of a thread (the opening post + replies),
// paging through XenForo's /threads/{id}/posts. Capped at maxScanPosts to bound
// AI usage on very long threads.
func (c *Client) FetchThreadPosts(ctx context.Context, threadID int64) ([]Post, error) {
	const maxScanPosts = 300
	var all []Post
	title := ""
	for page := 1; ; page++ {
		form := url.Values{"page": {strconv.Itoa(page)}}
		req, err := c.newReq(ctx, http.MethodGet, "/threads/"+strconv.FormatInt(threadID, 10)+"/posts", form)
		if err != nil {
			return nil, err
		}
		b, code, err := c.do(req)
		if err != nil {
			return nil, err
		}
		if code != http.StatusOK {
			return nil, fmt.Errorf("xenforo thread posts HTTP %d: %.200s", code, string(b))
		}
		var out struct {
			Posts []struct {
				PostID       int64  `json:"post_id"`
				ThreadID     int64  `json:"thread_id"`
				Position     int    `json:"position"`
				UserID       int64  `json:"user_id"`
				Username     string `json:"username"`
				Message      string `json:"message"`
				MessageState string `json:"message_state"`
			} `json:"posts"`
			Thread struct {
				Title string `json:"title"`
			} `json:"thread"`
			Pagination struct {
				CurrentPage int `json:"current_page"`
				LastPage    int `json:"last_page"`
			} `json:"pagination"`
		}
		if err := json.Unmarshal(b, &out); err != nil {
			return nil, err
		}
		if out.Thread.Title != "" {
			title = out.Thread.Title
		}
		for _, p := range out.Posts {
			all = append(all, Post{
				ID: p.PostID, ThreadID: p.ThreadID, ThreadTitle: title,
				Position: p.Position, UserID: p.UserID, Username: p.Username,
				Message: p.Message, MessageState: p.MessageState,
			})
		}
		if out.Pagination.LastPage <= out.Pagination.CurrentPage || len(all) >= maxScanPosts || len(out.Posts) == 0 {
			break
		}
	}
	return all, nil
}

// ListThreads returns one page of thread ids the bot can see, plus the last
// page number. Used by the full-forum scan to walk every thread (paginated).
func (c *Client) ListThreads(ctx context.Context, page int) (ids []int64, lastPage int, err error) {
	form := url.Values{"page": {strconv.Itoa(page)}}
	req, err := c.newReq(ctx, http.MethodGet, "/threads", form)
	if err != nil {
		return nil, 0, err
	}
	b, code, err := c.do(req)
	if err != nil {
		return nil, 0, err
	}
	if code != http.StatusOK {
		return nil, 0, fmt.Errorf("xenforo list threads HTTP %d: %.200s", code, string(b))
	}
	var out struct {
		Threads []struct {
			ThreadID int64 `json:"thread_id"`
		} `json:"threads"`
		Pagination struct {
			CurrentPage int `json:"current_page"`
			LastPage    int `json:"last_page"`
		} `json:"pagination"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, 0, err
	}
	for _, t := range out.Threads {
		ids = append(ids, t.ThreadID)
	}
	last := out.Pagination.LastPage
	if last < out.Pagination.CurrentPage {
		last = out.Pagination.CurrentPage
	}
	return ids, last, nil
}

// SetHidden soft-deletes (hide) or restores a post. XenForo has no "hidden" flag;
// soft delete (message_state=deleted) is the reversible equivalent.
func (c *Client) SetHidden(ctx context.Context, postID int64, hidden bool) error {
	id := strconv.FormatInt(postID, 10)
	if hidden {
		form := url.Values{"hard_delete": {"0"}, "reason": {"VozCheck: vi phạm nội quy"}}
		req, err := c.newReq(ctx, http.MethodDelete, "/posts/"+id, form)
		if err != nil {
			return err
		}
		_, code, err := c.do(req)
		if err != nil {
			return err
		}
		if code != http.StatusOK {
			return fmt.Errorf("xenforo delete post HTTP %d", code)
		}
		return nil
	}
	// Restore: set message_state back to visible.
	form := url.Values{"message_state": {"visible"}}
	req, err := c.newReq(ctx, http.MethodPost, "/posts/"+id, form)
	if err != nil {
		return err
	}
	_, code, err := c.do(req)
	if err != nil {
		return err
	}
	if code != http.StatusOK {
		return fmt.Errorf("xenforo restore post HTTP %d", code)
	}
	return nil
}

// Approve publishes a post that is awaiting moderation (message_state=moderated)
// by setting it visible. Same underlying call as restoring a soft-deleted post.
func (c *Client) Approve(ctx context.Context, postID int64) error {
	form := url.Values{"message_state": {"visible"}}
	req, err := c.newReq(ctx, http.MethodPost, "/posts/"+strconv.FormatInt(postID, 10), form)
	if err != nil {
		return err
	}
	_, code, err := c.do(req)
	if err != nil {
		return err
	}
	if code != http.StatusOK {
		return fmt.Errorf("xenforo approve post HTTP %d", code)
	}
	return nil
}

// Reply posts a comment into a thread (as the bot user) and returns the new post id.
func (c *Client) Reply(ctx context.Context, threadID int64, content string) (int64, error) {
	form := url.Values{
		"thread_id": {strconv.FormatInt(threadID, 10)},
		"message":   {content},
	}
	req, err := c.newReq(ctx, http.MethodPost, "/posts", form)
	if err != nil {
		return 0, err
	}
	b, code, err := c.do(req)
	if err != nil {
		return 0, err
	}
	if code != http.StatusOK {
		return 0, fmt.Errorf("xenforo reply HTTP %d: %.200s", code, string(b))
	}
	var out struct {
		Post struct {
			PostID int64 `json:"post_id"`
		} `json:"post"`
	}
	_ = json.Unmarshal(b, &out)
	return out.Post.PostID, nil
}

// Mention builds the XenForo mention bbcode that triggers an alert.
func (c *Client) Mention(username string, userID int64) string {
	return fmt.Sprintf("[USER=%d]@%s[/USER]", userID, username)
}
