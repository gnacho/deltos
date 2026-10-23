package api

import (
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/update"
)

// registerUpdateRoutes ports the self-update endpoints of server/src/app.ts
// (admin only): status (latest stable release), progress (apply progress file)
// and apply (writes the .update-requested flag for the systemd .path unit).
func (s *Server) registerUpdateRoutes(r *rtr) {
	r.Get("/api/update/status", s.handleUpdateStatus)
	r.Get("/api/update/progress", s.handleUpdateProgress)
	r.Post("/api/update/apply", s.handleUpdateApply)
}

func (s *Server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, s.Cfg.Update.Status(s.Prod))
}

func (s *Server) handleUpdateProgress(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"progress": update.ReadProgress(s.Cfg.DataDir)})
}

func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	user := auth.UserFrom(r)
	auditLog(s.Prod, user.ID, "update.apply", "system", nil, map[string]any{})
	// The service is sandboxed (ProtectSystem=strict + no-root): it cannot run
	// deltos-update.sh with privileges. It writes a flag in the data dir
	// (writable); a systemd .path (deltos-update.path) detects it and launches
	// deltos-update.service (root) on-demand. The apply is async: the front
	// polls /api/version until the build changes.
	flag := filepath.Join(s.Cfg.DataDir, ".update-requested")
	if err := os.WriteFile(flag, []byte(time.Now().UTC().Format("2006-01-02T15:04:05.000Z")), 0o644); err != nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"requested": true})
}
