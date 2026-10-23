package api

import (
	"net/http"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/errors"
)

// handleDemoLogin is the one-click demo entry (no password): 403 when disabled
// in Settings. The session lives in the demo database (read-only).
func (s *Server) handleDemoLogin(w http.ResponseWriter, r *http.Request) {
	if s.Prod.KVGet("demo_enabled", "1") != "1" {
		errors.Write(w, errors.New(http.StatusForbidden, errors.AuthDemoDisabled))
		return
	}
	user, err := auth.GetUserByUsername(s.Demo, "demo")
	if err != nil {
		internalErr(w)
		return
	}
	if user == nil {
		errors.Write(w, errors.New(http.StatusServiceUnavailable, errors.DemoUnavailable))
		return
	}
	if previous := s.Auth.ResolveSession(r); previous != nil {
		_ = auth.DestroySession(previous.DB, previous.SessionID)
	}
	sessionID, csrfToken, err := auth.CreateSession(s.Demo, user.ID, r.Header.Get("User-Agent"))
	if err != nil {
		internalErr(w)
		return
	}
	s.Auth.SetCookie(w, sessionID, auth.SessionTTL)
	writeJSON(w, http.StatusOK, map[string]any{"user": user, "demo": true, "csrfToken": csrfToken})
}
