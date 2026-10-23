// Command server is the Deltos Go entrypoint (port of server/src/index.ts,
// phase 1 scope: config, databases, bootstrap admin, inbox, auto-archive,
// HTTP server, hourly maintenance, graceful shutdown). Demo seed, push,
// digest and update arrive in phases 5-6.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/gnacho/deltos/server-go/internal/api"
	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/config"
	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/logger"
	"github.com/gnacho/deltos/server-go/internal/version"
)

var log = logger.L().Child(map[string]any{"component": "server"})

func main() {
	if err := run(); err != nil {
		log.Error("fatal", "error", err.Error())
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "uploads"), 0o755); err != nil {
		return err
	}

	// Two separate databases: demo data NEVER mixes with production.
	prod, err := db.Open(filepath.Join(cfg.DataDir, "app.db"))
	if err != nil {
		return err
	}
	defer prod.Close()
	demo, err := db.Open(filepath.Join(cfg.DataDir, "app_demo.db"))
	if err != nil {
		return err
	}
	defer demo.Close()

	// demo_enabled=1 by default: only controls whether the "Enter as demo"
	// button shows on the login screen (the demo DB is read-only anyway).
	if prod.KVGet("demo_enabled", "") == "" {
		if err := prod.KVSet("demo_enabled", "1"); err != nil {
			return err
		}
	}

	secret := auth.GetSecret(prod, cfg.SessionSecret)
	if _, err := auth.EnsureBootstrapAdmin(prod, cfg.AuthUser, cfg.AuthPass); err != nil {
		return err
	}
	// "Sin proyecto" tray: created once users exist (all of them members).
	if _, err := prod.EnsureInbox(); err != nil {
		return err
	}
	if _, err := demo.EnsureInbox(); err != nil {
		return err
	}

	// Auto-archive tasks/expenses done more than N days ago (boot + hourly).
	for _, d := range []*db.DB{prod, demo} {
		if _, err := d.ArchiveStaleDoneTasks(); err != nil {
			log.Error("auto_archive_failed", "db", "tasks", "error", err.Error())
		}
		if _, err := d.ArchiveStaleDoneExpenses(); err != nil {
			log.Error("auto_archive_failed", "db", "expenses", "error", err.Error())
		}
	}

	build := os.Getenv("BUILD_SHA")
	if build == "" {
		build = version.Version
	}
	srv := api.New(&auth.Service{
		Prod: prod, Demo: demo, Secret: secret, CookieSecure: cfg.CookieSecure,
	}, prod, demo, api.Config{
		CookieSecure:  cfg.CookieSecure,
		MaxUploadMB:   cfg.MaxUploadMB,
		MaxSSEClients: cfg.MaxSSEClients,
		StaticDir:     cfg.StaticDir,
		UploadsDir:    filepath.Join(cfg.DataDir, "uploads"),
		Version:       version.Version,
		Build:         build,
		TrustedProxy:  cfg.TrustedProxy,
	})

	httpServer := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Info("server_listening", "port", cfg.Port, "data_dir", cfg.DataDir, "static_dir", cfg.StaticDir)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("listen_failed", "error", err.Error())
			os.Exit(1)
		}
	}()

	// Hourly maintenance: WAL truncate checkpoint, session/trash purge and
	// auto-archive (SSE notifications join in phase 2).
	stop := make(chan struct{})
	go func() {
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				prod.HourlyMaintenance("prod")
				demo.HourlyMaintenance("demo")
				if n, err := prod.ArchiveStaleDoneTasks(); err == nil && n > 0 {
					// Auto-archive changed the board: notify SSE clients.
					srv.Hub.Broadcast("tasks")
				}
				if _, err := demo.ArchiveStaleDoneTasks(); err != nil {
					log.Error("hourly_maintenance_failed", "error", err.Error())
				}
				if _, err := prod.ArchiveStaleDoneExpenses(); err != nil {
					log.Error("hourly_maintenance_failed", "error", err.Error())
				}
				if _, err := demo.ArchiveStaleDoneExpenses(); err != nil {
					log.Error("hourly_maintenance_failed", "error", err.Error())
				}
			case <-stop:
				return
			}
		}
	}()

	// Graceful shutdown (SIGTERM/SIGINT).
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	s := <-sig
	log.Info("server_shutdown", "signal", s.String())
	close(stop)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return httpServer.Shutdown(ctx)
}
