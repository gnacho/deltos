package api

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/errors"
	"github.com/gnacho/deltos/server-go/internal/ids"
)

// Decision module (server/src/routes-decisions.ts): advice process
// (problem -> solutions -> advisory vote -> decision). Own tables, own routes,
// SSE domain `decisions` -> `decision.changed`. Soft delete via deleted_at
// (no trash/restore). Gamification hooks run inside the same transaction.

// Stricter allowlist than tasks/expenses (issue #279): no office/compressed.
var decisionAllowedMimeTypes = map[string]bool{
	"image/jpeg": true, "image/png": true, "image/gif": true, "image/webp": true, "image/svg+xml": true,
	"text/plain": true, "text/csv": true, "application/json": true, "application/pdf": true,
}

const maxAttachmentsPerDecision = 50

// --- row scanning -------------------------------------------------------------

type decisionRow struct {
	ID               string
	ProjectID        string
	Title            string
	Description      sql.NullString
	Status           string
	ChosenSolutionID sql.NullString
	CreatedBy        string
	CreatedAt        int64
	UpdatedAt        int64
	DecidedAt        sql.NullInt64
	DeletedAt        sql.NullInt64
}

const decisionCols = `id, project_id, title, description, status, chosen_solution_id, created_by, created_at, updated_at, decided_at, deleted_at`

