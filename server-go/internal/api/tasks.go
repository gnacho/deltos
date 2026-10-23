package api

import (
	"database/sql"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/errors"
	"github.com/gnacho/deltos/server-go/internal/ids"
	"github.com/gnacho/deltos/server-go/internal/recurrence"
)

// registerTaskRoutes ports the task routes of routes-domain.ts (CRUD, move,
// archive, subtasks, comments, attachments) plus recurring pause/resume.
func (s *Server) registerTaskRoutes(r *rtr) {
	r.Post("/api/tasks", s.handleTaskCreate)
	r.Patch("/api/tasks/:id", s.handleTaskPatch)
	r.Post("/api/tasks/:id/move", s.handleTaskMove)
	r.Delete("/api/tasks/:id", s.handleTaskDelete)
	r.Post("/api/tasks/:id/do-today", s.handleTaskDoToday)
	r.Post("/api/tasks/:id/archive", s.handleTaskArchive)
	r.Post("/api/tasks/:id/done-and-archive", s.handleTaskDoneAndArchive)
	r.Post("/api/tasks/:id/unarchive", s.handleTaskUnarchive)
	r.Get("/api/tasks/:id", s.handleTaskDetail)

	r.Post("/api/tasks/:id/subtasks", s.handleSubtaskCreate)
	r.Patch("/api/subtasks/:id", s.handleSubtaskPatch)
	r.Delete("/api/subtasks/:id", s.handleSubtaskDelete)

	r.Post("/api/tasks/:id/comments", s.handleCommentCreate)
	r.Post("/api/tasks/:id/attachments", s.handleAttachmentCreate)
	r.Get("/api/attachments/:id", s.handleAttachmentGet)

	r.Post("/api/tasks/recurring/:id/pause", s.handleRecurringPause)
	r.Post("/api/tasks/recurring/:id/resume", s.handleRecurringResume)
}

var validColumns = map[string]bool{"nuevo": true, "encurso": true, "hecho": true}
var validPriorities = map[string]bool{"alta": true, "media": true, "baja": true}

// parseRecurrenceField validates + normalizes a recurrence body value.
func parseRecurrenceField(raw json.RawMessage, issues *[]issue) *recurrence.Recurrence {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		*issues = append(*issues, issue{Path: []string{"recurrence"}, Message: "invalid recurrence"})
		return nil
	}
	if freq, ok := m["freq"].(string); !ok || (freq != "daily" && freq != "weekly" && freq != "monthly") {
		*issues = append(*issues, issue{Path: []string{"recurrence", "freq"}, Message: "invalid freq"})
		return nil
	}
	if iv, ok := m["interval"].(float64); ok {
		if iv < 1 || iv > 999 || iv != math.Trunc(iv) {
			*issues = append(*issues, issue{Path: []string{"recurrence", "interval"}, Message: "invalid interval"})
			return nil
		}
	}
	if wd, ok := m["weekdays"].([]any); ok {
		if len(wd) > 7 {
			*issues = append(*issues, issue{Path: []string{"recurrence", "weekdays"}, Message: "too many weekdays"})
			return nil
		}
		for _, w := range wd {
			f, ok := w.(float64)
			if !ok || f < 0 || f > 6 || f != math.Trunc(f) {
				*issues = append(*issues, issue{Path: []string{"recurrence", "weekdays"}, Message: "invalid weekday"})
				return nil
			}
		}
	}
	if mode, ok := m["mode"].(string); ok && mode != "due" && mode != "completion" {
		*issues = append(*issues, issue{Path: []string{"recurrence", "mode"}, Message: "invalid mode"})
		return nil
	}
	return recurrence.NormalizeRecurrence(m)
}

// --- create -------------------------------------------------------------------

