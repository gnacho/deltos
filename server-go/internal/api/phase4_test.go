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
)

// Phase 4 tests: decision lifecycle, decision attachments, gamification
// ledger, and rewards. They reuse the harness of api_test.go (bootAPI,
// loginAdmin, doReq, decodeMap, createProject, createTask).

const phase4Pass = "passwd1234567"

func registerPhase4User(t *testing.T, ts *httptest.Server, admin session, username string) (session, string) {
	t.Helper()
	res, body := doReq(t, ts, http.MethodPost, "/api/auth/register",
		map[string]any{"username": username, "password": phase4Pass}, admin.headers())
	if res.StatusCode != 201 {
		t.Fatalf("register %s: %d %s", username, res.StatusCode, body)
	}
	m := decodeMap(t, body)
	uid, _ := m["user"].(map[string]any)["id"].(string)

	res2, body2 := doReq(t, ts, http.MethodPost, "/api/auth/login",
		map[string]string{"username": username, "password": phase4Pass}, nil)
	if res2.StatusCode != 200 {
		t.Fatalf("login %s: %d %s", username, res2.StatusCode, body2)
	}
	m2 := decodeMap(t, body2)
	csrf, _ := m2["csrfToken"].(string)
	return session{cookie: cookieOf(t, res2), csrf: csrf}, uid
}

func addProjectMembers(t *testing.T, ts *httptest.Server, admin session, projectID string, memberIDs []string) {
	t.Helper()
	res, body := doReq(t, ts, http.MethodPut, "/api/projects/"+projectID+"/members",
		map[string]any{"member_ids": memberIDs}, admin.headers())
	if res.StatusCode != 200 {
		t.Fatalf("add members: %d %s", res.StatusCode, body)
	}
}

func createDecision(t *testing.T, ts *httptest.Server, s session, projectID, title string) string {
	t.Helper()
	res, body := doReq(t, ts, http.MethodPost, "/api/decisions",
		map[string]any{"project_id": projectID, "title": title}, s.headers())
	if res.StatusCode != 201 {
		t.Fatalf("create decision: %d %s", res.StatusCode, body)
	}
	return decodeMap(t, body)["decision"].(map[string]any)["id"].(string)
}

func createSolution(t *testing.T, ts *httptest.Server, s session, decisionID, title string) string {
	t.Helper()
	res, body := doReq(t, ts, http.MethodPost, "/api/decisions/"+decisionID+"/solutions",
		map[string]any{"title": title}, s.headers())
	if res.StatusCode != 201 {
		t.Fatalf("create solution: %d %s", res.StatusCode, body)
	}
	return decodeMap(t, body)["solution"].(map[string]any)["id"].(string)
}

func voteDecision(t *testing.T, ts *httptest.Server, s session, decisionID, solutionID string) (*http.Response, []byte) {
	t.Helper()
	return doReq(t, ts, http.MethodPut, "/api/decisions/"+decisionID+"/vote",
		map[string]any{"solution_id": solutionID}, s.headers())
}

func chooseDecision(t *testing.T, ts *httptest.Server, s session, decisionID string, solutionID any) (*http.Response, []byte) {
	t.Helper()
	return doReq(t, ts, http.MethodPost, "/api/decisions/"+decisionID+"/choose",
		map[string]any{"solution_id": solutionID}, s.headers())
}

func decisionDetail(t *testing.T, ts *httptest.Server, s session, decisionID string) map[string]any {
	t.Helper()
	_, body := doReq(t, ts, http.MethodGet, "/api/decisions/"+decisionID, nil, s.headers())
	return decodeMap(t, body)
}

func summaryOf(t *testing.T, ts *httptest.Server, s session) map[string]any {
	t.Helper()
	_, body := doReq(t, ts, http.MethodGet, "/api/gamification/summary", nil, s.headers())
	return decodeMap(t, body)
}

// decisionUpload posts a multipart file to a decision attachment endpoint,
// optionally scoped to a solution.
func decisionUpload(t *testing.T, ts *httptest.Server, s session, decisionID, solutionID, filename, contentType, content string) (*http.Response, []byte) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if solutionID != "" {
		_ = w.WriteField("solution_id", solutionID)
	}
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename))
	h.Set("Content-Type", contentType)
	fw, err := w.CreatePart(h)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fw.Write([]byte(content))
	_ = w.Close()

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/decisions/"+decisionID+"/attachments", &buf)
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

