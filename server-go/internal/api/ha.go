package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/errors"
	"github.com/gnacho/deltos/server-go/internal/ids"
	"github.com/gnacho/deltos/server-go/internal/recurrence"
)

const (
	haTokenKey    = "ha_token_hash"
	haUsernameKey = "ha_username"
)

// registerHaRoutes ports server/src/routes-ha.ts (token management + public
// Bearer todo endpoints).
func (s *Server) registerHaRoutes(r *rtr) {
	r.Get("/api/ha/status", s.handleHaStatus)
	r.Post("/api/ha/token", s.handleHaTokenCreate)
	r.Delete("/api/ha/token", s.handleHaTokenDelete)
	r.Get("/api/ha/tasks", s.handleHaTasksList)
	r.Post("/api/ha/tasks", s.handleHaTasksCreate)
	r.Patch("/api/ha/tasks/:id/complete", s.handleHaTasksComplete)
}

func sha256Hex(v string) string {
	sum := sha256.Sum256([]byte(v))
	return hex.EncodeToString(sum[:])
}

// requireHaToken enforces the Bearer token with a timing-safe SHA-256 compare.
func (s *Server) requireHaToken(w http.ResponseWriter, r *http.Request) bool {
	header := r.Header.Get("Authorization")
	token := ""
	if strings.HasPrefix(header, "Bearer ") {
		token = strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	}
	expected := s.Prod.KVGet(haTokenKey, "")
	if token == "" || expected == "" {
		errors.Write(w, errors.New(http.StatusUnauthorized, errors.AuthRequired))
		return false
	}
	expectedHash, err1 := hex.DecodeString(expected)
	givenHash, err2 := hex.DecodeString(sha256Hex(token))
	if err1 != nil || err2 != nil || len(expectedHash) != len(givenHash) ||
		subtle.ConstantTimeCompare(expectedHash, givenHash) != 1 {
		errors.Write(w, errors.New(http.StatusUnauthorized, errors.AuthRequired))
		return false
	}
	return true
}

type haActor struct {
	ID       string
	Username string
}

func haActorFor(d *db.DB, username string) (*haActor, error) {
	if username != "" {
		var a haActor
		err := d.QueryRow("SELECT id, username FROM users WHERE username = ?", username).Scan(&a.ID, &a.Username)
		if err == sql.ErrNoRows {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &a, nil
	}
	var a haActor
	err := d.QueryRow("SELECT id, username FROM users WHERE role = ? ORDER BY created_at LIMIT 1", "admin").Scan(&a.ID, &a.Username)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *Server) handleHaStatus(w http.ResponseWriter, r *http.Request) {
	hash := s.Prod.KVGet(haTokenKey, "")
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":  hash != "",
		"username": s.kvNil(haUsernameKey),
	})
}

type haTokenBody struct {
	Username string `json:"username"`
}

func (s *Server) handleHaTokenCreate(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var body haTokenBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if len(body.Username) > 50 {
		validationFailed(w, []issue{{Path: []string{"username"}, Message: "username too long"}})
		return
	}
	username := body.Username
	if username != "" {
		var u string
		if err := s.Prod.QueryRow("SELECT id FROM users WHERE username = ?", username).Scan(&u); err != nil {
			errors.Write(w, errors.New(http.StatusNotFound, errors.UserNotFound))
			return
		}
		_ = s.Prod.KVSet(haUsernameKey, username)
	} else {
		_ = s.Prod.KVSet(haUsernameKey, "")
	}
	token := ids.RandomHex(32)
	_ = s.Prod.KVSet(haTokenKey, sha256Hex(token))
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "username": nullableOr(username)})
}

