package api

import (
	"bytes"
	"database/sql"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"testing"

	"github.com/gnacho/deltos/server-go/internal/db"
)

const testUserPass = "user1234567"

func bootExp(t *testing.T) (*httptest.Server, *db.DB) {
	t.Helper()
	ts, prod, _ := bootAPI(t)
	if err := prod.KVSet("plugin_expenses_enabled", "1"); err != nil {
		t.Fatal(err)
	}
	return ts, prod
}

func createUserSession(t *testing.T, ts *httptest.Server, admin session, username string) session {
	t.Helper()
	res, b := doReq(t, ts, http.MethodPost, "/api/users",
		map[string]any{"username": username, "password": testUserPass, "color": "slate", "role": "user"}, admin.headers())
	if res.StatusCode != 201 {
		t.Fatalf("create user %s: %d %s", username, res.StatusCode, b)
	}
	res, b = doReq(t, ts, http.MethodPost, "/api/auth/login", map[string]string{"username": username, "password": testUserPass}, nil)
	if res.StatusCode != 200 {
		t.Fatalf("login %s: %d %s", username, res.StatusCode, b)
	}
	m := decodeMap(t, b)
	csrf, _ := m["csrfToken"].(string)
	return session{cookie: cookieOf(t, res), csrf: csrf}
}

func myID(t *testing.T, ts *httptest.Server, s session) string {
	t.Helper()
	_, b := doReq(t, ts, http.MethodGet, "/api/auth/me", nil, s.headers())
	u, _ := decodeMap(t, b)["user"].(map[string]any)
	return u["id"].(string)
}

func createExpenseReq(t *testing.T, ts *httptest.Server, s session, extra map[string]any) map[string]any {
	t.Helper()
	body := map[string]any{"title": "Cena", "amount_cents": int64(6000)}
	for k, v := range extra {
		body[k] = v
	}
	res, b := doReq(t, ts, http.MethodPost, "/api/expenses", body, s.headers())
	if res.StatusCode != 201 {
		t.Fatalf("create expense: %d %s", res.StatusCode, b)
	}
	exp, _ := decodeMap(t, b)["expense"].(map[string]any)
	return exp
}

// --- G4: expense lifecycle -----------------------------------------------------

