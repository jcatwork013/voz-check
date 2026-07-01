package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// ErrNotFound is returned by lookups that find no row.
var ErrNotFound = errors.New("not found")

// Store wraps a single SQLite connection pool. SQLite is single-writer, so we
// cap the pool at one connection and rely on WAL for concurrent reads.
type Store struct {
	db *sql.DB
}

// Open opens (creating if needed) the SQLite database, applies the schema and
// seeds default settings + the bootstrap admin account.
func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// modernc/sqlite is safe for concurrent use, but a single writer avoids
	// "database is locked" under our low write volume.
	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(0)

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if err := s.seedDefaults(); err != nil {
		return nil, fmt.Errorf("seed: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	const schema = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id          INTEGER NOT NULL,
  discussion_id    INTEGER,
  discussion_title TEXT,
  author_user_id   INTEGER,
  author_username  TEXT,
  post_type        TEXT,
  content_excerpt  TEXT,
  violation        INTEGER NOT NULL DEFAULT 0,
  confidence       REAL NOT NULL DEFAULT 0,
  severity         TEXT,
  categories       TEXT,
  reason           TEXT,
  message_to_user  TEXT,
  action_taken     TEXT,
  source           TEXT,            -- 'live' | 'backfill'
  ai_provider      TEXT,
  ai_model         TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_post   ON moderation_logs(post_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON moderation_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_violation ON moderation_logs(violation);

CREATE TABLE IF NOT EXISTS user_strikes (
  user_id           INTEGER PRIMARY KEY,
  username          TEXT,
  strikes           INTEGER NOT NULL DEFAULT 0,
  last_violation_at TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  note              TEXT
);

CREATE TABLE IF NOT EXISTS poller_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  last_post_id INTEGER NOT NULL DEFAULT 0,
  last_poll_at TEXT,
  last_error   TEXT
);
INSERT OR IGNORE INTO poller_state (id, last_post_id) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS token_usage (
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  calls             INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT,
  PRIMARY KEY (provider, model)
);
`
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	// Forward migration: add platform to logs for per-forum reporting. Ignore the
	// "duplicate column" error when the column already exists.
	_, _ = s.db.Exec(`ALTER TABLE moderation_logs ADD COLUMN platform TEXT`)
	return nil
}

func nowUTC() string { return time.Now().UTC().Format(time.RFC3339) }