func scanDecisionRow(sc scanner) (*decisionRow, error) {
	var d decisionRow
	err := sc.Scan(&d.ID, &d.ProjectID, &d.Title, &d.Description, &d.Status, &d.ChosenSolutionID,
		&d.CreatedBy, &d.CreatedAt, &d.UpdatedAt, &d.DecidedAt, &d.DeletedAt)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// --- JSON shapes --------------------------------------------------------------

type decisionDetailJSON struct {
	ID                string  `json:"id"`
	ProjectID         string  `json:"project_id"`
	Title             string  `json:"title"`
	Description       *string `json:"description"`
	Status            string  `json:"status"`
	ChosenSolutionID  *string `json:"chosen_solution_id"`
	CreatedBy         string  `json:"created_by"`
	CreatedByUsername *string `json:"created_by_username"`
	CreatedByColor    *string `json:"created_by_color"`
	CreatedAt         int64   `json:"created_at"`
	UpdatedAt         int64   `json:"updated_at"`
	DecidedAt         *int64  `json:"decided_at"`
}

type decisionCounts struct {
	Solutions int64 `json:"solutions"`
	Votes     int64 `json:"votes"`
	Comments  int64 `json:"comments"`
}

type decisionListJSON struct {
	ID                  string         `json:"id"`
	ProjectID           string         `json:"project_id"`
	Title               string         `json:"title"`
	Status              string         `json:"status"`
	ChosenSolutionID    *string        `json:"chosen_solution_id"`
	ChosenSolutionTitle *string        `json:"chosen_solution_title"`
	CreatedBy           string         `json:"created_by"`
	CreatedByUsername   *string        `json:"created_by_username"`
	CreatedByColor      *string        `json:"created_by_color"`
	CreatedAt           int64          `json:"created_at"`
	UpdatedAt           int64          `json:"updated_at"`
	DecidedAt           *int64         `json:"decided_at"`
	Counts              decisionCounts `json:"counts"`
}

type decisionSolutionJSON struct {
	ID               string  `json:"id"`
	DecisionID       string  `json:"decision_id"`
	Title            string  `json:"title"`
	Description      *string `json:"description"`
	ProposerID       string  `json:"proposer_id"`
	ProposerUsername *string `json:"proposer_username"`
	ProposerColor    *string `json:"proposer_color"`
	Votes            int64   `json:"votes"`
	MyVote           bool    `json:"my_vote"`
	CreatedAt        int64   `json:"created_at"`
	UpdatedAt        int64   `json:"updated_at"`
}

type decisionCommentJSON struct {
	ID         string  `json:"id"`
	DecisionID string  `json:"decision_id"`
	UserID     *string `json:"user_id"`
	Body       string  `json:"body"`
	CreatedAt  int64   `json:"created_at"`
	Username   *string `json:"username"`
	UserColor  *string `json:"user_color"`
}

type decisionActivityJSON struct {
	ID         string          `json:"id"`
	DecisionID string          `json:"decision_id"`
	UserID     *string         `json:"user_id"`
	Type       string          `json:"type"`
	Data       json.RawMessage `json:"data"`
	CreatedAt  int64           `json:"created_at"`
	Username   *string         `json:"username"`
}

type decisionAttachmentJSON struct {
	ID                 string  `json:"id"`
	DecisionID         string  `json:"decision_id"`
	SolutionID         *string `json:"solution_id"`
	Filename           string  `json:"filename"`
	Size               int64   `json:"size"`
	Mime               string  `json:"mime"`
	CreatedAt          int64   `json:"created_at"`
	UploadedBy         *string `json:"uploaded_by"`
	UploadedByUsername *string `json:"uploaded_by_username"`
	UploadedByColor    *string `json:"uploaded_by_color"`
}

// --- route registration -------------------------------------------------------

func (s *Server) registerDecisionRoutes(r *rtr) {
	r.Get("/api/decisions", s.handleDecisionList)
	r.Post("/api/decisions", s.handleDecisionCreate)
	r.Get("/api/decisions/:id", s.handleDecisionDetail)
	r.Patch("/api/decisions/:id", s.handleDecisionPatch)
	r.Delete("/api/decisions/:id", s.handleDecisionDelete)
	r.Post("/api/decisions/:id/solutions", s.handleSolutionCreate)
	r.Patch("/api/decisions/:id/solutions/:solutionId", s.handleSolutionPatch)
	r.Delete("/api/decisions/:id/solutions/:solutionId", s.handleSolutionDelete)
	r.Put("/api/decisions/:id/vote", s.handleDecisionVote)
	r.Delete("/api/decisions/:id/vote", s.handleDecisionUnvote)
	r.Post("/api/decisions/:id/choose", s.handleDecisionChoose)
	r.Post("/api/decisions/:id/reopen", s.handleDecisionReopen)
	r.Get("/api/decisions/:id/comments", s.handleDecisionComments)
	r.Post("/api/decisions/:id/comments", s.handleDecisionCommentCreate)
	r.Post("/api/decisions/:id/attachments", s.handleDecisionAttachmentCreate)
	r.Get("/api/decisions/attachments/:aid", s.handleDecisionAttachmentGet)
	r.Delete("/api/decisions/attachments/:aid", s.handleDecisionAttachmentDelete)
}

// --- helpers ------------------------------------------------------------------

func addDecisionEvent(q querier, decisionID, userID, typ string, data map[string]any) {
	b, _ := json.Marshal(data)
	_, _ = q.Exec(
		"INSERT INTO decision_activity_events (id, decision_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		ids.New(), decisionID, userID, typ, string(b), nowMs())
}

// loadDecision checks existence (404 DECISION_NOT_FOUND) and membership
// (403 PROJECT_NOT_MEMBER), returning the non-deleted decision row.
func loadDecision(q querier, user *auth.User, id string) (*decisionRow, *errors.HTTPError) {
	row := q.QueryRow("SELECT "+decisionCols+" FROM decisions WHERE id = ? AND deleted_at IS NULL", id)
	d, err := scanDecisionRow(row)
	if err == sql.ErrNoRows {
		return nil, errors.New(http.StatusNotFound, errors.DecisionNotFound)
	}
	if err != nil {
		return nil, errors.New(http.StatusInternalServerError, errors.InternalError)
	}
	if !isMember(q, user.ID, d.ProjectID) {
		return nil, errors.New(http.StatusForbidden, errors.ProjectNotMember)
	}
	return d, nil
}

func canDecide(user *auth.User, decision *decisionRow) bool {
	return user.Role == "admin" || decision.CreatedBy == user.ID
}

func decisionDetailJSONFrom(d decisionRow, cbUsername, cbColor sql.NullString) decisionDetailJSON {
	return decisionDetailJSON{
		ID:                d.ID,
		ProjectID:         d.ProjectID,
		Title:             d.Title,
		Description:       nstr(d.Description),
		Status:            d.Status,
		ChosenSolutionID:  nstr(d.ChosenSolutionID),
		CreatedBy:         d.CreatedBy,
		CreatedByUsername: nstr(cbUsername),
		CreatedByColor:    nstr(cbColor),
		CreatedAt:         d.CreatedAt,
		UpdatedAt:         d.UpdatedAt,
		DecidedAt:         nint(d.DecidedAt),
	}
}

func (s *Server) writeDecision(w http.ResponseWriter, r *http.Request, id string) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	detail := hydrateDecisionDetail(d, user.ID, id)
	if detail == nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"decision": detail["decision"]})
}

