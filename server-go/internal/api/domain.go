package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/errors"
	"github.com/gnacho/deltos/server-go/internal/ids"
	"github.com/gnacho/deltos/server-go/internal/keyset"
	"golang.org/x/crypto/bcrypt"
)

// registerDomainRoutes ports the domain routes of server/src/routes-domain.ts
// (bootstrap, projects, labels, users, settings, audit, search, activity,
// export, trash). Tasks live in tasks.go.
func (s *Server) registerDomainRoutes(r *rtr) {
	r.Get("/api/bootstrap", s.handleBootstrap)
	r.Post("/api/projects", s.handleProjectCreate)
	r.Patch("/api/projects/:id", s.handleProjectPatch)
	r.Delete("/api/projects/:id", s.handleProjectDelete)
	r.Put("/api/projects/:id/members", s.handleProjectMembers)

	r.Post("/api/labels", s.handleLabelCreate)
	r.Patch("/api/labels/:id", s.handleLabelPatch)
	r.Delete("/api/labels/:id", s.handleLabelDelete)

	r.Get("/api/users", s.handleUsersList)
	r.Post("/api/users", s.handleUserCreate)
	r.Put("/api/users/:id/role", s.handleUserRole)
	r.Put("/api/users/:id/password", s.handleUserPassword)
	r.Put("/api/users/:id/language", s.handleUserLanguage)
	r.Delete("/api/users/:id", s.handleUserDelete)

	r.Get("/api/settings/demo", s.handleSettingsDemoGet)
	r.Put("/api/settings/demo", s.handleSettingsDemoPut)
	r.Get("/api/settings/server", s.handleSettingsServerGet)
	r.Put("/api/settings/server", s.handleSettingsServerPut)

	r.Get("/api/admin/audit", s.handleAdminAudit)
	r.Get("/api/search", s.handleSearch)
	r.Get("/api/activity", s.handleActivity)
	r.Get("/api/export", s.handleExport)
	r.Get("/api/trash", s.handleTrashList)
	r.Post("/api/trash/:id/restore", s.handleTrashRestore)
	r.Delete("/api/trash/:id", s.handleTrashDelete)
	r.Delete("/api/trash", s.handleTrashEmpty)
	r.Post("/api/trash/expense/:id/restore", s.handleExpenseTrashRestore)
	r.Delete("/api/trash/expense/:id", s.handleExpenseTrashDelete)
	r.Delete("/api/trash/expenses", s.handleExpenseTrashEmpty)
}

// --- validation helpers -------------------------------------------------------

var colorRe = regexp.MustCompile(`^[a-z]{2,20}$`)
var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func validColor(s string) bool { return colorRe.MatchString(s) }
func validDate(s string) bool  { return dateRe.MatchString(s) }

func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	u := auth.UserFrom(r)
	if u == nil || u.Role != "admin" {
		errors.Write(w, errors.New(http.StatusForbidden, errors.AuthForbidden))
		return false
	}
	return true
}

func internalErr(w http.ResponseWriter) {
	errors.Write(w, errors.New(http.StatusInternalServerError, errors.InternalError))
}

// kvNil returns a kv value or nil when the key is absent (for nullable settings).
func (s *Server) kvNil(key string) *string {
	var v sql.NullString
	if err := s.Prod.QueryRow("SELECT value FROM kv WHERE key = ?", key).Scan(&v); err != nil || !v.Valid {
		return nil
	}
	return &v.String
}

func kvIntOf(v *string, def int) int {
	if v == nil {
		return def
	}
	n, err := strconv.Atoi(*v)
	if err != nil {
		return def
	}
	return n
}

// --- bootstrap ----------------------------------------------------------------

type bootstrapProject struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Emoji    *string      `json:"emoji"`
	Color    *string      `json:"color"`
	Position int64        `json:"position"`
	OwnerID  *string      `json:"owner_id"`
	IsInbox  bool         `json:"is_inbox"`
	Counts   projCounts   `json:"counts"`
	Members  []memberJSON `json:"members"`
}

type projCounts struct {
	Nuevo   int `json:"nuevo"`
	Encurso int `json:"encurso"`
	Hecho   int `json:"hecho"`
}