func TestExpenseLifecycle(t *testing.T) {
	t.Run("create without shares defaults payer and step", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		me := myID(t, ts, s)
		exp := createExpenseReq(t, ts, s, nil)
		if exp["payer_id"] != me {
			t.Fatalf("payer_id = %v, want %v", exp["payer_id"], me)
		}
		if exp["payer_username"] != "admin" {
			t.Fatalf("payer_username = %v", exp["payer_username"])
		}
		if shares, _ := exp["shares"].([]any); len(shares) != 0 {
			t.Fatalf("shares = %v, want empty", exp["shares"])
		}
		if exp["step"] != "nuevo" {
			t.Fatalf("step = %v, want nuevo", exp["step"])
		}
	})

	t.Run("split to three derives en-curso and pays the payer share", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		ana := createUserSession(t, ts, s, "ana")
		beto := createUserSession(t, ts, s, "beto")
		meID := myID(t, ts, s)
		anaID := myID(t, ts, ana)
		betoID := myID(t, ts, beto)
		exp := createExpenseReq(t, ts, s, map[string]any{
			"shares": []map[string]any{
				{"user_id": meID, "share_cents": int64(2000)},
				{"user_id": anaID, "share_cents": int64(3000)},
				{"user_id": betoID, "share_cents": int64(1000)},
			},
		})
		if exp["step"] != "en-curso" {
			t.Fatalf("step = %v, want en-curso", exp["step"])
		}
		shares := exp["shares"].([]any)
		mine := findShare(shares, meID)
		if mine == nil || mine["paid"] != true {
			t.Fatalf("payer share must be paid: %v", shares)
		}
		unpaid := 0
		for _, sh := range shares {
			if sh.(map[string]any)["paid"] != true {
				unpaid++
			}
		}
		if unpaid != 2 {
			t.Fatalf("unpaid shares = %d, want 2: %v", unpaid, shares)
		}
	})

	t.Run("my-share marks paid and settles to hecho, undo returns to en-curso", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		ana := createUserSession(t, ts, s, "ana")
		meID := myID(t, ts, s)
		anaID := myID(t, ts, ana)
		exp := createExpenseReq(t, ts, s, map[string]any{
			"shares": []map[string]any{
				{"user_id": meID, "share_cents": int64(3000)},
				{"user_id": anaID, "share_cents": int64(3000)},
			},
		})
		// a third party with no share cannot mark it
		beto := createUserSession(t, ts, s, "beto")
		res, _ := doReq(t, ts, http.MethodPut, "/api/expenses/"+exp["id"].(string)+"/my-share", map[string]any{"paid": true}, beto.headers())
		if res.StatusCode != 403 {
			t.Fatalf("non-share my-share must 403, got %d", res.StatusCode)
		}
		res, b := doReq(t, ts, http.MethodPut, "/api/expenses/"+exp["id"].(string)+"/my-share", map[string]any{"paid": true}, ana.headers())
		if res.StatusCode != 200 {
			t.Fatalf("my-share: %d %s", res.StatusCode, b)
		}
		upd := decodeMap(t, b)["expense"].(map[string]any)
		if findShare(upd["shares"].([]any), anaID)["paid"] != true || upd["step"] != "hecho" {
			t.Fatalf("after paying last share: %v", upd)
		}
		_, b = doReq(t, ts, http.MethodPut, "/api/expenses/"+exp["id"].(string)+"/my-share", map[string]any{"paid": false}, ana.headers())
		if decodeMap(t, b)["expense"].(map[string]any)["step"] != "en-curso" {
			t.Fatalf("undo must return to en-curso: %s", b)
		}
	})

	t.Run("move through steps compacts positions", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		a := createExpenseReq(t, ts, s, map[string]any{"title": "A"})
		b := createExpenseReq(t, ts, s, map[string]any{"title": "B"})
		// move A to en-curso
		res, bb := doReq(t, ts, http.MethodPut, "/api/expenses/"+a["id"].(string)+"/move", map[string]any{"step": "en-curso", "position": 0}, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("move: %d %s", res.StatusCode, bb)
		}
		moved := decodeMap(t, bb)["expense"].(map[string]any)
		if moved["step"] != "en-curso" || moved["position"] != float64(0) {
			t.Fatalf("moved = %v", moved)
		}
		// move A to hecho
		res, bb = doReq(t, ts, http.MethodPut, "/api/expenses/"+a["id"].(string)+"/move", map[string]any{"step": "hecho", "position": 0}, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("move to hecho: %d %s", res.StatusCode, bb)
		}
		if decodeMap(t, bb)["expense"].(map[string]any)["step"] != "hecho" {
			t.Fatalf("moved to hecho: %s", bb)
		}
		// B remains in nuevo with compacted position 0
		_, lb := doReq(t, ts, http.MethodGet, "/api/expenses", nil, s.headers())
		list := decodeMap(t, lb)["expenses"].([]any)
		var bPos float64 = -1
		for _, e := range list {
			em := e.(map[string]any)
			if em["id"] == b["id"] {
				bPos = em["position"].(float64)
			}
		}
		if bPos != 0 {
			t.Fatalf("B position after compaction = %v, want 0: %v", bPos, list)
		}
	})

	t.Run("parse natural language concept", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		res, b := doReq(t, ts, http.MethodPost, "/api/expenses/parse", map[string]any{"text": "cena aniversario ayer 89,90 €", "lang": "es"}, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("parse: %d %s", res.StatusCode, b)
		}
		body := decodeMap(t, b)
		if body["parsed"] != true {
			t.Fatalf("parsed = %v", body)
		}
		if body["amount_cents"] != float64(8990) {
			t.Fatalf("amount_cents = %v", body["amount_cents"])
		}
		if body["cleanedTitle"] != "cena aniversario" {
			t.Fatalf("cleanedTitle = %v", body["cleanedTitle"])
		}
		if sp, _ := body["spent_at"].(string); len(sp) != 10 {
			t.Fatalf("spent_at = %v, want YYYY-MM-DD", body["spent_at"])
		}
		_, b = doReq(t, ts, http.MethodPost, "/api/expenses/parse", map[string]any{"text": "cena normal", "lang": "es"}, s.headers())
		if decodeMap(t, b)["parsed"] != false {
			t.Fatalf("no concept should parse false: %s", b)
		}
	})

	t.Run("comments and activity feed shape", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		exp := createExpenseReq(t, ts, s, nil)
		id := exp["id"].(string)
		res, b := doReq(t, ts, http.MethodPost, "/api/expenses/"+id+"/comments", map[string]any{"body": "hola"}, s.headers())
		if res.StatusCode != 201 {
			t.Fatalf("comment: %d %s", res.StatusCode, b)
		}
		if decodeMap(t, b)["ok"] != true {
			t.Fatalf("comment body: %s", b)
		}
		_, b = doReq(t, ts, http.MethodGet, "/api/expenses/"+id+"/detail", nil, s.headers())
		detail := decodeMap(t, b)
		comments := detail["comments"].([]any)
		if len(comments) != 1 || comments[0].(map[string]any)["body"] != "hola" {
			t.Fatalf("comments = %v", comments)
		}
		activity := detail["activity"].([]any)
		if !hasEvent(activity, "created") {
			t.Fatalf("missing created event: %v", activity)
		}
	})

	t.Run("settle clears debts in both directions", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		ana := createUserSession(t, ts, s, "ana")
		meID := myID(t, ts, s)
		anaID := myID(t, ts, ana)
		// admin paid 60, ana owes 30; ana paid 40, admin owes 20 -> net ana->admin 10
		createExpenseReq(t, ts, s, map[string]any{
			"title": "A",
			"shares": []map[string]any{
				{"user_id": meID, "share_cents": int64(3000)},
				{"user_id": anaID, "share_cents": int64(3000)},
			},
		})
		createExpenseReq(t, ts, s, map[string]any{
			"title":        "B",
			"amount_cents": int64(4000),
			"payer_id":     anaID,
			"shares": []map[string]any{
				{"user_id": anaID, "share_cents": int64(2000)},
				{"user_id": meID, "share_cents": int64(2000)},
			},
		})
		res, b := doReq(t, ts, http.MethodPost, "/api/expenses/settle", map[string]any{"other_user_id": meID}, ana.headers())
		if res.StatusCode != 200 {
			t.Fatalf("settle: %d %s", res.StatusCode, b)
		}
		body := decodeMap(t, b)
		if body["settled"] != float64(2) || body["total_cents"] != float64(5000) {
			t.Fatalf("settle result = %v", body)
		}
		_, lb := doReq(t, ts, http.MethodGet, "/api/expenses", nil, s.headers())
		for _, e := range decodeMap(t, lb)["expenses"].([]any) {
			em := e.(map[string]any)
			if em["step"] != "hecho" {
				t.Fatalf("expense step after settle = %v", em["step"])
			}
			for _, sh := range em["shares"].([]any) {
				if sh.(map[string]any)["paid"] != true {
					t.Fatalf("share not paid after settle: %v", em["shares"])
				}
			}
		}
	})
}