// hydrateDecisionDetail returns the flat detail payload
// {decision, solutions, comments, activity, attachments}, or nil.
func hydrateDecisionDetail(q querier, userID, id string) map[string]any {
	var d decisionRow
	var cbUsername, cbColor sql.NullString
	err := q.QueryRow(
		`SELECT d.id, d.project_id, d.title, d.description, d.status, d.chosen_solution_id,
		        d.created_by, d.created_at, d.updated_at, d.decided_at, d.deleted_at,
		        u.username, u.color
		 FROM decisions d JOIN users u ON u.id = d.created_by WHERE d.id = ?`, id).
		Scan(&d.ID, &d.ProjectID, &d.Title, &d.Description, &d.Status, &d.ChosenSolutionID,
			&d.CreatedBy, &d.CreatedAt, &d.UpdatedAt, &d.DecidedAt, &d.DeletedAt,
			&cbUsername, &cbColor)
	if err != nil {
		return nil
	}

	// solutions: votes DESC then created_at ASC, with my_vote resolved.
	srows, err := q.Query(
		`SELECT s.id, s.decision_id, s.title, s.description, s.proposer_id,
		        u.username AS proposer_username, u.color AS proposer_color,
		        (SELECT COUNT(*) FROM decision_votes v WHERE v.solution_id = s.id) AS votes,
		        EXISTS(SELECT 1 FROM decision_votes mv WHERE mv.solution_id = s.id AND mv.user_id = ?) AS my_vote,
		        s.created_at, s.updated_at
		 FROM decision_solutions s
		 JOIN users u ON u.id = s.proposer_id
		 WHERE s.decision_id = ?
		 ORDER BY votes DESC, s.created_at ASC`, userID, id)
	if err != nil {
		return nil
	}
	solutions := []decisionSolutionJSON{}
	for srows.Next() {
		var s decisionSolutionJSON
		var description, proposerUsername, proposerColor sql.NullString
		var myVote int
		if err := srows.Scan(&s.ID, &s.DecisionID, &s.Title, &description, &s.ProposerID,
			&proposerUsername, &proposerColor, &s.Votes, &myVote, &s.CreatedAt, &s.UpdatedAt); err != nil {
			srows.Close()
			return nil
		}
		s.Description = nstr(description)
		s.ProposerUsername = nstr(proposerUsername)
		s.ProposerColor = nstr(proposerColor)
		s.MyVote = myVote != 0
		solutions = append(solutions, s)
	}
	srows.Close()

	// comments (raw c.* + username/color)
	crows, err := q.Query(
		`SELECT c.id, c.decision_id, c.user_id, c.body, c.created_at, u.username, u.color AS user_color
		 FROM decision_comments c LEFT JOIN users u ON u.id = c.user_id
		 WHERE c.decision_id = ? ORDER BY c.created_at`, id)
	if err != nil {
		return nil
	}
	comments := []decisionCommentJSON{}
	for crows.Next() {
		var c decisionCommentJSON
		var userID, username, userColor sql.NullString
		if err := crows.Scan(&c.ID, &c.DecisionID, &userID, &c.Body, &c.CreatedAt, &username, &userColor); err != nil {
			crows.Close()
			return nil
		}
		c.UserID = nstr(userID)
		c.Username = nstr(username)
		c.UserColor = nstr(userColor)
		comments = append(comments, c)
	}
	crows.Close()

	// activity (data parsed from JSON string)
	arows, err := q.Query(
		`SELECT e.id, e.decision_id, e.user_id, e.type, e.data, e.created_at, u.username
		 FROM decision_activity_events e LEFT JOIN users u ON u.id = e.user_id
		 WHERE e.decision_id = ? ORDER BY e.created_at`, id)
	if err != nil {
		return nil
	}
	activity := []decisionActivityJSON{}
	for arows.Next() {
		var e decisionActivityJSON
		var userID, username sql.NullString
		var data sql.NullString
		if err := arows.Scan(&e.ID, &e.DecisionID, &userID, &e.Type, &data, &e.CreatedAt, &username); err != nil {
			arows.Close()
			return nil
		}
		e.UserID = nstr(userID)
		e.Username = nstr(username)
		e.Data = json.RawMessage(orEmpty(data))
		activity = append(activity, e)
	}
	arows.Close()

	// attachments (flat array; solution_id distinguishes description-level).
	atrows, err := q.Query(
		`SELECT a.id, a.decision_id, a.solution_id, a.filename, a.size, a.mime, a.created_at,
		        a.uploaded_by, u.username AS uploaded_by_username, u.color AS uploaded_by_color
		 FROM decision_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
		 WHERE a.decision_id = ? ORDER BY a.created_at`, id)
	if err != nil {
		return nil
	}
	attachments := []decisionAttachmentJSON{}
	for atrows.Next() {
		var a decisionAttachmentJSON
		var solutionID, uploadedBy, uploadedByUsername, uploadedByColor sql.NullString
		if err := atrows.Scan(&a.ID, &a.DecisionID, &solutionID, &a.Filename, &a.Size, &a.Mime, &a.CreatedAt,
			&uploadedBy, &uploadedByUsername, &uploadedByColor); err != nil {
			atrows.Close()
			return nil
		}
		a.SolutionID = nstr(solutionID)
		a.UploadedBy = nstr(uploadedBy)
		a.UploadedByUsername = nstr(uploadedByUsername)
		a.UploadedByColor = nstr(uploadedByColor)
		attachments = append(attachments, a)
	}
	atrows.Close()

	return map[string]any{
		"decision":    decisionDetailJSONFrom(d, cbUsername, cbColor),
		"solutions":   solutions,
		"comments":    comments,
		"activity":    activity,
		"attachments": attachments,
	}
}