func (s *Server) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)

	urows, err := d.Query("SELECT id, username, color FROM users ORDER BY username")
	if err != nil {
		internalErr(w)
		return
	}
	users := []userBasic{}
	for urows.Next() {
		var u userBasic
		var color sql.NullString
		if err := urows.Scan(&u.ID, &u.Username, &color); err != nil {
			urows.Close()
			internalErr(w)
			return
		}
		u.Color = nstr(color)
		users = append(users, u)
	}
	urows.Close()

	prows, err := d.Query(
		`SELECT p.id, p.name, p.emoji, p.color, p.position, p.owner_id, p.is_inbox,
		        COALESCE(SUM(CASE WHEN t."column" = 'nuevo' THEN 1 ELSE 0 END), 0) AS nuevo,
		        COALESCE(SUM(CASE WHEN t."column" = 'encurso' THEN 1 ELSE 0 END), 0) AS encurso,
		        COALESCE(SUM(CASE WHEN t."column" = 'hecho' THEN 1 ELSE 0 END), 0) AS hecho
		 FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL AND t.archived_at IS NULL
		 WHERE p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
		 GROUP BY p.id ORDER BY p.position`, user.ID)
	if err != nil {
		internalErr(w)
		return
	}
	type projRow struct {
		id, name              string
		emoji, color, ownerID sql.NullString
		position, isInbox     int64
		nuevo, encurso, hecho int
	}
	var projects []projRow
	for prows.Next() {
		var p projRow
		if err := prows.Scan(&p.id, &p.name, &p.emoji, &p.color, &p.position, &p.ownerID, &p.isInbox,
			&p.nuevo, &p.encurso, &p.hecho); err != nil {
			prows.Close()
			internalErr(w)
			return
		}
		projects = append(projects, p)
	}
	prows.Close()

	shaped := make([]bootstrapProject, 0, len(projects))
	var ids []string
	for _, p := range projects {
		ids = append(ids, p.id)
		shaped = append(shaped, bootstrapProject{
			ID: p.id, Name: p.name, Emoji: nstr(p.emoji), Color: nstr(p.color),
			Position: p.position, OwnerID: nstr(p.ownerID), IsInbox: p.isInbox == 1,
			Counts:  projCounts{Nuevo: p.nuevo, Encurso: p.encurso, Hecho: p.hecho},
			Members: []memberJSON{},
		})
	}
	// hydrate members of visible projects in one query
	if len(ids) > 0 {
		ph := strings.Repeat("?,", len(ids))
		ph = ph[:len(ph)-1]
		args := make([]any, len(ids))
		for i, id := range ids {
			args[i] = id
		}
		mrows, err := d.Query(
			`SELECT pm.project_id, u.id, u.username, u.color, pm.role
			 FROM project_members pm JOIN users u ON u.id = pm.user_id
			 WHERE pm.project_id IN (`+ph+`)
			 ORDER BY (pm.role = 'owner') DESC, u.username`, args...)
		if err != nil {
			internalErr(w)
			return
		}
		byProject := map[string][]memberJSON{}
		for mrows.Next() {
			var pid string
			var m memberJSON
			var color sql.NullString
			if err := mrows.Scan(&pid, &m.ID, &m.Username, &color, &m.Role); err != nil {
				mrows.Close()
				internalErr(w)
				return
			}
			m.Color = nstr(color)
			byProject[pid] = append(byProject[pid], m)
		}
		mrows.Close()
		for i := range shaped {
			if m, ok := byProject[shaped[i].ID]; ok {
				shaped[i].Members = m
			}
		}
	}

	lrows, err := d.Query("SELECT id, name, color FROM labels ORDER BY name")
	if err != nil {
		internalErr(w)
		return
	}
	labels := []labelJSON{}
	for lrows.Next() {
		var l labelJSON
		if err := lrows.Scan(&l.ID, &l.Name, &l.Color); err != nil {
			lrows.Close()
			internalErr(w)
			return
		}
		labels = append(labels, l)
	}
	lrows.Close()

	tasks := hydrateTasks(d, "t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)", user.ID)

	writeJSON(w, http.StatusOK, map[string]any{
		"users": users, "projects": shaped, "labels": labels, "tasks": tasks,
	})
}

// --- projects -----------------------------------------------------------------

type projectCreateBody struct {
	Name      string   `json:"name"`
	Emoji     string   `json:"emoji"`
	Color     string   `json:"color"`
	MemberIDs []string `json:"member_ids"`
}

