package store

import (
	"strings"
)

// LogEntry is one moderation decision recorded for audit + dashboard display.
type LogEntry struct {
	ID              int64   `json:"id"`
	PostID          int64   `json:"post_id"`
	DiscussionID    int64   `json:"discussion_id"`
	DiscussionTitle string  `json:"discussion_title"`
	AuthorUserID    int64   `json:"author_user_id"`
	AuthorUsername  string  `json:"author_username"`
	PostType        string  `json:"post_type"` // "discussion" | "comment"
	ContentExcerpt  string  `json:"content_excerpt"`
	Violation       bool    `json:"violation"`
	Confidence      float64 `json:"confidence"`
	Severity        string  `json:"severity"`
	Categories      string  `json:"categories"` // JSON array string
	Reason          string  `json:"reason"`
	MessageToUser   string  `json:"message_to_user"`
	ActionTaken     string  `json:"action_taken"`
	Source          string  `json:"source"`   // "live" | "backfill" | "scan-url" | "full-scan"
	Platform        string  `json:"platform"` // "flarum" | "xenforo"
	AIProvider      string  `json:"ai_provider"`
	AIModel         string  `json:"ai_model"`
	CreatedAt       string  `json:"created_at"`
}

func (s *Store) InsertLog(e LogEntry) (int64, error) {
	res, err := s.db.Exec(`
		INSERT INTO moderation_logs(
			post_id, discussion_id, discussion_title, author_user_id, author_username,
			post_type, content_excerpt, violation, confidence, severity, categories,
			reason, message_to_user, action_taken, source, platform, ai_provider, ai_model, created_at
		) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		e.PostID, e.DiscussionID, e.DiscussionTitle, e.AuthorUserID, e.AuthorUsername,
		e.PostType, e.ContentExcerpt, boolToInt(e.Violation), e.Confidence, e.Severity, e.Categories,
		e.Reason, e.MessageToUser, e.ActionTaken, e.Source, e.Platform, e.AIProvider, e.AIModel, nowUTC())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// LogFilter narrows the log listing.
type LogFilter struct {
	OnlyViolations bool
	Query          string // matches author or content
	Limit          int
	Offset         int
}

func (s *Store) ListLogs(f LogFilter) ([]LogEntry, int, error) {
	where := []string{"1=1"}
	args := []any{}
	if f.OnlyViolations {
		where = append(where, "violation = 1")
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		where = append(where, "(author_username LIKE ? OR content_excerpt LIKE ? OR discussion_title LIKE ?)")
		like := "%" + q + "%"
		args = append(args, like, like, like)
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM moderation_logs WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args = append(args, limit, f.Offset)
	rows, err := s.db.Query(`
		SELECT id, post_id, discussion_id, discussion_title, author_user_id, author_username,
		       post_type, content_excerpt, violation, confidence, severity, categories,
		       reason, message_to_user, action_taken, source, COALESCE(platform,''), ai_provider, ai_model, created_at
		FROM moderation_logs WHERE `+whereSQL+`
		ORDER BY id DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out, err := scanLogs(rows)
	return out, total, err
}

func (s *Store) GetLog(id int64) (LogEntry, error) {
	rows, err := s.db.Query(`
		SELECT id, post_id, discussion_id, discussion_title, author_user_id, author_username,
		       post_type, content_excerpt, violation, confidence, severity, categories,
		       reason, message_to_user, action_taken, source, COALESCE(platform,''), ai_provider, ai_model, created_at
		FROM moderation_logs WHERE id = ?`, id)
	if err != nil {
		return LogEntry{}, err
	}
	defer rows.Close()
	list, err := scanLogs(rows)
	if err != nil {
		return LogEntry{}, err
	}
	if len(list) == 0 {
		return LogEntry{}, ErrNotFound
	}
	return list[0], nil
}

func (s *Store) UpdateLogAction(id int64, action string) error {
	_, err := s.db.Exec(`UPDATE moderation_logs SET action_taken = ? WHERE id = ?`, action, id)
	return err
}

type scanner interface {
	Scan(dest ...any) error
	Next() bool
	Err() error
}

func scanLogs(rows scanner) ([]LogEntry, error) {
	var out []LogEntry
	for rows.Next() {
		var e LogEntry
		var violation int
		if err := rows.Scan(
			&e.ID, &e.PostID, &e.DiscussionID, &e.DiscussionTitle, &e.AuthorUserID, &e.AuthorUsername,
			&e.PostType, &e.ContentExcerpt, &violation, &e.Confidence, &e.Severity, &e.Categories,
			&e.Reason, &e.MessageToUser, &e.ActionTaken, &e.Source, &e.Platform, &e.AIProvider, &e.AIModel, &e.CreatedAt,
		); err != nil {
			return nil, err
		}
		e.Violation = violation != 0
		out = append(out, e)
	}
	return out, rows.Err()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
