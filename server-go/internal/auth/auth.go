// Package auth ports server/src/auth.ts: HMAC-signed session cookie
// (deltos_session = "id.hmac", httpOnly, SameSite=Lax, 30 days), bcrypt
// password checks, SQLite-backed login lockout and the requireAuth
// middleware (sliding renewal, issue #251).
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/errors"
	"github.com/gnacho/deltos/server-go/internal/ids"
	"github.com/gnacho/deltos/server-go/internal/logger"
	"golang.org/x/crypto/bcrypt"
)

var log = logger.L().Child(map[string]any{"component": "auth"})

// SessionTTL is 30 days; with less than half the TTL ahead the session is
// extended and the cookie re-issued (sliding renewal, issue #251).
const (
	SessionTTL            = 30 * 24 * time.Hour
	SessionRenewThreshold = SessionTTL / 2
	CookieName            = "deltos_session"
	lockMs                = int64(5 * 60 * 1000) // 5 min lock after 5 failures
)

// DUMMY_HASH: bcrypt compare target when the user does not exist, to keep
// response timing uniform (anti user enumeration).
const DUMMY_HASH = "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012"

// User is the public session user (no password hash). Pointers serialize as
// JSON null, matching what better-sqlite3 returned to the frontend.
type User struct {
	ID                string  `json:"id"`
	Username          string  `json:"username"`
	DisplayName       *string `json:"display_name"`
	Email             *string `json:"email"`
	Phone             *string `json:"phone"`
	Color             string  `json:"color"`
	Language          string  `json:"language"`
	Role              string  `json:"role"`
	ExpensesEnabled   int     `json:"expenses_enabled"`
	AntiSlipThreshold int     `json:"anti_slip_threshold"`
	CreatedAt         int64   `json:"created_at"`
}

const userPublicCols = "id, username, display_name, email, phone, color, language, role, expenses_enabled, anti_slip_threshold, created_at"

// Service resolves sessions against the production database and, failing
// that, the demo database (both never mix).
type Service struct {
	Prod         *db.DB
	Demo         *db.DB
	Secret       string
	CookieSecure bool
}

// GetSecret returns the HMAC secret: env SESSION_SECRET, or generated and
// persisted in kv (dev convenience only, issue #168).
func GetSecret(prod *db.DB, envSecret string) string {
	if envSecret != "" {
		return envSecret
	}
	secret := prod.KVGet("session_secret", "")
	if secret == "" {
		secret = ids.RandomHex(32)
		_ = prod.KVSet("session_secret", secret)
		log.Warn("session_secret_generated", "reason", "no_env_secret", "stored", "kv_fallback")
	} else {
		log.Warn("session_secret_from_kv", "reason", "no_env_secret", "stored", "kv_fallback")
	}
	return secret
}

func hmacHex(secret, value string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(value))
	return hex.EncodeToString(m.Sum(nil))
}

func validSignature(secret, id, sig string) bool {
	expected, err1 := hex.DecodeString(hmacHex(secret, id))
	given, err2 := hex.DecodeString(sig)
	if err1 != nil || err2 != nil || len(expected) != len(given) {
		return false
	}
	return subtle.ConstantTimeCompare(expected, given) == 1
}

// CookieValue builds "id.hmac" for the session id.
func CookieValue(secret, sessionID string) string {
	return sessionID + "." + hmacHex(secret, sessionID)
}

