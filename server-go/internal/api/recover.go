package api

import (
	cryptorand "crypto/rand"
	"encoding/base64"
	"net"
	"net/http"

	"github.com/gnacho/deltos/server-go/internal/errors"
	"golang.org/x/crypto/bcrypt"
)

// handleRecover is the emergency password kit: reachable ONLY from a direct
// localhost connection (127.0.0.1/::1), it resets every admin password to a
// random temporary one returned once in the response. The Node server has no
// such endpoint: this is ported from the Helios pattern as an operational
// safety net (documented in the phase digest).
func (s *Server) handleRecover(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Forwarded-For") != "" || r.Header.Get("X-Real-IP") != "" {
		errors.Write(w, errors.New(http.StatusForbidden, errors.AuthForbidden))
		return
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if host != "127.0.0.1" && host != "::1" {
		errors.Write(w, errors.New(http.StatusForbidden, errors.AuthForbidden))
		return
	}

	raw := make([]byte, 12)
	if _, err := cryptorand.Read(raw); err != nil {
		internalErr(w)
		return
	}
	temp := base64.RawURLEncoding.EncodeToString(raw)
	hash, err := bcrypt.GenerateFromPassword([]byte(temp), 10)
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := s.Prod.Exec("UPDATE users SET password_hash = ? WHERE role = 'admin'", string(hash)); err != nil {
		internalErr(w)
		return
	}
	// Audit: there is no session, so the actor is the first admin (if any).
	var actor string
	if err := s.Prod.QueryRow("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").Scan(&actor); err == nil && actor != "" {
		auditLog(s.Prod, actor, "admin_recover", "system", nil, map[string]any{})
	}
	log.Info("admin_recover", "reason", "temporary password reset from localhost")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "tempPassword": temp})
}
