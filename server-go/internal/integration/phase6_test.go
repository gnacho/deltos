package integration

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/gnacho/deltos/server-go/internal/api"
	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/db"
	demopkg "github.com/gnacho/deltos/server-go/internal/demo"
	"github.com/gnacho/deltos/server-go/internal/digest"
	"github.com/gnacho/deltos/server-go/internal/push"
)

// bootPhase6 boots the full stack with the demo seeded, a push service
// configured with test VAPID keys and a data dir (for the backup endpoint).
func bootPhase6(t *testing.T) (*httptest.Server, *db.DB, *db.DB, *push.Service, string) {
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
	if _, err := auth.EnsureBootstrapAdmin(prod, adminUser, adminPassword); err != nil {
		t.Fatal(err)
	}
	if _, err := prod.EnsureInbox(); err != nil {
		t.Fatal(err)
	}
	if _, err := demo.EnsureInbox(); err != nil {
		t.Fatal(err)
	}
	demopkg.SeedDemo(demo, filepath.Join(dir, "uploads"))

	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	pushSvc := push.New(pub, priv, "mailto:test@example.com")
	svc := &auth.Service{Prod: prod, Demo: demo, Secret: "integration-test-secret-value-32-chars!"}
	srv := api.New(svc, prod, demo, api.Config{
		MaxUploadMB: 10,
		StaticDir:   dir,
		UploadsDir:  filepath.Join(dir, "uploads"),
		DataDir:     dir,
		Version:     "test",
		Build:       "test",
		Push:        pushSvc,
	})
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return ts, prod, demo, pushSvc, dir
}

func TestPhase6Smoke(t *testing.T) {
	ts, prod, _, pushSvc, _ := bootPhase6(t)
	admin := smokeLogin(t, ts)

	// 1. demo login works (200 + demo:true).
	status, body := smokeDo(t, ts, http.MethodPost, "/api/auth/demo", nil, smokeSession{}, nil)
	if status != 200 || body["demo"] != true {
		t.Fatalf("demo login: %d %v", status, body)
	}
	if body["user"].(map[string]any)["username"] != "demo" {
		t.Fatalf("demo user: %v", body["user"])
	}

	// 2. push prefs saved.
	status, _ = smokeDo(t, ts, http.MethodPut, "/api/push/preferences", map[string]any{"tipo": "comentario", "enabled": false}, admin, nil)
	if status != 200 {
		t.Fatalf("push prefs: %d", status)
	}
	status, body = smokeDo(t, ts, http.MethodGet, "/api/push/preferences", nil, admin, nil)
	if status != 200 {
		t.Fatalf("push prefs get: %d", status)
	}
	if body["prefs"].(map[string]any)["comentario"] != false {
		t.Fatalf("prefs not saved: %v", body["prefs"])
	}

	// 3. backup run via endpoint (admin).
	status, body = smokeDo(t, ts, http.MethodPost, "/api/settings/backup/run", nil, admin, nil)
	if status != 200 || body["ok"] != true {
		t.Fatalf("backup run: %d %v", status, body)
	}

	// 4. digest delivery is wired to real push: subscribe the admin, create a
	// due-today task for them, run the digest and assert the push goes out.
	var mu sync.Mutex
	var sent []string
	pushSvc.SetSendFn(func(_ *webpush.Subscription, payload []byte, _ *webpush.Options) (int, error) {
		mu.Lock()
		sent = append(sent, string(payload))
		mu.Unlock()
		return 201, nil
	})
	status, _ = smokeDo(t, ts, http.MethodPost, "/api/push/subscribe", map[string]any{
		"endpoint": "https://push.example.com/smoke",
		"keys":     map[string]string{"p256dh": "BP256dhFakeKeyParaTests", "auth": "authSecretFake"},
	}, admin, nil)
	if status != 201 {
		t.Fatalf("subscribe: %d", status)
	}

	// create a project and a due-today task assigned to the admin
	status, body = smokeDo(t, ts, http.MethodPost, "/api/projects", map[string]any{"name": "Casa"}, admin, nil)
	if status != 201 {
		t.Fatalf("create project: %d %v", status, body)
	}
	projectID := body["project"].(map[string]any)["id"].(string)
	var adminID string
	_ = prod.QueryRow("SELECT id FROM users WHERE username = ?", adminUser).Scan(&adminID)
	today := time.Now().In(madrid()).Format("2006-01-02")
	status, _ = smokeDo(t, ts, http.MethodPost, "/api/tasks", map[string]any{
		"project_id": projectID, "title": "Digest smoke", "due_date": today, "assignee_id": adminID,
	}, admin, nil)
	if status != 201 {
		t.Fatalf("create task: %d", status)
	}

	delivery := digest.DeliveryFunc(func(userID string, counts digest.Counts, opts digest.Options) error {
		pushSvc.NotifyUsers(prod, []string{userID}, "vencimiento", map[string]any{
			"vencidas": counts.Vencidas, "hoy": counts.Hoy, "pronto": counts.Pronto, "total": counts.Total,
		}, push.Options{Demo: opts.Demo, Severity: push.Severity(opts.Severity), URL: opts.URL})
		return nil
	})
	if err := digest.EnviarDigestVencimiento(prod, delivery, false, today); err != nil {
		t.Fatalf("digest: %v", err)
	}

	mu.Lock()
	got := len(sent)
	mu.Unlock()
	if got != 1 {
		t.Fatalf("digest delivery must send 1 push, got %d", got)
	}
}
