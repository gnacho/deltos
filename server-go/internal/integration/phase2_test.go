package integration

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type smokeSession struct {
	cookie string
	csrf   string
}

func smokeLogin(t *testing.T, ts *httptest.Server) smokeSession {
	t.Helper()
	res, body := postJSON(t, ts.URL+"/api/auth/login", map[string]string{"username": adminUser, "password": adminPassword}, nil)
	if res.StatusCode != 200 {
		t.Fatalf("login: %d %v", res.StatusCode, body)
	}
	var cookies []string
	for _, c := range res.Cookies() {
		if c.Name == "deltos_session" {
			cookies = append(cookies, c.Name+"="+c.Value)
		}
	}
	csrf, _ := body["csrfToken"].(string)
	return smokeSession{cookie: strings.Join(cookies, "; "), csrf: csrf}
}

func smokeDo(t *testing.T, ts *httptest.Server, method, path string, body any, s smokeSession, extra map[string]string) (int, map[string]any) {
	t.Helper()
	var buf bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		buf = *bytes.NewReader(b)
	}
	var req *http.Request
	var err error
	if body != nil {
		req, err = http.NewRequest(method, ts.URL+path, &buf)
		req.Header.Set("Content-Type", "application/json")
	} else {
		req, err = http.NewRequest(method, ts.URL+path, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	if s.cookie != "" {
		req.Header.Set("Cookie", s.cookie)
	}
	if s.csrf != "" {
		req.Header.Set("X-Csrf-Token", s.csrf)
	}
	for k, v := range extra {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func TestPhase2Smoke(t *testing.T) {
	ts, _, _, _ := boot(t)
	s := smokeLogin(t, ts)

	// 1. create project + task
	status, body := smokeDo(t, ts, http.MethodPost, "/api/projects", map[string]any{"name": "Casa"}, s, nil)
	if status != 201 {
		t.Fatalf("create project: %d %v", status, body)
	}
	projectID := body["project"].(map[string]any)["id"].(string)

	// 2. Idempotency: create task with a key, then replay
	status, body = smokeDo(t, ts, http.MethodPost, "/api/tasks", map[string]any{"project_id": projectID, "title": "Tarea idempotente"}, s, map[string]string{"Idempotency-Key": "smoke-key-1"})
	if status != 201 {
		t.Fatalf("create task (idem): %d %v", status, body)
	}
	firstTaskID := body["task"].(map[string]any)["id"].(string)

	status2, body2 := smokeDo(t, ts, http.MethodPost, "/api/tasks", map[string]any{"project_id": projectID, "title": "Tarea idempotente"}, s, map[string]string{"Idempotency-Key": "smoke-key-1"})
	if status2 != 201 {
		t.Fatalf("replay task (idem): %d %v", status2, body2)
	}
	if body2["task"].(map[string]any)["id"] != firstTaskID {
		t.Fatalf("idempotent replay must return the same task id: %v vs %v", firstTaskID, body2["task"].(map[string]any)["id"])
	}

	// 3. recurring task: move to 'hecho' creates the next instance
	now := time.Now().In(madrid())
	due := now.AddDate(0, 0, -1).Format("2006-01-02")
	expected := now.AddDate(0, 0, 6).Format("2006-01-02")

	status, body = smokeDo(t, ts, http.MethodPost, "/api/tasks", map[string]any{
		"project_id": projectID,
		"title":      "Riega",
		"due_date":   due,
		"recurrence": map[string]any{"freq": "weekly", "interval": 1, "mode": "due"},
	}, s, nil)
	if status != 201 {
		t.Fatalf("create recurring task: %d %v", status, body)
	}
	recTask := body["task"].(map[string]any)
	recTaskID := recTask["id"].(string)
	if recTask["recurrence_group_id"] != recTaskID {
		t.Fatalf("recurrence_group_id must equal task id: %v", recTask)
	}

	status, body = smokeDo(t, ts, http.MethodPost, "/api/tasks/"+recTaskID+"/move", map[string]any{"column": "hecho", "position": 0}, s, nil)
	if status != 200 {
		t.Fatalf("move recurring to hecho: %d %v", status, body)
	}
	if body["task"].(map[string]any)["column"] != "hecho" {
		t.Fatalf("moved task column: %v", body)
	}

	// find the next instance via bootstrap
	status, boot := smokeDo(t, ts, http.MethodGet, "/api/bootstrap", nil, s, nil)
	if status != 200 {
		t.Fatalf("bootstrap: %d", status)
	}
	var next map[string]any
	for _, t := range boot["tasks"].([]any) {
		task := t.(map[string]any)
		if task["recurrence_group_id"] == recTaskID && task["column"] == "nuevo" {
			next = task
		}
	}
	if next == nil {
		t.Fatalf("next recurring instance not created: %v", boot["tasks"])
	}
	if next["due_date"] != expected {
		t.Fatalf("next due_date = %v, want %v", next["due_date"], expected)
	}

	// 4. SSE receives task.changed with the right event name and data
	sseReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/events", nil)
	sseReq.Header.Set("Cookie", s.cookie)
	sseRes, err := http.DefaultClient.Do(sseReq)
	if err != nil {
		t.Fatal(err)
	}
	defer sseRes.Body.Close()
	reader := bufio.NewReader(sseRes.Body)

	event, data := readSSE(t, reader)
	if event != "hello" || data != `{"ok":true}` {
		t.Fatalf("expected hello event, got %q %q", event, data)
	}

	// trigger a mutation -> broadcast task.changed
	status, _ = smokeDo(t, ts, http.MethodPost, "/api/tasks", map[string]any{"project_id": projectID, "title": "Otra"}, s, nil)
	if status != 201 {
		t.Fatalf("create task for SSE: %d", status)
	}

	event, data = readSSE(t, reader)
	if event != "task.changed" || data != `{"type":"changed","entity":"tasks"}` {
		t.Fatalf("expected task.changed event, got %q %q", event, data)
	}
}

func madrid() *time.Location {
	loc, err := time.LoadLocation("Europe/Madrid")
	if err != nil {
		return time.UTC
	}
	return loc
}

func readSSE(t *testing.T, r *bufio.Reader) (event, data string) {
	t.Helper()
	type result struct {
		event, data string
		err         error
	}
	ch := make(chan result, 1)
	go func() {
		var event, data string
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				ch <- result{err: err}
				return
			}
			line = strings.TrimSuffix(line, "\n")
			if line == "" {
				ch <- result{event: event, data: data}
				return
			}
			switch {
			case strings.HasPrefix(line, "event: "):
				event = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				data = strings.TrimPrefix(line, "data: ")
			}
		}
	}()
	select {
	case res := <-ch:
		if res.err != nil {
			t.Fatalf("read SSE: %v", res.err)
		}
		return res.event, res.data
	case <-time.After(5 * time.Second):
		t.Fatalf("timeout reading SSE event")
		return "", ""
	}
}
