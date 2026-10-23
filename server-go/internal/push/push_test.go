package push

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/ids"
)

// validSubKeys generates a real subscription key pair (a valid P-256 point for
// p256dh and a 16-byte auth secret) so webpush.SendNotification can encrypt.
func validSubKeys(t *testing.T) (p256dh, auth string) {
	t.Helper()
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("ec key: %v", err)
	}
	pub := priv.PublicKey().Bytes()
	authBytes := make([]byte, 16)
	if _, err := rand.Read(authBytes); err != nil {
		t.Fatalf("auth: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(pub), base64.RawURLEncoding.EncodeToString(authBytes)
}

func testDB(t *testing.T) *db.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "push.db"))
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func mkUser(t *testing.T, d *db.DB, username, lang string) string {
	t.Helper()
	id := ids.New()
	if _, err := d.Exec(
		"INSERT INTO users (id, username, password_hash, language, role, created_at) VALUES (?, ?, 'x', ?, 'user', ?)",
		id, username, lang, time.Now().UnixMilli()); err != nil {
		t.Fatalf("user: %v", err)
	}
	return id
}

func mkSub(t *testing.T, d *db.DB, userID, endpoint string) {
	t.Helper()
	now := time.Now().UnixMilli()
	if _, err := d.Exec(
		"INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, ?, 'p', 'a', ?, ?)",
		ids.New(), userID, endpoint, now, now); err != nil {
		t.Fatalf("sub: %v", err)
	}
}

// testKeys generates a real VAPID pair (the web-push lib validates the format).
func testKeys(t *testing.T) (priv, pub string) {
	t.Helper()
	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("vapid keys: %v", err)
	}
	return priv, pub
}

func newTestService(d *db.DB, priv, pub string) *Service {
	return New(pub, priv, "mailto:test@example.com")
}

// svcKeys builds a configured Service with freshly generated VAPID keys.
func svcKeys(t *testing.T, d *db.DB) *Service {
	t.Helper()
	priv, pub := testKeys(t)
	return newTestService(d, priv, pub)
}

func TestNotConfiguredOmits(t *testing.T) {
	d := testDB(t)
	uid := mkUser(t, d, "u1", "es")
	s := New("", "", "")
	if s.Configured() {
		t.Fatal("should not be configured without VAPID")
	}
	mkSub(t, d, uid, "https://push.example/1")
	res := s.NotifyUsers(d, []string{uid}, "tarea_creada", Datos{"usuario": "x", "titulo": "y"}, Options{})
	if res.Omitidos != 1 || res.Enviados != 0 {
		t.Fatalf("should omit without VAPID: %+v", res)
	}
}

func TestNotifySendsToSubscriptions(t *testing.T) {
	d := testDB(t)
	uid := mkUser(t, d, "u1", "es")
	s := svcKeys(t, d)
	mkSub(t, d, uid, "https://push.example/1")

	var gotPayload string
	s.SetSendFn(func(sub *webpush.Subscription, payload []byte, opts *webpush.Options) (int, error) {
		gotPayload = string(payload)
		if opts.TTL <= 0 {
			t.Errorf("invalid TTL: %d", opts.TTL)
		}
		if opts.Subscriber != "mailto:test@example.com" {
			t.Errorf("subscriber = %q", opts.Subscriber)
		}
		return 201, nil
	})

	res := s.NotifyUsers(d, []string{uid}, "tarea_creada", Datos{"usuario": "nacho", "titulo": "Comprar pan"}, Options{Severity: "high"})
	if res.Enviados != 1 {
		t.Fatalf("enviados = %d (%+v)", res.Enviados, res)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(gotPayload), &payload); err != nil {
		t.Fatalf("payload not JSON: %v", err)
	}
	if payload["title"] != "Nueva tarea" {
		t.Fatalf("title = %v", payload["title"])
	}
	if !strings.Contains(payload["body"].(string), "«Comprar pan»") {
		t.Fatalf("body = %v", payload["body"])
	}
	if payload["tag"] != "tarea_creada" {
		t.Fatalf("tag = %v", payload["tag"])
	}
	if payload["web_push"] != float64(8030) {
		t.Fatalf("web_push = %v", payload["web_push"])
	}
}

