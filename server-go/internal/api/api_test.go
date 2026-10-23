package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/db"
)

const testAdminPass = "admin1234567"

func bootAPI(t *testing.T) (*httptest.Server, *db.DB, string) {
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
	return ts, prod, dir
}

type session struct {
	cookie string
	csrf   string
}

func loginAdmin(t *testing.T, ts *httptest.Server) session {
	t.Helper()
	res, body := doReq(t, ts, http.MethodPost, "/api/auth/login", map[string]string{"username": "admin", "password": testAdminPass}, nil)
	if res.StatusCode != 200 {
		t.Fatalf("login admin failed: %d %s", res.StatusCode, body)
	}
	var m map[string]any
	_ = json.Unmarshal(body, &m)
	csrf, _ := m["csrfToken"].(string)
	return session{cookie: cookieOf(t, res), csrf: csrf}
}

func (s session) headers() map[string]string {
	return map[string]string{"Cookie": s.cookie, "X-Csrf-Token": s.csrf}
}

// doReq performs a request with a JSON body (nil body = no body).
func doReq(t *testing.T, ts *httptest.Server, method, path string, body any, headers map[string]string) (*http.Response, []byte) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, ts.URL+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res, b
}

func decodeMap(t *testing.T, b []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("invalid JSON: %v (%s)", err, b)
	}
	return m
}

func createProject(t *testing.T, ts *httptest.Server, s session, name string) string {
	t.Helper()
	res, body := doReq(t, ts, http.MethodPost, "/api/projects", map[string]any{"name": name}, s.headers())
	if res.StatusCode != 201 {
		t.Fatalf("create project: %d %s", res.StatusCode, body)
	}
	return decodeMap(t, body)["project"].(map[string]any)["id"].(string)
}

func createTask(t *testing.T, ts *httptest.Server, s session, projectID, title string) string {
	t.Helper()
	res, body := doReq(t, ts, http.MethodPost, "/api/tasks", map[string]any{"project_id": projectID, "title": title}, s.headers())
	if res.StatusCode != 201 {
		t.Fatalf("create task: %d %s", res.StatusCode, body)
	}
	return decodeMap(t, body)["task"].(map[string]any)["id"].(string)
}

// uploadAttachment posts a multipart file and returns the response.
func uploadAttachment(t *testing.T, ts *httptest.Server, s session, taskID, filename, contentType, content string) (*http.Response, []byte) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename))
	h.Set("Content-Type", contentType)
	fw, err := w.CreatePart(h)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fw.Write([]byte(content))
	_ = w.Close()

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/tasks/"+taskID+"/attachments", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Cookie", s.cookie)
	req.Header.Set("X-Csrf-Token", s.csrf)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	return res, b
}

func cookieOf(t *testing.T, res *http.Response) string {
	t.Helper()
	var out []string
	for _, c := range res.Cookies() {
		if c.Name == "deltos_session" {
			out = append(out, c.Name+"="+c.Value)
		}
	}
	return strings.Join(out, "; ")
}

// --- G7: attachments ----------------------------------------------------------