func nullableOr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *Server) handleHaTokenDelete(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	_ = s.Prod.KVSet(haTokenKey, "")
	_ = s.Prod.KVSet(haUsernameKey, "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleHaTasksList(w http.ResponseWriter, r *http.Request) {
	if !s.requireHaToken(w, r) {
		return
	}
	username := s.Prod.KVGet(haUsernameKey, "")
	base := `SELECT t.id, t.title, t."column", t.priority, t.due_date,
		p.name AS project_name, u.username AS assignee
	 FROM tasks t
	 LEFT JOIN projects p ON p.id = t.project_id
	 LEFT JOIN users u ON u.id = t.assignee_id
	 WHERE t.deleted_at IS NULL AND t."column" != 'hecho'`
	var rows *sql.Rows
	var err error
	if username != "" {
		rows, err = s.Prod.Query(base+` AND (t.assignee_id IS NULL OR t.assignee_id IN (SELECT id FROM users WHERE username = ?)) ORDER BY t.position`, username)
	} else {
		rows, err = s.Prod.Query(base + ` ORDER BY t."column", t.position`)
	}
	if err != nil {
		internalErr(w)
		return
	}
	defer rows.Close()
	type task struct {
		id, title, column string
		priority, dueDate sql.NullString
		projectName       sql.NullString
		assignee          sql.NullString
	}
	var tasks []map[string]any
	for rows.Next() {
		var t task
		if err := rows.Scan(&t.id, &t.title, &t.column, &t.priority, &t.dueDate, &t.projectName, &t.assignee); err != nil {
			internalErr(w)
			return
		}
		status := "needs_action"
		if t.column == "encurso" {
			status = "in_progress"
		}
		tasks = append(tasks, map[string]any{
			"id": t.id, "title": t.title, "summary": t.title, "status": status,
			"due_date": nstr(t.dueDate), "priority": nstr(t.priority),
			"project": nstr(t.projectName), "assignee": nstr(t.assignee),
		})
	}
	if tasks == nil {
		tasks = []map[string]any{}
	}
	usernameOut := any(nil)
	if username != "" {
		usernameOut = username
	}
	writeJSON(w, http.StatusOK, map[string]any{"username": usernameOut, "count": len(tasks), "tasks": tasks})
}

type haCreateBody struct {
	Title     string  `json:"title"`
	ProjectID *string `json:"project_id"`
	DueDate   *string `json:"due_date"`
	Priority  *string `json:"priority"`
}

func (s *Server) handleHaTasksCreate(w http.ResponseWriter, r *http.Request) {
	if !s.requireHaToken(w, r) {
		return
	}
	var body haCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	var issues []issue
	if len(body.Title) < 1 || len(body.Title) > 200 {
		issues = append(issues, issue{Path: []string{"title"}, Message: "title must be 1-200 characters"})
	}
	if body.ProjectID != nil && len(*body.ProjectID) > 64 {
		issues = append(issues, issue{Path: []string{"project_id"}, Message: "invalid project_id"})
	}
	if body.DueDate != nil && !validDate(*body.DueDate) {
		issues = append(issues, issue{Path: []string{"due_date"}, Message: "usa YYYY-MM-DD"})
	}
	if body.Priority != nil && !validPriorities[*body.Priority] {
		issues = append(issues, issue{Path: []string{"priority"}, Message: "invalid priority"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}

	username := s.Prod.KVGet(haUsernameKey, "")
	actor, err := haActorFor(s.Prod, username)
	if err != nil {
		internalErr(w)
		return
	}
	if actor == nil {
		internalErr(w)
		return
	}
	projectID := ""
	if body.ProjectID != nil {
		projectID = *body.ProjectID
	}
	if projectID == "" {
		var first string
		err := s.Prod.QueryRow(`SELECT p.id FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = ? ORDER BY p.position LIMIT 1`, actor.ID).Scan(&first)
		if err == nil {
			projectID = first
		}
	}
	if projectID == "" {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ProjectNotFound))
		return
	}
	var exists string
	if err := s.Prod.QueryRow("SELECT id FROM projects WHERE id = ?", projectID).Scan(&exists); err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ProjectNotFound))
		return
	}
	if !isMember(s.Prod, actor.ID, projectID) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.AuthForbidden))
		return
	}

	id := ids.New()
	now := nowMs()
	var pos int64
	_ = s.Prod.QueryRow(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE "column" = ?`, "nuevo").Scan(&pos)
	tx, err := s.Prod.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	shortID, _ := s.Prod.AllocateShortId(tx, projectID)
	if _, err := tx.Exec(
		`INSERT INTO tasks (id, project_id, title, description, "column", position, priority, due_date, assignee_id, created_by, created_at, updated_at, short_id)
		 VALUES (?, ?, ?, '', 'nuevo', ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, projectID, body.Title, pos, body.Priority, body.DueDate, actor.ID, actor.ID, now, now, shortID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	addEvent(tx, id, actor.ID, "created", map[string]any{})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"task": map[string]any{"id": id, "title": body.Title, "status": "needs_action"},
	})
}