// --- G5: invite flow -----------------------------------------------------------

func TestInvite(t *testing.T) {
	t.Run("generate invite returns token once and stores only the hash", func(t *testing.T) {
		ts, prod := bootExp(t)
		s := loginAdmin(t, ts)
		exp := createExpenseReq(t, ts, s, nil)
		res, b := doReq(t, ts, http.MethodPost, "/api/invite/create", map[string]any{
			"invite_name": "Ana ext", "share_cents": int64(3000), "expense_id": exp["id"], "notes": "",
		}, s.headers())
		if res.StatusCode != 201 {
			t.Fatalf("create invite: %d %s", res.StatusCode, b)
		}
		inv := decodeMap(t, b)["invite"].(map[string]any)
		token, _ := inv["token"].(string)
		if token == "" {
			t.Fatalf("invite must return the plaintext token: %v", inv)
		}
		// the token is stored hashed, never plaintext
		var storedHash, storedPlain sql.NullString
		if err := prod.QueryRow("SELECT token_hash, token FROM expense_invites WHERE id = ?", inv["id"]).Scan(&storedHash, &storedPlain); err != nil {
			t.Fatal(err)
		}
		if !storedHash.Valid || storedHash.String != sha256Hex(token) {
			t.Fatalf("token_hash must be sha256(token): %v", storedHash)
		}
		if storedPlain.Valid {
			t.Fatalf("plaintext token must not be stored: %v", storedPlain)
		}
	})

	t.Run("public GET by token works without auth", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		exp := createExpenseReq(t, ts, s, nil)
		_, b := doReq(t, ts, http.MethodPost, "/api/invite/create", map[string]any{
			"invite_name": "Ana ext", "share_cents": int64(3000), "expense_id": exp["id"], "notes": "",
		}, s.headers())
		token := decodeMap(t, b)["invite"].(map[string]any)["token"].(string)
		// no auth headers
		g, gb := doReq(t, ts, http.MethodGet, "/api/invite/"+token, nil, nil)
		if g.StatusCode != 200 {
			t.Fatalf("public GET: %d %s", g.StatusCode, gb)
		}
		body := decodeMap(t, gb)
		if body["invite"].(map[string]any)["invite_name"] != "Ana ext" {
			t.Fatalf("invite = %v", body["invite"])
		}
		if body["expense"].(map[string]any)["title"] != "Cena" {
			t.Fatalf("expense = %v", body["expense"])
		}
		if body["invite"].(map[string]any)["paid"] != false {
			t.Fatalf("invite.paid = %v", body["invite"])
		}
	})

	t.Run("pay and public comment via token", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		exp := createExpenseReq(t, ts, s, nil)
		_, b := doReq(t, ts, http.MethodPost, "/api/invite/create", map[string]any{
			"invite_name": "Ana ext", "share_cents": int64(3000), "expense_id": exp["id"], "notes": "",
		}, s.headers())
		inv := decodeMap(t, b)["invite"].(map[string]any)
		token := inv["token"].(string)
		// public comment (POST /comments)
		c, cb := doReq(t, ts, http.MethodPost, "/api/invite/"+token+"/comments", map[string]any{"body": "listo"}, nil)
		if c.StatusCode != 201 {
			t.Fatalf("public comment: %d %s", c.StatusCode, cb)
		}
		// pay
		p, pb := doReq(t, ts, http.MethodPut, "/api/invite/"+token+"/pay", map[string]any{}, nil)
		if p.StatusCode != 200 {
			t.Fatalf("pay: %d %s", p.StatusCode, pb)
		}
		if decodeMap(t, pb)["ok"] != true {
			t.Fatalf("pay body: %s", pb)
		}
		// expense now settled (hecho): no shares + invite paid
		_, gb := doReq(t, ts, http.MethodGet, "/api/expenses/"+exp["id"].(string), nil, s.headers())
		if decodeMap(t, gb)["expense"].(map[string]any)["step"] != "hecho" {
			t.Fatalf("expense step after invite pay: %s", gb)
		}
	})

	t.Run("unknown token returns 404", func(t *testing.T) {
		ts, _ := bootExp(t)
		res, b := doReq(t, ts, http.MethodGet, "/api/invite/no-such-token", nil, nil)
		if res.StatusCode != 404 {
			t.Fatalf("unknown token must 404, got %d %s", res.StatusCode, b)
		}
		if decodeMap(t, b)["error"].(map[string]any)["code"] != "EXPENSE_NOT_FOUND" {
			t.Fatalf("unknown token code: %s", b)
		}
	})
}

