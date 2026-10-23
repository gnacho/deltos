package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"time"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/errors"
	"github.com/gnacho/deltos/server-go/internal/ids"
	"github.com/gnacho/deltos/server-go/internal/push"
)

// registerPushRoutes ports server/src/routes-push.ts: subscription endpoints
// (VAPID public key, subscribe, unsubscribe, per-type preferences). The push
// endpoint is a secret capability URL and is NEVER logged.
func (s *Server) registerPushRoutes(r *rtr) {
	r.Get("/api/push/vapid-public-key", s.handleVapidPublicKey)
	r.Post("/api/push/subscribe", s.handlePushSubscribe)
	r.Delete("/api/push/unsubscribe", s.handlePushUnsubscribe)
	r.Get("/api/push/preferences", s.handlePushPreferencesGet)
	r.Put("/api/push/preferences", s.handlePushPreferencesPut)
}

func (s *Server) pushConfigured() bool { return s.Push != nil && s.Push.Configured() }

func validURL(raw string, max int) bool {
	if raw == "" || len(raw) > max {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return false
	}
	return u.Scheme == "https" || u.Scheme == "http"
}

// handleVapidPublicKey serves the public VAPID key for applicationServerKey.
// It is not secret, but only served with a session. In demo (and without keys
// configured) the UI detects it.
func (s *Server) handleVapidPublicKey(w http.ResponseWriter, r *http.Request) {
	if auth.DemoFrom(r) {
		writeJSON(w, http.StatusOK, map[string]any{"demo": true})
		return
	}
	if !s.pushConfigured() {
		errors.Write(w, errors.New(http.StatusServiceUnavailable, errors.PushNotConfigured))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"publicKey": s.Push.PublicKeyOrEmpty()})
}

type pushSubscribeBody struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// handlePushSubscribe upserts by endpoint: re-subscription or user switch on
// the same browser = UPDATE (the endpoint is unique per device/browser).
func (s *Server) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	if auth.DemoFrom(r) {
		errors.Write(w, errors.New(http.StatusNotImplemented, errors.PushDemoUnavailable))
		return
	}
	if !s.pushConfigured() {
		errors.Write(w, errors.New(http.StatusServiceUnavailable, errors.PushNotConfigured))
		return
	}
	var body pushSubscribeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	var issues []issue
	if !validURL(body.Endpoint, 1000) {
		issues = append(issues, issue{Path: []string{"endpoint"}, Message: "invalid URL"})
	}
	if len(body.Keys.P256dh) < 1 || len(body.Keys.P256dh) > 200 {
		issues = append(issues, issue{Path: []string{"keys", "p256dh"}, Message: "p256dh must be 1-200 characters"})
	}
	if len(body.Keys.Auth) < 1 || len(body.Keys.Auth) > 200 {
		issues = append(issues, issue{Path: []string{"keys", "auth"}, Message: "auth must be 1-200 characters"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}

	user := auth.UserFrom(r)
	d := auth.DBFrom(r)
	now := time.Now().UnixMilli()
	ua := r.Header.Get("User-Agent")
	uaArg := any(ua)
	if ua == "" {
		uaArg = nil
	}
	_, err := d.Exec(
		`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(endpoint) DO UPDATE SET
		   user_id = excluded.user_id,
		   p256dh = excluded.p256dh,
		   auth = excluded.auth,
		   user_agent = excluded.user_agent,
		   updated_at = excluded.updated_at`,
		ids.New(), user.ID, body.Endpoint, body.Keys.P256dh, body.Keys.Auth, uaArg, now, now)
	if err != nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true})
}

type pushUnsubscribeBody struct {
	Endpoint string `json:"endpoint"`
}

// handlePushUnsubscribe deletes ONLY if the subscription belongs to the session
// user. In demo there is nothing to delete.
func (s *Server) handlePushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	if auth.DemoFrom(r) {
		writeJSON(w, http.StatusOK, map[string]any{"demo": true})
		return
	}
	var body pushUnsubscribeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if !validURL(body.Endpoint, 1000) {
		validationFailed(w, []issue{{Path: []string{"endpoint"}, Message: "invalid URL"}})
		return
	}
	_, _ = auth.DBFrom(r).Exec("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", body.Endpoint, auth.UserFrom(r).ID)
	w.WriteHeader(http.StatusNoContent)
}

// handlePushPreferencesGet returns the per-type toggles (absence = enabled).
func (s *Server) handlePushPreferencesGet(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFrom(r)
	d := auth.DBFrom(r)
	rows, err := d.Query("SELECT tipo, enabled FROM notification_preferences WHERE user_id = ?", user.ID)
	if err != nil {
		internalErr(w)
		return
	}
	off := map[string]bool{}
	for rows.Next() {
		var tipo string
		var enabled int
		if err := rows.Scan(&tipo, &enabled); err != nil {
			rows.Close()
			internalErr(w)
			return
		}
		if enabled == 0 {
			off[tipo] = true
		}
	}
	rows.Close()
	prefs := map[string]bool{}
	for _, tipo := range push.TiposPush {
		prefs[tipo] = !off[tipo]
	}
	writeJSON(w, http.StatusOK, map[string]any{"prefs": prefs})
}

type pushPrefBody struct {
	Tipo    string `json:"tipo"`
	Enabled bool   `json:"enabled"`
}

func (s *Server) handlePushPreferencesPut(w http.ResponseWriter, r *http.Request) {
	if auth.DemoFrom(r) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.DemoReadOnly))
		return
	}
	var body pushPrefBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if !push.IsValidTipo(body.Tipo) {
		validationFailed(w, []issue{{Path: []string{"tipo"}, Message: "invalid type"}})
		return
	}
	enabled := 0
	if body.Enabled {
		enabled = 1
	}
	_, err := auth.DBFrom(r).Exec(
		`INSERT INTO notification_preferences (user_id, tipo, enabled, min_severity, updated_at)
		 VALUES (?, ?, ?, 'normal', ?)
		 ON CONFLICT(user_id, tipo) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
		auth.UserFrom(r).ID, body.Tipo, enabled, time.Now().UnixMilli())
	if err != nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
