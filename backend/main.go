// Command vozcheck is the backend for the VozCheck AI moderation bot: it serves
// the dashboard REST API and runs the background poller that moderates new
// Flarum posts via Gemini/OpenAI.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"vozcheck/internal/auth"
	"vozcheck/internal/config"
	"vozcheck/internal/httpapi"
	"vozcheck/internal/moderation"
	"vozcheck/internal/store"
)

func main() {
	logger := log.New(os.Stdout, "[vozcheck] ", log.LstdFlags|log.Lmsgprefix)
	cfg := config.Load()

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		logger.Fatalf("open store: %v", err)
	}
	defer st.Close()

	if err := bootstrapAdmin(st, cfg, logger); err != nil {
		logger.Fatalf("bootstrap admin: %v", err)
	}

	authn := auth.New(cfg.JWTSecret)
	worker := moderation.New(st, logger)
	server := httpapi.New(st, authn, worker, logger, cfg.AllowedOrigin)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go worker.Run(ctx)

	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Printf("listening on %s (db=%s)", cfg.Addr, cfg.DBPath)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatalf("http server: %v", err)
		}
	}()

	<-ctx.Done()
	logger.Println("shutting down…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}

// bootstrapAdmin creates the seed dashboard account if no users exist yet.
func bootstrapAdmin(st *store.Store, cfg config.Config, logger *log.Logger) error {
	n, err := st.CountUsers()
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	hash, err := auth.HashPassword(cfg.BootstrapPass)
	if err != nil {
		return err
	}
	if _, err := st.CreateUser(cfg.BootstrapUser, hash); err != nil {
		return err
	}
	logger.Printf("seeded dashboard admin %q (đổi mật khẩu sau khi đăng nhập!)", cfg.BootstrapUser)
	return nil
}
