package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/errors"
	"github.com/gnacho/deltos/server-go/internal/ids"
)

// Gamification ledger (server/src/routes-gamification.ts): points for
// completing tasks (base + priority bonus, 23h anti-farming) and for decisions
// (issue #280: +8 to the chosen solution author, +1 per vote once), rewards
// and redemptions, and the summary (balance, week, streak). The grant/revert
// helpers are called INSIDE the mutation transaction of tasks.go and
// decisions.go so a failure rolls everything back together.

const (
	basePoints    = 5
	chosenPoints  = 8
	votePoints    = 1
	antiFarmingMs = int64(23 * 60 * 60 * 1000)
	dayMs         = int64(24 * 60 * 60 * 1000)
)

var priorityBonus = map[string]int{"alta": 5, "media": 2, "baja": 0}

// grantCompletionPoints grants points for completing a task. Call INSIDE the
// move transaction. Returns the points granted (0 when anti-farming blocks a
// fresh grant). Reactivates a reverted entry still inside the window.
func grantCompletionPoints(q querier, taskID string, priority sql.NullString, userID string) int {
	cutoff := nowMs() - antiFarmingMs
	var one int
	if err := q.QueryRow(
		"SELECT 1 FROM gam_points_ledger WHERE task_id = ? AND created_at >= ? AND reverted_at IS NULL LIMIT 1",
		taskID, cutoff).Scan(&one); err == nil {
		return 0
	}
	var id string
	var points int
	if err := q.QueryRow(
		"SELECT id, points FROM gam_points_ledger WHERE task_id = ? AND created_at >= ? AND reverted_at IS NOT NULL ORDER BY created_at DESC LIMIT 1",
		taskID, cutoff).Scan(&id, &points); err == nil {
		_, _ = q.Exec("UPDATE gam_points_ledger SET reverted_at = NULL WHERE id = ?", id)
		return points
	}
	pts := basePoints
	if priority.Valid {
		pts += priorityBonus[priority.String]
	}
	_, _ = q.Exec(
		"INSERT INTO gam_points_ledger (id, user_id, task_id, points, reason, created_at, reverted_at) VALUES (?, ?, ?, ?, 'task_done', ?, NULL)",
		ids.New(), userID, taskID, pts, nowMs())
	return pts
}

// revertCompletionPoints reverts the last active task grant when a task leaves
// 'hecho'. Returns the points reverted (0 if none active).
func revertCompletionPoints(q querier, taskID string) int {
	var id string
	var points int
	if err := q.QueryRow(
		"SELECT id, points FROM gam_points_ledger WHERE task_id = ? AND reverted_at IS NULL ORDER BY created_at DESC LIMIT 1",
		taskID).Scan(&id, &points); err != nil {
		return 0
	}
	_, _ = q.Exec("UPDATE gam_points_ledger SET reverted_at = ? WHERE id = ?", nowMs(), id)
	return points
}

// grantChosenPoints grants +8 to the chosen solution author. Call INSIDE the
// choose transaction, AFTER revertChosenPoints. One decision pays one author.
func grantChosenPoints(q querier, decisionID, solutionID string) int {
	var proposerID string
	if err := q.QueryRow("SELECT proposer_id FROM decision_solutions WHERE id = ? AND decision_id = ?", solutionID, decisionID).Scan(&proposerID); err != nil {
		return 0
	}
	var id string
	var points int
	if err := q.QueryRow(
		"SELECT id, points FROM gam_points_ledger WHERE decision_id = ? AND user_id = ? AND reason = 'decision_chosen' AND reverted_at IS NULL LIMIT 1",
		decisionID, proposerID).Scan(&id, &points); err == nil {
		return 0
	}
	cutoff := nowMs() - antiFarmingMs
	if err := q.QueryRow(
		"SELECT id, points FROM gam_points_ledger WHERE decision_id = ? AND user_id = ? AND reason = 'decision_chosen' AND reverted_at IS NOT NULL AND created_at >= ? ORDER BY created_at DESC LIMIT 1",
		decisionID, proposerID, cutoff).Scan(&id, &points); err == nil {
		_, _ = q.Exec("UPDATE gam_points_ledger SET reverted_at = NULL WHERE id = ?", id)
		return points
	}
	_, _ = q.Exec(
		"INSERT INTO gam_points_ledger (id, user_id, task_id, decision_id, points, reason, created_at, reverted_at) VALUES (?, ?, NULL, ?, ?, 'decision_chosen', ?, NULL)",
		ids.New(), proposerID, decisionID, chosenPoints, nowMs())
	return chosenPoints
}