func balanceOf(t *testing.T, summary map[string]any, username string) float64 {
	t.Helper()
	users := summary["users"].([]any)
	for _, u := range users {
		m := u.(map[string]any)
		if m["username"] == username {
			return m["balance"].(float64)
		}
	}
	t.Fatalf("user %s not in summary %v", username, summary)
	return 0
}

func userStat(t *testing.T, summary map[string]any, username string) map[string]any {
	t.Helper()
	users := summary["users"].([]any)
	for _, u := range users {
		m := u.(map[string]any)
		if m["username"] == username {
			return m
		}
	}
	t.Fatalf("user %s not in summary", username)
	return nil
}

// --- G4: decision lifecycle ---------------------------------------------------

func TestDecisionLifecycle(t *testing.T) {
	ts, _, _ := bootAPI(t)
	admin := loginAdmin(t, ts)
	project := createProject(t, ts, admin, "Casa")

	bSession, bID := registerPhase4User(t, ts, admin, "berta")
	addProjectMembers(t, ts, admin, project, []string{bID})

	// A creates
	dID := createDecision(t, ts, admin, project, "¿Qué comemos?")

	// B comments
	res, body := doReq(t, ts, http.MethodPost, "/api/decisions/"+dID+"/comments",
		map[string]any{"body": "matizo"}, bSession.headers())
	if res.StatusCode != 201 {
		t.Fatalf("B comment: %d %s", res.StatusCode, body)
	}

	// B proposes s1, A proposes s2
	s1 := createSolution(t, ts, bSession, dID, "Pizza")
	s2 := createSolution(t, ts, admin, dID, "Sushi")

	// B votes s1, A votes s1 -> s1 = 2 votes, s2 = 0 votes
	if res, b := voteDecision(t, ts, bSession, dID, s1); res.StatusCode != 200 {
		t.Fatalf("B vote: %d %s", res.StatusCode, b)
	}
	if res, b := voteDecision(t, ts, admin, dID, s1); res.StatusCode != 200 {
		t.Fatalf("A vote: %d %s", res.StatusCode, b)
	}

	// A chooses the NON-top-voted solution s2 (0 votes)
	res, body = chooseDecision(t, ts, admin, dID, s2)
	if res.StatusCode != 200 {
		t.Fatalf("choose: %d %s", res.StatusCode, body)
	}
	chosen := decodeMap(t, body)["decision"].(map[string]any)
	if chosen["status"] != "decided" || chosen["chosen_solution_id"] != s2 {
		t.Fatalf("choose payload: %v", chosen)
	}

	// detail: solutions sorted votes DESC -> s1 (2 votes) before s2 (0 votes)
	detail := decisionDetail(t, ts, bSession, dID)
	solutions := detail["solutions"].([]any)
	if len(solutions) != 2 {
		t.Fatalf("solutions = %d", len(solutions))
	}
	sol0 := solutions[0].(map[string]any)
	sol1 := solutions[1].(map[string]any)
	if sol0["id"] != s1 || sol0["votes"] != float64(2) {
		t.Fatalf("solution order/votes: %v", sol0)
	}
	if sol1["id"] != s2 || sol1["votes"] != float64(0) {
		t.Fatalf("solution order/votes: %v", sol1)
	}
	// B's my_vote on s1 is true
	if sol0["my_vote"] != true {
		t.Fatalf("B my_vote on s1: %v", sol0["my_vote"])
	}
	// B sees the decision as decided with the chosen solution
	if detail["decision"].(map[string]any)["status"] != "decided" {
		t.Fatalf("B sees status: %v", detail["decision"])
	}
	if detail["decision"].(map[string]any)["chosen_solution_id"] != s2 {
		t.Fatalf("B sees chosen: %v", detail["decision"])
	}

	// A reopens
	res, body = doReq(t, ts, http.MethodPost, "/api/decisions/"+dID+"/reopen", map[string]any{}, admin.headers())
	if res.StatusCode != 200 {
		t.Fatalf("reopen: %d %s", res.StatusCode, body)
	}
	reopened := decodeMap(t, body)["decision"].(map[string]any)
	if reopened["status"] != "open" || reopened["chosen_solution_id"] != nil || reopened["decided_at"] != nil {
		t.Fatalf("reopen payload: %v", reopened)
	}

	// A closes without solution
	res, body = chooseDecision(t, ts, admin, dID, nil)
	if res.StatusCode != 200 {
		t.Fatalf("close: %d %s", res.StatusCode, body)
	}
	closed := decodeMap(t, body)["decision"].(map[string]any)
	if closed["status"] != "decided" || closed["chosen_solution_id"] != nil {
		t.Fatalf("close payload: %v", closed)
	}
}

