package idempotency

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/db"
)

func setup(t *testing.T) (*db.DB, *auth.User, *auth.Resolved) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "idem.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := d.Exec("INSERT INTO users (id, username, password_hash, color, language, role, created_at) VALUES ('u1','admin','x','slate','auto','admin',0)"); err != nil {
		t.Fatal(err)
	}
	u := &auth.User{ID: "u1", Username: "admin", Role: "admin"}
	res := &auth.Resolved{DB: d, Demo: false, User: u, SessionID: "s1", CSRFToken: "csrf"}
	return d, u, res
}

func TestMissStoresAndHitReplays(t *testing.T) {
	d, _, res := setup(t)

	// first request: runs the handler, caches the 2xx response
	req1 := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
	req1.Header.Set("Idempotency-Key", "k1")
	req1 = auth.WithUser(req1, res)
	runs := 0
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		runs++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"ok":true,"id":"new"}`)
	})
	rec1 := httptest.NewRecorder()
	Middleware()(h).ServeHTTP(rec1, req1)
	if rec1.Code != 201 || runs != 1 {
		t.Fatalf("first request: code=%d runs=%d", rec1.Code, runs)
	}
	if rec1.Body.String() != `{"ok":true,"id":"new"}` {
		t.Fatalf("first body = %q", rec1.Body.String())
	}
	var storedStatus int
	var storedBody string
	if err := d.QueryRow("SELECT status, response_body FROM idempotency_keys WHERE key = 'k1'").Scan(&storedStatus, &storedBody); err != nil {
		t.Fatalf("row not stored: %v", err)
	}
	if storedStatus != 201 || storedBody != `{"ok":true,"id":"new"}` {
		t.Fatalf("stored = (%d, %q)", storedStatus, storedBody)
	}

	// replay: same body + status, handler not run
	req2 := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
	req2.Header.Set("Idempotency-Key", "k1")
	req2 = auth.WithUser(req2, res)
	rec2 := httptest.NewRecorder()
	Middleware()(h).ServeHTTP(rec2, req2)
	if rec2.Code != 201 || runs != 1 {
		t.Fatalf("replay: code=%d runs=%d (handler must not run again)", rec2.Code, runs)
	}
	if rec2.Body.String() != `{"ok":true,"id":"new"}` {
		t.Fatalf("replay body = %q", rec2.Body.String())
	}
}

func TestExpiredRowRecomputed(t *testing.T) {
	d, _, res := setup(t)
	old := time.Now().UnixMilli() - 25*60*60*1000 // 25h ago
	if _, err := d.Exec("INSERT INTO idempotency_keys (key, user_id, status, response_body, created_at) VALUES ('kold','u1',201,'{\"stale\":true}',?)", old); err != nil {
		t.Fatal(err)
	}
	runs := 0
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		runs++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"ok":true,"id":"fresh"}`)
	})
	req := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
	req.Header.Set("Idempotency-Key", "kold")
	req = auth.WithUser(req, res)
	rec := httptest.NewRecorder()
	Middleware()(h).ServeHTTP(rec, req)
	if rec.Code != 201 || runs != 1 {
		t.Fatalf("expired row must recompute: code=%d runs=%d", rec.Code, runs)
	}
	if rec.Body.String() != `{"ok":true,"id":"fresh"}` {
		t.Fatalf("expired recompute body = %q", rec.Body.String())
	}
}

func TestNonPOSTIgnored(t *testing.T) {
	d, _, res := setup(t)
	runs := 0
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		runs++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"ok":true}`)
	})
	req := httptest.NewRequest(http.MethodGet, "/api/bootstrap", nil)
	req.Header.Set("Idempotency-Key", "k-get")
	req = auth.WithUser(req, res)
	rec := httptest.NewRecorder()
	Middleware()(h).ServeHTTP(rec, req)
	if rec.Code != 200 || runs != 1 {
		t.Fatalf("GET must ignore idempotency: code=%d runs=%d", rec.Code, runs)
	}
	var n int
	_ = d.QueryRow("SELECT COUNT(*) FROM idempotency_keys").Scan(&n)
	if n != 0 {
		t.Fatalf("GET must not store a row, got %d", n)
	}
}

func TestWithoutKeyOrUserIgnored(t *testing.T) {
	d, _, _ := setup(t)
	runs := 0
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		runs++
		w.WriteHeader(http.StatusCreated)
	})
	// no key
	rec := httptest.NewRecorder()
	Middleware()(h).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`)))
	if runs != 1 {
		t.Fatalf("no key must pass through, runs=%d", runs)
	}
	// no user in context
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
	req.Header.Set("Idempotency-Key", "k-no-user")
	Middleware()(h).ServeHTTP(rec, req)
	if runs != 2 {
		t.Fatalf("no user must pass through, runs=%d", runs)
	}
	var n int
	_ = d.QueryRow("SELECT COUNT(*) FROM idempotency_keys").Scan(&n)
	if n != 0 {
		t.Fatalf("no rows should be stored, got %d", n)
	}
}