// revertChosenPoints reverts ALL active decision_chosen grants of a decision
// (reopen, choose another / close without solution, delete the chosen
// solution). Returns the points reverted (0 if none).
func revertChosenPoints(q querier, decisionID string) int {
	rows, err := q.Query("SELECT id, points FROM gam_points_ledger WHERE decision_id = ? AND reason = 'decision_chosen' AND reverted_at IS NULL", decisionID)
	if err != nil {
		return 0
	}
	defer rows.Close()
	now := nowMs()
	total := 0
	for rows.Next() {
		var id string
		var points int
		if rows.Scan(&id, &points) != nil {
			continue
		}
		_, _ = q.Exec("UPDATE gam_points_ledger SET reverted_at = ? WHERE id = ?", now, id)
		total += points
	}
	return total
}

// grantVotePoints grants +1 for voting, ONCE per user per decision. Moving the
// vote does not re-grant; re-voting after unvote reactivates the reverted row.
func grantVotePoints(q querier, decisionID, userID string) int {
	var one int
	if err := q.QueryRow(
		"SELECT 1 FROM gam_points_ledger WHERE decision_id = ? AND user_id = ? AND reason = 'decision_vote' AND reverted_at IS NULL LIMIT 1",
		decisionID, userID).Scan(&one); err == nil {
		return 0
	}
	var id string
	var points int
	if err := q.QueryRow(
		"SELECT id, points FROM gam_points_ledger WHERE decision_id = ? AND user_id = ? AND reason = 'decision_vote' AND reverted_at IS NOT NULL ORDER BY created_at DESC LIMIT 1",
		decisionID, userID).Scan(&id, &points); err == nil {
		_, _ = q.Exec("UPDATE gam_points_ledger SET reverted_at = NULL WHERE id = ?", id)
		return points
	}
	_, _ = q.Exec(
		"INSERT INTO gam_points_ledger (id, user_id, task_id, decision_id, points, reason, created_at, reverted_at) VALUES (?, ?, NULL, ?, ?, 'decision_vote', ?, NULL)",
		ids.New(), userID, decisionID, votePoints, nowMs())
	return votePoints
}

// revertVotePoints reverts the +1 of a user's vote in a decision (on unvote).
func revertVotePoints(q querier, decisionID, userID string) int {
	var id string
	var points int
	if err := q.QueryRow(
		"SELECT id, points FROM gam_points_ledger WHERE decision_id = ? AND user_id = ? AND reason = 'decision_vote' AND reverted_at IS NULL LIMIT 1",
		decisionID, userID).Scan(&id, &points); err != nil {
		return 0
	}
	_, _ = q.Exec("UPDATE gam_points_ledger SET reverted_at = ? WHERE id = ?", nowMs(), id)
	return points
}

// mondayStartMs is the local Monday 00:00 of the current week (epoch ms).
func mondayStartMs(now time.Time) int64 {
	d := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	d = d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
	return d.UnixMilli()
}

// localDay renders an epoch ms as 'YYYY-MM-DD' in local time (for streaks).
func localDay(ms int64) string {
	return time.UnixMilli(ms).In(time.Local).Format("2006-01-02")
}

// streakDays counts consecutive days with at least one active grant, ending
// today or yesterday (if today has none yet).
func streakDays(daysSet map[string]bool, nowMs int64) int {
	cursor := localDay(nowMs)
	if !daysSet[cursor] {
		cursor = localDay(nowMs - dayMs)
		if !daysSet[cursor] {
			return 0
		}
	}
	streak := 0
	t, _ := time.ParseInLocation("2006-01-02", cursor, time.Local)
	cursorMs := t.UnixMilli()
	for daysSet[localDay(cursorMs)] {
		streak++
		cursorMs -= dayMs
	}
	return streak
}

// --- route registration -------------------------------------------------------