// --- list ---------------------------------------------------------------------

func (s *Server) handleDecisionList(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	projectID := r.URL.Query().Get("project_id")
	status := r.URL.Query().Get("status")
	if status != "" && status != "open" && status != "decided" {
		validationFailed(w, []issue{{Path: []string{"status"}, Message: "invalid status"}})
		return
	}

	where := "d.deleted_at IS NULL AND d.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)"
	args := []any{user.ID}
	if projectID != "" {
		where += " AND d.project_id = ?"
		args = append(args, projectID)
	}
	if status != "" {
		where += " AND d.status = ?"
		args = append(args, status)
	}

	rows, err := d.Query(
		`SELECT d.id, d.project_id, d.title, d.status, d.chosen_solution_id,
		        d.created_by, d.created_at, d.updated_at, d.decided_at,
		        u.username AS created_by_username, u.color AS created_by_color,
		        cs.title AS chosen_solution_title,
		        (SELECT COUNT(*) FROM decision_solutions s WHERE s.decision_id = d.id) AS solutions_count,
		        (SELECT COUNT(*) FROM decision_votes v WHERE v.decision_id = d.id) AS votes_count,
		        (SELECT COUNT(*) FROM decision_comments c WHERE c.decision_id = d.id) AS comments_count
		 FROM decisions d
		 JOIN users u ON u.id = d.created_by
		 LEFT JOIN decision_solutions cs ON cs.id = d.chosen_solution_id
		 WHERE `+where+`
		 ORDER BY (d.status = 'open') DESC, d.created_at DESC`, args...)
	if err != nil {
		internalErr(w)
		return
	}
	defer rows.Close()

	out := []decisionListJSON{}
	for rows.Next() {
		var x decisionListJSON
		var chosenSolutionID, chosenSolutionTitle, cbUsername, cbColor sql.NullString
		var decidedAt sql.NullInt64
		var solutionsCount, votesCount, commentsCount int64
		if err := rows.Scan(&x.ID, &x.ProjectID, &x.Title, &x.Status, &chosenSolutionID,
			&x.CreatedBy, &x.CreatedAt, &x.UpdatedAt, &decidedAt,
			&cbUsername, &cbColor, &chosenSolutionTitle,
			&solutionsCount, &votesCount, &commentsCount); err != nil {
			internalErr(w)
			return
		}
		x.ChosenSolutionID = nstr(chosenSolutionID)
		x.ChosenSolutionTitle = nstr(chosenSolutionTitle)
		x.CreatedByUsername = nstr(cbUsername)
		x.CreatedByColor = nstr(cbColor)
		x.DecidedAt = nint(decidedAt)
		x.Counts = decisionCounts{Solutions: solutionsCount, Votes: votesCount, Comments: commentsCount}
		out = append(out, x)
	}
	writeJSON(w, http.StatusOK, map[string]any{"decisions": out})
}

// --- create -------------------------------------------------------------------