func (s *Server) handleProjectCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	var body projectCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if body.Emoji == "" {
		body.Emoji = ""
	}
	if body.Color == "" {
		body.Color = "sky"
	}
	var issues []issue
	if len(body.Name) < 1 || len(body.Name) > 80 {
		issues = append(issues, issue{Path: []string{"name"}, Message: "name must be 1-80 characters"})
	}
	if len(body.Emoji) > 40 {
		issues = append(issues, issue{Path: []string{"emoji"}, Message: "emoji too long"})
	}
	if !validColor(body.Color) {
		issues = append(issues, issue{Path: []string{"color"}, Message: "invalid color"})
	}
	if len(body.MemberIDs) > 50 {
		issues = append(issues, issue{Path: []string{"member_ids"}, Message: "too many members"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}

	id := ids.New()
	var pos int64
	_ = d.QueryRow("SELECT COALESCE(MAX(position) + 1, 0) AS p FROM projects").Scan(&pos)
	now := nowMs()
	validIds := validUserIds(d, filterOut(body.MemberIDs, user.ID))

	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("INSERT INTO projects (id, name, emoji, color, position, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		id, body.Name, body.Emoji, body.Color, pos, user.ID, now); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec("INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)",
		id, user.ID, "owner", now); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	for _, mid := range validIds {
		if _, err := tx.Exec("INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)",
			id, mid, "member", now); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("projects")

	p, err := getProject(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	w.Header().Set("Location", "/api/projects/"+id)
	writeJSON(w, http.StatusCreated, map[string]any{
		"project": projectWithMembersJSON{projectRowJSON: p.toJSON(), Members: memberList(d, id)},
	})
}

func getProject(q querier, id string) (*projectRow, error) {
	row := q.QueryRow("SELECT "+projectCols+" FROM projects WHERE id = ?", id)
	p, err := scanProject(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return p, err
}

func filterOut(ids []string, exclude string) []string {
	var out []string
	for _, id := range ids {
		if id != exclude {
			out = append(out, id)
		}
	}
	return out
}

type projectPatchBody struct {
	Name  *string `json:"name"`
	Emoji *string `json:"emoji"`
	Color *string `json:"color"`
}

func (s *Server) handleProjectPatch(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	p, err := getProject(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if p == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ProjectNotFound))
		return
	}
	if p.IsInbox == 1 {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectInbox))
		return
	}
	if !canManageProject(d, user, p.OwnerID, p.ID) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotOwner))
		return
	}
	var body projectPatchBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	var issues []issue
	if body.Name != nil && (len(*body.Name) < 1 || len(*body.Name) > 80) {
		issues = append(issues, issue{Path: []string{"name"}, Message: "name must be 1-80 characters"})
	}
	if body.Emoji != nil && len(*body.Emoji) > 40 {
		issues = append(issues, issue{Path: []string{"emoji"}, Message: "emoji too long"})
	}
	if body.Color != nil && !validColor(*body.Color) {
		issues = append(issues, issue{Path: []string{"color"}, Message: "invalid color"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}

	name := p.Name
	if body.Name != nil {
		name = *body.Name
	}
	emoji := nstr(p.Emoji)
	if body.Emoji != nil {
		emoji = body.Emoji
	}
	color := nstr(p.Color)
	if body.Color != nil {
		color = body.Color
	}
	if _, err := d.Exec("UPDATE projects SET name = ?, emoji = ?, color = ? WHERE id = ?",
		name, emoji, color, p.ID); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("projects")
	updated, err := getProject(d, p.ID)
	if err != nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": updated.toJSON()})
}

func (s *Server) handleProjectDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	p, err := getProject(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if p == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ProjectNotFound))
		return
	}
	if p.IsInbox == 1 {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectInbox))
		return
	}
	if !canManageProject(d, user, p.OwnerID, p.ID) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotOwner))
		return
	}
	// remove attachment files of the project's tasks (best effort)
	trows, _ := d.Query("SELECT id FROM tasks WHERE project_id = ?", p.ID)
	var taskIDs []string
	for trows.Next() {
		var tid string
		if trows.Scan(&tid) == nil {
			taskIDs = append(taskIDs, tid)
		}
	}
	trows.Close()
	for _, tid := range taskIDs {
		removeAttachmentFiles(d, s.UploadsDir, tid)
	}
	if _, err := d.Exec("DELETE FROM projects WHERE id = ?", p.ID); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("projects")
	s.Hub.Broadcast("tasks")
	w.WriteHeader(http.StatusNoContent)
}

type membersBody struct {
	MemberIDs []string `json:"member_ids"`
}

func (s *Server) handleProjectMembers(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	p, err := getProject(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if p == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ProjectNotFound))
		return
	}
	if p.IsInbox == 1 {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectInbox))
		return
	}
	if !canManageProject(d, user, p.OwnerID, p.ID) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotOwner))
		return
	}
	var body membersBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if len(body.MemberIDs) > 50 {
		validationFailed(w, []issue{{Path: []string{"member_ids"}, Message: "too many members"}})
		return
	}
	validIds := validUserIds(d, body.MemberIDs)
	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("DELETE FROM project_members WHERE project_id = ? AND role = 'member'", p.ID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	for mid := range validIds {
		if !p.OwnerID.Valid || mid != p.OwnerID.String {
			if _, err := tx.Exec("INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)",
				p.ID, mid, "member", now); err != nil {
				_ = tx.Rollback()
				internalErr(w)
				return
			}
		}
	}
	role := "member"
	if p.OwnerID.Valid && p.OwnerID.String == user.ID {
		role = "owner"
	}
	if _, err := tx.Exec("INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)",
		p.ID, user.ID, role, now); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("projects")
	writeJSON(w, http.StatusOK, map[string]any{"members": memberList(d, p.ID)})
}

// --- labels -------------------------------------------------------------------

type labelBody struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func (s *Server) handleLabelCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	var body labelBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if body.Color == "" {
		body.Color = "slate"
	}
	var issues []issue
	if len(body.Name) < 1 || len(body.Name) > 40 {
		issues = append(issues, issue{Path: []string{"name"}, Message: "name must be 1-40 characters"})
	}
	if !validColor(body.Color) {
		issues = append(issues, issue{Path: []string{"color"}, Message: "invalid color"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}
	var existing string
	if err := d.QueryRow("SELECT id FROM labels WHERE name = ?", body.Name).Scan(&existing); err == nil {
		errors.Write(w, errors.New(http.StatusConflict, errors.LabelNameTaken))
		return
	}
	id := ids.New()
	if _, err := d.Exec("INSERT INTO labels (id, name, color) VALUES (?, ?, ?)", id, body.Name, body.Color); err != nil {
		errors.Write(w, errors.New(http.StatusConflict, errors.LabelNameTaken))
		return
	}
	s.Hub.Broadcast("labels")
	w.Header().Set("Location", "/api/labels/"+id)
	writeJSON(w, http.StatusCreated, map[string]any{"label": labelJSON{ID: id, Name: body.Name, Color: body.Color}})
}

type labelPatchBody struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
}