func (s *Server) registerGamificationRoutes(r *rtr) {
	r.Get("/api/gamification/summary", s.handleGamificationSummary)
	r.Get("/api/rewards", s.handleRewardsList)
	r.Post("/api/rewards", s.handleRewardCreate)
	r.Delete("/api/rewards/:id", s.handleRewardDelete)
	r.Post("/api/rewards/:id/redeem", s.handleRewardRedeem)
}

// --- summary ------------------------------------------------------------------

type summaryUserJSON struct {
	UserID         string  `json:"user_id"`
	DisplayName    *string `json:"display_name"`
	Username       string  `json:"username"`
	Color          *string `json:"color"`
	Balance        int64   `json:"balance"`
	WeekPoints     int64   `json:"week_points"`
	StreakDays     int64   `json:"streak_days"`
	TasksDoneTotal int64   `json:"tasks_done_total"`
}

type recentEntryJSON struct {
	ID            string  `json:"id"`
	UserID        string  `json:"user_id"`
	Username      string  `json:"username"`
	DisplayName   *string `json:"display_name"`
	TaskID        *string `json:"task_id"`
	TaskTitle     *string `json:"task_title"`
	DecisionID    *string `json:"decision_id"`
	DecisionTitle *string `json:"decision_title"`
	Points        int64   `json:"points"`
	Reason        string  `json:"reason"`
	CreatedAt     int64   `json:"created_at"`
}

type redemptionJSON struct {
	ID          string  `json:"id"`
	UserID      string  `json:"user_id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name"`
	RewardID    string  `json:"reward_id"`
	RewardTitle string  `json:"reward_title"`
	RewardEmoji string  `json:"reward_emoji"`
	Cost        int64   `json:"cost"`
	CreatedAt   int64   `json:"created_at"`
}