type decisionCreateBody struct {
	ProjectID   string `json:"project_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

func (s *Server) handleDecisionCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	var body decisionCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	var issues []issue
	if len(body.ProjectID) < 1 || len(body.ProjectID) > 100 {
		issues = append(issues, issue{Path: []string{"project_id"}, Message: "invalid project_id"})
	}
	if len(body.Title) < 1 || len(body.Title) > 200 {
		issues = append(issues, issue{Path: []string{"title"}, Message: "title must be 1-200 characters"})
	}
	if len(body.Description) > 5000 {
		issues = append(issues, issue{Path: []string{"description"}, Message: "description too long"})
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
	if !isMember(d, user.ID, body.ProjectID) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotMember))
		return
	}

	id := ids.New()
	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec(
		"INSERT INTO decisions (id, project_id, title, description, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)",
		id, body.ProjectID, body.Title, body.Description, user.ID, now, now); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	addDecisionEvent(tx, id, user.ID, "created", map[string]any{})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("decisions")
	w.Header().Set("Location", "/api/decisions/"+id)
	detail := hydrateDecisionDetail(d, user.ID, id)
	if detail == nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"decision": detail["decision"]})
}

// --- detail -------------------------------------------------------------------

func (s *Server) handleDecisionDetail(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	if _, herr := loadDecision(d, user, id); herr != nil {
		errors.Write(w, herr)
		return
	}
	detail := hydrateDecisionDetail(d, user.ID, id)
	if detail == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.DecisionNotFound))
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

// --- patch --------------------------------------------------------------------

type decisionPatchBody struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
}

func (s *Server) handleDecisionPatch(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	current, herr := loadDecision(d, user, id)
	if herr != nil {
		errors.Write(w, herr)
		return
	}
	var body decisionPatchBody
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
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}

	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if body.Title != nil && *body.Title != current.Title {
		if _, err := tx.Exec("UPDATE decisions SET title = ?, updated_at = ? WHERE id = ?", *body.Title, now, id); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		addDecisionEvent(tx, id, user.ID, "title", map[string]any{"from": current.Title, "to": *body.Title})
	}
	if body.Description != nil && *body.Description != current.Description.String {
		if _, err := tx.Exec("UPDATE decisions SET description = ?, updated_at = ? WHERE id = ?", *body.Description, now, id); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		addDecisionEvent(tx, id, user.ID, "description", map[string]any{})
	}
	if _, err := tx.Exec("UPDATE decisions SET updated_at = ? WHERE id = ?", now, id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("decisions")
	s.writeDecision(w, r, id)
}

// --- delete -------------------------------------------------------------------

func (s *Server) handleDecisionDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	current, herr := loadDecision(d, user, id)
	if herr != nil {
		errors.Write(w, herr)
		return
	}
	if !canDecide(user, current) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotOwner))
		return
	}
	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE decisions SET deleted_at = ?, updated_at = ? WHERE id = ?", now, now, id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	addDecisionEvent(tx, id, user.ID, "deleted", map[string]any{})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("decisions")
	w.WriteHeader(http.StatusNoContent)
}

// --- solutions ----------------------------------------------------------------

type solutionCreateBody struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

func (s *Server) handleSolutionCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	current, herr := loadDecision(d, user, id)
	if herr != nil {
		errors.Write(w, herr)
		return
	}
	if current.Status != "open" {
		errors.Write(w, errors.New(http.StatusConflict, errors.DecisionNotOpen))
		return
	}
	var body solutionCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	var issues []issue
	if len(body.Title) < 1 || len(body.Title) > 200 {
		issues = append(issues, issue{Path: []string{"title"}, Message: "title must be 1-200 characters"})
	}
	if len(body.Description) > 5000 {
		issues = append(issues, issue{Path: []string{"description"}, Message: "description too long"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}

	solutionID := ids.New()
	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec(
		"INSERT INTO decision_solutions (id, decision_id, title, description, proposer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		solutionID, id, body.Title, body.Description, user.ID, now, now); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE decisions SET updated_at = ? WHERE id = ?", now, id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	addDecisionEvent(tx, id, user.ID, "solution_added", map[string]any{"solution_id": solutionID, "title": body.Title})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("decisions")
	w.Header().Set("Location", "/api/decisions/"+id+"/solutions/"+solutionID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"solution": map[string]any{"id": solutionID, "decision_id": id, "title": body.Title, "description": body.Description},
	})
}

type solutionPatchBody struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
}

func (s *Server) handleSolutionPatch(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	solutionID := param(r, "solutionId")
	if _, herr := loadDecision(d, user, id); herr != nil {
		errors.Write(w, herr)
		return
	}
	var title, description sql.NullString
	var proposerID string
	err := d.QueryRow("SELECT title, description, proposer_id FROM decision_solutions WHERE id = ? AND decision_id = ?", solutionID, id).
		Scan(&title, &description, &proposerID)
	if err == sql.ErrNoRows {
		errors.Write(w, errors.New(http.StatusNotFound, errors.SolutionNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	if user.Role != "admin" && proposerID != user.ID {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotOwner))
		return
	}
	var body solutionPatchBody
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
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}

	newTitle := title.String
	if body.Title != nil {
		newTitle = *body.Title
	}
	newDescription := description.String
	if body.Description != nil {
		newDescription = *body.Description
	}
	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE decision_solutions SET title = ?, description = ?, updated_at = ? WHERE id = ?",
		newTitle, newDescription, now, solutionID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	addDecisionEvent(tx, id, user.ID, "solution_edited", map[string]any{"solution_id": solutionID})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("decisions")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleSolutionDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	solutionID := param(r, "solutionId")
	current, herr := loadDecision(d, user, id)
	if herr != nil {
		errors.Write(w, herr)
		return
	}
	var proposerID string
	err := d.QueryRow("SELECT proposer_id FROM decision_solutions WHERE id = ? AND decision_id = ?", solutionID, id).Scan(&proposerID)
	if err == sql.ErrNoRows {
		errors.Write(w, errors.New(http.StatusNotFound, errors.SolutionNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	if user.Role != "admin" && proposerID != user.ID {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotOwner))
		return
	}

	wasChosen := current.ChosenSolutionID.Valid && current.ChosenSolutionID.String == solutionID
	revertedPoints := 0
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("DELETE FROM decision_solutions WHERE id = ?", solutionID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if wasChosen {
		if _, err := tx.Exec("UPDATE decisions SET chosen_solution_id = NULL, status = 'open', decided_at = NULL, updated_at = ? WHERE id = ?", nowMs(), id); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		revertedPoints = revertChosenPoints(tx, id)
	}
	addDecisionEvent(tx, id, user.ID, "solution_removed", map[string]any{"solution_id": solutionID, "reopen": wasChosen})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	if revertedPoints > 0 {
		s.Hub.Broadcast("gamification")
	}
	s.Hub.Broadcast("decisions")
	w.WriteHeader(http.StatusNoContent)
}

// --- vote ---------------------------------------------------------------------

type voteBody struct {
	SolutionID string `json:"solution_id"`
}

func (s *Server) handleDecisionVote(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	current, herr := loadDecision(d, user, id)
	if herr != nil {
		errors.Write(w, herr)
		return
	}
	if current.Status != "open" {
		errors.Write(w, errors.New(http.StatusConflict, errors.DecisionNotOpen))
		return
	}
	var body voteBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if len(body.SolutionID) < 1 || len(body.SolutionID) > 100 {
		validationFailed(w, []issue{{Path: []string{"solution_id"}, Message: "invalid solution_id"}})
		return
	}
	var exists string
	if err := d.QueryRow("SELECT id FROM decision_solutions WHERE id = ? AND decision_id = ?", body.SolutionID, id).Scan(&exists); err != nil {
		if err == sql.ErrNoRows {
			errors.Write(w, errors.New(http.StatusNotFound, errors.SolutionNotFound))
		} else {
			internalErr(w)
		}
		return
	}

	now := nowMs()
	granted := 0
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec(
		`INSERT INTO decision_votes (decision_id, solution_id, user_id, created_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(decision_id, user_id) DO UPDATE SET solution_id = excluded.solution_id, created_at = excluded.created_at`,
		id, body.SolutionID, user.ID, now); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE decisions SET updated_at = ? WHERE id = ?", now, id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	granted = grantVotePoints(tx, id, user.ID)
	addDecisionEvent(tx, id, user.ID, "voted", map[string]any{"solution_id": body.SolutionID})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	if granted > 0 {
		s.Hub.Broadcast("gamification")
	}
	s.Hub.Broadcast("decisions")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDecisionUnvote(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	if _, herr := loadDecision(d, user, id); herr != nil {
		errors.Write(w, herr)
		return
	}
	reverted := 0
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("DELETE FROM decision_votes WHERE decision_id = ? AND user_id = ?", id, user.ID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE decisions SET updated_at = ? WHERE id = ?", nowMs(), id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	reverted = revertVotePoints(tx, id, user.ID)
	addDecisionEvent(tx, id, user.ID, "voted", map[string]any{"removed": true})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	if reverted > 0 {
		s.Hub.Broadcast("gamification")
	}
	s.Hub.Broadcast("decisions")
	w.WriteHeader(http.StatusNoContent)
}

// --- choose / reopen ----------------------------------------------------------

func (s *Server) handleDecisionChoose(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	current, herr := loadDecision(d, user, id)
	if herr != nil {
		errors.Write(w, herr)
		return
	}
	if !canDecide(user, current) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotOwner))
		return
	}
	var raw struct {
		SolutionID json.RawMessage `json:"solution_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	var solutionID *string
	if len(raw.SolutionID) > 0 && string(raw.SolutionID) != "null" {
		var s string
		if err := json.Unmarshal(raw.SolutionID, &s); err != nil || len(s) < 1 || len(s) > 100 {
			validationFailed(w, []issue{{Path: []string{"solution_id"}, Message: "invalid solution_id"}})
			return
		}
		solutionID = &s
	}

	now := nowMs()
	gamGranted := 0
	gamReverted := 0
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if solutionID != nil {
		var exists string
		if err := tx.QueryRow("SELECT id FROM decision_solutions WHERE id = ? AND decision_id = ?", *solutionID, id).Scan(&exists); err != nil {
			_ = tx.Rollback()
			if err == sql.ErrNoRows {
				errors.Write(w, errors.New(http.StatusNotFound, errors.SolutionNotFound))
			} else {
				internalErr(w)
			}
			return
		}
		if _, err := tx.Exec("UPDATE decisions SET chosen_solution_id = ?, status = 'decided', decided_at = ?, updated_at = ? WHERE id = ?",
			*solutionID, now, now, id); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		gamReverted += revertChosenPoints(tx, id)
		gamGranted += grantChosenPoints(tx, id, *solutionID)
		addDecisionEvent(tx, id, user.ID, "chosen", map[string]any{"solution_id": *solutionID})
	} else {
		if _, err := tx.Exec("UPDATE decisions SET chosen_solution_id = NULL, status = 'decided', decided_at = ?, updated_at = ? WHERE id = ?",
			now, now, id); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		gamReverted += revertChosenPoints(tx, id)
		addDecisionEvent(tx, id, user.ID, "unchosen", map[string]any{})
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	if gamGranted > 0 || gamReverted > 0 {
		s.Hub.Broadcast("gamification")
	}
	s.Hub.Broadcast("decisions")
	s.writeDecision(w, r, id)
}

func (s *Server) handleDecisionReopen(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	current, herr := loadDecision(d, user, id)
	if herr != nil {
		errors.Write(w, herr)
		return
	}
	if !canDecide(user, current) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotOwner))
		return
	}
	reverted := 0
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE decisions SET status = 'open', chosen_solution_id = NULL, decided_at = NULL, updated_at = ? WHERE id = ?",
		nowMs(), id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	reverted = revertChosenPoints(tx, id)
	addDecisionEvent(tx, id, user.ID, "reopened", map[string]any{})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	if reverted > 0 {
		s.Hub.Broadcast("gamification")
	}
	s.Hub.Broadcast("decisions")
	s.writeDecision(w, r, id)
}

