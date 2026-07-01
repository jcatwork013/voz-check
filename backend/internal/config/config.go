package config

import (
	"os"
	"strconv"
)

// Config holds process-level configuration sourced from the environment.
// Everything that an operator can change at runtime (Flarum token, AI key,
// prompts, thresholds) lives in the database instead — see store.Settings.
type Config struct {
	Addr           string // HTTP listen address, e.g. ":8080"
	DBPath         string // SQLite file path
	JWTSecret      string // secret for signing dashboard JWTs
	BootstrapUser  string // seed admin username (created if no users exist)
	BootstrapPass  string // seed admin password
	AllowedOrigin  string // CORS allow-origin for the dashboard (dev convenience)
}

func Load() Config {
	return Config{
		Addr:          env("VOZ_ADDR", ":8080"),
		DBPath:        env("VOZ_DB_PATH", "/data/vozcheck.db"),
		JWTSecret:     env("VOZ_JWT_SECRET", "change-me-in-production"),
		BootstrapUser: env("VOZ_ADMIN_USER", "admin"),
		BootstrapPass: env("VOZ_ADMIN_PASS", "admin123"),
		AllowedOrigin: env("VOZ_CORS_ORIGIN", ""),
	}
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

// EnvInt reads an integer env var with a fallback (exported for reuse/tests).
func EnvInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