func (s *Server) handleGamificationSummary(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)

	urows, err := d.Query("SELECT id, username, display_name, color FROM users ORDER BY created_at, username")
	if err != nil {
		internalErr(w)
		return
	}
	type userRow struct {
		id          string
		username    string
		displayName sql.NullString
		color       sql.NullString
	}
	var users []userRow
	for urows.Next() {
		var u userRow
		if err := urows.Scan(&u.id, &u.username, &u.displayName, &u.color); err != nil {
			urows.Close()
			internalErr(w)
			return
		}
		users = append(users, u)
	}
	urows.Close()

	weekStart := mondayStartMs(time.Now())
	activeWhere := "reverted_at IS NULL"

	earned := map[string]struct{ total, n int64 }{}
	erows, err := d.Query(
		`SELECT user_id, SUM(points) AS total,
		        SUM(CASE WHEN task_id IS NOT NULL THEN 1 ELSE 0 END) AS n
		 FROM gam_points_ledger WHERE ` + activeWhere + ` GROUP BY user_id`)
	if err != nil {
		internalErr(w)
		return
	}
	for erows.Next() {
		var uid string
		var e struct{ total, n int64 }
		if err := erows.Scan(&uid, &e.total, &e.n); err != nil {
			erows.Close()
			internalErr(w)
			return
		}
		earned[uid] = e
	}
	erows.Close()

	weekMap := map[string]int64{}
	wrows, err := d.Query("SELECT user_id, SUM(points) AS total FROM gam_points_ledger WHERE created_at >= ? AND "+activeWhere+" GROUP BY user_id", weekStart)
	if err != nil {
		internalErr(w)
		return
	}
	for wrows.Next() {
		var uid string
		var total int64
		if err := wrows.Scan(&uid, &total); err != nil {
			wrows.Close()
			internalErr(w)
			return
		}
		weekMap[uid] = total
	}
	wrows.Close()

	spentMap := map[string]int64{}
	srows, err := d.Query("SELECT user_id, SUM(cost) AS total FROM gam_redemptions GROUP BY user_id")
	if err != nil {
		internalErr(w)
		return
	}
	for srows.Next() {
		var uid string
		var total int64
		if err := srows.Scan(&uid, &total); err != nil {
			srows.Close()
			internalErr(w)
			return
		}
		spentMap[uid] = total
	}
	srows.Close()

	daysMap := map[string]map[string]bool{}
	drows, err := d.Query("SELECT DISTINCT user_id, created_at FROM gam_points_ledger WHERE " + activeWhere + " ORDER BY user_id, created_at")
	if err != nil {
		internalErr(w)
		return
	}
	for drows.Next() {
		var uid string
		var createdAt int64
		if err := drows.Scan(&uid, &createdAt); err != nil {
			drows.Close()
			internalErr(w)
			return
		}
		if daysMap[uid] == nil {
			daysMap[uid] = map[string]bool{}
		}
		daysMap[uid][localDay(createdAt)] = true
	}
	drows.Close()

	summary := make([]summaryUserJSON, 0, len(users))
	for _, u := range users {
		totalEarned := earned[u.id].total
		totalSpent := spentMap[u.id]
		summary = append(summary, summaryUserJSON{
			UserID:         u.id,
			DisplayName:    nstr(u.displayName),
			Username:       u.username,
			Color:          nstr(u.color),
			Balance:        totalEarned - totalSpent,
			WeekPoints:     weekMap[u.id],
			StreakDays:     int64(streakDays(daysMap[u.id], nowMs())),
			TasksDoneTotal: earned[u.id].n,
		})
	}

	recent := []recentEntryJSON{}
	recentRows, err := d.Query(
		`SELECT l.id, l.user_id, u.username, u.display_name, l.task_id, t.title AS task_title,
		        l.decision_id, d.title AS decision_title,
		        l.points, l.reason, l.created_at
		 FROM gam_points_ledger l
		 JOIN users u ON u.id = l.user_id
		 LEFT JOIN tasks t ON t.id = l.task_id
		 LEFT JOIN decisions d ON d.id = l.decision_id
		 WHERE l.reverted_at IS NULL
		 ORDER BY l.created_at DESC, l.id DESC
		 LIMIT 10`)
	if err != nil {
		internalErr(w)
		return
	}
	for recentRows.Next() {
		var e recentEntryJSON
		var displayName, taskID, taskTitle, decisionID, decisionTitle sql.NullString
		if err := recentRows.Scan(&e.ID, &e.UserID, &e.Username, &displayName, &taskID, &taskTitle, &decisionID, &decisionTitle, &e.Points, &e.Reason, &e.CreatedAt); err != nil {
			recentRows.Close()
			internalErr(w)
			return
		}
		e.DisplayName = nstr(displayName)
		e.TaskID = nstr(taskID)
		e.TaskTitle = nstr(taskTitle)
		e.DecisionID = nstr(decisionID)
		e.DecisionTitle = nstr(decisionTitle)
		recent = append(recent, e)
	}
	recentRows.Close()

	redemptions := []redemptionJSON{}
	rrows, err := d.Query(
		`SELECT r.id, r.user_id, u.username, u.display_name, r.reward_id,
		        w.title AS reward_title, w.emoji AS reward_emoji, r.cost, r.created_at
		 FROM gam_redemptions r
		 JOIN users u ON u.id = r.user_id
		 JOIN gam_rewards w ON w.id = r.reward_id
		 ORDER BY r.created_at DESC, r.id DESC
		 LIMIT 10`)
	if err != nil {
		internalErr(w)
		return
	}
	for rrows.Next() {
		var e redemptionJSON
		var displayName sql.NullString
		if err := rrows.Scan(&e.ID, &e.UserID, &e.Username, &displayName, &e.RewardID, &e.RewardTitle, &e.RewardEmoji, &e.Cost, &e.CreatedAt); err != nil {
			rrows.Close()
			internalErr(w)
			return
		}
		e.DisplayName = nstr(displayName)
		redemptions = append(redemptions, e)
	}
	rrows.Close()

	writeJSON(w, http.StatusOK, map[string]any{"users": summary, "recent": recent, "redemptions": redemptions})
}

// --- rewards ------------------------------------------------------------------

type rewardJSON struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Emoji     string `json:"emoji"`
	Cost      int64  `json:"cost"`
	CreatedBy string `json:"created_by"`
	CreatedAt int64  `json:"created_at"`
}

func rewardRowJSON(q querier, id string) *rewardJSON {
	var r rewardJSON
	if err := q.QueryRow("SELECT id, title, emoji, cost, created_by, created_at FROM gam_rewards WHERE id = ?", id).
		Scan(&r.ID, &r.Title, &r.Emoji, &r.Cost, &r.CreatedBy, &r.CreatedAt); err != nil {
		return nil
	}
	return &r
}