// TestRealSendVAPIDHeaders drives the real webpush.SendNotification against an
// httptest push service and asserts the VAPID Authorization header is present
// (and the encrypted body uses aes128gcm).
func TestRealSendVAPIDHeaders(t *testing.T) {
	d := testDB(t)
	uid := mkUser(t, d, "u1", "es")
	priv, pub := testKeys(t)
	s := newTestService(d, priv, pub)

	type captured struct {
		auth            string
		contentEncoding string
		ttl             string
		urgency         string
	}
	got := make(chan captured, 1)
	pushSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got <- captured{
			auth:            r.Header.Get("Authorization"),
			contentEncoding: r.Header.Get("Content-Encoding"),
			ttl:             r.Header.Get("TTL"),
			urgency:         r.Header.Get("Urgency"),
		}
		w.WriteHeader(201)
	}))
	defer pushSrv.Close()

	s.SetHTTPClient(pushSrv.Client())
	p256dh, auth := validSubKeys(t)
	now := time.Now().UnixMilli()
	if _, err := d.Exec(
		"INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		ids.New(), uid, pushSrv.URL+"/sub/abc", p256dh, auth, now, now); err != nil {
		t.Fatalf("sub: %v", err)
	}

	res := s.NotifyUsers(d, []string{uid}, "tarea_creada", Datos{"usuario": "nacho", "titulo": "x"}, Options{})
	if res.Enviados != 1 {
		t.Fatalf("enviados = %d (%+v)", res.Enviados, res)
	}
	c := <-got
	if !strings.HasPrefix(c.auth, "vapid ") {
		t.Fatalf("VAPID Authorization header missing: %q", c.auth)
	}
	if !strings.Contains(c.auth, "t=") || !strings.Contains(c.auth, "k=") {
		t.Fatalf("VAPID Authorization must carry t= (JWT) and k= (key): %q", c.auth)
	}
	if c.contentEncoding != "aes128gcm" {
		t.Fatalf("content-encoding = %q", c.contentEncoding)
	}
	if c.ttl == "" {
		t.Fatalf("TTL header missing")
	}
}

func TestRespectsDisabledPreference(t *testing.T) {
	d := testDB(t)
	uid := mkUser(t, d, "u1", "es")
	s := svcKeys(t, d)
	mkSub(t, d, uid, "https://push.example/1")
	if _, err := d.Exec(
		"INSERT INTO notification_preferences (user_id, tipo, enabled, min_severity, updated_at) VALUES (?, 'comentario', 0, 'normal', ?)",
		uid, time.Now().UnixMilli()); err != nil {
		t.Fatalf("pref: %v", err)
	}
	s.SetSendFn(func(*webpush.Subscription, []byte, *webpush.Options) (int, error) {
		t.Fatal("should not send with preference disabled")
		return 0, nil
	})
	res := s.NotifyUsers(d, []string{uid}, "comentario", Datos{}, Options{})
	if res.Omitidos != 1 || res.Enviados != 0 {
		t.Fatalf("res = %+v", res)
	}
}

func TestRespectsMinSeverity(t *testing.T) {
	d := testDB(t)
	uid := mkUser(t, d, "u1", "es")
	s := svcKeys(t, d)
	mkSub(t, d, uid, "https://push.example/1")
	if _, err := d.Exec(
		"INSERT INTO notification_preferences (user_id, tipo, enabled, min_severity, updated_at) VALUES (?, 'tarea_movida', 1, 'critical', ?)",
		uid, time.Now().UnixMilli()); err != nil {
		t.Fatalf("pref: %v", err)
	}
	s.SetSendFn(func(*webpush.Subscription, []byte, *webpush.Options) (int, error) {
		t.Fatal("high severity should not pass with min_severity critical")
		return 0, nil
	})
	res := s.NotifyUsers(d, []string{uid}, "tarea_movida", Datos{}, Options{Severity: "high"})
	if res.Omitidos != 1 {
		t.Fatalf("omitidos = %d (%+v)", res.Omitidos, res)
	}
}

// TestQuietHoursEnqueueAndFlush: a window covering now enqueues; the flush
// consolidates once the window is closed.
func TestQuietHoursEnqueueAndFlush(t *testing.T) {
	d := testDB(t)
	uid := mkUser(t, d, "u1", "es")
	s := svcKeys(t, d)
	mkSub(t, d, uid, "https://push.example/1")

	loc, _ := time.LoadLocation("Europe/Madrid")
	h := time.Now().In(loc).Hour()
	start, end := h, (h+2)%24
	if _, err := d.Exec(
		"INSERT INTO notification_quiet_hours (user_id, quiet_start, quiet_end, tz, updated_at) VALUES (?, ?, ?, 'Europe/Madrid', ?)",
		uid, start, end, time.Now().UnixMilli()); err != nil {
		t.Fatalf("quiet: %v", err)
	}

	s.SetSendFn(func(*webpush.Subscription, []byte, *webpush.Options) (int, error) {
		t.Fatal("should not send inside quiet hours")
		return 0, nil
	})
	res := s.NotifyUsers(d, []string{uid}, "tarea_movida", Datos{"usuario": "x", "titulo": "y", "columna": "hecho"}, Options{})
	if res.Pospuestos != 1 {
		t.Fatalf("pospuestos = %d (%+v)", res.Pospuestos, res)
	}
	var n int
	_ = d.QueryRow("SELECT COUNT(*) FROM notification_queue").Scan(&n)
	if n != 1 {
		t.Fatalf("queue = %d, want 1", n)
	}

	// still inside the window: flush does not deliver
	s.FlushNotificationQueue(d, false)
	_ = d.QueryRow("SELECT COUNT(*) FROM notification_queue").Scan(&n)
	if n != 1 {
		t.Fatalf("queue after in-window flush = %d, want 1", n)
	}

	// close the window and flush consolidates into one summary
	if _, err := d.Exec("DELETE FROM notification_quiet_hours"); err != nil {
		t.Fatal(err)
	}
	var sent []string
	s.SetSendFn(func(_ *webpush.Subscription, payload []byte, _ *webpush.Options) (int, error) {
		sent = append(sent, string(payload))
		return 201, nil
	})
	s.FlushNotificationQueue(d, false)
	_ = d.QueryRow("SELECT COUNT(*) FROM notification_queue").Scan(&n)
	if n != 0 {
		t.Fatalf("queue after flush = %d, want 0", n)
	}
	if len(sent) != 1 {
		t.Fatalf("sent = %d, want 1", len(sent))
	}
	var p map[string]any
	_ = json.Unmarshal([]byte(sent[0]), &p)
	if p["title"] != "Actividad en Deltos" || !strings.Contains(p["body"].(string), "1 cambios") {
		t.Fatalf("summary payload = %s", sent[0])
	}
}

