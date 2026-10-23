// Package idempotency ports server/src/idempotency.ts: a POST-only middleware
// that replays a cached response when the Idempotency-Key header repeats
// within 24h, otherwise runs the handler and caches 2xx JSON responses.
package idempotency

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/logger"
)

var log = logger.L().Child(map[string]any{"component": "idempotency"})

const ttlMs = int64(24 * 60 * 60 * 1000)

// Middleware builds the idempotency middleware. It is applied to the /api
// group after the mutation rate limit.
func Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				next.ServeHTTP(w, r)
				return
			}
			key := r.Header.Get("Idempotency-Key")
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}
			user := auth.UserFrom(r)
			if user == nil {
				next.ServeHTTP(w, r)
				return
			}
			d := auth.DBFrom(r)
			if d == nil {
				next.ServeHTTP(w, r)
				return
			}

			now := time.Now().UnixMilli()
			var status int
			var body sql.NullString
			var createdAt int64
			err := d.QueryRow(
				"SELECT status, response_body, created_at FROM idempotency_keys WHERE key = ? AND user_id = ?",
				key, user.ID).Scan(&status, &body, &createdAt)
			if err == nil && now-createdAt < ttlMs {
				log.Info("idempotency_hit", "key", truncate(key))
				replay(w, status, body.String)
				return
			}
			if err == nil {
				// expired row: recompute
				_, _ = d.Exec("DELETE FROM idempotency_keys WHERE key = ?", key)
			}

			rec := &captureWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)

			if rec.status >= 200 && rec.status < 300 {
				bodyStr := rec.body.String()
				if !json.Valid(rec.body.Bytes()) {
					bodyStr = "null"
				}
				_, _ = d.Exec(
					"INSERT INTO idempotency_keys (key, user_id, status, response_body, created_at) VALUES (?, ?, ?, ?, ?)",
					key, user.ID, rec.status, bodyStr, now)
			}

			// best-effort purge of expired rows
			_, _ = d.Exec("DELETE FROM idempotency_keys WHERE created_at < ?", now-ttlMs)
		})
	}
}

func truncate(key string) string {
	if len(key) > 12 {
		return key[:12]
	}
	return key
}

func replay(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

// captureWriter records the status and body written by the wrapped handler.
type captureWriter struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (c *captureWriter) WriteHeader(code int) {
	c.status = code
	c.ResponseWriter.WriteHeader(code)
}

func (c *captureWriter) Write(p []byte) (int, error) {
	c.body.Write(p)
	return c.ResponseWriter.Write(p)
}
