package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/db"
)

// bootAPIServer boots the API and returns the *Server so tests can hit handlers
// directly with a custom RemoteAddr.
func bootAPIServer(t *testing.T) (*httptest.Server, *Server, *db.DB) {
	t.Helper()
	dir := t.TempDir()
	prod, err := db.Open(filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { prod.Close() })
	demo, err := db.Open(filepath.Join(dir, "app_demo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { demo.Close() })
	if _, err := auth.EnsureBootstrapAdmin(prod, "admin", testAdminPass); err != nil {
		t.Fatal(err)
	}
	if _, err := prod.EnsureInbox(); err != nil {
		t.Fatal(err)
	}
	svc := &auth.Service{Prod: prod, Demo: demo, Secret: "test-secret-32-characters-long-ok!"}
	srv := New(svc, prod, demo, Config{
		MaxUploadMB:   10,
		MaxSSEClients: 20,
		StaticDir:     dir,
		UploadsDir:    filepath.Join(dir, "uploads"),
		Version:       "test",
		Build:         "test",
	})
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return ts, srv, prod
}

func TestRecover(t *testing.T) {
	t.Run("from 127.0.0.1 resets and returns a temp password", func(t *testing.T) {
		ts, _, _ := bootAPIServer(t)
		res, body := doReq(t, ts, http.MethodPost, "/api/auth/recover", nil, nil)
		if res.StatusCode != 200 {
			t.Fatalf("recover: %d %s", res.StatusCode, body)
		}
		temp := decodeMap(t, body)["tempPassword"].(string)
		if temp == "" {
			t.Fatalf("tempPassword missing: %s", body)
		}
	})

	t.Run("from a non-loopback remote returns 403", func(t *testing.T) {
		_, srv, _ := bootAPIServer(t)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/recover", nil)
		req.RemoteAddr = "203.0.113.5:1234"
		w := httptest.NewRecorder()
		srv.handleRecover(w, req)
		if w.Code != 403 {
			t.Fatalf("status = %d, want 403", w.Code)
		}
	})

	t.Run("old password stops working and the new one works", func(t *testing.T) {
		ts, _, _ := bootAPIServer(t)

		// old password works first
		res, _ := doReq(t, ts, http.MethodPost, "/api/auth/login", map[string]string{"username": "admin", "password": testAdminPass}, nil)
		if res.StatusCode != 200 {
			t.Fatalf("old password login: %d", res.StatusCode)
		}

		// recover
		res, body := doReq(t, ts, http.MethodPost, "/api/auth/recover", nil, nil)
		if res.StatusCode != 200 {
			t.Fatalf("recover: %d %s", res.StatusCode, body)
		}
		temp := decodeMap(t, body)["tempPassword"].(string)

		// old password no longer works
		res, _ = doReq(t, ts, http.MethodPost, "/api/auth/login", map[string]string{"username": "admin", "password": testAdminPass}, nil)
		if res.StatusCode != 401 {
			t.Fatalf("old password must 401 after recover: %d", res.StatusCode)
		}

		// new temp password works
		res, body = doReq(t, ts, http.MethodPost, "/api/auth/login", map[string]string{"username": "admin", "password": temp}, nil)
		if res.StatusCode != 200 {
			t.Fatalf("temp password login: %d %s", res.StatusCode, body)
		}
	})
}