// SetCookie writes the session cookie on the response.
func (s *Service) SetCookie(w http.ResponseWriter, sessionID string, maxAge time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    CookieValue(s.Secret, sessionID),
		Path:     "/",
		MaxAge:   int(maxAge / time.Second),
		HttpOnly: true,
		Secure:   s.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearCookie expires the session cookie.
func (s *Service) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

// CreateSession inserts a session row and returns id + csrf token.
func CreateSession(d *db.DB, userID, ua string) (id, csrfToken string, err error) {
	id = ids.New()
	csrfToken = ids.RandomHex(32)
	n := time.Now().UnixMilli()
	_, err = d.Exec(
		"INSERT INTO sessions (id, user_id, created_at, expires_at, ua, csrf_token) VALUES (?, ?, ?, ?, ?, ?)",
		id, userID, n, n+SessionTTL.Milliseconds(), nullIfEmpty(ua), csrfToken)
	return id, csrfToken, err
}

// DestroySession removes a session row.
func DestroySession(d *db.DB, sessionID string) error {
	_, err := d.Exec("DELETE FROM sessions WHERE id = ?", sessionID)
	return err
}

// Resolved is a valid session (equivalent of ResolvedSession).
type Resolved struct {
	DB        *db.DB
	Demo      bool
	User      *User
	SessionID string
	CSRFToken string
	Renew     bool
}

// ResolveSession checks the cookie against prod and demo; nil when invalid.
func (s *Service) ResolveSession(r *http.Request) *Resolved {
	c, err := r.Cookie(CookieName)
	if err != nil || c.Value == "" {
		return nil
	}
	raw := c.Value
	dot := strings.LastIndex(raw, ".")
	if dot < 1 {
		return nil
	}
	id, sig := raw[:dot], raw[dot+1:]
	if !validSignature(s.Secret, id, sig) {
		return nil
	}
	ua := r.Header.Get("User-Agent")
	nowMs := time.Now().UnixMilli()
	for _, cand := range []struct {
		d    *db.DB
		demo bool
	}{{s.Prod, false}, {s.Demo, true}} {
		if cand.d == nil {
			continue
		}
		var userID string
		var createdAt, expiresAt int64
		var uaVal, csrf sql.NullString
		err := cand.d.QueryRow("SELECT user_id, created_at, expires_at, ua, csrf_token FROM sessions WHERE id = ?", id).
			Scan(&userID, &createdAt, &expiresAt, &uaVal, &csrf)
		if err != nil || expiresAt <= nowMs {
			continue
		}
		// The User-Agent changes with legitimate browser/PWA updates: do not
		// invalidate the session, just refresh the fingerprint (issue #251).
		if uaVal.Valid && uaVal.String != ua && ua != "" {
			_, _ = cand.d.Exec("UPDATE sessions SET ua = ? WHERE id = ?", ua, id)
			log.Info("session_ua_updated", "sessionId", id, "reason", "ua_changed")
		}
		user, err := getUserPublic(cand.d, "WHERE id = ?", userID)
		if err != nil || user == nil {
			continue
		}
		return &Resolved{
			DB: cand.d, Demo: cand.demo, User: user, SessionID: id,
			CSRFToken: csrf.String, Renew: expiresAt-nowMs < SessionRenewThreshold.Milliseconds(),
		}
	}
	return nil
}

func getUserPublic(d *db.DB, where string, args ...any) (*User, error) {
	row := d.QueryRow("SELECT "+userPublicCols+" FROM users "+where, args...)
	return scanUser(row)
}

func scanUser(row *sql.Row) (*User, error) {
	var u User
	var displayName, email, phone sql.NullString
	err := row.Scan(&u.ID, &u.Username, &displayName, &email, &phone, &u.Color, &u.Language,
		&u.Role, &u.ExpensesEnabled, &u.AntiSlipThreshold, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if displayName.Valid {
		s := displayName.String
		u.DisplayName = &s
	}
	if email.Valid {
		s := email.String
		u.Email = &s
	}
	if phone.Valid {
		s := phone.String
		u.Phone = &s
	}
	return &u, nil
}

// Public paths under /api (everything else requires a session).
var publicPaths = map[string]bool{
	"/api/auth/login":  true,
	"/api/auth/demo":   true,
	"/api/auth/logout": true,
}

// IsPublicPath mirrors the isPublic check of requireAuth.
func IsPublicPath(path, method string) bool {
	if publicPaths[path] {
		return true
	}
	if strings.HasPrefix(path, "/api/ha/tasks") {
		return true
	}
	if strings.HasPrefix(path, "/api/invite/") {
		if method == http.MethodGet || method == http.MethodPut ||
			(method == http.MethodPost && strings.HasSuffix(path, "/comments")) {
			return true
		}
	}
	if path == "/api/settings/demo" && method == http.MethodGet {
		return true
	}
	return false
}

type ctxKey int

const (
	ctxKeyUser ctxKey = iota
	ctxKeyDB
	ctxKeyDemo
	ctxKeySessionID
	ctxKeyCSRF
)

// WithUser stores the resolved session in the request context.
func WithUser(r *http.Request, res *Resolved) *http.Request {
	ctx := r.Context()
	ctx = context.WithValue(ctx, ctxKeyUser, res.User)
	ctx = context.WithValue(ctx, ctxKeyDB, res.DB)
	ctx = context.WithValue(ctx, ctxKeyDemo, res.Demo)
	ctx = context.WithValue(ctx, ctxKeySessionID, res.SessionID)
	ctx = context.WithValue(ctx, ctxKeyCSRF, res.CSRFToken)
	return r.WithContext(ctx)
}

// UserFrom returns the session user (non-nil after RequireAuth).
func UserFrom(r *http.Request) *User {
	u, _ := r.Context().Value(ctxKeyUser).(*User)
	return u
}

// DBFrom returns the database backing the session (prod or demo).
func DBFrom(r *http.Request) *db.DB {
	d, _ := r.Context().Value(ctxKeyDB).(*db.DB)
	return d
}

// DemoFrom reports whether the session lives in the demo database.
func DemoFrom(r *http.Request) bool {
	b, _ := r.Context().Value(ctxKeyDemo).(bool)
	return b
}

// SessionIDFrom returns the current session id.
func SessionIDFrom(r *http.Request) string {
	s, _ := r.Context().Value(ctxKeySessionID).(string)
	return s
}

// CSRFTokenFrom returns the csrf token of the session.
func CSRFTokenFrom(r *http.Request) string {
	s, _ := r.Context().Value(ctxKeyCSRF).(string)
	return s
}

// RequireAuth is the middleware: everything under /api/* requires a session
// except the public paths. It applies sliding renewal (issue #251) and
// stores the session in the context.
func (s *Service) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if IsPublicPath(r.URL.Path, r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		res := s.ResolveSession(r)
		if res == nil {
			errors.Write(w, errors.New(http.StatusUnauthorized, errors.AuthRequired))
			return
		}
		if res.Renew {
			expiresAt := time.Now().UnixMilli() + SessionTTL.Milliseconds()
			if _, err := res.DB.Exec("UPDATE sessions SET expires_at = ? WHERE id = ?", expiresAt, res.SessionID); err == nil {
				s.SetCookie(w, res.SessionID, SessionTTL)
			}
		}
		next.ServeHTTP(w, WithUser(r, res))
	})
}