// --- comments -----------------------------------------------------------------

func (s *Server) handleDecisionComments(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	if _, herr := loadDecision(d, user, id); herr != nil {
		errors.Write(w, herr)
		return
	}
	rows, err := d.Query(
		`SELECT c.id, c.decision_id, c.user_id, c.body, c.created_at, u.username, u.color AS user_color
		 FROM decision_comments c LEFT JOIN users u ON u.id = c.user_id
		 WHERE c.decision_id = ? ORDER BY c.created_at DESC LIMIT 200`, id)
	if err != nil {
		internalErr(w)
		return
	}
	defer rows.Close()
	comments := []decisionCommentJSON{}
	for rows.Next() {
		var c decisionCommentJSON
		var userID, username, userColor sql.NullString
		if err := rows.Scan(&c.ID, &c.DecisionID, &userID, &c.Body, &c.CreatedAt, &username, &userColor); err != nil {
			internalErr(w)
			return
		}
		c.UserID = nstr(userID)
		c.Username = nstr(username)
		c.UserColor = nstr(userColor)
		comments = append(comments, c)
	}
	writeJSON(w, http.StatusOK, map[string]any{"comments": comments})
}

type decisionCommentBody struct {
	Body string `json:"body"`
}

func (s *Server) handleDecisionCommentCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	if _, herr := loadDecision(d, user, id); herr != nil {
		errors.Write(w, herr)
		return
	}
	var body decisionCommentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if len(body.Body) < 1 || len(body.Body) > 5000 {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "body must be 1-5000 characters"}})
		return
	}
	commentID := ids.New()
	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("INSERT INTO decision_comments (id, decision_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
		commentID, id, user.ID, body.Body, now); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE decisions SET updated_at = ? WHERE id = ?", now, id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	addDecisionEvent(tx, id, user.ID, "comment", map[string]any{"comment_id": commentID})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("decisions")
	w.Header().Set("Location", "/api/decisions/"+id+"/comments/"+commentID)
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "id": commentID})
}