func (s *Server) handleHaTasksComplete(w http.ResponseWriter, r *http.Request) {
	if !s.requireHaToken(w, r) {
		return
	}
	id := param(r, "id")
	task, err := getTask(s.Prod, id)
	if err != nil {
		internalErr(w)
		return
	}
	if task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	username := s.Prod.KVGet(haUsernameKey, "")
	actor, err := haActorFor(s.Prod, username)
	if err != nil {
		internalErr(w)
		return
	}
	if actor == nil {
		internalErr(w)
		return
	}
	if !isMember(s.Prod, actor.ID, task.ProjectID) {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	now := nowMs()
	tx, err := s.Prod.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	var targetCount int64
	_ = tx.QueryRow(`SELECT COUNT(*) AS n FROM tasks WHERE "column" = ? AND id != ? AND archived_at IS NULL AND deleted_at IS NULL`, "hecho", task.ID).Scan(&targetCount)
	if !task.ArchivedAt.Valid {
		if _, err := tx.Exec(`UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ? AND archived_at IS NULL AND deleted_at IS NULL`, task.Column, task.Position); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
	}
	if _, err := tx.Exec(`UPDATE tasks SET "column" = ?, position = ?, updated_at = ?, archived_at = NULL, done_at = ? WHERE id = ?`,
		"hecho", targetCount, now, now, task.ID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	addEvent(tx, task.ID, orEmptyStr(task.CreatedBy), "moved", map[string]any{"from": task.Column, "to": "hecho"})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}

	nextTask := any(nil)
	if task.Recurrence.Valid {
		rec := parseRec(task.Recurrence)
		if rec != nil {
			nextDue := recurrence.ComputeNextDue(s.Prod, recurrence.RecurrentTask{
				ID:                task.ID,
				DueDate:           nstr(task.DueDate),
				Recurrence:        nstr(task.Recurrence),
				RecurrenceGroupID: nstr(task.RecurrenceGroupID),
			}, recurrence.TodayLocal())
			if nextDue != nil {
				nid := ids.New()
				var npos int64
				_ = s.Prod.QueryRow(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE "column" = ?`, "nuevo").Scan(&npos)
				groupID := task.ID
				if task.RecurrenceGroupID.Valid {
					groupID = task.RecurrenceGroupID.String
				}
				ntx, err := s.Prod.Begin()
				if err == nil {
					shortID, _ := s.Prod.AllocateShortId(ntx, task.ProjectID)
					if _, err := ntx.Exec(
						`INSERT INTO tasks (id, project_id, title, description, "column", position, priority, due_date, assignee_id, created_by, created_at, updated_at, recurrence, recurrence_group_id, short_id)
						 VALUES (?, ?, ?, ?, 'nuevo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						nid, task.ProjectID, task.Title, task.Description, npos,
						sqlStr(task.Priority), *nextDue, sqlStr(task.AssigneeID), sqlStr(task.CreatedBy), now, now,
						recurrence.SerializeRecurrence(rec), groupID, shortID); err == nil {
						addEvent(ntx, nid, orEmptyStr(task.CreatedBy), "created", map[string]any{})
						if err := ntx.Commit(); err == nil {
							nextTask = map[string]any{"id": nid, "title": task.Title}
						}
					} else {
						_ = ntx.Rollback()
					}
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"task": map[string]any{"id": task.ID, "status": "completed"},
		"next": nextTask,
	})
}

func orEmptyStr(s sql.NullString) string {
	if s.Valid {
		return s.String
	}
	return ""
}
