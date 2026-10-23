package integration

import (
	"bufio"
	"net/http"
	"testing"
)

func TestPhase3Smoke(t *testing.T) {
	ts, _, prod, _ := boot(t)
	s := smokeLogin(t, ts)

	// enable the expense plugin
	if err := prod.KVSet("plugin_expenses_enabled", "1"); err != nil {
		t.Fatal(err)
	}

	// 1. create expense (no shares -> 'nuevo')
	status, body := smokeDo(t, ts, http.MethodPost, "/api/expenses", map[string]any{"title": "Cena", "amount_cents": int64(6000)}, s, nil)
	if status != 201 {
		t.Fatalf("create expense: %d %v", status, body)
	}
	expenseID := body["expense"].(map[string]any)["id"].(string)

	// 2. create an invite (the split with a non-user) -> auto 'en-curso'
	status, body = smokeDo(t, ts, http.MethodPost, "/api/invite/create", map[string]any{
		"invite_name": "Ana ext", "share_cents": int64(3000), "expense_id": expenseID, "notes": "",
	}, s, nil)
	if status != 201 {
		t.Fatalf("create invite: %d %v", status, body)
	}
	token := body["invite"].(map[string]any)["token"].(string)

	// 3. open SSE and consume hello
	sseReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/events", nil)
	sseReq.Header.Set("Cookie", s.cookie)
	sseRes, err := http.DefaultClient.Do(sseReq)
	if err != nil {
		t.Fatal(err)
	}
	defer sseRes.Body.Close()
	reader := bufio.NewReader(sseRes.Body)
	if event, data := readSSE(t, reader); event != "hello" || data != `{"ok":true}` {
		t.Fatalf("expected hello, got %q %q", event, data)
	}

	// 4. move the expense to 'en-curso' -> broadcast expense.changed
	status, _ = smokeDo(t, ts, http.MethodPut, "/api/expenses/"+expenseID+"/move", map[string]any{"step": "en-curso", "position": 0}, s, nil)
	if status != 200 {
		t.Fatalf("move expense: %d", status)
	}
	if event, data := readSSE(t, reader); event != "expense.changed" || data != `{"type":"changed","entity":"expenses"}` {
		t.Fatalf("expected expense.changed, got %q %q", event, data)
	}

	// 5. public invite GET by token (no auth)
	status, body = smokeDo(t, ts, http.MethodGet, "/api/invite/"+token, nil, smokeSession{}, nil)
	if status != 200 {
		t.Fatalf("public invite GET: %d %v", status, body)
	}
	if body["invite"].(map[string]any)["paid"] != false {
		t.Fatalf("invite should start unpaid: %v", body["invite"])
	}

	// 6. public pay -> expense settles to 'hecho'
	status, body = smokeDo(t, ts, http.MethodPut, "/api/invite/"+token+"/pay", map[string]any{}, smokeSession{}, nil)
	if status != 200 {
		t.Fatalf("invite pay: %d %v", status, body)
	}
	status, body = smokeDo(t, ts, http.MethodGet, "/api/expenses/"+expenseID, nil, s, nil)
	if status != 200 {
		t.Fatalf("expense GET: %d", status)
	}
	if body["expense"].(map[string]any)["step"] != "hecho" {
		t.Fatalf("expense should be settled (hecho) after invite pay: %v", body["expense"])
	}
}