func (s *Server) handleLabelPatch(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	id := param(r, "id")
	var label labelJSON
	if err := d.QueryRow("SELECT id, name, color FROM labels WHERE id = ?", id).Scan(&label.ID, &label.Name, &label.Color); err != nil {
		if err == sql.ErrNoRows {
			errors.Write(w, errors.New(http.StatusNotFound, errors.LabelNotFound))
		} else {
			internalErr(w)
		}
		return
	}
	var body labelPatchBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	var issues []issue
	if body.Name != nil && (len(*body.Name) < 1 || len(*body.Name) > 40) {
		issues = append(issues, issue{Path: []string{"name"}, Message: "name must be 1-40 characters"})
	}
	if body.Color != nil && !validColor(*body.Color) {
		issues = append(issues, issue{Path: []string{"color"}, Message: "invalid color"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}
	name := label.Name
	if body.Name != nil {
		name = *body.Name
	}
	color := label.Color
	if body.Color != nil {
		color = *body.Color
	}
	if _, err := d.Exec("UPDATE labels SET name = ?, color = ? WHERE id = ?", name, color, id); err != nil {
		errors.Write(w, errors.New(http.StatusConflict, errors.LabelNameTaken))
		return
	}
	s.Hub.Broadcast("labels")
	var updated labelJSON
	_ = d.QueryRow("SELECT id, name, color FROM labels WHERE id = ?", id).Scan(&updated.ID, &updated.Name, &updated.Color)
	writeJSON(w, http.StatusOK, map[string]any{"label": updated})
}

func (s *Server) handleLabelDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	res, err := d.Exec("DELETE FROM labels WHERE id = ?", param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		errors.Write(w, errors.New(http.StatusNotFound, errors.LabelNotFound))
		return
	}
	s.Hub.Broadcast("labels")
	s.Hub.Broadcast("tasks")
	w.WriteHeader(http.StatusNoContent)
}

// --- users --------------------------------------------------------------------

func (s *Server) handleUsersList(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	d := auth.DBFrom(r)
	rows, err := d.Query("SELECT id, username, email, phone, color, language, role, created_at FROM users ORDER BY username")
	if err != nil {
		internalErr(w)
		return
	}
	defer rows.Close()
	users := []userAdmin{}
	for rows.Next() {
		var u userAdmin
		var email, phone, color, language sql.NullString
		if err := rows.Scan(&u.ID, &u.Username, &email, &phone, &color, &language, &u.Role, &u.CreatedAt); err != nil {
			internalErr(w)
			return
		}
		u.Email = nstr(email)
		u.Phone = nstr(phone)
		u.Color = nstr(color)
		u.Language = nstr(language)
		users = append(users, u)
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

type userCreateBody struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Color    string `json:"color"`
	Role     string `json:"role"`
}

func (s *Server) handleUserCreate(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	d := auth.DBFrom(r)
	me := auth.UserFrom(r)
	var body userCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if body.Color == "" {
		body.Color = "slate"
	}
	if body.Role == "" {
		body.Role = "user"
	}
	var issues []issue
	if len(body.Username) < 1 || len(body.Username) > 50 {
		issues = append(issues, issue{Path: []string{"username"}, Message: "username must be 1-50 characters"})
	}
	if len(body.Password) < 10 || len(body.Password) > 100 {
		issues = append(issues, issue{Path: []string{"password"}, Message: "la contraseña inicial debe tener al menos 10 caracteres"})
	}
	if !validColor(body.Color) {
		issues = append(issues, issue{Path: []string{"color"}, Message: "invalid color"})
	}
	if body.Role != "admin" && body.Role != "user" {
		issues = append(issues, issue{Path: []string{"role"}, Message: "invalid role"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}
	var existing string
	if err := d.QueryRow("SELECT id FROM users WHERE username = ?", body.Username).Scan(&existing); err == nil {
		errors.Write(w, errors.New(http.StatusConflict, errors.UserAlreadyExists))
		return
	}
	created, err := auth.RegisterUser(d, body.Username, body.Password, body.Color, "auto", body.Role)
	if err != nil {
		internalErr(w)
		return
	}
	if created == nil {
		errors.Write(w, errors.New(http.StatusConflict, errors.UserAlreadyExists))
		return
	}
	_ = d.EnsureUserInInbox(created.ID)
	s.Hub.Broadcast("users")
	auditLog(d, me.ID, "user_created", "user", created.ID, map[string]any{"username": body.Username, "role": body.Role})
	w.Header().Set("Location", "/api/users/"+created.ID)
	writeJSON(w, http.StatusCreated, map[string]any{"user": userAdminOf(d, created.ID)})
}

// userAdminOf loads the GET /api/users shape of one user.
func userAdminOf(q querier, id string) *userAdmin {
	var u userAdmin
	var email, phone, color, language sql.NullString
	err := q.QueryRow("SELECT id, username, email, phone, color, language, role, created_at FROM users WHERE id = ?", id).
		Scan(&u.ID, &u.Username, &email, &phone, &color, &language, &u.Role, &u.CreatedAt)
	if err != nil {
		return nil
	}
	u.Email = nstr(email)
	u.Phone = nstr(phone)
	u.Color = nstr(color)
	u.Language = nstr(language)
	return &u
}

func userColsOf(q querier, id string) *userColsJSON {
	var u userColsJSON
	var displayName, email, phone, color, language sql.NullString
	err := q.QueryRow("SELECT id, username, display_name, email, phone, color, language, role, created_at FROM users WHERE id = ?", id).
		Scan(&u.ID, &u.Username, &displayName, &email, &phone, &color, &language, &u.Role, &u.CreatedAt)
	if err != nil {
		return nil
	}
	u.DisplayName = nstr(displayName)
	u.Email = nstr(email)
	u.Phone = nstr(phone)
	u.Color = nstr(color)
	u.Language = nstr(language)
	return &u
}

type userRoleBody struct {
	Role string `json:"role"`
}

func (s *Server) handleUserRole(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	d := auth.DBFrom(r)
	me := auth.UserFrom(r)
	id := param(r, "id")
	if id == me.ID {
		errors.Write(w, errors.New(http.StatusBadRequest, errors.UserSelfRole))
		return
	}
	var body userRoleBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if body.Role != "admin" && body.Role != "user" {
		validationFailed(w, []issue{{Path: []string{"role"}, Message: "invalid role"}})
		return
	}
	var curRole string
	err := d.QueryRow("SELECT role FROM users WHERE id = ?", id).Scan(&curRole)
	if err == sql.ErrNoRows {
		errors.Write(w, errors.New(http.StatusNotFound, errors.UserNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	if curRole == "admin" && body.Role == "user" && countAdmins(d) <= 1 {
		errors.Write(w, errors.New(http.StatusBadRequest, errors.UserLastAdmin))
		return
	}
	if _, err := d.Exec("UPDATE users SET role = ? WHERE id = ?", body.Role, id); err != nil {
		internalErr(w)
		return
	}
	auditLog(d, me.ID, "user_role_changed", "user", id, map[string]any{"from": curRole, "to": body.Role})
	s.Hub.Broadcast("users")
	writeJSON(w, http.StatusOK, map[string]any{"user": userColsOf(d, id)})
}

type userPasswordBody struct {
	Password string `json:"password"`
}

func (s *Server) handleUserPassword(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	d := auth.DBFrom(r)
	me := auth.UserFrom(r)
	id := param(r, "id")
	var body userPasswordBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if len(body.Password) < 10 || len(body.Password) > 100 {
		validationFailed(w, []issue{{Path: []string{"password"}, Message: "la contraseña debe tener al menos 10 caracteres"}})
		return
	}
	var exists string
	err := d.QueryRow("SELECT id FROM users WHERE id = ?", id).Scan(&exists)
	if err == sql.ErrNoRows {
		errors.Write(w, errors.New(http.StatusNotFound, errors.UserNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	hash, err := hashPassword(body.Password)
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := d.Exec("UPDATE users SET password_hash = ? WHERE id = ?", hash, id); err != nil {
		internalErr(w)
		return
	}
	if _, err := d.Exec("DELETE FROM sessions WHERE user_id = ?", id); err != nil {
		internalErr(w)
		return
	}
	auditLog(d, me.ID, "user_password_reset", "user", id, map[string]any{})
	s.Hub.Broadcast("users")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type userLanguageBody struct {
	Language string `json:"language"`
}

func (s *Server) handleUserLanguage(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	d := auth.DBFrom(r)
	me := auth.UserFrom(r)
	id := param(r, "id")
	var body userLanguageBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if body.Language != "auto" && body.Language != "es" && body.Language != "en" {
		validationFailed(w, []issue{{Path: []string{"language"}, Message: "invalid language"}})
		return
	}
	var exists string
	err := d.QueryRow("SELECT id FROM users WHERE id = ?", id).Scan(&exists)
	if err == sql.ErrNoRows {
		errors.Write(w, errors.New(http.StatusNotFound, errors.UserNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := d.Exec("UPDATE users SET language = ? WHERE id = ?", body.Language, id); err != nil {
		internalErr(w)
		return
	}
	auditLog(d, me.ID, "user_language_changed", "user", id, map[string]any{"to": body.Language})
	s.Hub.Broadcast("users")
	writeJSON(w, http.StatusOK, map[string]any{"user": userColsOf(d, id)})
}

func (s *Server) handleUserDelete(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	d := auth.DBFrom(r)
	me := auth.UserFrom(r)
	id := param(r, "id")
	if id == me.ID {
		errors.Write(w, errors.New(http.StatusBadRequest, errors.UserSelfDelete))
		return
	}
	var username, role string
	err := d.QueryRow("SELECT username, role FROM users WHERE id = ?", id).Scan(&username, &role)
	if err == sql.ErrNoRows {
		errors.Write(w, errors.New(http.StatusNotFound, errors.UserNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	if role == "admin" && countAdmins(d) <= 1 {
		errors.Write(w, errors.New(http.StatusBadRequest, errors.UserLastAdmin))
		return
	}
	if _, err := d.Exec("DELETE FROM sessions WHERE user_id = ?", id); err != nil {
		internalErr(w)
		return
	}
	auditLog(d, me.ID, "user_deleted", "user", id, map[string]any{"username": username})
	if _, err := d.Exec("DELETE FROM users WHERE id = ?", id); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("users")
	w.WriteHeader(http.StatusNoContent)
}

// --- settings -----------------------------------------------------------------

func (s *Server) handleSettingsDemoGet(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"demo_enabled": s.Prod.KVGet("demo_enabled", "1") == "1"})
}

type demoToggleBody struct {
	Enabled bool `json:"enabled"`
}

func (s *Server) handleSettingsDemoPut(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	if auth.DemoFrom(r) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.SettingsProdOnly))
		return
	}
	var body demoToggleBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	v := "0"
	if body.Enabled {
		v = "1"
	}
	if err := s.Prod.KVSet("demo_enabled", v); err != nil {
		internalErr(w)
		return
	}
	auditLog(s.Prod, auth.UserFrom(r).ID, "demo_toggled", "setting", "demo_enabled", map[string]any{"enabled": body.Enabled})
	s.Hub.Broadcast("settings")
	writeJSON(w, http.StatusOK, map[string]any{"demo_enabled": body.Enabled})
}

func (s *Server) handleSettingsServerGet(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"backup_enabled":           s.Prod.KVGet("backup_enabled", "1") == "1",
		"backup_retention_days":    kvIntOf(s.kvNil("backup_retention_days"), 3),
		"max_attachments_per_task": kvIntOf(s.kvNil("max_attachments_per_task"), 50),
		"backup_last_run":          s.kvNil("backup_last_run"),
		"backup_path":              s.kvNil("backup_path"),
		"backup_timer_active":      isBackupTimerActive(),
		"plugin_expenses_enabled":  s.Prod.KVGet("plugin_expenses_enabled", "0") == "1",
		"archive_after_days":       kvIntOf(s.kvNil("archive_after_days"), 3),
	})
}

type serverSettingsBody struct {
	BackupEnabled       bool `json:"backup_enabled"`
	BackupRetentionDays int  `json:"backup_retention_days"`
	MaxAttachments      int  `json:"max_attachments_per_task"`
	PluginExpenses      bool `json:"plugin_expenses_enabled"`
	ArchiveAfterDays    int  `json:"archive_after_days"`
}

func (s *Server) handleSettingsServerPut(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	if auth.DemoFrom(r) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.SettingsProdOnly))
		return
	}
	var body serverSettingsBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	var issues []issue
	if body.BackupRetentionDays < 1 || body.BackupRetentionDays > 365 {
		issues = append(issues, issue{Path: []string{"backup_retention_days"}, Message: "must be 1-365"})
	}
	if body.MaxAttachments < 5 || body.MaxAttachments > 50 {
		issues = append(issues, issue{Path: []string{"max_attachments_per_task"}, Message: "must be 5-50"})
	}
	if body.ArchiveAfterDays < 1 || body.ArchiveAfterDays > 365 {
		issues = append(issues, issue{Path: []string{"archive_after_days"}, Message: "must be 1-365"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}
	_ = s.Prod.KVSet("backup_enabled", bool01(body.BackupEnabled))
	_ = s.Prod.KVSet("backup_retention_days", strconv.Itoa(body.BackupRetentionDays))
	_ = s.Prod.KVSet("max_attachments_per_task", strconv.Itoa(body.MaxAttachments))
	_ = s.Prod.KVSet("plugin_expenses_enabled", bool01(body.PluginExpenses))
	_ = s.Prod.KVSet("archive_after_days", strconv.Itoa(body.ArchiveAfterDays))
	auditLog(s.Prod, auth.UserFrom(r).ID, "server_settings_changed", "setting", "server", map[string]any{
		"backup_enabled": body.BackupEnabled, "backup_retention_days": body.BackupRetentionDays,
		"max_attachments_per_task": body.MaxAttachments, "plugin_expenses_enabled": body.PluginExpenses,
		"archive_after_days": body.ArchiveAfterDays,
	})
	s.Hub.Broadcast("settings")
	writeJSON(w, http.StatusOK, map[string]any{
		"backup_enabled": body.BackupEnabled, "backup_retention_days": body.BackupRetentionDays,
		"max_attachments_per_task": body.MaxAttachments, "plugin_expenses_enabled": body.PluginExpenses,
		"archive_after_days": body.ArchiveAfterDays,
	})
}

func bool01(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func isBackupTimerActive() bool {
	out, err := exec.Command("systemctl", "is-active", "deltos-backup.timer").Output()
	return err == nil && strings.TrimSpace(string(out)) == "active"
}

// --- audit / search / activity / export / trash ---------------------------------

func parseLimit(v string) int {
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 || n > 100 {
		return 30
	}
	return n
}

type activityRow struct {
	id, typ, taskID, taskTitle, projectID, projectName string
	data                                               sql.NullString
	createdAt                                          int64
	username, userColor                                sql.NullString
}

func (a activityRow) GetCreatedAt() int64 { return a.createdAt }
func (a activityRow) GetID() string       { return a.id }

func (a activityRow) json() map[string]any {
	return map[string]any{
		"id": a.id, "type": a.typ, "data": json.RawMessage(orEmpty(a.data)),
		"created_at": a.createdAt, "task_id": a.taskID, "task_title": a.taskTitle,
		"project_id": a.projectID, "project_name": a.projectName,
		"username": nstr(a.username), "user_color": nstr(a.userColor),
	}
}

func orEmpty(s sql.NullString) []byte {
	if !s.Valid {
		return []byte("{}")
	}
	return []byte(s.String)
}

func (s *Server) handleActivity(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	cursor := r.URL.Query().Get("cursor")
	limit := parseLimit(r.URL.Query().Get("limit"))

	var decoded *keyset.Cursor
	if cursor != "" {
		c, herr := keyset.DecodeCursor(cursor)
		if herr != nil {
			errors.Write(w, herr)
			return
		}
		decoded = &c
	}

	query := `SELECT e.id, e.type, e.data, e.created_at, e.task_id,
		t.title AS task_title, t.project_id, p.name AS project_name,
		u.username, u.color AS user_color
	 FROM activity_events e
	 JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
	 JOIN projects p ON p.id = t.project_id
	 JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
	 LEFT JOIN users u ON u.id = e.user_id`
	args := []any{user.ID}
	if decoded != nil {
		query += " WHERE (e.created_at < ? OR (e.created_at = ? AND e.id < ?))"
		args = append(args, decoded.TS, decoded.TS, decoded.ID)
	}
	query += " ORDER BY e.created_at DESC, e.id DESC LIMIT ?"
	args = append(args, limit+1)

	rows, err := d.Query(query, args...)
	if err != nil {
		internalErr(w)
		return
	}
	var all []activityRow
	for rows.Next() {
		var a activityRow
		if err := rows.Scan(&a.id, &a.typ, &a.data, &a.createdAt, &a.taskID, &a.taskTitle, &a.projectID, &a.projectName, &a.username, &a.userColor); err != nil {
			rows.Close()
			internalErr(w)
			return
		}
		all = append(all, a)
	}
	rows.Close()

	items, hasMore, next := keyset.Page(all, limit)
	out := make([]map[string]any, 0, len(items))
	for _, a := range items {
		out = append(out, a.json())
	}
	nextCursor := any(nil)
	if next != "" {
		nextCursor = next
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out, "nextCursor": nextCursor, "hasMore": hasMore})
}

type auditRow struct {
	id, actorID, action  string
	targetType, targetID sql.NullString
	data                 sql.NullString
	createdAt            int64
	actorUsername        sql.NullString
}

func (a auditRow) GetCreatedAt() int64 { return a.createdAt }
func (a auditRow) GetID() string       { return a.id }

func (s *Server) handleAdminAudit(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	d := auth.DBFrom(r)
	cursor := r.URL.Query().Get("cursor")
	limit := parseLimit(r.URL.Query().Get("limit"))

	var decoded *keyset.Cursor
	if cursor != "" {
		c, herr := keyset.DecodeCursor(cursor)
		if herr != nil {
			errors.Write(w, herr)
			return
		}
		decoded = &c
	}
	query := `SELECT a.id, a.actor_id, a.action, a.target_type, a.target_id, a.data, a.created_at, u.username AS actor_username
	 FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id`
	args := []any{}
	if decoded != nil {
		query += " WHERE (a.created_at < ? OR (a.created_at = ? AND a.id < ?))"
		args = append(args, decoded.TS, decoded.TS, decoded.ID)
	}
	query += " ORDER BY a.created_at DESC, a.id DESC LIMIT ?"
	args = append(args, limit+1)

	rows, err := d.Query(query, args...)
	if err != nil {
		internalErr(w)
		return
	}
	var all []auditRow
	for rows.Next() {
		var a auditRow
		if err := rows.Scan(&a.id, &a.actorID, &a.action, &a.targetType, &a.targetID, &a.data, &a.createdAt, &a.actorUsername); err != nil {
			rows.Close()
			internalErr(w)
			return
		}
		all = append(all, a)
	}
	rows.Close()

	items, hasMore, next := keyset.Page(all, limit)
	out := make([]map[string]any, 0, len(items))
	for _, a := range items {
		out = append(out, map[string]any{
			"id": a.id, "actor_id": a.actorID, "action": a.action,
			"target_type": nstr(a.targetType), "target_id": nstr(a.targetID),
			"data": json.RawMessage(orEmpty(a.data)), "created_at": a.createdAt,
			"actor_username": nstr(a.actorUsername),
		})
	}
	nextCursor := any(nil)
	if next != "" {
		nextCursor = next
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out, "nextCursor": nextCursor, "hasMore": hasMore})
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		writeJSON(w, http.StatusOK, map[string]any{"tasks": []taskJSON{}})
		return
	}
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
	like := "%" + escaped + "%"
	tasks := hydrateTasks(d,
		`t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
		 AND (
		   t.title LIKE ? ESCAPE '\'
		   OR t.description LIKE ? ESCAPE '\'
		   OR u.username LIKE ? ESCAPE '\'
		   OR EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.name LIKE ? ESCAPE '\')
		   OR EXISTS (SELECT 1 FROM task_labels tl JOIN labels l ON l.id = tl.label_id
		              WHERE tl.task_id = t.id AND l.name LIKE ? ESCAPE '\')
		 )`,
		user.ID, like, like, like, like, like)
	if len(tasks) > 50 {
		tasks = tasks[:50]
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)

	memberRows := queryMaps(d, "SELECT project_id FROM project_members WHERE user_id = ?", user.ID)
	var memberProjects []string
	for _, m := range memberRows {
		if pid, ok := m["project_id"].(string); ok {
			memberProjects = append(memberProjects, pid)
		}
	}
	qByProject := func(query string) []map[string]any {
		if len(memberProjects) == 0 {
			return []map[string]any{}
		}
		ph := strings.Repeat("?,", len(memberProjects))
		ph = ph[:len(ph)-1]
		args := make([]any, len(memberProjects))
		for i, p := range memberProjects {
			args[i] = p
		}
		return queryMaps(d, strings.Replace(query, "__IDS__", ph, 1), args...)
	}

	projects := qByProject("SELECT * FROM projects WHERE id IN (__IDS__) ORDER BY position")
	labels := queryMaps(d, "SELECT * FROM labels ORDER BY name")
	tasks := qByProject(`SELECT * FROM tasks WHERE deleted_at IS NULL AND project_id IN (__IDS__) ORDER BY "column", position`)
	var taskIDs []string
	for _, t := range tasks {
		if id, ok := t["id"].(string); ok {
			taskIDs = append(taskIDs, id)
		}
	}
	qByTask := func(query string) []map[string]any {
		if len(taskIDs) == 0 {
			return []map[string]any{}
		}
		ph := strings.Repeat("?,", len(taskIDs))
		ph = ph[:len(ph)-1]
		args := make([]any, len(taskIDs))
		for i, id := range taskIDs {
			args[i] = id
		}
		return queryMaps(d, strings.Replace(query, "__IDS__", ph, 1), args...)
	}
	comments := qByTask("SELECT * FROM comments WHERE task_id IN (__IDS__) ORDER BY created_at")
	attachments := qByTask("SELECT id, task_id, filename, size, mime, created_at FROM attachments WHERE task_id IN (__IDS__) ORDER BY created_at")
	events := qByTask("SELECT * FROM activity_events WHERE task_id IN (__IDS__) ORDER BY created_at")
	trash := qByProject("SELECT * FROM tasks WHERE deleted_at IS NOT NULL AND project_id IN (__IDS__) ORDER BY deleted_at DESC")
	expenses := queryMaps(d, `SELECT * FROM expenses WHERE deleted_at IS NULL ORDER BY step, position`)
	expenseTrash := queryMaps(d, "SELECT * FROM expenses WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")

	writeJSON(w, http.StatusOK, map[string]any{
		"exported_at": nowRFC3339(),
		"user":        map[string]any{"id": user.ID, "username": user.Username, "email": user.Email, "language": user.Language},
		"projects":    projects, "labels": labels, "tasks": tasks, "comments": comments,
		"attachments": attachments, "events": events, "trash": trash,
		"expenses": expenses, "expense_trash": expenseTrash,
	})
}

func nowRFC3339() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func hashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), 10)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (s *Server) handleTrashList(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	tasks := queryMaps(d,
		`SELECT t.*, p.name AS project_name
		 FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
		 WHERE t.deleted_at IS NOT NULL
		   AND t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
		 ORDER BY t.deleted_at DESC`, user.ID)
	expenses := queryMaps(d,
		`SELECT e.*, u.username AS created_by_username
		 FROM expenses e JOIN users u ON u.id = e.created_by
		 WHERE e.deleted_at IS NOT NULL
		 ORDER BY e.deleted_at DESC`)
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks, "expenses": expenses})
}

func (s *Server) handleTrashRestore(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	row := d.QueryRow("SELECT "+taskCols+" FROM tasks WHERE id = ? AND deleted_at IS NOT NULL", id)
	task, err := scanTask(row)
	if err == sql.ErrNoRows || task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	var pos int64
	_ = d.QueryRow(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE "column" = ? AND archived_at IS NULL AND deleted_at IS NULL`, task.Column).Scan(&pos)
	now := nowMs()
	if _, err := d.Exec(
		`UPDATE tasks SET deleted_at = NULL, position = ?, updated_at = ?, archived_at = NULL, done_at = CASE WHEN "column" = 'hecho' THEN ? ELSE NULL END WHERE id = ?`,
		pos, now, now, task.ID); err != nil {
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

func (s *Server) handleTrashDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	row := d.QueryRow("SELECT "+taskCols+" FROM tasks WHERE id = ? AND deleted_at IS NOT NULL", id)
	task, err := scanTask(row)
	if err == sql.ErrNoRows || task == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	if herr := requireMember(d, user.ID, task.ProjectID); herr != nil {
		errors.Write(w, herr)
		return
	}
	removeAttachmentFiles(d, s.UploadsDir, task.ID)
	if _, err := d.Exec("DELETE FROM tasks WHERE id = ?", task.ID); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("tasks")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleTrashEmpty(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	ids := queryMaps(d,
		`SELECT id FROM tasks WHERE deleted_at IS NOT NULL
		 AND project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)`, user.ID)
	for _, m := range ids {
		if tid, ok := m["id"].(string); ok {
			removeAttachmentFiles(d, s.UploadsDir, tid)
		}
	}
	if _, err := d.Exec(
		`DELETE FROM tasks WHERE deleted_at IS NOT NULL
		 AND project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)`, user.ID); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("tasks")
	w.WriteHeader(http.StatusNoContent)
}

// --- expense trash (mirrors routes-domain.ts trash handlers) -------------------

func (s *Server) handleExpenseTrashRestore(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	id := param(r, "id")
	var step string
	if err := d.QueryRow("SELECT step FROM expenses WHERE id = ? AND deleted_at IS NOT NULL", id).Scan(&step); err != nil {
		// The Node reuses TASK_NOT_FOUND here (not EXPENSE_NOT_FOUND).
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	var pos int64
	_ = d.QueryRow("SELECT COALESCE(MAX(position) + 1, 0) FROM expenses WHERE step = ? AND deleted_at IS NULL", step).Scan(&pos)
	if _, err := d.Exec("UPDATE expenses SET deleted_at = NULL, position = ?, updated_at = ? WHERE id = ?", pos, nowMs(), id); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("expenses")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleExpenseTrashDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	id := param(r, "id")
	var exists string
	if err := d.QueryRow("SELECT id FROM expenses WHERE id = ? AND deleted_at IS NOT NULL", id).Scan(&exists); err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.TaskNotFound))
		return
	}
	if _, err := d.Exec("DELETE FROM expenses WHERE id = ?", id); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("expenses")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleExpenseTrashEmpty(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	if _, err := d.Exec("DELETE FROM expenses WHERE deleted_at IS NOT NULL"); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("expenses")
	w.WriteHeader(http.StatusNoContent)
}
