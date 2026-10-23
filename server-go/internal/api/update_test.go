package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/update"
)

// bootAPIUpdate boots the API with a data dir, a release marker and an injectable
// fake GitHub base URL.
func bootAPIUpdate(t *testing.T, ghBase string) (*httptest.Server, *db.DB, string) {
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
	marker := filepath.Join(dir, ".release-id")
	if err := os.WriteFile(marker, []byte("2.6.52"), 0o644); err != nil {
		t.Fatal(err)
	}
	svc := &auth.Service{Prod: prod, Demo: demo, Secret: "test-secret-32-characters-long-ok!"}
	srv := New(svc, prod, demo, Config{
		MaxUploadMB:   10,
		MaxSSEClients: 20,
		StaticDir:     dir,
		UploadsDir:    filepath.Join(dir, "uploads"),
		DataDir:       dir,
		Version:       "test",
		Build:         "test",
		Update:        update.Config{GitHubBase: ghBase, Repo: "gnacho/deltos", Marker: marker},
	})
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return ts, prod, dir
}

func TestUpdate(t *testing.T) {
	t.Run("status parses a release JSON and compares semver", func(t *testing.T) {
		fakeGH := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/repos/gnacho/deltos/releases/latest" {
				t.Errorf("unexpected path: %s", r.URL.Path)
			}
			if r.Header.Get("Accept") != "application/vnd.github+json" {
				t.Errorf("accept header: %q", r.Header.Get("Accept"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"tag_name":"v2.6.53","body":"release notes"}`))
		}))
		defer fakeGH.Close()

		ts, _, _ := bootAPIUpdate(t, fakeGH.URL)
		s := loginAdmin(t, ts)
		res, body := doReq(t, ts, http.MethodGet, "/api/update/status", nil, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("status: %d %s", res.StatusCode, body)
		}
		st := decodeMap(t, body)
		if st["current"] != "2.6.52" || st["latest"] != "2.6.53" || st["available"] != true || st["checkFailed"] != false {
			t.Fatalf("status: %v", st)
		}
		if st["notes"] != "release notes" {
			t.Fatalf("notes: %v", st["notes"])
		}
	})

	t.Run("status reports checkFailed when GitHub is down", func(t *testing.T) {
		// no server listening: the fetch fails
		ts, _, _ := bootAPIUpdate(t, "http://127.0.0.1:1")
		s := loginAdmin(t, ts)
		res, body := doReq(t, ts, http.MethodGet, "/api/update/status", nil, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("status: %d %s", res.StatusCode, body)
		}
		st := decodeMap(t, body)
		if st["checkFailed"] != true || st["available"] != false {
			t.Fatalf("status: %v", st)
		}
	})

	t.Run("progress reads a live file and ignores stale ones", func(t *testing.T) {
		ts, _, dir := bootAPIUpdate(t, "http://127.0.0.1:1")
		s := loginAdmin(t, ts)
		progFile := filepath.Join(dir, "update-progress.json")
		if err := os.WriteFile(progFile, []byte(`{"step":"downloading","pct":42,"ts":1}`), 0o644); err != nil {
			t.Fatal(err)
		}
		// stale (ts=1 is old): null progress
		_, body := doReq(t, ts, http.MethodGet, "/api/update/progress", nil, s.headers())
		if decodeMap(t, body)["progress"] != nil {
			t.Fatalf("stale progress must be null: %s", body)
		}
		// fresh: written just now
		if err := os.WriteFile(progFile, []byte(`{"step":"applying","pct":90,"ts":`+fmt.Sprint(time.Now().UnixMilli())+`}`), 0o644); err != nil {
			t.Fatal(err)
		}
		_, body = doReq(t, ts, http.MethodGet, "/api/update/progress", nil, s.headers())
		prog, _ := decodeMap(t, body)["progress"].(map[string]any)
		if prog == nil || prog["step"] != "applying" || prog["pct"] != float64(90) {
			t.Fatalf("progress: %s", body)
		}
	})

	t.Run("apply writes the flag and an audit row", func(t *testing.T) {
		ts, prod, dir := bootAPIUpdate(t, "http://127.0.0.1:1")
		s := loginAdmin(t, ts)
		res, body := doReq(t, ts, http.MethodPost, "/api/update/apply", nil, s.headers())
		if res.StatusCode != 202 {
			t.Fatalf("apply: %d %s", res.StatusCode, body)
		}
		if decodeMap(t, body)["requested"] != true {
			t.Fatalf("apply body: %s", body)
		}
		if _, err := os.Stat(filepath.Join(dir, ".update-requested")); err != nil {
			t.Fatalf("flag not written: %v", err)
		}
		var n int
		_ = prod.QueryRow("SELECT COUNT(*) FROM admin_audit WHERE action = 'update.apply'").Scan(&n)
		if n != 1 {
			t.Fatalf("audit rows = %d, want 1", n)
		}
	})

	t.Run("non-admin cannot access update endpoints", func(t *testing.T) {
		ts, _, _ := bootAPIUpdate(t, "http://127.0.0.1:1")
		admin := loginAdmin(t, ts)
		// create a non-admin user
		res, _ := doReq(t, ts, http.MethodPost, "/api/users", map[string]any{"username": "pepe", "password": "pepe1234567"}, admin.headers())
		if res.StatusCode != 201 {
			t.Fatalf("create pepe: %d", res.StatusCode)
		}
		res, body := doReq(t, ts, http.MethodPost, "/api/auth/login", map[string]string{"username": "pepe", "password": "pepe1234567"}, nil)
		pepe := session{cookie: cookieOf(t, res), csrf: decodeMap(t, body)["csrfToken"].(string)}

		res, body = doReq(t, ts, http.MethodGet, "/api/update/status", nil, pepe.headers())
		if res.StatusCode != 403 {
			t.Fatalf("status non-admin: %d %s", res.StatusCode, body)
		}
		res, _ = doReq(t, ts, http.MethodPost, "/api/update/apply", nil, pepe.headers())
		if res.StatusCode != 403 {
			t.Fatalf("apply non-admin: %d", res.StatusCode)
		}
	})
}