func TestAttachments(t *testing.T) {
	t.Run("upload registers event and downloads with content-type", func(t *testing.T) {
		ts, _, _ := bootAPI(t)
		s := loginAdmin(t, ts)
		project := createProject(t, ts, s, "Casa")
		task := createTask(t, ts, s, project, "Con adjunto")

		res, b := uploadAttachment(t, ts, s, task, "nota.txt", "text/plain", "contenido de prueba")
		if res.StatusCode != 201 {
			t.Fatalf("upload: %d %s", res.StatusCode, b)
		}
		up := decodeMap(t, b)
		att, _ := up["attachment"].(map[string]any)
		if att["filename"] != "nota.txt" || att["size"] != float64(19) {
			t.Fatalf("attachment = %v", att)
		}
		attID, _ := att["id"].(string)

		_, b = doReq(t, ts, http.MethodGet, "/api/tasks/"+task, nil, s.headers())
		detail := decodeMap(t, b)
		if len(detail["attachments"].([]any)) != 1 {
			t.Fatalf("detail.attachments = %d", len(detail["attachments"].([]any)))
		}
		activity, _ := detail["activity"].([]any)
		found := false
		for _, e := range activity {
			ev, _ := e.(map[string]any)
			d, _ := ev["data"].(map[string]any)
			if ev["type"] == "attachment" && d["filename"] == "nota.txt" {
				found = true
			}
		}
		if !found {
			t.Fatalf("attachment event missing: %v", activity)
		}

		res, b = doReq(t, ts, http.MethodGet, "/api/attachments/"+attID, nil, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("download: %d", res.StatusCode)
		}
		if !strings.Contains(res.Header.Get("Content-Type"), "text/plain") {
			t.Fatalf("content-type = %q", res.Header.Get("Content-Type"))
		}
		if !strings.Contains(res.Header.Get("Content-Disposition"), "nota.txt") {
			t.Fatalf("content-disposition = %q", res.Header.Get("Content-Disposition"))
		}
		if string(b) != "contenido de prueba" {
			t.Fatalf("download body = %q", b)
		}
	})

	t.Run("rejects multipart without file", func(t *testing.T) {
		ts, _, _ := bootAPI(t)
		s := loginAdmin(t, ts)
		project := createProject(t, ts, s, "Casa")
		task := createTask(t, ts, s, project, "T")

		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		_ = w.WriteField("nada", "x")
		_ = w.Close()
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/tasks/"+task+"/attachments", &buf)
		req.Header.Set("Content-Type", w.FormDataContentType())
		req.Header.Set("Cookie", s.cookie)
		req.Header.Set("X-Csrf-Token", s.csrf)
		res, _ := http.DefaultClient.Do(req)
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode != 400 {
			t.Fatalf("missing file must 400, got %d", res.StatusCode)
		}
	})

	t.Run("rejects disallowed mime", func(t *testing.T) {
		ts, _, _ := bootAPI(t)
		s := loginAdmin(t, ts)
		project := createProject(t, ts, s, "Casa")
		task := createTask(t, ts, s, project, "T")

		res, b := uploadAttachment(t, ts, s, task, "malware.exe", "application/x-msdownload", "<script>alert(1)</script>")
		if res.StatusCode != 415 {
			t.Fatalf("disallowed mime must 415, got %d", res.StatusCode)
		}
		if decodeMap(t, b)["error"].(map[string]any)["code"] != "UPLOAD_INVALID_MIME" {
			t.Fatalf("expected UPLOAD_INVALID_MIME: %s", b)
		}
	})

	t.Run("non-member cannot download (IDOR)", func(t *testing.T) {
		ts, _, _ := bootAPI(t)
		s := loginAdmin(t, ts)
		res, _ := doReq(t, ts, http.MethodPost, "/api/users", map[string]any{"username": "jordi", "password": "jordi1234567"}, s.headers())
		if res.StatusCode != 201 {
			t.Fatalf("register jordi: %d", res.StatusCode)
		}
		project := createProject(t, ts, s, "Casa")
		task := createTask(t, ts, s, project, "Con adjunto")

		res, b := uploadAttachment(t, ts, s, task, "nota.txt", "text/plain", "contenido de prueba")
		if res.StatusCode != 201 {
			t.Fatalf("upload: %d %s", res.StatusCode, b)
		}
		attID := decodeMap(t, b)["attachment"].(map[string]any)["id"].(string)

		jres, jb := doReq(t, ts, http.MethodPost, "/api/auth/login", map[string]string{"username": "jordi", "password": "jordi1234567"}, nil)
		if jres.StatusCode != 200 {
			t.Fatalf("jordi login: %d %s", jres.StatusCode, jb)
		}
		jordi := session{cookie: cookieOf(t, jres), csrf: ""}

		res, _ = doReq(t, ts, http.MethodGet, "/api/attachments/"+attID, nil, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("admin download: %d", res.StatusCode)
		}
		res, _ = doReq(t, ts, http.MethodGet, "/api/attachments/"+attID, nil, jordi.headers())
		if res.StatusCode != 404 {
			t.Fatalf("non-member download must 404, got %d", res.StatusCode)
		}
	})
}

// --- G8: HA -------------------------------------------------------------------