// --- G6: expense attachments ---------------------------------------------------

func uploadExpenseAttachment(t *testing.T, ts *httptest.Server, s session, expenseID, filename, contentType string, content []byte) (*http.Response, []byte) {
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
	_, _ = fw.Write(content)
	_ = w.Close()

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/expenses/"+expenseID+"/attachments", &buf)
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

func TestExpenseAttachments(t *testing.T) {
	t.Run("upload allowed mime, reject bad mime, download", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		exp := createExpenseReq(t, ts, s, nil)
		id := exp["id"].(string)

		res, b := uploadExpenseAttachment(t, ts, s, id, "nota.txt", "text/plain", []byte("contenido de prueba"))
		if res.StatusCode != 201 {
			t.Fatalf("upload: %d %s", res.StatusCode, b)
		}
		up := decodeMap(t, b)
		if up["ok"] != true || up["filename"] != "nota.txt" {
			t.Fatalf("upload body: %v", up)
		}
		attID := up["id"].(string)

		// bad mime -> 415
		res, b = uploadExpenseAttachment(t, ts, s, id, "malware.exe", "application/x-msdownload", []byte("<script>"))
		if res.StatusCode != 415 {
			t.Fatalf("bad mime must 415, got %d %s", res.StatusCode, b)
		}
		if decodeMap(t, b)["error"].(map[string]any)["code"] != "UPLOAD_INVALID_MIME" {
			t.Fatalf("bad mime code: %s", b)
		}

		// download
		res, b = doReq(t, ts, http.MethodGet, "/api/expenses/"+id+"/attachments/"+attID, nil, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("download: %d %s", res.StatusCode, b)
		}
		if string(b) != "contenido de prueba" {
			t.Fatalf("download body = %q", b)
		}
		if !bytes.Contains([]byte(res.Header.Get("Content-Type")), []byte("text/plain")) {
			t.Fatalf("content-type = %q", res.Header.Get("Content-Type"))
		}
	})

	t.Run("oversize upload rejected 413", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		exp := createExpenseReq(t, ts, s, nil)
		big := bytes.Repeat([]byte("x"), 10*1024*1024+1) // just over 10 MB
		res, b := uploadExpenseAttachment(t, ts, s, exp["id"].(string), "big.bin", "application/octet-stream", big)
		if res.StatusCode != 413 {
			t.Fatalf("oversize must 413, got %d", res.StatusCode)
		}
		_ = b
	})
}