// --- attachments --------------------------------------------------------------

var decisionNonAlnumDot = regexp.MustCompile(`[^a-zA-Z0-9.]`)

func (s *Server) handleDecisionAttachmentCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	if _, herr := loadDecision(d, user, id); herr != nil {
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
	if !decisionAllowedMimeTypes[mime] {
		errors.Write(w, errors.New(http.StatusUnsupportedMediaType, errors.UploadInvalidMIME))
		return
	}

	var solutionID *string
	if raw := r.FormValue("solution_id"); raw != "" {
		trimmed := raw
		if trimmed != "" {
			// validate the solution belongs to this decision and permissions
			var proposerID string
			if err := d.QueryRow("SELECT proposer_id FROM decision_solutions WHERE id = ? AND decision_id = ?", trimmed, id).Scan(&proposerID); err != nil {
				if err == sql.ErrNoRows {
					errors.Write(w, errors.New(http.StatusNotFound, errors.SolutionNotFound))
				} else {
					internalErr(w)
				}
				return
			}
			if user.Role != "admin" && proposerID != user.ID {
				errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotOwner))
				return
			}
			v := trimmed
			solutionID = &v
		}
	}

	var currentCount int
	_ = d.QueryRow("SELECT COUNT(*) AS n FROM decision_attachments WHERE decision_id = ?", id).Scan(&currentCount)
	if currentCount >= maxAttachmentsPerDecision {
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
	ext := decisionNonAlnumDot.ReplaceAllString(filepath.Ext(filename), "")
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

	attID := ids.New()
	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec(
		"INSERT INTO decision_attachments (id, decision_id, solution_id, filename, stored_name, size, mime, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		attID, id, solutionID, filename, stored, len(buf), mime, user.ID, now); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE decisions SET updated_at = ? WHERE id = ?", now, id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	eventData := map[string]any{"filename": filename}
	if solutionID != nil {
		eventData["solution_id"] = *solutionID
	}
	addDecisionEvent(tx, id, user.ID, "attachment", eventData)
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("decisions")
	w.Header().Set("Location", "/api/decisions/attachments/"+attID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"attachment": map[string]any{
			"id":                   attID,
			"decision_id":          id,
			"solution_id":          solutionID,
			"filename":             filename,
			"size":                 len(buf),
			"mime":                 mime,
			"created_at":           now,
			"uploaded_by":          user.ID,
			"uploaded_by_username": user.Username,
		},
	})
}