type taskCreateBody struct {
	ProjectID   string          `json:"project_id"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Column      string          `json:"column"`
	Priority    *string         `json:"priority"`
	DueDate     *string         `json:"due_date"`
	AssigneeID  *string         `json:"assignee_id"`
	Labels      []string        `json:"labels"`
	Recurrence  json.RawMessage `json:"recurrence"`
	Subtasks    []string        `json:"subtasks"`
}

func (s *Server) handleTaskCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	var body taskCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if body.Column == "" {
		body.Column = "nuevo"
	}
	var issues []issue
	if len(body.ProjectID) < 1 || len(body.ProjectID) > 64 {
		issues = append(issues, issue{Path: []string{"project_id"}, Message: "invalid project_id"})
	}
	if len(body.Title) < 1 || len(body.Title) > 200 {
		issues = append(issues, issue{Path: []string{"title"}, Message: "title must be 1-200 characters"})
	}
	if len(body.Description) > 5000 {
		issues = append(issues, issue{Path: []string{"description"}, Message: "description too long"})
	}
	if !validColumns[body.Column] {
		issues = append(issues, issue{Path: []string{"column"}, Message: "invalid column"})
	}
	if body.Priority != nil && !validPriorities[*body.Priority] {
		issues = append(issues, issue{Path: []string{"priority"}, Message: "invalid priority"})
	}
	if body.DueDate != nil && !validDate(*body.DueDate) {
		issues = append(issues, issue{Path: []string{"due_date"}, Message: "usa YYYY-MM-DD"})
	}
	if body.AssigneeID != nil && len(*body.AssigneeID) > 64 {
		issues = append(issues, issue{Path: []string{"assignee_id"}, Message: "invalid assignee_id"})
	}
	if len(body.Labels) > 20 {
		issues = append(issues, issue{Path: []string{"labels"}, Message: "too many labels"})
	}
	if len(body.Subtasks) > 50 {
		issues = append(issues, issue{Path: []string{"subtasks"}, Message: "too many subtasks"})
	}
	var rec *recurrence.Recurrence
	if len(body.Recurrence) > 0 {
		rec = parseRecurrenceField(body.Recurrence, &issues)
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}

	var exists string
	if err := d.QueryRow("SELECT id FROM projects WHERE id = ?", body.ProjectID).Scan(&exists); err != nil {
		if err == sql.ErrNoRows {
			errors.Write(w, errors.New(http.StatusNotFound, errors.ProjectNotFound))
		} else {
			internalErr(w)
		}
		return
	}
	if herr := requireMember(d, user.ID, body.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	if body.AssigneeID != nil && *body.AssigneeID != "" {
		var u string
		if err := d.QueryRow("SELECT id FROM users WHERE id = ?", *body.AssigneeID).Scan(&u); err != nil {
			errors.Write(w, errors.New(http.StatusNotFound, errors.AssigneeNotFound))
			return
		}
		if !isMember(d, *body.AssigneeID, body.ProjectID) {
			errors.Write(w, errors.New(422, errors.AssigneeNotMember))
			return
		}
	}

	id := ids.New()
	now := nowMs()
	var pos int64
	_ = d.QueryRow(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE "column" = ? AND archived_at IS NULL AND deleted_at IS NULL`, body.Column).Scan(&pos)

	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	shortID, _ := d.AllocateShortId(tx, body.ProjectID)
	recStr := any(nil)
	recGroup := any(nil)
	if rec != nil {
		recStr = recurrence.SerializeRecurrence(rec)
		recGroup = id
	}
	doneAt := any(nil)
	if body.Column == "hecho" {
		doneAt = now
	}
	if _, err := tx.Exec(
		`INSERT INTO tasks (id, project_id, title, description, "column", position, priority, due_date, assignee_id, created_by, created_at, updated_at, recurrence, recurrence_group_id, done_at, short_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, body.ProjectID, body.Title, body.Description, body.Column, pos,
		body.Priority, body.DueDate, body.AssigneeID, user.ID, now, now,
		recStr, recGroup, doneAt, shortID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	replaceTaskLabels(tx, id, body.Labels)
	for i, title := range body.Subtasks {
		if _, err := tx.Exec("INSERT INTO task_subtasks (id, task_id, parent_id, title, done, position, created_at) VALUES (?, ?, NULL, ?, 0, ?, ?)",
			ids.New(), id, title, i, now); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
	}
	addEvent(tx, id, user.ID, "created", map[string]any{})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("tasks")
	w.Header().Set("Location", "/api/tasks/"+id)
	list := hydrateTasks(d, "t.id = ?", id)
	if len(list) == 0 {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"task": list[0]})
}

// --- patch --------------------------------------------------------------------

type taskPatchBody struct {
	Title       *string         `json:"title"`
	Description *string         `json:"description"`
	Priority    json.RawMessage `json:"priority"`
	DueDate     json.RawMessage `json:"due_date"`
	AssigneeID  json.RawMessage `json:"assignee_id"`
	Labels      *[]string       `json:"labels"`
	ProjectID   *string         `json:"project_id"`
	Recurrence  json.RawMessage `json:"recurrence"`
}

func (s *Server) handleTaskPatch(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	task, err := getTask(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	var body taskPatchBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	var issues []issue
	if body.Title != nil && (len(*body.Title) < 1 || len(*body.Title) > 200) {
		issues = append(issues, issue{Path: []string{"title"}, Message: "title must be 1-200 characters"})
	}
	if body.Description != nil && len(*body.Description) > 5000 {
		issues = append(issues, issue{Path: []string{"description"}, Message: "description too long"})
	}
	if body.ProjectID != nil && (len(*body.ProjectID) < 1 || len(*body.ProjectID) > 64) {
		issues = append(issues, issue{Path: []string{"project_id"}, Message: "invalid project_id"})
	}
	if body.Labels != nil && len(*body.Labels) > 20 {
		issues = append(issues, issue{Path: []string{"labels"}, Message: "too many labels"})
	}
	priorityVal, prioritySet := decodeOptionalString(body.Priority, &issues, "priority", validPriorities)
	dueVal, dueSet := decodeOptionalDate(body.DueDate, &issues, "due_date")
	assigneeVal, assigneeSet := decodeOptionalNullableString(body.AssigneeID, &issues, "assignee_id")
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}
	// validate assignee
	if assigneeSet && assigneeVal != nil {
		var u string
		if err := d.QueryRow("SELECT id FROM users WHERE id = ?", *assigneeVal).Scan(&u); err != nil {
			errors.Write(w, errors.New(http.StatusNotFound, errors.AssigneeNotFound))
			return
		}
		effProject := task.ProjectID
		if body.ProjectID != nil {
			effProject = *body.ProjectID
		}
		if !isMember(d, *assigneeVal, effProject) {
			errors.Write(w, errors.New(422, errors.AssigneeNotMember))
			return
		}
	}

	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if body.Title != nil && *body.Title != task.Title {
		if _, err := tx.Exec("UPDATE tasks SET title = ? WHERE id = ?", *body.Title, task.ID); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		addEvent(tx, task.ID, user.ID, "title", map[string]any{"from": task.Title, "to": *body.Title})
	}
	if body.ProjectID != nil && *body.ProjectID != task.ProjectID {
		var p string
		if err := tx.QueryRow("SELECT id FROM projects WHERE id = ?", *body.ProjectID).Scan(&p); err != nil {
			_ = tx.Rollback()
			if err == sql.ErrNoRows {
				errors.Write(w, errors.New(http.StatusNotFound, errors.ProjectNotFound))
			} else {
				internalErr(w)
			}
			return
		}
		if !isMember(tx, user.ID, *body.ProjectID) {
			_ = tx.Rollback()
			errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotMember))
			return
		}
		if _, err := tx.Exec("UPDATE tasks SET project_id = ? WHERE id = ?", *body.ProjectID, task.ID); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		addEvent(tx, task.ID, user.ID, "project", map[string]any{"from": task.ProjectID, "to": *body.ProjectID})
	}
	if body.Description != nil && *body.Description != task.Description {
		if _, err := tx.Exec("UPDATE tasks SET description = ? WHERE id = ?", *body.Description, task.ID); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		addEvent(tx, task.ID, user.ID, "description", map[string]any{"from": task.Description, "to": *body.Description})
	}
	if prioritySet && !strPtrEq(priorityVal, task.Priority) {
		if _, err := tx.Exec("UPDATE tasks SET priority = ? WHERE id = ?", nullableStr(priorityVal), task.ID); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		addEvent(tx, task.ID, user.ID, "priority", map[string]any{"from": nstr(task.Priority), "to": priorityVal})
	}
	if dueSet && !strPtrEq(dueVal, task.DueDate) {
		if _, err := tx.Exec("UPDATE tasks SET due_date = ? WHERE id = ?", nullableStr(dueVal), task.ID); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		addEvent(tx, task.ID, user.ID, "due", map[string]any{"from": nstr(task.DueDate), "to": dueVal})
	}
	if assigneeSet && !strPtrEq(assigneeVal, task.AssigneeID) {
		if _, err := tx.Exec("UPDATE tasks SET assignee_id = ? WHERE id = ?", nullableStr(assigneeVal), task.ID); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		addEvent(tx, task.ID, user.ID, "assigned", map[string]any{"from": nstr(task.AssigneeID), "to": assigneeVal})
	}
	if body.Labels != nil {
		replaceTaskLabels(tx, task.ID, *body.Labels)
	}
	if len(body.Recurrence) > 0 {
		var recIssues []issue
		newRec := parseRecurrenceField(body.Recurrence, &recIssues)
		if len(recIssues) > 0 {
			_ = tx.Rollback()
			validationFailed(w, recIssues)
			return
		}
		prevRec := parseRec(task.Recurrence)
		recChanged := serializeRec(prevRec) != serializeRec(newRec)
		if recChanged {
			if _, err := tx.Exec("UPDATE tasks SET recurrence = ? WHERE id = ?", nullableStr(recurrencePtr(newRec)), task.ID); err != nil {
				_ = tx.Rollback()
				internalErr(w)
				return
			}
			if newRec != nil {
				if _, err := tx.Exec("UPDATE tasks SET recurrence_group_id = ? WHERE id = ?", task.ID, task.ID); err != nil {
					_ = tx.Rollback()
					internalErr(w)
					return
				}
			} else {
				if _, err := tx.Exec("UPDATE tasks SET recurrence_group_id = NULL WHERE id = ?", task.ID); err != nil {
					_ = tx.Rollback()
					internalErr(w)
					return
				}
			}
		}
	}
	if _, err := tx.Exec("UPDATE tasks SET updated_at = ? WHERE id = ?", now, task.ID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("tasks")
	list := hydrateTasks(d, "t.id = ?", task.ID)
	if len(list) == 0 {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": list[0]})
}

func nullableStr(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

// strPtrEq compares a nullable new value (*string, nil = null) with the
// stored column value.
func strPtrEq(a *string, b sql.NullString) bool {
	if a == nil {
		return !b.Valid
	}
	return b.Valid && *a == b.String
}

func recurrencePtr(r *recurrence.Recurrence) *string {
	if r == nil {
		return nil
	}
	v := recurrence.SerializeRecurrence(r)
	return &v
}

func serializeRec(r *recurrence.Recurrence) string {
	if r == nil {
		return "null"
	}
	return recurrence.SerializeRecurrence(r)
}

// decodeOptionalString decodes a nullable enum field (priority).
func decodeOptionalString(raw json.RawMessage, issues *[]issue, field string, allowed map[string]bool) (val *string, set bool) {
	if len(raw) == 0 {
		return nil, false
	}
	if string(raw) == "null" {
		return nil, true
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil || !allowed[s] {
		*issues = append(*issues, issue{Path: []string{field}, Message: "invalid " + field})
		return nil, true
	}
	return &s, true
}

func decodeOptionalDate(raw json.RawMessage, issues *[]issue, field string) (val *string, set bool) {
	if len(raw) == 0 {
		return nil, false
	}
	if string(raw) == "null" {
		return nil, true
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil || !validDate(s) {
		*issues = append(*issues, issue{Path: []string{field}, Message: "usa YYYY-MM-DD"})
		return nil, true
	}
	return &s, true
}

func decodeOptionalNullableString(raw json.RawMessage, issues *[]issue, field string) (val *string, set bool) {
	if len(raw) == 0 {
		return nil, false
	}
	if string(raw) == "null" {
		return nil, true
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		*issues = append(*issues, issue{Path: []string{field}, Message: "invalid " + field})
		return nil, true
	}
	if len(s) > 64 {
		*issues = append(*issues, issue{Path: []string{field}, Message: "invalid " + field})
		return nil, true
	}
	return &s, true
}

// --- move ---------------------------------------------------------------------

type moveBody struct {
	Column   string `json:"column"`
	Position int64  `json:"position"`
}

func (s *Server) handleTaskMove(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	task, err := getTask(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	var body moveBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if !validColumns[body.Column] {
		validationFailed(w, []issue{{Path: []string{"column"}, Message: "invalid column"}})
		return
	}
	if body.Position < 0 || body.Position > 100000 {
		validationFailed(w, []issue{{Path: []string{"position"}, Message: "invalid position"}})
		return
	}

	fromCol, fromPos := task.Column, task.Position
	toCol := body.Column
	var targetCount int64
	_ = d.QueryRow(`SELECT COUNT(*) AS n FROM tasks WHERE "column" = ? AND id != ? AND archived_at IS NULL AND deleted_at IS NULL`, toCol, task.ID).Scan(&targetCount)
	toPos := body.Position
	if toPos > targetCount {
		toPos = targetCount
	}

	noChange := !task.ArchivedAt.Valid && fromCol == toCol && toPos == fromPos
	if !noChange {
		tx, err := d.Begin()
		if err != nil {
			internalErr(w)
			return
		}
		if task.ArchivedAt.Valid {
			if _, err := tx.Exec(`UPDATE tasks SET position = position + 1 WHERE "column" = ? AND position >= ? AND archived_at IS NULL AND deleted_at IS NULL`, toCol, toPos); err != nil {
				_ = tx.Rollback()
				internalErr(w)
				return
			}
		} else if fromCol == toCol {
			if toPos < fromPos {
				if _, err := tx.Exec(`UPDATE tasks SET position = position + 1 WHERE "column" = ? AND position >= ? AND position < ? AND archived_at IS NULL AND deleted_at IS NULL`, toCol, toPos, fromPos); err != nil {
					_ = tx.Rollback()
					internalErr(w)
					return
				}
			} else {
				if _, err := tx.Exec(`UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ? AND position <= ? AND archived_at IS NULL AND deleted_at IS NULL`, toCol, fromPos, toPos); err != nil {
					_ = tx.Rollback()
					internalErr(w)
					return
				}
			}
		} else {
			if _, err := tx.Exec(`UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ? AND archived_at IS NULL AND deleted_at IS NULL`, fromCol, fromPos); err != nil {
				_ = tx.Rollback()
				internalErr(w)
				return
			}
			if _, err := tx.Exec(`UPDATE tasks SET position = position + 1 WHERE "column" = ? AND position >= ? AND archived_at IS NULL AND deleted_at IS NULL`, toCol, toPos); err != nil {
				_ = tx.Rollback()
				internalErr(w)
				return
			}
		}
		doneAt := any(nil)
		if toCol == "hecho" {
			doneAt = nowMs()
		}
		if _, err := tx.Exec(`UPDATE tasks SET "column" = ?, position = ?, updated_at = ?, archived_at = NULL, done_at = ? WHERE id = ?`,
			toCol, toPos, nowMs(), doneAt, task.ID); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		addEvent(tx, task.ID, user.ID, "moved", map[string]any{"from": fromCol, "to": toCol})
		if err := tx.Commit(); err != nil {
			internalErr(w)
			return
		}
	}

	if fromCol != "hecho" && toCol == "hecho" && task.Recurrence.Valid {
		s.createRecurringInstance(d, task, user.ID)
	}
	s.Hub.Broadcast("tasks")
	list := hydrateTasks(d, "t.id = ?", task.ID)
	if len(list) == 0 {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": list[0]})
}

// --- delete / do-today / archive / done-and-archive / unarchive ----------------

func (s *Server) handleTaskDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	task, err := getTask(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE tasks SET deleted_at = ? WHERE id = ?", nowMs(), task.ID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if !task.ArchivedAt.Valid {
		if _, err := tx.Exec(`UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ? AND archived_at IS NULL AND deleted_at IS NULL`, task.Column, task.Position); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("tasks")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleTaskDoToday(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	task, err := getTask(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	today := recurrence.TodayLocal()
	now := nowMs()
	if _, err := d.Exec("UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?", today, now, task.ID); err != nil {
		internalErr(w)
		return
	}
	addEvent(d, task.ID, user.ID, "due", map[string]any{"from": nstr(task.DueDate), "to": today, "reset": true})
	s.Hub.Broadcast("tasks")
	list := hydrateTasks(d, "t.id = ?", task.ID)
	if len(list) == 0 {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": list[0]})
}

func (s *Server) handleTaskArchive(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	task, err := getTask(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	if task.Column != "hecho" {
		errors.Write(w, errors.New(422, errors.TaskNotDone))
		return
	}
	if task.ArchivedAt.Valid {
		list := hydrateTasks(d, "t.id = ?", task.ID)
		if len(list) > 0 {
			writeJSON(w, http.StatusOK, map[string]any{"task": list[0]})
		}
		return
	}
	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE tasks SET archived_at = ? WHERE id = ?", now, task.ID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec(`UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ? AND archived_at IS NULL AND deleted_at IS NULL`, task.Column, task.Position); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("tasks")
	list := hydrateTasks(d, "t.id = ?", task.ID)
	if len(list) == 0 {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": list[0]})
}

func (s *Server) handleTaskDoneAndArchive(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	task, err := getTask(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	if task.ArchivedAt.Valid {
		list := hydrateTasks(d, "t.id = ?", task.ID)
		if len(list) > 0 {
			writeJSON(w, http.StatusOK, map[string]any{"task": list[0]})
		}
		return
	}
	now := nowMs()
	archivePos := task.Position
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if task.Column != "hecho" {
		if _, err := tx.Exec(`UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ? AND archived_at IS NULL AND deleted_at IS NULL`, task.Column, task.Position); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		_ = tx.QueryRow(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE "column" = ? AND archived_at IS NULL AND deleted_at IS NULL`, "hecho").Scan(&archivePos)
		if _, err := tx.Exec(`UPDATE tasks SET "column" = ?, position = ?, updated_at = ?, done_at = ?, archived_at = NULL WHERE id = ?`,
			"hecho", archivePos, now, now, task.ID); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		addEvent(tx, task.ID, user.ID, "moved", map[string]any{"from": task.Column, "to": "hecho"})
	}
	if _, err := tx.Exec("UPDATE tasks SET archived_at = ? WHERE id = ?", now, task.ID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec(`UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ? AND archived_at IS NULL AND deleted_at IS NULL`, "hecho", archivePos); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}

	if task.Column != "hecho" && task.Recurrence.Valid {
		s.createRecurringInstance(d, task, user.ID)
	}
	s.Hub.Broadcast("tasks")
	list := hydrateTasks(d, "t.id = ?", task.ID)
	if len(list) == 0 {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": list[0]})
}

