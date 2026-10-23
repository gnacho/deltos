package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Phase 5 tests: POST /api/tasks/parse and GET /api/tasks/recurring
// (plus pause/resume), mirroring server/tests/recurrence.test.ts and the
// nlp endpoint shape.

func createRecurringTask(t *testing.T, ts *httptest.Server, s session, projectID string, body map[string]any) string {
	t.Helper()
	body["project_id"] = projectID
	if _, ok := body["title"]; !ok {
		body["title"] = "Riega"
	}
	res, b := doReq(t, ts, http.MethodPost, "/api/tasks", body, s.headers())
	if res.StatusCode != 201 {
		t.Fatalf("create task: %d %s", res.StatusCode, b)
	}
	return decodeMap(t, b)["task"].(map[string]any)["id"].(string)
}

func TestTaskParse(t *testing.T) {
	ts, _, _ := bootAPI(t)
	s := loginAdmin(t, ts)

	// ES: recurrence only -> parsed true, recurrence weekly interval 2, no date.
	res, b := doReq(t, ts, http.MethodPost, "/api/tasks/parse",
		map[string]any{"text": "regar cada 2 semanas"}, s.headers())
	if res.StatusCode != 200 {
		t.Fatalf("parse: %d %s", res.StatusCode, b)
	}
	m := decodeMap(t, b)
	if m["parsed"] != true {
		t.Fatalf("parsed = %v, want true", m["parsed"])
	}
	if m["cleanedTitle"] != "regar" {
		t.Fatalf("cleanedTitle = %v", m["cleanedTitle"])
	}
	if m["due_date"] != nil {
		t.Fatalf("due_date = %v, want null", m["due_date"])
	}
	rec, _ := m["recurrence"].(map[string]any)
	if rec == nil || rec["freq"] != "weekly" || rec["interval"] != float64(2) || rec["weekdays"] != nil || rec["mode"] != "due" {
		t.Fatalf("recurrence = %v", m["recurrence"])
	}

	// ES: date only -> parsed true, due_date set (tomorrow, relative to today),
	// recurrence null.
	_, b = doReq(t, ts, http.MethodPost, "/api/tasks/parse",
		map[string]any{"text": "revisar el coche mañana"}, s.headers())
	m = decodeMap(t, b)
	if m["parsed"] != true || m["recurrence"] != nil {
		t.Fatalf("date-only parse = %v", m)
	}
	due, _ := m["due_date"].(string)
	if len(due) != 10 {
		t.Fatalf("due_date = %v, want YYYY-MM-DD", m["due_date"])
	}
	if m["cleanedTitle"] != "revisar el coche" {
		t.Fatalf("cleanedTitle = %v", m["cleanedTitle"])
	}

	// no match -> parsed false
	res, b = doReq(t, ts, http.MethodPost, "/api/tasks/parse",
		map[string]any{"text": "comprar leche"}, s.headers())
	if res.StatusCode != 200 || decodeMap(t, b)["parsed"] != false {
		t.Fatalf("no-match parse: %d %s", res.StatusCode, b)
	}

	// invalid lang -> 422
	res, _ = doReq(t, ts, http.MethodPost, "/api/tasks/parse",
		map[string]any{"text": "x", "lang": "fr"}, s.headers())
	if res.StatusCode != 422 {
		t.Fatalf("invalid lang must 422, got %d", res.StatusCode)
	}
}

