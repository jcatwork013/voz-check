package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"strconv"
)

// NewIngestKey generates a fresh ingest API key (for the dashboard regenerate action).
func NewIngestKey() string { return randomKey() }

// randomKey returns a 32-char hex secret for the ingest API key.
func randomKey() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "voz-ingest-key-change-me"
	}
	return hex.EncodeToString(b)
}

// Settings is the typed view over the key/value settings table. Secrets
// (FlarumToken, AIAPIKey) are never serialised to the dashboard directly; the
// HTTP layer exposes only boolean "has key" flags.
type Settings struct {
	ForumType        string `json:"forum_type"` // "flarum" | "xenforo"
	FlarumBaseURL    string `json:"flarum_base_url"`
	FlarumToken      string `json:"-"`
	FlarumBotUserID  int    `json:"flarum_bot_user_id"`
	// XenForo (push/add-on model). XenoToken is obtained via API login and reused.
	XenforoBaseURL   string `json:"xenforo_base_url"`
	XenforoAPIKey    string `json:"-"`
	XenforoBotUserID int    `json:"xenforo_bot_user_id"`
	XenforoToken     string `json:"-"`
	// Shared secret the XenForo add-on uses to obtain an ingest token.
	IngestAPIKey     string `json:"-"`
	AIProvider       string `json:"ai_provider"` // "gemini" | "openai"
	AIAPIKey         string `json:"-"`
	AIModel          string `json:"ai_model"`
	Enabled          bool   `json:"moderation_enabled"`
	AutoHide         bool   `json:"auto_hide"`
	NotifyUser       bool   `json:"notify_user"`
	ViolationThresh  int    `json:"violation_threshold"` // 0-100
	PollIntervalSec  int    `json:"poll_interval_seconds"`
	StrikeSuspendAt  int    `json:"strike_suspend_threshold"`
	Rules            string `json:"rules"`
	SystemPrompt     string `json:"system_prompt"`
	NotifyTemplate   string `json:"notify_template"`
}

// Setting keys (kept as constants to avoid typos).
const (
	kForumType        = "forum_type"
	kFlarumBaseURL    = "flarum_base_url"
	kFlarumToken      = "flarum_token"
	kFlarumBotUserID  = "flarum_bot_user_id"
	kXenforoBaseURL   = "xenforo_base_url"
	kXenforoAPIKey    = "xenforo_api_key"
	kXenforoBotUserID = "xenforo_bot_user_id"
	kXenforoToken     = "xenforo_token"
	kIngestAPIKey     = "ingest_api_key"
	kAIProvider       = "ai_provider"
	kAIAPIKey        = "ai_api_key"
	kAIModel         = "ai_model"
	kEnabled         = "moderation_enabled"
	kAutoHide        = "auto_hide"
	kNotifyUser      = "notify_user"
	kViolationThresh = "violation_threshold"
	kPollInterval    = "poll_interval_seconds"
	kStrikeSuspend   = "strike_suspend_threshold"
	kRules           = "rules"
	kSystemPrompt    = "system_prompt"
	kNotifyTemplate  = "notify_template"
)

func (s *Store) seedDefaults() error {
	defaults := map[string]string{
		kForumType:        "flarum",
		kFlarumBaseURL:    "http://community-flarum:8888",
		kFlarumToken:      "",
		kFlarumBotUserID:  "1",
		kXenforoBaseURL:   "",
		kXenforoAPIKey:    "",
		kXenforoBotUserID: "1",
		kXenforoToken:     "",
		kIngestAPIKey:     randomKey(),
		kAIProvider:       "gemini",
		kAIAPIKey:        "",
		kAIModel:         "gemini-2.0-flash",
		kEnabled:         "false", // off until operator configures keys
		kAutoHide:        "true",
		kNotifyUser:      "true",
		kViolationThresh: "75",
		kPollInterval:    "10",
		kStrikeSuspend:   "3",
		kRules:           defaultRules,
		kSystemPrompt:    defaultSystemPrompt,
		kNotifyTemplate:  defaultNotifyTemplate,
	}
	for k, v := range defaults {
		if _, err := s.db.Exec(`INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)`, k, v); err != nil {
			return err
		}
	}
	return nil
}

// GetSettings returns the full typed settings (including secrets — callers in
// the moderation worker need them; the HTTP layer redacts before sending).
func (s *Store) GetSettings() (Settings, error) {
	rows, err := s.db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return Settings{}, err
	}
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return Settings{}, err
		}
		m[k] = v
	}
	if err := rows.Err(); err != nil {
		return Settings{}, err
	}
	atoi := func(k string, def int) int {
		if n, err := strconv.Atoi(m[k]); err == nil {
			return n
		}
		return def
	}
	forumType := m[kForumType]
	if forumType == "" {
		forumType = "flarum"
	}
	return Settings{
		ForumType:        forumType,
		FlarumBaseURL:    m[kFlarumBaseURL],
		FlarumToken:      m[kFlarumToken],
		FlarumBotUserID:  atoi(kFlarumBotUserID, 1),
		XenforoBaseURL:   m[kXenforoBaseURL],
		XenforoAPIKey:    m[kXenforoAPIKey],
		XenforoBotUserID: atoi(kXenforoBotUserID, 1),
		XenforoToken:     m[kXenforoToken],
		IngestAPIKey:     m[kIngestAPIKey],
		AIProvider:       m[kAIProvider],
		AIAPIKey:        m[kAIAPIKey],
		AIModel:         m[kAIModel],
		Enabled:         m[kEnabled] == "true",
		AutoHide:        m[kAutoHide] == "true",
		NotifyUser:      m[kNotifyUser] == "true",
		ViolationThresh: atoi(kViolationThresh, 75),
		PollIntervalSec: atoi(kPollInterval, 10),
		StrikeSuspendAt: atoi(kStrikeSuspend, 3),
		Rules:           m[kRules],
		SystemPrompt:    m[kSystemPrompt],
		NotifyTemplate:  m[kNotifyTemplate],
	}, nil
}

// SetSetting upserts a single key. Empty secret values are ignored so a partial
// update from the dashboard never wipes an existing key.
func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(
		`INSERT INTO settings(key, value) VALUES(?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// SetSettings applies a batch of key updates in a transaction.
func (s *Store) SetSettings(updates map[string]string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	stmt, err := tx.Prepare(`INSERT INTO settings(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for k, v := range updates {
		if _, err := stmt.Exec(k, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetSetting reads one key, returning "" if absent.
func (s *Store) GetSetting(key string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}
