package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/demo"
)

// seedDemoDB seeds the demo database (helper shared by demo/push tests).
func seedDemoDB(t *testing.T, d *db.DB) {
	t.Helper()
	demo.SeedDemo(d, filepath.Join(t.TempDir(), "uploads"))
}

// bootAPIDemo boots the API and seeds the demo DB.
func bootAPIDemo(t *testing.T) (*httptest.Server, *db.DB, *db.DB) {
	t.Helper()
	dir := t.TempDir()
	prod, err := db.Open(filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { prod.Close() })
	demoDB, err := db.Open(filepath.Join(dir, "app_demo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { demoDB.Close() })
	if _, err := auth.EnsureBootstrapAdmin(prod, "admin", testAdminPass); err != nil {
		t.Fatal(err)
	}
	if _, err := prod.EnsureInbox(); err != nil {
		t.Fatal(err)
	}
	seedDemoDB(t, demoDB)
	svc := &auth.Service{Prod: prod, Demo: demoDB, Secret: "test-secret-32-characters-long-ok!"}
	srv := New(svc, prod, demoDB, Config{
		MaxUploadMB:   10,
		MaxSSEClients: 20,
		StaticDir:     dir,
		UploadsDir:    filepath.Join(dir, "uploads"),
		Version:       "test",
		Build:         "test",
	})
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return ts, prod, demoDB
}

func TestDemo(t *testing.T) {
	t.Run("seed is idempotent and matches the mockup counts", func(t *testing.T) {
		dir := t.TempDir()
		d, err := db.Open(filepath.Join(dir, "app_demo.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer d.Close()
		up := filepath.Join(dir, "uploads")
		if !demo.SeedDemo(d, up) {
			t.Fatal("first seed should return true")
		}
		counts := func() (users, projects, tasks int) {
			_ = d.QueryRow("SELECT COUNT(*) FROM users").Scan(&users)
			_ = d.QueryRow("SELECT COUNT(*) FROM projects").Scan(&projects)
			_ = d.QueryRow("SELECT COUNT(*) FROM tasks").Scan(&tasks)
			return
		}
		u1, p1, t1 := counts()
		if u1 != 3 || p1 != 4 || t1 != 15 {
			t.Fatalf("seed counts = %d users, %d projects, %d tasks", u1, p1, t1)
		}
		if demo.SeedDemo(d, up) {
			t.Fatal("second seed should return false (already seeded)")
		}
		u2, p2, t2 := counts()
		if u1 != u2 || p1 != p2 || t1 != t2 {
			t.Fatalf("row counts changed after second seed: %d/%d/%d -> %d/%d/%d", u1, p1, t1, u2, p2, t2)
		}
	})

	t.Run("demo login returns 200 with cookie and demo:true", func(t *testing.T) {
		ts, _, _ := bootAPIDemo(t)
		res, body := doReq(t, ts, http.MethodPost, "/api/auth/demo", nil, nil)
		if res.StatusCode != 200 {
			t.Fatalf("demo login: %d %s", res.StatusCode, body)
		}
		m := decodeMap(t, body)
		if m["demo"] != true {
			t.Fatalf("demo flag: %v", m)
		}
		if m["user"].(map[string]any)["username"] != "demo" {
			t.Fatalf("user: %v", m["user"])
		}
		if m["csrfToken"] == "" {
			t.Fatalf("csrfToken missing: %v", m)
		}
		if cookieOf(t, res) == "" {
			t.Fatal("demo login must set the session cookie")
		}
	})

	t.Run("mutations in a demo session are rejected with DEMO_READ_ONLY", func(t *testing.T) {
		ts, _, _ := bootAPIDemo(t)
		res, body := doReq(t, ts, http.MethodPost, "/api/auth/demo", nil, nil)
		if res.StatusCode != 200 {
			t.Fatalf("demo login: %d %s", res.StatusCode, body)
		}
		ds := session{cookie: cookieOf(t, res), csrf: decodeMap(t, body)["csrfToken"].(string)}

		// POST a task: the demo read-only middleware must reject it.
		res, body = doReq(t, ts, http.MethodPost, "/api/tasks", map[string]any{"project_id": "p-casa", "title": "No se puede"}, ds.headers())
		if res.StatusCode != 403 {
			t.Fatalf("mutation must 403: %d %s", res.StatusCode, body)
		}
		if decodeMap(t, body)["error"].(map[string]any)["code"] != "DEMO_READ_ONLY" {
			t.Fatalf("code: %s", body)
		}
	})

	t.Run("demo login is 403 AUTH_DEMO_DISABLED when disabled", func(t *testing.T) {
		ts, _, _ := bootAPIDemo(t)
		// disable via admin settings
		admin := loginAdmin(t, ts)
		res, body := doReq(t, ts, http.MethodPut, "/api/settings/demo", map[string]any{"enabled": false}, admin.headers())
		if res.StatusCode != 200 {
			t.Fatalf("disable demo: %d %s", res.StatusCode, body)
		}
		res, body = doReq(t, ts, http.MethodPost, "/api/auth/demo", nil, nil)
		if res.StatusCode != 403 {
			t.Fatalf("demo login must 403: %d %s", res.StatusCode, body)
		}
		if decodeMap(t, body)["error"].(map[string]any)["code"] != "AUTH_DEMO_DISABLED" {
			t.Fatalf("code: %s", body)
		}
	})
}