func TestRecurringListing(t *testing.T) {
	ts, _, _ := bootAPI(t)
	s := loginAdmin(t, ts)
	project := createProject(t, ts, s, "Casa")

	// Active series: a fresh task in 'nuevo' with a future due date.
	id := createRecurringTask(t, ts, s, project, map[string]any{
		"due_date":   "2026-09-01",
		"recurrence": map[string]any{"freq": "daily", "interval": 1, "mode": "due"},
	})

	res, b := doReq(t, ts, http.MethodGet, "/api/tasks/recurring", nil, s.headers())
	if res.StatusCode != 200 {
		t.Fatalf("recurring: %d %s", res.StatusCode, b)
	}
	body := decodeMap(t, b)
	series := body["series"].([]any)
	if len(series) != 1 {
		t.Fatalf("series = %d, want 1", len(series))
	}
	s0 := series[0].(map[string]any)
	if s0["group_id"] != id {
		t.Fatalf("group_id = %v, want %s", s0["group_id"], id)
	}
	if s0["active_task_id"] != id {
		t.Fatalf("active_task_id = %v, want %s", s0["active_task_id"], id)
	}
	if s0["status"] != "open" {
		t.Fatalf("status = %v, want open", s0["status"])
	}
	if s0["next_due"] != "2026-09-01" {
		t.Fatalf("next_due = %v, want 2026-09-01", s0["next_due"])
	}
	if s0["effective_interval_days"] != float64(1) {
		t.Fatalf("effective_interval_days = %v, want 1", s0["effective_interval_days"])
	}
	rec := s0["recurrence"].(map[string]any)
	if rec["freq"] != "daily" || rec["interval"] != float64(1) {
		t.Fatalf("recurrence = %v", rec)
	}
	proj := s0["project"].(map[string]any)
	if proj["id"] != project || proj["name"] != "Casa" {
		t.Fatalf("project = %v", proj)
	}
	if s0["last_completed_at"] != nil {
		t.Fatalf("last_completed_at = %v, want null", s0["last_completed_at"])
	}
}

func TestRecurringListingWaitingAndPause(t *testing.T) {
	ts, _, _ := bootAPI(t)
	s := loginAdmin(t, ts)
	project := createProject(t, ts, s, "Casa")

	// No active instance (created directly in 'hecho') -> status waiting.
	id := createRecurringTask(t, ts, s, project, map[string]any{
		"column":     "hecho",
		"due_date":   "2026-09-01",
		"recurrence": map[string]any{"freq": "daily", "interval": 1, "mode": "due"},
	})
	_, b := doReq(t, ts, http.MethodGet, "/api/tasks/recurring", nil, s.headers())
	s0 := decodeMap(t, b)["series"].([]any)[0].(map[string]any)
	if s0["status"] != "waiting" || s0["active_task_id"] != nil {
		t.Fatalf("waiting series = %v", s0)
	}

	// Active series -> pause -> status paused.
	id2 := createRecurringTask(t, ts, s, project, map[string]any{
		"due_date":   "2026-09-01",
		"recurrence": map[string]any{"freq": "daily", "interval": 1, "mode": "due"},
	})
	res, _ := doReq(t, ts, http.MethodPost, "/api/tasks/recurring/"+id2+"/pause", map[string]any{}, s.headers())
	if res.StatusCode != 204 {
		t.Fatalf("pause: %d", res.StatusCode)
	}
	_, b = doReq(t, ts, http.MethodGet, "/api/tasks/recurring", nil, s.headers())
	for _, raw := range decodeMap(t, b)["series"].([]any) {
		item := raw.(map[string]any)
		if item["group_id"] == id2 && item["status"] != "paused" {
			t.Fatalf("paused series = %v", item)
		}
	}

	// resume -> waiting again (no active instance exists for id).
	res, _ = doReq(t, ts, http.MethodPost, "/api/tasks/recurring/"+id2+"/resume", map[string]any{}, s.headers())
	if res.StatusCode != 204 {
		t.Fatalf("resume: %d", res.StatusCode)
	}
	_ = id
}

func TestRecurringPauseNotFound(t *testing.T) {
	ts, _, _ := bootAPI(t)
	s := loginAdmin(t, ts)
	res, _ := doReq(t, ts, http.MethodPost, "/api/tasks/recurring/does-not-exist/pause", map[string]any{}, s.headers())
	if res.StatusCode != 404 {
		t.Fatalf("pause missing group must 404, got %d", res.StatusCode)
	}
}