func TestCriticalBypassesQuietHours(t *testing.T) {
	d := testDB(t)
	uid := mkUser(t, d, "u1", "es")
	s := svcKeys(t, d)
	mkSub(t, d, uid, "https://push.example/1")
	loc, _ := time.LoadLocation("Europe/Madrid")
	h := time.Now().In(loc).Hour()
	_, _ = d.Exec(
		"INSERT INTO notification_quiet_hours (user_id, quiet_start, quiet_end, tz, updated_at) VALUES (?, ?, ?, 'Europe/Madrid', ?)",
		uid, h, (h+2)%24, time.Now().UnixMilli())
	s.SetSendFn(func(*webpush.Subscription, []byte, *webpush.Options) (int, error) { return 201, nil })
	res := s.NotifyUsers(d, []string{uid}, "pago_requerido", Datos{}, Options{Severity: "critical"})
	if res.Enviados != 1 {
		t.Fatalf("critical should send: %+v", res)
	}
}

func TestDeadSubscriptionRemoved(t *testing.T) {
	d := testDB(t)
	uid := mkUser(t, d, "u1", "es")
	s := svcKeys(t, d)
	mkSub(t, d, uid, "https://push.example/1")
	s.SetSendFn(func(*webpush.Subscription, []byte, *webpush.Options) (int, error) { return 410, nil })
	res := s.NotifyUsers(d, []string{uid}, "tarea_creada", Datos{"usuario": "x", "titulo": "y"}, Options{})
	if res.Borrados != 1 {
		t.Fatalf("borrados = %d (%+v)", res.Borrados, res)
	}
	var n int
	_ = d.QueryRow("SELECT COUNT(*) FROM push_subscriptions").Scan(&n)
	if n != 0 {
		t.Fatalf("subscription not removed: %d", n)
	}
}

func TestRetriesOn500(t *testing.T) {
	d := testDB(t)
	uid := mkUser(t, d, "u1", "es")
	s := svcKeys(t, d)
	mkSub(t, d, uid, "https://push.example/1")
	attempts := 0
	s.SetSendFn(func(*webpush.Subscription, []byte, *webpush.Options) (int, error) {
		attempts++
		if attempts < 3 {
			return 500, nil
		}
		return 201, nil
	})
	res := s.NotifyUsers(d, []string{uid}, "tarea_creada", Datos{"usuario": "x", "titulo": "y"}, Options{})
	if res.Enviados != 1 {
		t.Fatalf("should eventually send: %+v", res)
	}
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3", attempts)
	}
}

func TestPayloadI18n(t *testing.T) {
	cases := []struct {
		lang  Lang
		title string
	}{
		{LangES, "Nueva tarea"},
		{LangEN, "New task"},
	}
	for _, c := range cases {
		raw := composePayload(c.lang, "tarea_creada", Datos{"usuario": "nacho", "titulo": "X"}, "/")
		var p map[string]any
		if err := json.Unmarshal(raw, &p); err != nil {
			t.Fatalf("json: %v", err)
		}
		if p["title"] != c.title {
			t.Fatalf("%s title = %v (want %v)", c.lang, p["title"], c.title)
		}
	}
}

func TestPayloadUnknownTipoFallsBack(t *testing.T) {
	raw := composePayload(LangES, "desconocido", Datos{"total": 5}, "/")
	var p map[string]any
	_ = json.Unmarshal(raw, &p)
	if p["title"] != "Actividad en Deltos" {
		t.Fatalf("fallback title = %v", p["title"])
	}
}