func (s *Server) handleTaskUnarchive(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	task, err := getTask(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	if !task.ArchivedAt.Valid {
		list := hydrateTasks(d, "t.id = ?", task.ID)
		if len(list) > 0 {
			writeJSON(w, http.StatusOK, map[string]any{"task": list[0]})
		}
		return
	}
	now := nowMs()
	var pos int64
	_ = d.QueryRow(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE "column" = ? AND archived_at IS NULL AND deleted_at IS NULL`, "hecho").Scan(&pos)
	if _, err := d.Exec(`UPDATE tasks SET archived_at = NULL, done_at = ?, "column" = ?, position = ? WHERE id = ?`,
		now, "hecho", pos, task.ID); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("tasks")
	list := hydrateTasks(d, "t.id = ?", task.ID)
	if len(list) == 0 {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": list[0]})
}

// --- detail -------------------------------------------------------------------

func (s *Server) handleTaskDetail(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	list := hydrateTasks(d, "t.id = ?", id)
	if len(list) == 0 {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	hydrated := list[0]
	if !isMember(d, user.ID, hydrated.ProjectID) {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}

	arows, err := d.Query(`SELECT a.id, a.filename, a.size, a.mime, a.created_at, a.uploaded_by, u.username AS uploaded_by_username
		FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
		WHERE a.task_id = ? ORDER BY a.created_at`, id)
	if err != nil {
		internalErr(w)
		return
	}
	attachments := []map[string]any{}
	for arows.Next() {
		var id, filename, mime string
		var size int64
		var createdAt int64
		var uploadedBy, uploadedByUsername sql.NullString
		if err := arows.Scan(&id, &filename, &size, &mime, &createdAt, &uploadedBy, &uploadedByUsername); err != nil {
			arows.Close()
			internalErr(w)
			return
		}
		attachments = append(attachments, map[string]any{
			"id": id, "filename": filename, "size": size, "mime": mime,
			"created_at": createdAt, "uploaded_by": nstr(uploadedBy),
			"uploaded_by_username": nstr(uploadedByUsername),
		})
	}
	arows.Close()

	crows, err := d.Query(`SELECT cm.id, cm.body, cm.created_at, cm.user_id, u.username, u.color AS user_color
		FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
		WHERE cm.task_id = ? ORDER BY cm.created_at`, id)
	if err != nil {
		internalErr(w)
		return
	}
	comments := []map[string]any{}
	for crows.Next() {
		var cid, body string
		var createdAt int64
		var userID, username, userColor sql.NullString
		if err := crows.Scan(&cid, &body, &createdAt, &userID, &username, &userColor); err != nil {
			crows.Close()
			internalErr(w)
			return
		}
		comments = append(comments, map[string]any{
			"id": cid, "body": body, "created_at": createdAt,
			"user_id": nstr(userID), "username": nstr(username), "user_color": nstr(userColor),
		})
	}
	crows.Close()

	erows, err := d.Query(`SELECT e.id, e.type, e.data, e.created_at, e.user_id, u.username
		FROM activity_events e LEFT JOIN users u ON u.id = e.user_id
		WHERE e.task_id = ? ORDER BY e.created_at DESC LIMIT 50`, id)
	if err != nil {
		internalErr(w)
		return
	}
	activity := []map[string]any{}
	for erows.Next() {
		var eid, typ string
		var data sql.NullString
		var createdAt int64
		var userID, username sql.NullString
		if err := erows.Scan(&eid, &typ, &data, &createdAt, &userID, &username); err != nil {
			erows.Close()
			internalErr(w)
			return
		}
		activity = append(activity, map[string]any{
			"id": eid, "type": typ, "data": json.RawMessage(orEmpty(data)),
			"created_at": createdAt, "user_id": nstr(userID), "username": nstr(username),
		})
	}
	erows.Close()

	srows, err := d.Query("SELECT id, parent_id, title, done, position FROM task_subtasks WHERE task_id = ? ORDER BY position", id)
	if err != nil {
		internalErr(w)
		return
	}
	subtasks := []map[string]any{}
	for srows.Next() {
		var sid, title string
		var parentID sql.NullString
		var done, position int64
		if err := srows.Scan(&sid, &parentID, &title, &done, &position); err != nil {
			srows.Close()
			internalErr(w)
			return
		}
		subtasks = append(subtasks, map[string]any{
			"id": sid, "parent_id": nstr(parentID), "title": title, "done": done, "position": position,
		})
	}
	srows.Close()

	writeJSON(w, http.StatusOK, map[string]any{
		"task": hydrated, "attachments": attachments, "comments": comments,
		"activity": activity, "subtasks": subtasks,
	})
}

// --- subtasks -----------------------------------------------------------------

type subtaskBody struct {
	Title    string  `json:"title"`
	ParentID *string `json:"parent_id"`
}

func (s *Server) handleSubtaskCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	task, err := getTask(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	var body subtaskBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if len(body.Title) < 1 || len(body.Title) > 200 {
		validationFailed(w, []issue{{Path: []string{"title"}, Message: "title must be 1-200 characters"}})
		return
	}
	if body.ParentID != nil && *body.ParentID != "" {
		var parent string
		if err := d.QueryRow("SELECT id FROM task_subtasks WHERE id = ? AND task_id = ?", *body.ParentID, task.ID).Scan(&parent); err != nil {
			errors.Write(w, errors.New(http.StatusNotFound, errors.SubtaskNotFound))
			return
		}
	}
	id := ids.New()
	now := nowMs()
	var pos int64
	_ = d.QueryRow("SELECT COALESCE(MAX(position) + 1, 0) AS p FROM task_subtasks WHERE task_id = ? AND parent_id IS ?", task.ID, body.ParentID).Scan(&pos)
	if _, err := d.Exec("INSERT INTO task_subtasks (id, task_id, parent_id, title, done, position, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
		id, task.ID, body.ParentID, body.Title, pos, now); err != nil {
		internalErr(w)
		return
	}
	if _, err := d.Exec("UPDATE tasks SET updated_at = ? WHERE id = ?", now, task.ID); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("tasks")
	sub := subtaskJSON(d, id)
	writeJSON(w, http.StatusCreated, map[string]any{"subtask": sub})
}

func subtaskJSON(q querier, id string) map[string]any {
	var sid, title string
	var parentID sql.NullString
	var done, position int64
	if err := q.QueryRow("SELECT id, parent_id, title, done, position FROM task_subtasks WHERE id = ?", id).Scan(&sid, &parentID, &title, &done, &position); err != nil {
		return nil
	}
	return map[string]any{"id": sid, "parent_id": nstr(parentID), "title": title, "done": done, "position": position}
}

type subtaskPatchBody struct {
	Title *string `json:"title"`
	Done  *bool   `json:"done"`
}

func (s *Server) handleSubtaskPatch(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	var subTaskID, projectID string
	err := d.QueryRow("SELECT s.task_id, t.project_id FROM task_subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?", id).Scan(&subTaskID, &projectID)
	if err == sql.ErrNoRows {
		errors.Write(w, errors.New(http.StatusNotFound, errors.SubtaskNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	if herr := requireMember(d, user.ID, projectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	var body subtaskPatchBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if body.Title != nil && (len(*body.Title) < 1 || len(*body.Title) > 200) {
		validationFailed(w, []issue{{Path: []string{"title"}, Message: "title must be 1-200 characters"}})
		return
	}
	now := nowMs()
	if body.Title != nil {
		if _, err := d.Exec("UPDATE task_subtasks SET title = ? WHERE id = ?", *body.Title, id); err != nil {
			internalErr(w)
			return
		}
	}
	if body.Done != nil {
		if _, err := d.Exec("UPDATE task_subtasks SET done = ? WHERE id = ?", boolToInt(*body.Done), id); err != nil {
			internalErr(w)
			return
		}
	}
	if _, err := d.Exec("UPDATE tasks SET updated_at = ? WHERE id = ?", now, subTaskID); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("tasks")
	writeJSON(w, http.StatusOK, map[string]any{"subtask": subtaskJSON(d, id)})
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (s *Server) handleSubtaskDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	var subTaskID, projectID string
	err := d.QueryRow("SELECT s.task_id, t.project_id FROM task_subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?", id).Scan(&subTaskID, &projectID)
	if err == sql.ErrNoRows {
		errors.Write(w, errors.New(http.StatusNotFound, errors.SubtaskNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	if herr := requireMember(d, user.ID, projectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	res, err := d.Exec("DELETE FROM task_subtasks WHERE id = ?", id)
	if err != nil {
		internalErr(w)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		if _, err := d.Exec("UPDATE tasks SET updated_at = ? WHERE id = ?", nowMs(), subTaskID); err != nil {
			internalErr(w)
			return
		}
	}
	s.Hub.Broadcast("tasks")
	w.WriteHeader(http.StatusNoContent)
}

// --- comments -----------------------------------------------------------------

type commentBody struct {
	Body string `json:"body"`
}

func (s *Server) handleCommentCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	task, err := getTask(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	var body commentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if len(body.Body) < 1 || len(body.Body) > 2000 {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "body must be 1-2000 characters"}})
		return
	}
	id := ids.New()
	now := nowMs()
	if _, err := d.Exec("INSERT INTO comments (id, task_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
		id, task.ID, user.ID, body.Body, now); err != nil {
		internalErr(w)
		return
	}
	if _, err := d.Exec("UPDATE tasks SET updated_at = ? WHERE id = ?", now, task.ID); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("comments")
	w.Header().Set("Location", "/api/tasks/"+task.ID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"comment": map[string]any{
			"id": id, "body": body.Body, "created_at": now,
			"user_id": user.ID, "username": user.Username, "user_color": user.Color,
		},
	})
}

// --- attachments --------------------------------------------------------------

var allowedMimeTypes = map[string]bool{
	"image/jpeg": true, "image/png": true, "image/gif": true, "image/webp": true, "image/svg+xml": true,
	"application/pdf": true,
	"text/plain":      true, "text/csv": true,
	"application/json":   true,
	"application/msword": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
	"application/vnd.ms-excel": true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
	"application/vnd.oasis.opendocument.text":                           true,
	"application/vnd.oasis.opendocument.spreadsheet":                    true,
	"application/vnd.oasis.opendocument.presentation":                   true,
	"application/zip": true, "application/gzip": true,
	"application/x-tar": true,
}

var nonAlnumDot = regexp.MustCompile(`[^a-zA-Z0-9.]`)

func (s *Server) handleAttachmentCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	task, err := getTask(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}

	if err := r.ParseMultipartForm(s.MaxUploadBytes); err != nil {
		errors.Write(w, errors.New(http.StatusBadRequest, errors.UploadFileRequired))
		return
	}
	file, fh, err := r.FormFile("file")
	if err != nil {
		errors.Write(w, errors.New(http.StatusBadRequest, errors.UploadFileRequired))
		return
	}
	defer file.Close()
	if fh.Size > s.MaxUploadBytes {
		errors.Write(w, errors.New(http.StatusRequestEntityTooLarge, errors.UploadTooLarge))
		return
	}
	mime := fh.Header.Get("Content-Type")
	if mime == "" {
		mime = "application/octet-stream"
	}
	if len(mime) > 100 {
		mime = mime[:100]
	}
	if !allowedMimeTypes[mime] {
		errors.Write(w, errors.New(http.StatusUnsupportedMediaType, errors.UploadInvalidMIME))
		return
	}
	maxAttachments := kvIntOf(s.kvNil("max_attachments_per_task"), 50)
	var currentCount int
	_ = d.QueryRow("SELECT COUNT(*) AS n FROM attachments WHERE task_id = ?", task.ID).Scan(&currentCount)
	if currentCount >= maxAttachments {
		errors.Write(w, errors.New(http.StatusConflict, errors.AttachmentsLimitExc))
		return
	}

	filename := fh.Filename
	if filename == "" {
		filename = "adjunto"
	}
	if len(filename) > 200 {
		filename = filename[:200]
	}
	ext := nonAlnumDot.ReplaceAllString(filepath.Ext(filename), "")
	if len(ext) > 10 {
		ext = ext[:10]
	}
	stored := ids.New() + ext
	buf, err := io.ReadAll(file)
	if err != nil {
		internalErr(w)
		return
	}
	if err := os.MkdirAll(s.UploadsDir, 0o755); err != nil {
		internalErr(w)
		return
	}
	if err := os.WriteFile(filepath.Join(s.UploadsDir, stored), buf, 0o644); err != nil {
		internalErr(w)
		return
	}

	id := ids.New()
	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("INSERT INTO attachments (id, task_id, filename, stored_name, size, mime, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		id, task.ID, filename, stored, len(buf), mime, user.ID, now); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE tasks SET updated_at = ? WHERE id = ?", now, task.ID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	addEvent(tx, task.ID, user.ID, "attachment", map[string]any{"filename": filename})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("attachments")
	s.Hub.Broadcast("tasks")
	w.Header().Set("Location", "/api/attachments/"+id)
	writeJSON(w, http.StatusCreated, map[string]any{
		"attachment": map[string]any{
			"id": id, "filename": filename, "size": len(buf), "mime": mime,
			"created_at": now, "uploaded_by": user.ID, "uploaded_by_username": user.Username,
		},
	})
}

func (s *Server) handleAttachmentGet(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	var taskID, storedName, filename, mime string
	err := d.QueryRow("SELECT task_id, stored_name, filename, mime FROM attachments WHERE id = ?", id).Scan(&taskID, &storedName, &filename, &mime)
	if err == sql.ErrNoRows {
		errors.Write(w, errors.New(http.StatusNotFound, errors.AttachmentNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	var projectID string
	err = d.QueryRow("SELECT project_id FROM tasks WHERE id = ?", taskID).Scan(&projectID)
	if err != nil || !isMember(d, user.ID, projectID) {
		errors.Write(w, errors.New(http.StatusNotFound, errors.AttachmentNotFound))
		return
	}
	filePath := filepath.Join(s.UploadsDir, filepath.Base(storedName))
	if _, err := os.Stat(filePath); err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.AttachmentFileMiss))
		return
	}
	if mime == "" {
		mime = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(filename))
	http.ServeFile(w, r, filePath)
}

// --- recurring pause / resume -------------------------------------------------

func (s *Server) recurringGroupTaskIDs(w http.ResponseWriter, r *http.Request) ([]string, string) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	groupID := param(r, "id")
	rows, err := d.Query(
		`SELECT t.id FROM tasks t
		 JOIN project_members pm ON pm.project_id = t.project_id
		 WHERE t.recurrence_group_id = ? AND pm.user_id = ? AND t.deleted_at IS NULL`, groupID, user.ID)
	if err != nil {
		internalErr(w)
		return nil, groupID
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids, groupID
}

func (s *Server) handleRecurringPause(w http.ResponseWriter, r *http.Request) {
	ids, groupID := s.recurringGroupTaskIDs(w, r)
	if len(ids) == 0 {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if _, err := auth.DBFrom(r).Exec("UPDATE tasks SET recurrence_paused = 1 WHERE recurrence_group_id = ?", groupID); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("tasks")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRecurringResume(w http.ResponseWriter, r *http.Request) {
	ids, groupID := s.recurringGroupTaskIDs(w, r)
	if len(ids) == 0 {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if _, err := auth.DBFrom(r).Exec("UPDATE tasks SET recurrence_paused = 0 WHERE recurrence_group_id = ?", groupID); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("tasks")
	w.WriteHeader(http.StatusNoContent)
}
