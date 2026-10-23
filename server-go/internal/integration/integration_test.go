// Package integration boots the real application stack (config, databases,
// auth, router) on an httptest server and validates the login round-trip
// with real HTTP requests: the phase 1 smoke (gate G7).
package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gnacho/deltos/server-go/internal/api"
	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/config"
	"github.com/gnacho/deltos/server-go/internal/db"
)

const (
	adminUser     = "testadmin"
	adminPassword = "supersecretpass"
)

func boot(t *testing.T) (*httptest.Server, *auth.Service, *db.DB, string) {
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

	cfg, err := config.Load(func(k string) string {
		switch k {
		case "AUTH_USER":
			return adminUser
		case "AUTH_PASS":
			return adminPassword
		case "SESSION_SECRET":
			return "integration-test-secret-value-32-chars!"
		case "DATA_DIR":
			return dir
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = cfg
	if _, err := auth.EnsureBootstrapAdmin(prod, adminUser, adminPassword); err != nil {
		t.Fatal(err)
	}
	if _, err := prod.EnsureInbox(); err != nil {
		t.Fatal(err)
	}
	svc := &auth.Service{
		Prod: prod, Demo: demo, Secret: "integration-test-secret-value-32-chars!",
	}
	srv := api.New(svc, prod, demo, api.Config{
		MaxUploadMB: 10,
		StaticDir:   dir,
		Version:     "test",
		Build:       "test",
	})
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return ts, svc, prod, dir
}

func postJSON(t *testing.T, url string, body any, headers map[string]string) (*http.Response, map[string]any) {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("invalid JSON response: %v", err)
	}
	return res, out
}

func TestLoginRoundTrip(t *testing.T) {
	ts, _, _, _ := boot(t)
	client := &http.Client{Timeout: 10 * time.Second}

	// 1. Health.
	res, err := client.Get(ts.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	var health map[string]any
	if err := json.NewDecoder(res.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 || health["status"] != "ok" || health["db"] != "connected" {
		t.Fatalf("health must be ok: %d %v", res.StatusCode, health)
	}

	// 2. Login with bad credentials: 401 AUTH_INVALID_CREDENTIALS.
	res, body := postJSON(t, ts.URL+"/api/auth/login",
		map[string]string{"username": adminUser, "password": "wrong-password"}, nil)
	if res.StatusCode != 401 {
		t.Fatalf("bad login must 401, got %d", res.StatusCode)
	}
	errObj, _ := body["error"].(map[string]any)
	if errObj == nil || errObj["code"] != "AUTH_INVALID_CREDENTIALS" {
		t.Fatalf("envelope must carry the code: %v", body)
	}

	// 3. Login OK: 200 + cookie + csrfToken + user payload.
	res, body = postJSON(t, ts.URL+"/api/auth/login",
		map[string]string{"username": adminUser, "password": adminPassword}, nil)
	if res.StatusCode != 200 {
		t.Fatalf("login must 200, got %d: %v", res.StatusCode, body)
	}
	loginCookies := res.Cookies()
	user, _ := body["user"].(map[string]any)
	if user == nil || user["username"] != adminUser || user["role"] != "admin" {
		t.Fatalf("login must return the admin user: %v", body)
	}
	if body["demo"] != false {
		t.Fatalf("login must be a prod session: %v", body)
	}
	csrfToken, _ := body["csrfToken"].(string)
	if csrfToken == "" {
		t.Fatalf("login must return a csrfToken: %v", body)
	}
	cookies := loginCookies
	if len(cookies) == 0 || cookies[0].Name != "deltos_session" {
		t.Fatalf("login must set deltos_session cookie: %v", cookies)
	}
	if !cookies[0].HttpOnly {
		t.Fatal("session cookie must be httpOnly")
	}

	// 4. /api/auth/me with the cookie: same user, csrf token.
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/auth/me", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var me map[string]any
	if err := json.NewDecoder(res.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("me must 200, got %d", res.StatusCode)
	}
	meUser, _ := me["user"].(map[string]any)
	if meUser == nil || meUser["username"] != adminUser {
		t.Fatalf("me must return the session user: %v", me)
	}
	if me["csrfToken"] != csrfToken {
		t.Fatalf("me must return the session csrf token: %v", me)
	}

	// 5. Mutation without CSRF header: 403 CSRF_INVALID (register is admin-only).
	req, _ = http.NewRequest(http.MethodPost, ts.URL+"/api/auth/register",
		strings.NewReader(`{"username":"other","password":"password-10"}`))
	req.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var regErr map[string]any
	_ = json.NewDecoder(res.Body).Decode(&regErr)
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatalf("mutation without csrf must 403, got %d: %v", res.StatusCode, regErr)
	}
	errObj, _ = regErr["error"].(map[string]any)
	if errObj == nil || errObj["code"] != "CSRF_INVALID" {
		t.Fatalf("envelope must carry CSRF_INVALID: %v", regErr)
	}

	// 6. Mutation WITH the csrf header: 201 created + Location.
	req, _ = http.NewRequest(http.MethodPost, ts.URL+"/api/auth/register",
		strings.NewReader(`{"username":"other","password":"password-10"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Csrf-Token", csrfToken)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("register with csrf must 201, got %d", res.StatusCode)
	}
	if loc := res.Header.Get("Location"); !strings.HasPrefix(loc, "/api/users/") {
		t.Fatalf("register must set Location: %q", loc)
	}

	// 7. Logout clears the cookie and kills the session.
	logoutReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/logout", nil)
	for _, c := range cookies {
		logoutReq.AddCookie(c)
	}
	res, err = client.Do(logoutReq)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("logout must 200, got %d", res.StatusCode)
	}
	req, _ = http.NewRequest(http.MethodGet, ts.URL+"/api/auth/me", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var meAfter map[string]any
	_ = json.NewDecoder(res.Body).Decode(&meAfter)
	res.Body.Close()
	if res.StatusCode != 200 && res.StatusCode != 401 {
		t.Fatalf("me after logout must be 200 (null user) or 401, got %d", res.StatusCode)
	}
	if res.StatusCode == 200 {
		if u, ok := meAfter["user"].(map[string]any); ok && u != nil {
			t.Fatalf("user must be null after logout: %v", meAfter)
		}
	}
}

func TestStaticAssetsServedAndMissing404(t *testing.T) {
	ts, _, _, dir := boot(t)

	// The boot temp dir is the STATIC_DIR: create the asset on disk.
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "index-CvfNCXj_.js"), []byte("console.log('x')"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Existing file under /assets must be served (the blank-screen bug: the
	// NotFound handler used to reject /assets/* before looking at disk).
	res, err := http.Get(ts.URL + "/assets/index-CvfNCXj_.js")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("existing asset must 200, got %d", res.StatusCode)
	}
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Fatalf("assets must be immutable, got %q", cc)
	}

	// Missing asset: 404 with the envelope (not an HTML page).
	res, err = http.Get(ts.URL + "/assets/nope.js")
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.NewDecoder(res.Body).Decode(&body)
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("missing asset must 404, got %d", res.StatusCode)
	}
	if e, _ := body["error"].(map[string]any); e == nil || e["code"] != "NOT_FOUND" {
		t.Fatalf("envelope must carry NOT_FOUND: %v", body)
	}

	// SPA fallback for a client route serves index.html.
	res, err = http.Get(ts.URL + "/tasks")
	if err != nil {
		t.Fatal(err)
	}
	ct := res.Header.Get("Content-Type")
	res.Body.Close()
	if res.StatusCode != 200 || !strings.Contains(ct, "text/html") {
		t.Fatalf("SPA fallback must serve html, got %d %q", res.StatusCode, ct)
	}
}

func TestMethodNotAllowedMatchesHono(t *testing.T) {
	// GET on a POST-only route: Hono answers the 404 envelope (no route
	// match); chi would answer an empty 405. Parity requires the envelope.
	ts, _, _, _ := boot(t)
	res, err := http.Get(ts.URL + "/api/projects")
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.NewDecoder(res.Body).Decode(&body)
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("GET on POST-only route must be 404 (Hono parity), got %d", res.StatusCode)
	}
	if e, _ := body["error"].(map[string]any); e == nil || e["code"] != "NOT_FOUND" {
		t.Fatalf("envelope must carry NOT_FOUND: %v", body)
	}
}

func TestLoginLockoutEndToEnd(t *testing.T) {
	ts, _, _, _ := boot(t)
	for i := 0; i < 5; i++ {
		res, _ := postJSON(t, ts.URL+"/api/auth/login",
			map[string]string{"username": adminUser, "password": "wrong"}, nil)
		if res.StatusCode != 401 {
			t.Fatalf("attempt %d must 401, got %d", i+1, res.StatusCode)
		}
	}
	// 6th attempt (even with the right password): 429 AUTH_RATE_LIMITED.
	res, body := postJSON(t, ts.URL+"/api/auth/login",
		map[string]string{"username": adminUser, "password": adminPassword}, nil)
	if res.StatusCode != 429 {
		t.Fatalf("locked login must 429, got %d: %v", res.StatusCode, body)
	}
	errObj, _ := body["error"].(map[string]any)
	if errObj == nil || errObj["code"] != "AUTH_RATE_LIMITED" {
		t.Fatalf("envelope must carry AUTH_RATE_LIMITED: %v", body)
	}
}

func TestVersionAndNotFound(t *testing.T) {
	ts, _, _, _ := boot(t)

	// Without a session /api/version is 401 (it lives behind requireAuth,
	// same as app.ts in the Node server).
	res, err := http.Get(ts.URL + "/api/version")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("version without session must 401, got %d", res.StatusCode)
	}

	// With a session: 200 + version payload.
	client := &http.Client{Timeout: 10 * time.Second}
	res, _ = postJSON(t, ts.URL+"/api/auth/login",
		map[string]string{"username": adminUser, "password": adminPassword}, nil)
	if res.StatusCode != 200 {
		t.Fatalf("login must 200, got %d", res.StatusCode)
	}
	loginCookies := res.Cookies()
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/version", nil)
	for _, c := range loginCookies {
		req.AddCookie(c)
	}
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]any
	_ = json.NewDecoder(res.Body).Decode(&v)
	res.Body.Close()
	if res.StatusCode != 200 || v["version"] != "test" {
		t.Fatalf("version: %d %v", res.StatusCode, v)
	}

	// /api/nope with a session: 404 NOT_FOUND envelope (requireAuth passes,
	// nothing matches). Without a session it is 401 (checked above).
	req2, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/nope", nil)
	for _, c := range loginCookies {
		req2.AddCookie(c)
	}
	res2, err := client.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	var nf map[string]any
	_ = json.NewDecoder(res2.Body).Decode(&nf)
	res2.Body.Close()
	if res2.StatusCode != 404 {
		t.Fatalf("unknown api route must 404, got %d", res2.StatusCode)
	}
	if e, _ := nf["error"].(map[string]any); e == nil || e["code"] != "NOT_FOUND" {
		t.Fatalf("envelope must carry NOT_FOUND: %v", nf)
	}
}