func TestHA(t *testing.T) {
	t.Run("token generate, status, revoke", func(t *testing.T) {
		ts, _, _ := bootAPI(t)
		s := loginAdmin(t, ts)

		res, body := doReq(t, ts, http.MethodPost, "/api/ha/token", map[string]any{"username": "admin"}, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("gen token: %d %s", res.StatusCode, body)
		}
		tok := decodeMap(t, body)
		if tok["username"] != "admin" || tok["token"] == "" {
			t.Fatalf("token payload: %v", tok)
		}

		_, body = doReq(t, ts, http.MethodGet, "/api/ha/status", nil, s.headers())
		st := decodeMap(t, body)
		if st["enabled"] != true || st["username"] != "admin" {
			t.Fatalf("status: %v", st)
		}
		if _, ok := st["token"]; ok {
			t.Fatalf("status must not expose token: %v", st)
		}

		res, _ = doReq(t, ts, http.MethodDelete, "/api/ha/token", nil, s.headers())
		if res.StatusCode != 204 {
			t.Fatalf("revoke: %d", res.StatusCode)
		}
		_, body = doReq(t, ts, http.MethodGet, "/api/ha/status", nil, s.headers())
		if decodeMap(t, body)["enabled"] != false {
			t.Fatalf("status after revoke: %s", body)
		}
	})

	t.Run("public tasks require bearer", func(t *testing.T) {
		ts, _, _ := bootAPI(t)
		res, _ := doReq(t, ts, http.MethodGet, "/api/ha/tasks", nil, nil)
		if res.StatusCode != 401 {
			t.Fatalf("no token must 401, got %d", res.StatusCode)
		}
	})

	t.Run("create, list, complete with bearer", func(t *testing.T) {
		ts, _, _ := bootAPI(t)
		s := loginAdmin(t, ts)
		project := createProject(t, ts, s, "Casa")
		_, body := doReq(t, ts, http.MethodPost, "/api/ha/token", map[string]any{"username": "admin"}, s.headers())
		token := decodeMap(t, body)["token"].(string)
		authHdr := map[string]string{"Authorization": "Bearer " + token}

		_, body = doReq(t, ts, http.MethodGet, "/api/ha/tasks", nil, authHdr)
		if list := decodeMap(t, body); len(list["tasks"].([]any)) != 0 || list["count"] != float64(0) {
			t.Fatalf("empty list: %v", list)
		}

		res, body := doReq(t, ts, http.MethodPost, "/api/ha/tasks", map[string]any{"title": "Comprar leche", "project_id": project, "due_date": "2026-08-30"}, authHdr)
		if res.StatusCode != 201 {
			t.Fatalf("create: %d %s", res.StatusCode, body)
		}
		created := decodeMap(t, body)["task"].(map[string]any)
		if created["status"] != "needs_action" {
			t.Fatalf("created status: %v", created)
		}

		_, body = doReq(t, ts, http.MethodGet, "/api/ha/tasks", nil, authHdr)
		list := decodeMap(t, body)
		if list["count"] != float64(1) {
			t.Fatalf("list count: %v", list)
		}
		task0 := list["tasks"].([]any)[0].(map[string]any)
		if task0["summary"] != "Comprar leche" || task0["due_date"] != "2026-08-30" || task0["status"] != "needs_action" {
			t.Fatalf("task0: %v", task0)
		}

		res, body = doReq(t, ts, http.MethodPatch, "/api/ha/tasks/"+created["id"].(string)+"/complete", nil, authHdr)
		if res.StatusCode != 200 {
			t.Fatalf("complete: %d %s", res.StatusCode, body)
		}
		if decodeMap(t, body)["task"].(map[string]any)["status"] != "completed" {
			t.Fatalf("complete status: %s", body)
		}

		_, body = doReq(t, ts, http.MethodGet, "/api/ha/tasks", nil, authHdr)
		if decodeMap(t, body)["count"] != float64(0) {
			t.Fatalf("list after complete: %s", body)
		}
	})

	t.Run("bad token returns 401", func(t *testing.T) {
		ts, _, _ := bootAPI(t)
		res, _ := doReq(t, ts, http.MethodGet, "/api/ha/tasks", nil, map[string]string{"Authorization": "Bearer incorrecto"})
		if res.StatusCode != 401 {
			t.Fatalf("bad token must 401, got %d", res.StatusCode)
		}
	})

	t.Run("token acts only on configured user's projects (membership)", func(t *testing.T) {
		ts, _, _ := bootAPI(t)
		s := loginAdmin(t, ts)
		project := createProject(t, ts, s, "Casa")
		other := createProject(t, ts, s, "Ajeno")
		res, _ := doReq(t, ts, http.MethodPost, "/api/users", map[string]any{"username": "pepe", "password": "pepe1234567", "role": "user"}, s.headers())
		if res.StatusCode != 201 {
			t.Fatalf("register pepe: %d", res.StatusCode)
		}
		task := createTask(t, ts, s, other, "Secreta")

		_, body := doReq(t, ts, http.MethodPost, "/api/ha/token", map[string]any{"username": "pepe"}, s.headers())
		pepeToken := decodeMap(t, body)["token"].(string)
		authHdr := map[string]string{"Authorization": "Bearer " + pepeToken}

		res, _ = doReq(t, ts, http.MethodPost, "/api/ha/tasks", map[string]any{"title": "Intrusa", "project_id": other}, authHdr)
		if res.StatusCode != 403 {
			t.Fatalf("non-member create must 403, got %d", res.StatusCode)
		}
		res, _ = doReq(t, ts, http.MethodPatch, "/api/ha/tasks/"+task+"/complete", nil, authHdr)
		if res.StatusCode != 404 {
			t.Fatalf("non-member complete must 404, got %d", res.StatusCode)
		}
		_, body = doReq(t, ts, http.MethodPost, "/api/ha/token", map[string]any{"username": "admin"}, s.headers())
		adminToken := decodeMap(t, body)["token"].(string)
		res, _ = doReq(t, ts, http.MethodPost, "/api/ha/tasks", map[string]any{"title": "Propia", "project_id": project}, map[string]string{"Authorization": "Bearer " + adminToken})
		if res.StatusCode != 201 {
			t.Fatalf("admin create must 201, got %d", res.StatusCode)
		}
	})
}
