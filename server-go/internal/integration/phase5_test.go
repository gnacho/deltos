package integration

import (
	"net/http"
	"testing"
)

// TestPhase5Smoke boots the real stack and validates the phase-5 flow:
// parse natural text -> create a recurrent task with the suggested recurrence
// -> the recurring listing shows the series with the next occurrence.
func TestPhase5Smoke(t *testing.T) {
	ts, _, _, _ := boot(t)
	admin := smokeLogin(t, ts)

	// create project
	status, body := smokeDo(t, ts, http.MethodPost, "/api/projects", map[string]any{"name": "Casa"}, admin, nil)
	if status != 201 {
		t.Fatalf("create project: %d %v", status, body)
	}
	projectID := body["project"].(map[string]any)["id"].(string)

	// parse natural text -> weekly recurrence with weekdays [1] and a title
	status, body = smokeDo(t, ts, http.MethodPost, "/api/tasks/parse",
		map[string]any{"text": "sacar la basura los lunes", "lang": "es"}, admin, nil)
	if status != 200 || body["parsed"] != true {
		t.Fatalf("parse: %d %v", status, body)
	}
	rec, _ := body["recurrence"].(map[string]any)
	if rec == nil || rec["freq"] != "weekly" {
		t.Fatalf("parsed recurrence = %v", body["recurrence"])
	}
	title, _ := body["cleanedTitle"].(string)
	if title != "sacar la basura" {
		t.Fatalf("cleanedTitle = %q", title)
	}

	// create the recurrent task using the parsed suggestion
	status, body = smokeDo(t, ts, http.MethodPost, "/api/tasks", map[string]any{
		"project_id": projectID,
		"title":      title,
		"due_date":   "2026-09-01",
		"recurrence": rec,
	}, admin, nil)
	if status != 201 {
		t.Fatalf("create task: %d %v", status, body)
	}
	taskID := body["task"].(map[string]any)["id"].(string)

	// the recurring listing shows the series with the active instance and its
	// next occurrence
	status, body = smokeDo(t, ts, http.MethodGet, "/api/tasks/recurring", nil, admin, nil)
	if status != 200 {
		t.Fatalf("recurring listing: %d %v", status, body)
	}
	series := body["series"].([]any)
	if len(series) != 1 {
		t.Fatalf("series = %d, want 1", len(series))
	}
	s0 := series[0].(map[string]any)
	if s0["group_id"] != taskID || s0["active_task_id"] != taskID {
		t.Fatalf("series identity = %v", s0)
	}
	if s0["status"] != "open" {
		t.Fatalf("status = %v, want open", s0["status"])
	}
	if s0["next_due"] != "2026-09-01" {
		t.Fatalf("next_due = %v, want 2026-09-01", s0["next_due"])
	}
	if rec, _ := s0["recurrence"].(map[string]any); rec == nil || rec["freq"] != "weekly" {
		t.Fatalf("listing recurrence = %v", s0["recurrence"])
	}
}