// --- G5: decision attachments -------------------------------------------------

func TestDecisionAttachments(t *testing.T) {
	ts, prod, _ := bootAPI(t)
	admin := loginAdmin(t, ts)
	project := createProject(t, ts, admin, "Casa")

	ana, anaID := registerPhase4User(t, ts, admin, "ana")
	addProjectMembers(t, ts, admin, project, []string{anaID})

	dID := createDecision(t, ts, admin, project, "¿Qué comemos?")
	sAdmin := createSolution(t, ts, admin, dID, "Solución del admin")
	sAna := createSolution(t, ts, ana, dID, "Solución de ana")

	// description-level upload by any member (ana)
	res, body := decisionUpload(t, ts, ana, dID, "", "nota.txt", "text/plain", "contenido")
	if res.StatusCode != 201 {
		t.Fatalf("description upload: %d %s", res.StatusCode, body)
	}
	att := decodeMap(t, body)["attachment"].(map[string]any)
	if att["solution_id"] != nil {
		t.Fatalf("description-level solution_id must be null: %v", att)
	}
	if att["uploaded_by_username"] != "ana" {
		t.Fatalf("uploaded_by_username: %v", att)
	}

	// solution-level upload by author (ana -> sAna) OK
	res, body = decisionUpload(t, ts, ana, dID, sAna, "propia.txt", "text/plain", "x")
	if res.StatusCode != 201 {
		t.Fatalf("author upload: %d %s", res.StatusCode, body)
	}
	if decodeMap(t, body)["attachment"].(map[string]any)["solution_id"] != sAna {
		t.Fatalf("solution-level upload solution_id: %s", body)
	}

	// solution-level upload by another non-admin member (ana -> sAdmin) 403
	res, body = decisionUpload(t, ts, ana, dID, sAdmin, "ajena.txt", "text/plain", "x")
	if res.StatusCode != 403 {
		t.Fatalf("non-author upload must 403: %d %s", res.StatusCode, body)
	}

	// admin can upload to ana's solution
	res, body = decisionUpload(t, ts, admin, dID, sAna, "por-admin.txt", "text/plain", "x")
	if res.StatusCode != 201 {
		t.Fatalf("admin upload: %d %s", res.StatusCode, body)
	}

	// delete: admin deletes ana's description attachment (204)
	attAdminRes, attAdminBody := decisionUpload(t, ts, admin, dID, "", "del-admin.txt", "text/plain", "x")
	if attAdminRes.StatusCode != 201 {
		t.Fatalf("admin upload: %d %s", attAdminRes.StatusCode, attAdminBody)
	}
	attAdminID := decodeMap(t, attAdminBody)["attachment"].(map[string]any)["id"].(string)

	// ana (non-uploader member) delete admin's attachment -> 403
	res, body = doReq(t, ts, http.MethodDelete, "/api/decisions/attachments/"+attAdminID, nil, ana.headers())
	if res.StatusCode != 403 {
		t.Fatalf("non-uploader delete must 403: %d %s", res.StatusCode, body)
	}
	// admin delete -> 204
	res, _ = doReq(t, ts, http.MethodDelete, "/api/decisions/attachments/"+attAdminID, nil, admin.headers())
	if res.StatusCode != 204 {
		t.Fatalf("admin delete must 204: %d", res.StatusCode)
	}

	// 51st attachment -> 409 ATTACHMENTS_LIMIT_EXCEEDED
	dID2 := createDecision(t, ts, admin, project, "Límite")
	var adminUserID string
	if err := prod.QueryRow("SELECT id FROM users WHERE username = 'admin'").Scan(&adminUserID); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 50; i++ {
		if _, err := prod.Exec(
			"INSERT INTO decision_attachments (id, decision_id, solution_id, filename, stored_name, size, mime, uploaded_by, created_at) VALUES (?, ?, NULL, 'f.txt', 'f.txt', 1, 'text/plain', ?, ?)",
			fmt.Sprintf("att-%d", i), dID2, adminUserID, int64(i)); err != nil {
			t.Fatal(err)
		}
	}
	res, body = decisionUpload(t, ts, admin, dID2, "", "extra.txt", "text/plain", "x")
	if res.StatusCode != 409 {
		t.Fatalf("51st attachment must 409: %d %s", res.StatusCode, body)
	}
	if decodeMap(t, body)["error"].(map[string]any)["code"] != "ATTACHMENTS_LIMIT_EXCEEDED" {
		t.Fatalf("error code: %s", body)
	}
}

