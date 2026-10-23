package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/push"
)

// bootAPIPush boots the API with a push service configured from test VAPID keys.
func bootAPIPush(t *testing.T) (*httptest.Server, *db.DB, *db.DB, *push.Service) {
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
	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	ps := push.New(pub, priv, "mailto:test@example.com")
	svc := &auth.Service{Prod: prod, Demo: demo, Secret: "test-secret-32-characters-long-ok!"}
	srv := New(svc, prod, demo, Config{
		MaxUploadMB:   10,
		MaxSSEClients: 20,
		StaticDir:     dir,
		UploadsDir:    filepath.Join(dir, "uploads"),
		Version:       "test",
		Build:         "test",
		Push:          ps,
	})
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return ts, prod, demo, ps
}

const subEndpoint = "https://push.example.com/sub/abc123"

func subBody() map[string]any {
	return map[string]any{
		"endpoint": subEndpoint,
		"keys":     map[string]string{"p256dh": "BP256dhFakeKeyParaTests", "auth": "authSecretFake"},
	}
}

func TestPushRoutes(t *testing.T) {
	t.Run("vapid-public-key without VAPID returns 503", func(t *testing.T) {
		ts, _, _ := bootAPI(t)
		s := loginAdmin(t, ts)
		res, body := doReq(t, ts, http.MethodGet, "/api/push/vapid-public-key", nil, s.headers())
		if res.StatusCode != 503 {
			t.Fatalf("status = %d, want 503", res.StatusCode)
		}
		if decodeMap(t, body)["error"].(map[string]any)["code"] != "PUSH_NOT_CONFIGURED" {
			t.Fatalf("code: %s", body)
		}
	})

	t.Run("vapid-public-key with VAPID returns the public key", func(t *testing.T) {
		ts, _, _, ps := bootAPIPush(t)
		s := loginAdmin(t, ts)
		res, body := doReq(t, ts, http.MethodGet, "/api/push/vapid-public-key", nil, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("status = %d", res.StatusCode)
		}
		if decodeMap(t, body)["publicKey"] != ps.PublicKeyOrEmpty() {
			t.Fatalf("publicKey: %s", body)
		}
	})

	t.Run("subscribe requires session (401 without cookie)", func(t *testing.T) {
		ts, _, _, _ := bootAPIPush(t)
		res, _ := doReq(t, ts, http.MethodPost, "/api/push/subscribe", subBody(), nil)
		if res.StatusCode != 401 {
			t.Fatalf("status = %d, want 401", res.StatusCode)
		}
	})

	t.Run("subscribe upserts by endpoint and unsubscribe deletes only own", func(t *testing.T) {
		ts, prod, _, _ := bootAPIPush(t)
		s := loginAdmin(t, ts)
		res, body := doReq(t, ts, http.MethodPost, "/api/push/subscribe", subBody(), s.headers())
		if res.StatusCode != 201 {
			t.Fatalf("subscribe: %d %s", res.StatusCode, body)
		}
		// re-subscribe same endpoint: UPDATE, no duplicate
		res, _ = doReq(t, ts, http.MethodPost, "/api/push/subscribe", subBody(), s.headers())
		if res.StatusCode != 201 {
			t.Fatalf("re-subscribe: %d", res.StatusCode)
		}
		var n int
		_ = prod.QueryRow("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint = ?", subEndpoint).Scan(&n)
		if n != 1 {
			t.Fatalf("rows = %d, want 1", n)
		}

		res, _ = doReq(t, ts, http.MethodDelete, "/api/push/unsubscribe", map[string]any{"endpoint": subEndpoint}, s.headers())
		if res.StatusCode != 204 {
			t.Fatalf("unsubscribe: %d", res.StatusCode)
		}
		_ = prod.QueryRow("SELECT COUNT(*) FROM push_subscriptions").Scan(&n)
		if n != 0 {
			t.Fatalf("rows after unsubscribe = %d, want 0", n)
		}
	})

	t.Run("subscribe validates payload (422 without keys)", func(t *testing.T) {
		ts, _, _, _ := bootAPIPush(t)
		s := loginAdmin(t, ts)
		res, body := doReq(t, ts, http.MethodPost, "/api/push/subscribe", map[string]any{"endpoint": subEndpoint}, s.headers())
		if res.StatusCode != 422 {
			t.Fatalf("status = %d, want 422", res.StatusCode)
		}
		if decodeMap(t, body)["error"].(map[string]any)["code"] != "VALIDATION_FAILED" {
			t.Fatalf("code: %s", body)
		}
	})

	t.Run("preferences: GET defaults all enabled; PUT disables and invalid type 422", func(t *testing.T) {
		ts, _, _, _ := bootAPIPush(t)
		s := loginAdmin(t, ts)

		res, body := doReq(t, ts, http.MethodGet, "/api/push/preferences", nil, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("GET prefs: %d", res.StatusCode)
		}
		prefs := decodeMap(t, body)["prefs"].(map[string]any)
		if prefs["asignacion"] != true || prefs["vencimiento"] != true {
			t.Fatalf("default prefs: %v", prefs)
		}
		if len(prefs) != 7 {
			t.Fatalf("prefs len = %d, want 7", len(prefs))
		}

		res, _ = doReq(t, ts, http.MethodPut, "/api/push/preferences", map[string]any{"tipo": "comentario", "enabled": false}, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("PUT prefs: %d", res.StatusCode)
		}
		_, body = doReq(t, ts, http.MethodGet, "/api/push/preferences", nil, s.headers())
		prefs = decodeMap(t, body)["prefs"].(map[string]any)
		if prefs["comentario"] != false || prefs["asignacion"] != true {
			t.Fatalf("prefs after disable: %v", prefs)
		}

		res, body = doReq(t, ts, http.MethodPut, "/api/push/preferences", map[string]any{"tipo": "inventado", "enabled": true}, s.headers())
		if res.StatusCode != 422 {
			t.Fatalf("invalid tipo: %d %s", res.StatusCode, body)
		}
	})

	t.Run("demo: vapid-public-key returns {demo:true} and subscribe is read-only", func(t *testing.T) {
		ts, _, demo, _ := bootAPIPush(t)
		seedDemoDB(t, demo)

		res, body := doReq(t, ts, http.MethodPost, "/api/auth/demo", nil, nil)
		if res.StatusCode != 200 {
			t.Fatalf("demo login: %d %s", res.StatusCode, body)
		}
		demoSess := session{cookie: cookieOf(t, res), csrf: decodeMap(t, body)["csrfToken"].(string)}

		res, body = doReq(t, ts, http.MethodGet, "/api/push/vapid-public-key", nil, demoSess.headers())
		if res.StatusCode != 200 || decodeMap(t, body)["demo"] != true {
			t.Fatalf("demo vapid: %d %s", res.StatusCode, body)
		}

		res, body = doReq(t, ts, http.MethodPost, "/api/push/subscribe", subBody(), demoSess.headers())
		if res.StatusCode != 403 || decodeMap(t, body)["error"].(map[string]any)["code"] != "DEMO_READ_ONLY" {
			t.Fatalf("demo subscribe: %d %s", res.StatusCode, body)
		}
	})
}