// --- G7: expense trash ---------------------------------------------------------

func TestExpenseTrash(t *testing.T) {
	t.Run("delete appears in trash, restore, purge", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		exp := createExpenseReq(t, ts, s, nil)
		id := exp["id"].(string)

		res, _ := doReq(t, ts, http.MethodDelete, "/api/expenses/"+id, nil, s.headers())
		if res.StatusCode != 204 {
			t.Fatalf("delete: %d", res.StatusCode)
		}
		_, b := doReq(t, ts, http.MethodGet, "/api/trash", nil, s.headers())
		trash := decodeMap(t, b)
		expenses := trash["expenses"].([]any)
		found := false
		for _, e := range expenses {
			if e.(map[string]any)["id"] == id {
				found = true
			}
		}
		if !found {
			t.Fatalf("deleted expense missing from trash: %v", trash)
		}

		// restore
		res, b = doReq(t, ts, http.MethodPost, "/api/trash/expense/"+id+"/restore", nil, s.headers())
		if res.StatusCode != 200 {
			t.Fatalf("restore: %d %s", res.StatusCode, b)
		}
		_, b = doReq(t, ts, http.MethodGet, "/api/expenses/"+id, nil, s.headers())
		if decodeMap(t, b)["expense"].(map[string]any)["id"] != id {
			t.Fatalf("restored expense: %s", b)
		}

		// purge single
		res, _ = doReq(t, ts, http.MethodDelete, "/api/expenses/"+id, nil, s.headers())
		if res.StatusCode != 204 {
			t.Fatalf("delete again: %d", res.StatusCode)
		}
		res, _ = doReq(t, ts, http.MethodDelete, "/api/trash/expense/"+id, nil, s.headers())
		if res.StatusCode != 204 {
			t.Fatalf("trash delete: %d", res.StatusCode)
		}
		_, b = doReq(t, ts, http.MethodGet, "/api/trash", nil, s.headers())
		if len(decodeMap(t, b)["expenses"].([]any)) != 0 {
			t.Fatalf("trash not empty after purge: %s", b)
		}
	})

	t.Run("empty expense trash", func(t *testing.T) {
		ts, _ := bootExp(t)
		s := loginAdmin(t, ts)
		a := createExpenseReq(t, ts, s, map[string]any{"title": "A"})
		b := createExpenseReq(t, ts, s, map[string]any{"title": "B"})
		doReq(t, ts, http.MethodDelete, "/api/expenses/"+a["id"].(string), nil, s.headers())
		doReq(t, ts, http.MethodDelete, "/api/expenses/"+b["id"].(string), nil, s.headers())
		res, _ := doReq(t, ts, http.MethodDelete, "/api/trash/expenses", nil, s.headers())
		if res.StatusCode != 204 {
			t.Fatalf("empty trash: %d", res.StatusCode)
		}
		_, bb := doReq(t, ts, http.MethodGet, "/api/trash", nil, s.headers())
		if len(decodeMap(t, bb)["expenses"].([]any)) != 0 {
			t.Fatalf("trash not empty: %s", bb)
		}
	})
}

// --- helpers -------------------------------------------------------------------

func findShare(shares []any, userID string) map[string]any {
	for _, sh := range shares {
		m := sh.(map[string]any)
		if m["user_id"] == userID {
			return m
		}
	}
	return nil
}

func hasEvent(activity []any, typ string) bool {
	for _, e := range activity {
		if m, ok := e.(map[string]any); ok && m["type"] == typ {
			return true
		}
	}
	return false
}