func (s *Server) handleDecisionAttachmentGet(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	aid := param(r, "aid")
	var storedName, filename, mime, projectID string
	var uploadedBy sql.NullString
	err := d.QueryRow(
		`SELECT a.stored_name, a.filename, a.mime, d.project_id, a.uploaded_by
		 FROM decision_attachments a JOIN decisions d ON d.id = a.decision_id WHERE a.id = ?`, aid).
		Scan(&storedName, &filename, &mime, &projectID, &uploadedBy)
	if err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.AttachmentNotFound))
		return
	}
	if !isMember(d, user.ID, projectID) {
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

func (s *Server) handleDecisionAttachmentDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	aid := param(r, "aid")
	var storedName, filename, decisionID, projectID string
	var uploadedBy sql.NullString
	err := d.QueryRow(
		`SELECT a.stored_name, a.filename, a.decision_id, d.project_id, a.uploaded_by
		 FROM decision_attachments a JOIN decisions d ON d.id = a.decision_id WHERE a.id = ?`, aid).
		Scan(&storedName, &filename, &decisionID, &projectID, &uploadedBy)
	if err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.AttachmentNotFound))
		return
	}
	if !isMember(d, user.ID, projectID) {
		errors.Write(w, errors.New(http.StatusNotFound, errors.AttachmentNotFound))
		return
	}
	if user.Role != "admin" && (!uploadedBy.Valid || uploadedBy.String != user.ID) {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotOwner))
		return
	}
	_ = os.Remove(filepath.Join(s.UploadsDir, filepath.Base(storedName)))
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("DELETE FROM decision_attachments WHERE id = ?", aid); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE decisions SET updated_at = ? WHERE id = ?", nowMs(), decisionID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	addDecisionEvent(tx, decisionID, user.ID, "attachment", map[string]any{"filename": filename, "removed": true})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("decisions")
	w.WriteHeader(http.StatusNoContent)
}
