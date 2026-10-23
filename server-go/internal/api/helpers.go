// Package api: shared domain types, SQL helpers and membership/authorization
// primitives used by domain.go, tasks.go and ha.go. These mirror the helpers
// at the top of server/src/routes-domain.ts.
package api

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/errors"
	"github.com/gnacho/deltos/server-go/internal/ids"
	"github.com/gnacho/deltos/server-go/internal/recurrence"
)

// querier is satisfied by *db.DB and *sql.Tx so helpers work inside and
// outside transactions.
type querier interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

type scanner interface {
	Scan(dest ...any) error
}

// --- JSON shapes (must match the Node handlers field-for-field) ---------------

type labelJSON struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type assigneeJSON struct {
	ID       string  `json:"id"`
	Username string  `json:"username"`
	Color    *string `json:"color"`
}

type taskCounts struct {
	Comments    int `json:"comments"`
	Attachments int `json:"attachments"`
}

type taskJSON struct {
	ID                string                 `json:"id"`
	ProjectID         string                 `json:"project_id"`
	ShortID           *string                `json:"short_id"`
	Title             string                 `json:"title"`
	Description       string                 `json:"description"`
	Column            string                 `json:"column"`
	Position          int64                  `json:"position"`
	Priority          *string                `json:"priority"`
	DueDate           *string                `json:"due_date"`
	Recurrence        *recurrence.Recurrence `json:"recurrence"`
	RecurrenceGroupID *string                `json:"recurrence_group_id"`
	RecurrencePaused  bool                   `json:"recurrence_paused"`
	AssigneeID        *string                `json:"assignee_id"`
	Assignee          *assigneeJSON          `json:"assignee"`
	CreatedBy         *string                `json:"created_by"`
	CreatedAt         int64                  `json:"created_at"`
	UpdatedAt         int64                  `json:"updated_at"`
	DoneAt            *int64                 `json:"done_at"`
	ArchivedAt        *int64                 `json:"archived_at"`
	Labels            []labelJSON            `json:"labels"`
	Counts            taskCounts             `json:"counts"`
	Slips             int                    `json:"slips"`
}

type memberJSON struct {
	ID       string  `json:"id"`
	Username string  `json:"username"`
	Color    *string `json:"color"`
	Role     string  `json:"role"`
}

type userBasic struct {
	ID       string  `json:"id"`
	Username string  `json:"username"`
	Color    *string `json:"color"`
}

type userAdmin struct {
	ID        string  `json:"id"`
	Username  string  `json:"username"`
	Email     *string `json:"email"`
	Phone     *string `json:"phone"`
	Color     *string `json:"color"`
	Language  *string `json:"language"`
	Role      string  `json:"role"`
	CreatedAt int64   `json:"created_at"`
}

type userColsJSON struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name"`
	Email       *string `json:"email"`
	Phone       *string `json:"phone"`
	Color       *string `json:"color"`
	Language    *string `json:"language"`
	Role        string  `json:"role"`
	CreatedAt   int64   `json:"created_at"`
}

// --- row scanners -------------------------------------------------------------

// taskRow mirrors the tasks table columns (explicit list, not SELECT *).
type taskRow struct {
	ID                string
	ProjectID         string
	ShortID           sql.NullString
	Title             string
	Description       string
	Column            string
	Position          int64
	Priority          sql.NullString
	DueDate           sql.NullString
	AssigneeID        sql.NullString
	CreatedBy         sql.NullString
	CreatedAt         int64
	UpdatedAt         int64
	Recurrence        sql.NullString
	RecurrenceGroupID sql.NullString
	DoneAt            sql.NullInt64
	ArchivedAt        sql.NullInt64
	RecurrencePaused  int64
	DeletedAt         sql.NullInt64
}

const taskCols = `id, project_id, short_id, title, description, "column", position, priority,
	due_date, assignee_id, created_by, created_at, updated_at, recurrence, recurrence_group_id,
	done_at, archived_at, recurrence_paused, deleted_at`