func (s *Server) handleRewardsList(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	rows, err := d.Query("SELECT id, title, emoji, cost, created_by, created_at FROM gam_rewards WHERE active = 1 ORDER BY created_at")
	if err != nil {
		internalErr(w)
		return
	}
	defer rows.Close()
	rewards := []rewardJSON{}
	for rows.Next() {
		var r rewardJSON
		if err := rows.Scan(&r.ID, &r.Title, &r.Emoji, &r.Cost, &r.CreatedBy, &r.CreatedAt); err != nil {
			internalErr(w)
			return
		}
		rewards = append(rewards, r)
	}
	writeJSON(w, http.StatusOK, map[string]any{"rewards": rewards})
}

type rewardCreateBody struct {
	Title string `json:"title"`
	Emoji string `json:"emoji"`
	Cost  int64  `json:"cost"`
}

func (s *Server) handleRewardCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	var body rewardCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if body.Emoji == "" {
		body.Emoji = "🎁"
	}
	var issues []issue
	if len(body.Title) < 1 || len(body.Title) > 120 {
		issues = append(issues, issue{Path: []string{"title"}, Message: "title must be 1-120 characters"})
	}
	if len(body.Emoji) > 16 {
		issues = append(issues, issue{Path: []string{"emoji"}, Message: "emoji too long"})
	}
	if body.Cost < 1 || body.Cost > 100000 {
		issues = append(issues, issue{Path: []string{"cost"}, Message: "cost must be 1-100000"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}
	id := ids.New()
	now := nowMs()
	if _, err := d.Exec("INSERT INTO gam_rewards (id, title, emoji, cost, active, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
		id, body.Title, body.Emoji, body.Cost, user.ID, now); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("gamification")
	w.Header().Set("Location", "/api/rewards/"+id)
	writeJSON(w, http.StatusCreated, map[string]any{"reward": rewardRowJSON(d, id)})
}

func (s *Server) handleRewardDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	id := param(r, "id")
	var one string
	if err := d.QueryRow("SELECT id FROM gam_rewards WHERE id = ? AND active = 1", id).Scan(&one); err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.RewardNotFound))
		return
	}
	if _, err := d.Exec("UPDATE gam_rewards SET active = 0 WHERE id = ?", id); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("gamification")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRewardRedeem(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	var rewardID, title, emoji string
	var cost int64
	var createdBy sql.NullString
	var createdAt int64
	err := d.QueryRow("SELECT id, title, emoji, cost, created_by, created_at FROM gam_rewards WHERE id = ? AND active = 1", id).
		Scan(&rewardID, &title, &emoji, &cost, &createdBy, &createdAt)
	if err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.RewardNotFound))
		return
	}

	var earned, spent int64
	var newBalance int64
	var redemptionID string
	var redemptionCreatedAt int64

	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if err := tx.QueryRow("SELECT COALESCE(SUM(points), 0) FROM gam_points_ledger WHERE user_id = ? AND reverted_at IS NULL", user.ID).Scan(&earned); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if err := tx.QueryRow("SELECT COALESCE(SUM(cost), 0) FROM gam_redemptions WHERE user_id = ?", user.ID).Scan(&spent); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	balance := earned - spent
	if balance < cost {
		_ = tx.Rollback()
		errors.Write(w, errors.New(http.StatusBadRequest, errors.InsufficientPoints))
		return
	}
	redemptionID = ids.New()
	redemptionCreatedAt = nowMs()
	if _, err := tx.Exec("INSERT INTO gam_redemptions (id, reward_id, user_id, cost, created_at) VALUES (?, ?, ?, ?, ?)",
		redemptionID, rewardID, user.ID, cost, redemptionCreatedAt); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	newBalance = balance - cost
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}

	s.Hub.Broadcast("gamification")
	redemption := map[string]any{
		"id":         redemptionID,
		"reward_id":  rewardID,
		"user_id":    user.ID,
		"cost":       cost,
		"created_at": redemptionCreatedAt,
	}
	writeJSON(w, http.StatusCreated, map[string]any{"redemption": redemption, "balance": newBalance})
}
