package integration

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestPhase4Smoke boots the real stack and validates the decision + vote +
// choose flow over SSE: decision.changed and gamification.changed are emitted
// with the right event names/data, and the ledger ends up with the +1 vote row
// and the +8 chosen row.
func TestPhase4Smoke(t *testing.T) {
	ts, _, prod, _ := boot(t)
	admin := smokeLogin(t, ts)

	// create project
	status, body := smokeDo(t, ts, http.MethodPost, "/api/projects", map[string]any{"name": "Casa"}, admin, nil)
	if status != 201 {
		t.Fatalf("create project: %d %v", status, body)
	}
	projectID := body["project"].(map[string]any)["id"].(string)

	// register a second user and add as member
	status, body = smokeDo(t, ts, http.MethodPost, "/api/auth/register",
		map[string]any{"username": "berta", "password": "passwd1234567"}, admin, nil)
	if status != 201 {
		t.Fatalf("register berta: %d %v", status, body)
	}
	bertaID := body["user"].(map[string]any)["id"].(string)
	berta := loginSmokeUser(t, ts, "berta", "passwd1234567")

	status, _ = smokeDo(t, ts, http.MethodPut, "/api/projects/"+projectID+"/members",
		map[string]any{"member_ids": []string{bertaID}}, admin, nil)
	if status != 200 {
		t.Fatalf("add member: %d", status)
	}

	// admin creates the decision, berta proposes a solution
	status, body = smokeDo(t, ts, http.MethodPost, "/api/decisions",
		map[string]any{"project_id": projectID, "title": "¿Qué comemos?"}, admin, nil)
	if status != 201 {
		t.Fatalf("create decision: %d %v", status, body)
	}
	decisionID := body["decision"].(map[string]any)["id"].(string)

	status, body = smokeDo(t, ts, http.MethodPost, "/api/decisions/"+decisionID+"/solutions",
		map[string]any{"title": "Pizza"}, berta, nil)
	if status != 201 {
		t.Fatalf("create solution: %d %v", status, body)
	}
	solutionID := body["solution"].(map[string]any)["id"].(string)

	// open the SSE stream
	sseReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/events", nil)
	sseReq.Header.Set("Cookie", admin.cookie)
	sseRes, err := http.DefaultClient.Do(sseReq)
	if err != nil {
		t.Fatal(err)
	}
	defer sseRes.Body.Close()
	reader := bufio.NewReader(sseRes.Body)
	if event, data := readSSE(t, reader); event != "hello" || data != `{"ok":true}` {
		t.Fatalf("expected hello, got %q %q", event, data)
	}

	// admin votes -> +1 gamification.changed then decision.changed
	status, _ = smokeDo(t, ts, http.MethodPut, "/api/decisions/"+decisionID+"/vote",
		map[string]any{"solution_id": solutionID}, admin, nil)
	if status != 200 {
		t.Fatalf("vote: %d", status)
	}
	assertSSE(t, reader, "gamification.changed", `{"type":"changed","entity":"gamification"}`)
	assertSSE(t, reader, "decision.changed", `{"type":"changed","entity":"decisions"}`)

	// admin chooses -> +8 gamification.changed then decision.changed
	status, _ = smokeDo(t, ts, http.MethodPost, "/api/decisions/"+decisionID+"/choose",
		map[string]any{"solution_id": solutionID}, admin, nil)
	if status != 200 {
		t.Fatalf("choose: %d", status)
	}
	assertSSE(t, reader, "gamification.changed", `{"type":"changed","entity":"gamification"}`)
	assertSSE(t, reader, "decision.changed", `{"type":"changed","entity":"decisions"}`)

	// ledger has exactly the +1 vote row (admin) and the +8 chosen row (berta).
	rows, err := prod.Query("SELECT reason, points, user_id FROM gam_points_ledger WHERE decision_id = ?", decisionID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string]int64{}
	for rows.Next() {
		var reason string
		var points int64
		var userID string
		if err := rows.Scan(&reason, &points, &userID); err != nil {
			t.Fatal(err)
		}
		got[reason] = points
	}
	if got["decision_vote"] != 1 {
		t.Fatalf("decision_vote points = %v, want 1 (ledger %v)", got["decision_vote"], got)
	}
	if got["decision_chosen"] != 8 {
		t.Fatalf("decision_chosen points = %v, want 8 (ledger %v)", got["decision_chosen"], got)
	}
}

func loginSmokeUser(t *testing.T, ts *httptest.Server, username, password string) smokeSession {
	t.Helper()
	res, body := postJSON(t, ts.URL+"/api/auth/login",
		map[string]string{"username": username, "password": password}, nil)
	if res.StatusCode != 200 {
		t.Fatalf("login %s: %d %v", username, res.StatusCode, body)
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

func assertSSE(t *testing.T, reader *bufio.Reader, wantEvent, wantData string) {
	t.Helper()
	event, data := readSSE(t, reader)
	if event != wantEvent || data != wantData {
		t.Fatalf("expected %q %q, got %q %q", wantEvent, wantData, event, data)
	}
}