func scanTask(sc scanner) (*taskRow, error) {
	var t taskRow
	err := sc.Scan(&t.ID, &t.ProjectID, &t.ShortID, &t.Title, &t.Description, &t.Column,
		&t.Position, &t.Priority, &t.DueDate, &t.AssigneeID, &t.CreatedBy, &t.CreatedAt,
		&t.UpdatedAt, &t.Recurrence, &t.RecurrenceGroupID, &t.DoneAt, &t.ArchivedAt,
		&t.RecurrencePaused, &t.DeletedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// projectRow mirrors the projects table columns.
type projectRow struct {
	ID        string
	Name      string
	Emoji     sql.NullString
	Color     sql.NullString
	Position  int64
	OwnerID   sql.NullString
	IsInbox   int64
	CreatedAt int64
	TaskSeq   int64
}

const projectCols = `id, name, emoji, color, position, owner_id, is_inbox, created_at, task_seq`

func scanProject(sc scanner) (*projectRow, error) {
	var p projectRow
	err := sc.Scan(&p.ID, &p.Name, &p.Emoji, &p.Color, &p.Position, &p.OwnerID, &p.IsInbox,
		&p.CreatedAt, &p.TaskSeq)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// --- null helpers -------------------------------------------------------------

func nstr(s sql.NullString) *string {
	if s.Valid {
		return &s.String
	}
	return nil
}

func nint(i sql.NullInt64) *int64 {
	if i.Valid {
		return &i.Int64
	}
	return nil
}

// sqlStr returns a driver-safe value (nil or the underlying value) for SQL
// parameters, since *string is not accepted by the driver.
func sqlStr(s sql.NullString) any {
	if s.Valid {
		return s.String
	}
	return nil
}

// --- membership / authorization -------------------------------------------------

func isMember(q querier, userID, projectID string) bool {
	var one int
	err := q.QueryRow("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?", projectID, userID).Scan(&one)
	return err == nil
}

// requireMember returns 403 PROJECT_NOT_MEMBER when the user is not a member.
func requireMember(q querier, userID, projectID string) *errors.HTTPError {
	if !isMember(q, userID, projectID) {
		return errors.New(403, errors.ProjectNotMember)
	}
	return nil
}

func canManageProject(q querier, user *auth.User, ownerID sql.NullString, projectID string) bool {
	if user.Role == "admin" {
		return true
	}
	if !ownerID.Valid {
		return isMember(q, user.ID, projectID)
	}
	return ownerID.String == user.ID
}

func memberList(q querier, projectID string) []memberJSON {
	rows, err := q.Query(
		`SELECT u.id, u.username, u.color, pm.role
		 FROM project_members pm JOIN users u ON u.id = pm.user_id
		 WHERE pm.project_id = ?
		 ORDER BY (pm.role = 'owner') DESC, u.username`, projectID)
	if err != nil {
		return []memberJSON{}
	}
	defer rows.Close()
	out := []memberJSON{}
	for rows.Next() {
		var m memberJSON
		var color sql.NullString
		if err := rows.Scan(&m.ID, &m.Username, &color, &m.Role); err != nil {
			return nil
		}
		m.Color = nstr(color)
		out = append(out, m)
	}
	return out
}

// validUserIds returns the set of ids that exist in users.
func validUserIds(q querier, ids []string) map[string]bool {
	out := map[string]bool{}
	seen := map[string]bool{}
	var unique []string
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	if len(unique) == 0 {
		return out
	}
	ph := strings.Repeat("?,", len(unique))
	ph = ph[:len(ph)-1]
	args := make([]any, len(unique))
	for i, id := range unique {
		args[i] = id
	}
	rows, err := q.Query("SELECT id FROM users WHERE id IN ("+ph+")", args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			out[id] = true
		}
	}
	return out
}

func countAdmins(q querier) int {
	var n int
	if err := q.QueryRow("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").Scan(&n); err != nil {
		return 0
	}
	return n
}

// --- events ---------------------------------------------------------------------

func addEvent(q querier, taskID, userID, typ string, data map[string]any) {
	b, _ := json.Marshal(data)
	_, _ = q.Exec(
		"INSERT INTO activity_events (id, task_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		ids.New(), taskID, userID, typ, string(b), nowMs())
}

func auditLog(q querier, actorID, action, targetType string, targetID any, data map[string]any) {
	b, _ := json.Marshal(data)
	_, _ = q.Exec(
		"INSERT INTO admin_audit (id, actor_id, action, target_type, target_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		ids.New(), actorID, action, targetType, targetID, string(b), nowMs())
}

func nowMs() int64 {
	return time.Now().UnixMilli()
}

// --- task labels ----------------------------------------------------------------

func replaceTaskLabels(q querier, taskID string, labelIDs []string) {
	_, _ = q.Exec("DELETE FROM task_labels WHERE task_id = ?", taskID)
	for _, lid := range labelIDs {
		_, _ = q.Exec("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)", taskID, lid)
	}
}

func getTaskLabelIds(q querier, taskID string) []string {
	rows, err := q.Query("SELECT label_id FROM task_labels WHERE task_id = ?", taskID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			out = append(out, id)
		}
	}
	return out
}

func copySubtasksWithReset(q querier, fromTaskID, toTaskID string) {
	rows, err := q.Query("SELECT id, parent_id, title, position FROM task_subtasks WHERE task_id = ? ORDER BY position", fromTaskID)
	if err != nil {
		return
	}
	type sub struct {
		id, parentID, title string
		position            int64
	}
	var subs []sub
	for rows.Next() {
		var s sub
		var parentID sql.NullString
		if err := rows.Scan(&s.id, &parentID, &s.title, &s.position); err != nil {
			rows.Close()
			return
		}
		if parentID.Valid {
			s.parentID = parentID.String
		}
		subs = append(subs, s)
	}
	rows.Close()
	if len(subs) == 0 {
		return
	}
	idMap := map[string]string{}
	for _, s := range subs {
		newID := ids.New()
		idMap[s.id] = newID
		parent := any(nil)
		if s.parentID != "" {
			if mapped, ok := idMap[s.parentID]; ok {
				parent = mapped
			}
		}
		_, _ = q.Exec(
			"INSERT INTO task_subtasks (id, task_id, parent_id, title, done, position, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
			newID, toTaskID, parent, s.title, s.position, nowMs())
	}
}

func removeAttachmentFiles(q querier, uploadsDir, taskID string) {
	rows, err := q.Query("SELECT stored_name FROM attachments WHERE task_id = ?", taskID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var stored string
		if rows.Scan(&stored) == nil {
			_ = os.Remove(filepath.Join(uploadsDir, filepath.Base(stored)))
		}
	}
}

// --- task lookup + hydration ------------------------------------------------------

// getTask loads a non-deleted task by id (nil when missing).
func getTask(q querier, id string) (*taskRow, error) {
	row := q.QueryRow("SELECT "+taskCols+" FROM tasks WHERE id = ? AND deleted_at IS NULL", id)
	t, err := scanTask(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return t, err
}

// hydrateTasks returns the public task shape with labels, assignee and counts.
func hydrateTasks(q querier, whereSQL string, params ...any) []taskJSON {
	filter := "t.deleted_at IS NULL"
	if whereSQL != "" {
		filter = "t.deleted_at IS NULL AND (" + whereSQL + ")"
	}
	query := `SELECT t.id, t.project_id, t.short_id, t.title, t.description, t."column", t.position,
		t.priority, t.due_date, t.assignee_id, t.created_by, t.created_at, t.updated_at,
		t.recurrence, t.recurrence_group_id, t.done_at, t.archived_at, t.recurrence_paused,
		u.username AS assignee_username, u.color AS assignee_color,
		(SELECT COUNT(*) FROM comments cm WHERE cm.task_id = t.id) AS comments_count,
		(SELECT COUNT(*) FROM attachments at WHERE at.task_id = t.id) AS attachments_count,
		(SELECT COUNT(*) FROM activity_events sl
			WHERE sl.task_id = t.id AND sl.type = 'due'
				AND COALESCE(json_extract(sl.data, '$.reset'), 0) != 1
				AND sl.created_at > COALESCE(
					(SELECT MAX(e.created_at) FROM activity_events e
						WHERE e.task_id = t.id AND (
							(e.type = 'moved' AND json_extract(e.data, '$.to') = 'hecho') OR
							(e.type = 'due' AND COALESCE(json_extract(e.data, '$.reset'), 0) = 1)
						)),
					t.created_at
				)
		) AS slips_count
	FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
	WHERE ` + filter + `
	ORDER BY t."column", t.position`

	type scanned struct {
		taskRow
		assigneeUsername sql.NullString
		assigneeColor    sql.NullString
		commentsCount    int
		attachmentsCount int
		slipsCount       int
	}
	rows, err := q.Query(query, params...)
	if err != nil {
		return nil
	}
	var tasks []scanned
	for rows.Next() {
		var s scanned
		if err := rows.Scan(&s.ID, &s.ProjectID, &s.ShortID, &s.Title, &s.Description, &s.Column,
			&s.Position, &s.Priority, &s.DueDate, &s.AssigneeID, &s.CreatedBy, &s.CreatedAt,
			&s.UpdatedAt, &s.Recurrence, &s.RecurrenceGroupID, &s.DoneAt, &s.ArchivedAt,
			&s.RecurrencePaused, &s.assigneeUsername, &s.assigneeColor, &s.commentsCount,
			&s.attachmentsCount, &s.slipsCount); err != nil {
			rows.Close()
			return nil
		}
		tasks = append(tasks, s)
	}
	rows.Close()
	if len(tasks) == 0 {
		return []taskJSON{}
	}

	// labels in a single query (same as Node)
	lrows, err := q.Query(`SELECT tl.task_id, l.id, l.name, l.color FROM task_labels tl JOIN labels l ON l.id = tl.label_id`)
	if err != nil {
		return nil
	}
	byTask := map[string][]labelJSON{}
	for lrows.Next() {
		var taskID string
		var l labelJSON
		if err := lrows.Scan(&taskID, &l.ID, &l.Name, &l.Color); err != nil {
			lrows.Close()
			return nil
		}
		byTask[taskID] = append(byTask[taskID], l)
	}
	lrows.Close()

	out := make([]taskJSON, 0, len(tasks))
	for _, s := range tasks {
		var assignee *assigneeJSON
		if s.AssigneeID.Valid {
			assignee = &assigneeJSON{ID: s.AssigneeID.String, Username: s.assigneeUsername.String, Color: nstr(s.assigneeColor)}
		}
		labels := byTask[s.ID]
		if labels == nil {
			labels = []labelJSON{}
		}
		out = append(out, taskJSON{
			ID:                s.ID,
			ProjectID:         s.ProjectID,
			ShortID:           nstr(s.ShortID),
			Title:             s.Title,
			Description:       s.Description,
			Column:            s.Column,
			Position:          s.Position,
			Priority:          nstr(s.Priority),
			DueDate:           nstr(s.DueDate),
			Recurrence:        parseRec(s.Recurrence),
			RecurrenceGroupID: nstr(s.RecurrenceGroupID),
			RecurrencePaused:  s.RecurrencePaused != 0,
			AssigneeID:        nstr(s.AssigneeID),
			Assignee:          assignee,
			CreatedBy:         nstr(s.CreatedBy),
			CreatedAt:         s.CreatedAt,
			UpdatedAt:         s.UpdatedAt,
			DoneAt:            nint(s.DoneAt),
			ArchivedAt:        nint(s.ArchivedAt),
			Labels:            labels,
			Counts:            taskCounts{Comments: s.commentsCount, Attachments: s.attachmentsCount},
			Slips:             s.slipsCount,
		})
	}
	return out
}

func parseRec(s sql.NullString) *recurrence.Recurrence {
	if !s.Valid {
		return nil
	}
	return recurrence.ParseRecurrence(s.String)
}

// createRecurringInstance creates the next instance of a recurrent task when it
// is completed. Returns the hydrated new task or nil.
func (s *Server) createRecurringInstance(d *db.DB, done *taskRow, actorID string) *taskJSON {
	if done.RecurrencePaused != 0 {
		return nil
	}
	rec := parseRec(done.Recurrence)
	if rec == nil {
		return nil
	}
	nextDue := recurrence.ComputeNextDue(d, recurrence.RecurrentTask{
		ID:                done.ID,
		DueDate:           nstr(done.DueDate),
		Recurrence:        nstr(done.Recurrence),
		RecurrenceGroupID: nstr(done.RecurrenceGroupID),
	}, recurrence.TodayLocal())
	if nextDue == nil {
		return nil
	}
	id := ids.New()
	now := nowMs()
	var pos int64
	_ = d.QueryRow(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE "column" = ?`, "nuevo").Scan(&pos)
	groupID := done.ID
	if done.RecurrenceGroupID.Valid {
		groupID = done.RecurrenceGroupID.String
	}
	tx, err := d.Begin()
	if err != nil {
		return nil
	}
	shortID, _ := d.AllocateShortId(tx, done.ProjectID)
	_, err = tx.Exec(
		`INSERT INTO tasks (id, project_id, title, description, "column", position, priority, due_date, assignee_id, created_by, created_at, updated_at, recurrence, recurrence_group_id, short_id)
		 VALUES (?, ?, ?, ?, 'nuevo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, done.ProjectID, done.Title, done.Description, pos,
		sqlStr(done.Priority), *nextDue, sqlStr(done.AssigneeID), sqlStr(done.CreatedBy), now, now,
		recurrence.SerializeRecurrence(rec), groupID, shortID)
	if err != nil {
		_ = tx.Rollback()
		return nil
	}
	replaceTaskLabels(tx, id, getTaskLabelIds(tx, done.ID))
	copySubtasksWithReset(tx, done.ID, id)
	addEvent(tx, id, actorID, "created", map[string]any{})
	if err := tx.Commit(); err != nil {
		return nil
	}
	list := hydrateTasks(d, "t.id = ?", id)
	if len(list) == 0 {
		return nil
	}
	return &list[0]
}

// queryMaps returns raw rows as []map[string]any (for export/trash, which echo
// SELECT * rows exactly like better-sqlite3).
func queryMaps(q querier, query string, args ...any) []map[string]any {
	rows, err := q.Query(query, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil
	}
	var out []map[string]any
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil
		}
		m := make(map[string]any, len(cols))
		for i, c := range cols {
			m[c] = normalizeValue(vals[i])
		}
		out = append(out, m)
	}
	return out
}

func normalizeValue(v any) any {
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return v
}

// projectRowJSON is the raw projects row echoed by POST/PATCH /api/projects.
type projectRowJSON struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Emoji     *string `json:"emoji"`
	Color     *string `json:"color"`
	Position  int64   `json:"position"`
	OwnerID   *string `json:"owner_id"`
	IsInbox   int64   `json:"is_inbox"`
	CreatedAt int64   `json:"created_at"`
	TaskSeq   int64   `json:"task_seq"`
}

// projectWithMembersJSON adds the members list to the raw row (POST project).
type projectWithMembersJSON struct {
	projectRowJSON
	Members []memberJSON `json:"members"`
}

func (p *projectRow) toJSON() projectRowJSON {
	return projectRowJSON{
		ID:        p.ID,
		Name:      p.Name,
		Emoji:     nstr(p.Emoji),
		Color:     nstr(p.Color),
		Position:  p.Position,
		OwnerID:   nstr(p.OwnerID),
		IsInbox:   p.IsInbox,
		CreatedAt: p.CreatedAt,
		TaskSeq:   p.TaskSeq,
	}
}
