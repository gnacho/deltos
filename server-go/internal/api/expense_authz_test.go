package api

import (
	"net/http"
	"testing"
)

// TestExpenseAuthz covers advisory GHSA-57q8-w8c6-96xh: invite listing,
// creation and revocation, moving an expense and deleting its attachments must
// be limited to the expense creator or payer (or the attachment uploader).
func TestExpenseAuthz(t *testing.T) {
	ts, prod := bootExp(t)
	admin := loginAdmin(t, ts)
	owner := createUserSession(t, ts, admin, "owner")
	outsider := createUserSession(t, ts, admin, "outsider")

	exp := createExpenseReq(t, ts, owner, nil)
	expID := exp["id"].(string)

	res, b := doReq(t, ts, http.MethodPost, "/api/invite/create", map[string]any{
		"invite_name": "Ana", "share_cents": int64(3000), "expense_id": expID,
	}, owner.headers())
	if res.StatusCode != 201 {
		t.Fatalf("owner invite: %d %s", res.StatusCode, b)
	}
	inviteID := decodeMap(t, b)["invite"].(map[string]any)["id"].(string)

	expenseStep := func() (string, bool) {
		var step string
		var doneAt *int64
		if err := prod.QueryRow("SELECT step, done_at FROM expenses WHERE id = ?", expID).Scan(&step, &doneAt); err != nil {
			t.Fatal(err)
		}
		return step, doneAt != nil
	}
	inviteCount := func() int {
		var n int
		if err := prod.QueryRow("SELECT COUNT(*) FROM expense_invites WHERE id = ?", inviteID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	t.Run("outsider cannot list another expense's invites", func(t *testing.T) {
		res, _ := doReq(t, ts, http.MethodGet, "/api/expenses/"+expID+"/invites", nil, owner.headers())
		if res.StatusCode != 200 {
			t.Fatalf("owner list: %d", res.StatusCode)
		}
		res, b := doReq(t, ts, http.MethodGet, "/api/expenses/"+expID+"/invites", nil, outsider.headers())
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("outsider list: %d %s", res.StatusCode, b)
		}
	})

	t.Run("outsider cannot create invites on another expense", func(t *testing.T) {
		res, b := doReq(t, ts, http.MethodPost, "/api/invite/create", map[string]any{
			"invite_name": "Intruso", "share_cents": int64(9999), "expense_id": expID,
		}, outsider.headers())
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("outsider create: %d %s", res.StatusCode, b)
		}
		var n int
		if err := prod.QueryRow("SELECT COUNT(*) FROM expense_invites WHERE expense_id = ?", expID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatalf("invites = %d, want 1", n)
		}
		if step, done := expenseStep(); step != "en-curso" || done {
			t.Fatalf("step = %s done = %v", step, done)
		}
	})

	t.Run("outsider cannot revoke another expense's invite", func(t *testing.T) {
		res, b := doReq(t, ts, http.MethodDelete, "/api/invite/"+inviteID, nil, outsider.headers())
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("outsider revoke: %d %s", res.StatusCode, b)
		}
		if inviteCount() != 1 {
			t.Fatal("invite was removed")
		}
	})

	t.Run("outsider cannot move another expense to hecho", func(t *testing.T) {
		res, b := doReq(t, ts, http.MethodPut, "/api/expenses/"+expID+"/move",
			map[string]any{"step": "hecho", "position": int64(0)}, outsider.headers())
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("outsider move: %d %s", res.StatusCode, b)
		}
		if step, done := expenseStep(); step != "en-curso" || done {
			t.Fatalf("step = %s done = %v", step, done)
		}
	})

	t.Run("outsider cannot delete another expense's attachment", func(t *testing.T) {
		up, b := uploadExpenseAttachment(t, ts, owner, expID, "recibo.txt", "text/plain", []byte("recibo"))
		if up.StatusCode != 201 {
			t.Fatalf("upload: %d %s", up.StatusCode, b)
		}
		attID := decodeMap(t, b)["id"].(string)

		res, b := doReq(t, ts, http.MethodDelete, "/api/expenses/"+expID+"/attachments/"+attID, nil, outsider.headers())
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("outsider delete attachment: %d %s", res.StatusCode, b)
		}
		var n int
		if err := prod.QueryRow("SELECT COUNT(*) FROM expense_attachments WHERE id = ?", attID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatal("attachment row was removed")
		}

		res, b = doReq(t, ts, http.MethodDelete, "/api/expenses/"+expID+"/attachments/"+attID, nil, owner.headers())
		if res.StatusCode != http.StatusNoContent {
			t.Fatalf("owner delete attachment: %d %s", res.StatusCode, b)
		}
	})

	t.Run("payer without being creator keeps control", func(t *testing.T) {
		outsiderID := myID(t, ts, outsider)
		res, b := doReq(t, ts, http.MethodPut, "/api/expenses/"+expID, map[string]any{"payer_id": outsiderID}, owner.headers())
		if res.StatusCode != 200 {
			t.Fatalf("set payer: %d %s", res.StatusCode, b)
		}
		res, b = doReq(t, ts, http.MethodGet, "/api/expenses/"+expID+"/invites", nil, outsider.headers())
		if res.StatusCode != 200 {
			t.Fatalf("payer list: %d %s", res.StatusCode, b)
		}
	})
}