// --- G6: gamification ledger --------------------------------------------------

func TestGamification(t *testing.T) {
	t.Run("choose grants +8 to the solution author, not the creator", func(t *testing.T) {
		ts, prod, _ := bootAPI(t)
		admin := loginAdmin(t, ts)
		project := createProject(t, ts, admin, "Casa")
		ana, anaID := registerPhase4User(t, ts, admin, "ana")
		addProjectMembers(t, ts, admin, project, []string{anaID})

		dID := createDecision(t, ts, admin, project, "¿Qué comemos?")
		sol := createSolution(t, ts, ana, dID, "Pizza")

		if res, b := chooseDecision(t, ts, admin, dID, sol); res.StatusCode != 200 {
			t.Fatalf("choose: %d %s", res.StatusCode, b)
		}
		s := summaryOf(t, ts, admin)
		if balanceOf(t, s, "ana") != 8 {
			t.Fatalf("ana balance = %v", balanceOf(t, s, "ana"))
		}
		if balanceOf(t, s, "admin") != 0 {
			t.Fatalf("admin balance = %v", balanceOf(t, s, "admin"))
		}
		var taskID sql.NullString
		var decisionID string
		var points int64
		if err := prod.QueryRow("SELECT task_id, decision_id, points FROM gam_points_ledger WHERE reason = 'decision_chosen'").Scan(&taskID, &decisionID, &points); err != nil {
			t.Fatal(err)
		}
		if taskID.Valid || decisionID != dID || points != 8 {
			t.Fatalf("chosen ledger row: task_id=%v decision_id=%s points=%d", taskID, decisionID, points)
		}
	})

	t.Run("reopen reverts +8, re-choose re-grants by reactivating the row", func(t *testing.T) {
		ts, prod, _ := bootAPI(t)
		admin := loginAdmin(t, ts)
		project := createProject(t, ts, admin, "Casa")
		ana, anaID := registerPhase4User(t, ts, admin, "ana")
		addProjectMembers(t, ts, admin, project, []string{anaID})

		dID := createDecision(t, ts, admin, project, "¿Qué comemos?")
		sol := createSolution(t, ts, ana, dID, "Pizza")
		chooseDecision(t, ts, admin, dID, sol)

		// reopen reverts
		if res, b := doReq(t, ts, http.MethodPost, "/api/decisions/"+dID+"/reopen", map[string]any{}, admin.headers()); res.StatusCode != 200 {
			t.Fatalf("reopen: %d %s", res.StatusCode, b)
		}
		if balanceOf(t, summaryOf(t, ts, admin), "ana") != 0 {
			t.Fatalf("ana balance after reopen = %v", balanceOf(t, summaryOf(t, ts, admin), "ana"))
		}

		// re-choose re-grants
		chooseDecision(t, ts, admin, dID, sol)
		if balanceOf(t, summaryOf(t, ts, admin), "ana") != 8 {
			t.Fatalf("ana balance after re-choose = %v", balanceOf(t, summaryOf(t, ts, admin), "ana"))
		}
		var n int
		if err := prod.QueryRow("SELECT COUNT(*) FROM gam_points_ledger WHERE reason = 'decision_chosen' AND decision_id = ?", dID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatalf("chosen rows = %d, want 1", n)
		}
	})

	t.Run("vote +1 once, move vote does not double-grant, unvote reverts, re-vote reactivates", func(t *testing.T) {
		ts, prod, _ := bootAPI(t)
		admin := loginAdmin(t, ts)
		project := createProject(t, ts, admin, "Casa")
		ana, anaID := registerPhase4User(t, ts, admin, "ana")
		addProjectMembers(t, ts, admin, project, []string{anaID})

		dID := createDecision(t, ts, admin, project, "¿Qué comemos?")
		s1 := createSolution(t, ts, admin, dID, "Pizza")
		s2 := createSolution(t, ts, admin, dID, "Tortilla")

		voteDecision(t, ts, ana, dID, s1)
		if balanceOf(t, summaryOf(t, ts, admin), "ana") != 1 {
			t.Fatalf("ana balance after vote = %v", balanceOf(t, summaryOf(t, ts, admin), "ana"))
		}
		// move vote to s2: no double grant, single row
		voteDecision(t, ts, ana, dID, s2)
		if balanceOf(t, summaryOf(t, ts, admin), "ana") != 1 {
			t.Fatalf("ana balance after move = %v", balanceOf(t, summaryOf(t, ts, admin), "ana"))
		}
		var n int
		prod.QueryRow("SELECT COUNT(*) FROM gam_points_ledger WHERE reason = 'decision_vote' AND decision_id = ?", dID).Scan(&n)
		if n != 1 {
			t.Fatalf("vote rows = %d, want 1", n)
		}
		// unvote reverts
		if res, b := doReq(t, ts, http.MethodDelete, "/api/decisions/"+dID+"/vote", nil, ana.headers()); res.StatusCode != 204 {
			t.Fatalf("unvote: %d %s", res.StatusCode, b)
		}
		if balanceOf(t, summaryOf(t, ts, admin), "ana") != 0 {
			t.Fatalf("ana balance after unvote = %v", balanceOf(t, summaryOf(t, ts, admin), "ana"))
		}
		// re-vote reactivates
		voteDecision(t, ts, ana, dID, s1)
		if balanceOf(t, summaryOf(t, ts, admin), "ana") != 1 {
			t.Fatalf("ana balance after re-vote = %v", balanceOf(t, summaryOf(t, ts, admin), "ana"))
		}
		prod.QueryRow("SELECT COUNT(*) FROM gam_points_ledger WHERE reason = 'decision_vote' AND decision_id = ?", dID).Scan(&n)
		if n != 1 {
			t.Fatalf("vote rows after re-vote = %d, want 1", n)
		}
	})

	t.Run("tasks_done_total counts only task rows, never decision rows", func(t *testing.T) {
		ts, _, _ := bootAPI(t)
		admin := loginAdmin(t, ts)
		project := createProject(t, ts, admin, "Casa")
		ana, anaID := registerPhase4User(t, ts, admin, "ana")
		addProjectMembers(t, ts, admin, project, []string{anaID})

		dID := createDecision(t, ts, admin, project, "¿Qué comemos?")
		sol := createSolution(t, ts, ana, dID, "Pizza")
		voteDecision(t, ts, ana, dID, sol)     // +1 decision_vote
		chooseDecision(t, ts, admin, dID, sol) // +8 decision_chosen

		task := createTask(t, ts, ana, project, "Tarea")
		if res, b := doReq(t, ts, http.MethodPost, "/api/tasks/"+task+"/move",
			map[string]any{"column": "hecho", "position": 0}, ana.headers()); res.StatusCode != 200 {
			t.Fatalf("move task: %d %s", res.StatusCode, b)
		}

		s := summaryOf(t, ts, ana)
		me := userStat(t, s, "ana")
		if me["balance"] != float64(8+1+5) {
			t.Fatalf("balance = %v", me["balance"])
		}
		if me["week_points"] != float64(8+1+5) {
			t.Fatalf("week_points = %v", me["week_points"])
		}
		if me["tasks_done_total"] != float64(1) {
			t.Fatalf("tasks_done_total = %v, want 1 (only the task)", me["tasks_done_total"])
		}
	})
}