// --- Login / logout ---------------------------------------------------------

// VerifyLogin checks username+password against the database. Unknown users
// still run a bcrypt compare against DUMMY_HASH (anti enumeration).
func VerifyLogin(d *db.DB, username, password string) (*User, error) {
	row := d.QueryRow("SELECT id, username, display_name, email, phone, color, language, role, expenses_enabled, anti_slip_threshold, created_at, password_hash FROM users WHERE username = ?", username)
	var u User
	var displayName, email, phone sql.NullString
	var hash string
	err := row.Scan(&u.ID, &u.Username, &displayName, &email, &phone, &u.Color, &u.Language,
		&u.Role, &u.ExpensesEnabled, &u.AntiSlipThreshold, &u.CreatedAt, &hash)
	if err == sql.ErrNoRows {
		_ = bcrypt.CompareHashAndPassword([]byte(DUMMY_HASH), []byte(password))
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if displayName.Valid {
		s := displayName.String
		u.DisplayName = &s
	}
	if email.Valid {
		s := email.String
		u.Email = &s
	}
	if phone.Valid {
		s := phone.String
		u.Phone = &s
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, nil
	}
	return &u, nil
}

// RegisterUser creates a user; nil when the username already exists.
func RegisterUser(d *db.DB, username, password string, color, language, role string) (*User, error) {
	var existing string
	err := d.QueryRow("SELECT id FROM users WHERE username = ?", username).Scan(&existing)
	if err == nil {
		return nil, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	if color == "" {
		color = "slate"
	}
	if language == "" {
		language = "auto"
	}
	if role == "" {
		role = "user"
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return nil, err
	}
	id := ids.New()
	n := time.Now().UnixMilli()
	_, err = d.Exec(
		"INSERT INTO users (id, username, display_name, password_hash, color, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		id, username, username, string(hash), color, language, role, n)
	if err != nil {
		return nil, err
	}
	return getUserPublic(d, "WHERE id = ?", id)
}

// UpdateUser applies the updatable profile fields (bug #172: SQLite has no
// booleans, expenses_enabled is coerced to 1/0).
func UpdateUser(d *db.DB, id string, updates map[string]any) (*User, error) {
	updatable := map[string]string{
		"display_name": "", "email": "", "phone": "", "language": "", "color": "",
		"expenses_enabled": "bool01", "anti_slip_threshold": "",
	}
	var sets []string
	var args []any
	for _, key := range []string{"display_name", "email", "phone", "language", "color", "expenses_enabled", "anti_slip_threshold"} {
		v, ok := updates[key]
		if !ok {
			continue
		}
		_ = updatable[key]
		if key == "expenses_enabled" {
			sets = append(sets, key+" = ?")
			if boolOf(v) {
				args = append(args, 1)
			} else {
				args = append(args, 0)
			}
			continue
		}
		sets = append(sets, key+" = ?")
		args = append(args, v)
	}
	if len(sets) == 0 {
		return nil, nil
	}
	args = append(args, id)
	if _, err := d.Exec("UPDATE users SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	return getUserPublic(d, "WHERE id = ?", id)
}

func boolOf(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case int:
		return t != 0
	case int64:
		return t != 0
	case string:
		return t == "true" || t == "1"
	default:
		return false
	}
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ChangePassword verifies the current password, re-hashes and returns ok /
// wrong-current / error (equivalent of the TS union).
func ChangePassword(d *db.DB, userID, current, next string) (string, error) {
	var hash string
	err := d.QueryRow("SELECT password_hash FROM users WHERE id = ?", userID).Scan(&hash)
	if err == sql.ErrNoRows {
		return "error", nil
	}
	if err != nil {
		return "", err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(current)) != nil {
		return "wrong-current", nil
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(next), 10)
	if err != nil {
		return "", err
	}
	if _, err := d.Exec("UPDATE users SET password_hash = ? WHERE id = ?", string(newHash), userID); err != nil {
		return "", err
	}
	return "ok", nil
}

// DestroyOtherSessions invalidates every session of the user except the
// current one (used after a password change).
func DestroyOtherSessions(d *db.DB, userID, currentSessionID string) error {
	if currentSessionID == "" {
		_, err := d.Exec("DELETE FROM sessions WHERE user_id = ?", userID)
		return err
	}
	_, err := d.Exec("DELETE FROM sessions WHERE user_id = ? AND id != ?", userID, currentSessionID)
	return err
}

// EnsureBootstrapAdmin creates the initial admin from env (idempotent).
func EnsureBootstrapAdmin(d *db.DB, username, password string) (bool, error) {
	if password == "" {
		log.Warn("bootstrap_admin_skipped", "reason", "auth_pass_missing")
		return false, nil
	}
	var existing string
	err := d.QueryRow("SELECT id FROM users WHERE username = ?", username).Scan(&existing)
	if err == nil {
		return false, nil
	}
	if err != sql.ErrNoRows {
		return false, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return false, err
	}
	id := ids.New()
	_, err = d.Exec(
		"INSERT INTO users (id, username, display_name, password_hash, color, language, role, created_at) VALUES (?, ?, ?, ?, 'violet', 'auto', 'admin', ?)",
		id, username, username, string(hash), time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	log.Info("bootstrap_admin_created", "username", username)
	return true, nil
}

// --- Login rate limit in SQLite (survives restarts) -------------------------

// ClientIP for rate limiting and per-IP decisions. Default is the socket
// peer: X-Forwarded-For is spoofable and trusting it blindly would bypass the
// login lockout (issue #167). Only when TRUSTED_PROXY is set AND the peer
// matches it, the first X-Forwarded-For value is used (real client).
func ClientIP(r *http.Request, trustedProxy string) string {
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		peer = r.RemoteAddr
	}
	if peer == "" {
		peer = "unknown"
	}
	if trustedProxy != "" && peer == trustedProxy {
		xff := r.Header.Get("X-Forwarded-For")
		if xff != "" {
			first := strings.TrimSpace(strings.SplitN(xff, ",", 2)[0])
			if first != "" {
				return first
			}
		}
	}
	return peer
}

// LoginRateLimited reports whether the IP is locked right now.
func LoginRateLimited(d *db.DB, r *http.Request, trustedProxy string) bool {
	var lockedUntil int64
	err := d.QueryRow("SELECT locked_until FROM login_attempts WHERE ip = ?", ClientIP(r, trustedProxy)).Scan(&lockedUntil)
	return err == nil && lockedUntil > time.Now().UnixMilli()
}

// RegisterLoginFail counts a failed attempt; 5 in a row lock the IP 5 min.
// The CASE reads attempts pre-UPDATE (SQLite semantics), same as the TS.
func RegisterLoginFail(d *db.DB, r *http.Request, trustedProxy string) error {
	ip := ClientIP(r, trustedProxy)
	_, err := d.Exec(
		`INSERT INTO login_attempts (ip, attempts, locked_until) VALUES (?, 1, 0)
		 ON CONFLICT(ip) DO UPDATE SET
		   attempts = attempts + 1,
		   locked_until = CASE WHEN attempts >= 4 THEN ? ELSE locked_until END`,
		ip, time.Now().UnixMilli()+lockMs)
	return err
}

// LoginOK clears the failure counter of the IP.
func LoginOK(d *db.DB, r *http.Request, trustedProxy string) error {
	_, err := d.Exec("DELETE FROM login_attempts WHERE ip = ?", ClientIP(r, trustedProxy))
	return err
}