// --- G7: rewards --------------------------------------------------------------

func TestRewards(t *testing.T) {
	ts, _, _ := bootAPI(t)
	admin := loginAdmin(t, ts)
	project := createProject(t, ts, admin, "Casa")

	// invalid: empty title and cost 0 -> 422
	res, body := doReq(t, ts, http.MethodPost, "/api/rewards", map[string]any{"title": "", "cost": 0}, admin.headers())
	if res.StatusCode != 422 {
		t.Fatalf("bad reward must 422: %d %s", res.StatusCode, body)
	}

	// create
	res, body = doReq(t, ts, http.MethodPost, "/api/rewards",
		map[string]any{"title": "Cena a elegir", "emoji": "🍕", "cost": 30}, admin.headers())
	if res.StatusCode != 201 {
		t.Fatalf("create reward: %d %s", res.StatusCode, body)
	}
	if loc := res.Header.Get("Location"); loc == "" {
		t.Fatalf("reward create must set Location")
	}
	reward := decodeMap(t, body)["reward"].(map[string]any)
	rewardID := reward["id"].(string)
	if reward["emoji"] != "🍕" || reward["cost"] != float64(30) {
		t.Fatalf("reward payload: %v", reward)
	}

	// list
	_, body = doReq(t, ts, http.MethodGet, "/api/rewards", nil, admin.headers())
	list := decodeMap(t, body)["rewards"].([]any)
	if len(list) != 1 {
		t.Fatalf("rewards list = %d", len(list))
	}

	// earn points to redeem
	task := createTask(t, ts, admin, project, "Tarea")
	if res, b := doReq(t, ts, http.MethodPost, "/api/tasks/"+task+"/move",
		map[string]any{"column": "hecho", "position": 0}, admin.headers()); res.StatusCode != 200 {
		t.Fatalf("move task: %d %s", res.StatusCode, b)
	}

	// redeem (cost snapshot): 5 points balance, cost 30 -> insufficient
	res, body = doReq(t, ts, http.MethodPost, "/api/rewards/"+rewardID+"/redeem", map[string]any{}, admin.headers())
	if res.StatusCode != 400 {
		t.Fatalf("insufficient redeem must 400: %d %s", res.StatusCode, body)
	}
	if decodeMap(t, body)["error"].(map[string]any)["code"] != "INSUFFICIENT_POINTS" {
		t.Fatalf("error code: %s", body)
	}

	// create a cheap reward and redeem
	res, body = doReq(t, ts, http.MethodPost, "/api/rewards", map[string]any{"title": "Café", "cost": 3}, admin.headers())
	if res.StatusCode != 201 {
		t.Fatalf("create cheap reward: %d %s", res.StatusCode, body)
	}
	cheap := decodeMap(t, body)["reward"].(map[string]any)
	cheapID := cheap["id"].(string)

	res, body = doReq(t, ts, http.MethodPost, "/api/rewards/"+cheapID+"/redeem", map[string]any{}, admin.headers())
	if res.StatusCode != 201 {
		t.Fatalf("redeem: %d %s", res.StatusCode, body)
	}
	redeemed := decodeMap(t, body)
	if redeemed["balance"] != float64(2) {
		t.Fatalf("balance after redeem = %v", redeemed["balance"])
	}
	redemption := redeemed["redemption"].(map[string]any)
	if redemption["cost"] != float64(3) || redemption["reward_id"] != cheapID {
		t.Fatalf("redemption payload: %v", redemption)
	}

	// redemption history in summary
	s := summaryOf(t, ts, admin)
	redemptions := s["redemptions"].([]any)
	if len(redemptions) != 1 {
		t.Fatalf("redemptions = %d", len(redemptions))
	}
	if redemptions[0].(map[string]any)["reward_title"] != "Café" {
		t.Fatalf("redemption history: %v", redemptions[0])
	}

	// soft delete (active=0)
	res, _ = doReq(t, ts, http.MethodDelete, "/api/rewards/"+cheapID, nil, admin.headers())
	if res.StatusCode != 204 {
		t.Fatalf("delete reward: %d", res.StatusCode)
	}
	_, body = doReq(t, ts, http.MethodGet, "/api/rewards", nil, admin.headers())
	list = decodeMap(t, body)["rewards"].([]any)
	for _, r := range list {
		if r.(map[string]any)["id"] == cheapID {
			t.Fatalf("deleted reward still listed")
		}
	}
	// delete again -> 404
	res, _ = doReq(t, ts, http.MethodDelete, "/api/rewards/"+cheapID, nil, admin.headers())
	if res.StatusCode != 404 {
		t.Fatalf("delete again must 404: %d", res.StatusCode)
	}
}
