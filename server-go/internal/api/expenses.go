// Package api: expense plugin routes (server/src/routes-expenses.ts). Global
// kanban board 'nuevo' -> 'en-curso' -> 'hecho' with per-step position
// compaction, payer + expense_shares splits, settle between two users, soft
// delete, comments, activity events and multipart attachments (same allowlist
// and size limit as task attachments). Gated on the kv flag
// plugin_expenses_enabled (404 NOT_FOUND when disabled), exactly like the Node.
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
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/errors"
	"github.com/gnacho/deltos/server-go/internal/ids"
)

// --- JSON shapes (match the Node shapeRow / sharesFor field-for-field) --------

type expenseShareJSON struct {
	UserID     string  `json:"user_id"`
	Username   string  `json:"username"`
	UserColor  *string `json:"user_color"`
	ShareCents int64   `json:"share_cents"`
	Paid       bool    `json:"paid"`
}

type expenseCounts struct {
	Comments    int `json:"comments"`
	Attachments int `json:"attachments"`
}

type expenseJSON struct {
	ID                string             `json:"id"`
	Title             string             `json:"title"`
	AmountCents       int64              `json:"amount_cents"`
	LabelID           *string            `json:"label_id"`
	LabelName         *string            `json:"label_name"`
	LabelColor        *string            `json:"label_color"`
	ProjectID         *string            `json:"project_id"`
	ProjectName       *string            `json:"project_name"`
	Notes             *string            `json:"notes"`
	PayerID           *string            `json:"payer_id"`
	PayerUsername     *string            `json:"payer_username"`
	PayerColor        *string            `json:"payer_color"`
	PaymentMethod     *string            `json:"payment_method"`
	SpentAt           *int64             `json:"spent_at"`
	Shares            []expenseShareJSON `json:"shares"`
	Step              string             `json:"step"`
	Position          int64              `json:"position"`
	CreatedBy         string             `json:"created_by"`
	CreatedByUsername string             `json:"created_by_username"`
	CreatedByColor    *string            `json:"created_by_color"`
	CreatedAt         int64              `json:"created_at"`
	UpdatedAt         int64              `json:"updated_at"`
	DeletedAt         *int64             `json:"deleted_at"`
	ArchivedAt        *int64             `json:"archived_at"`
	Counts            expenseCounts      `json:"counts"`
}

// --- row scanners -------------------------------------------------------------

type expenseRow struct {
	ID            string
	Title         string
	AmountCents   int64
	LabelID       sql.NullString
	ProjectID     sql.NullString
	Notes         sql.NullString
	PayerID       string
	PaymentMethod sql.NullString
	SpentAt       sql.NullInt64
	Step          string
	Position      int64
	CreatedBy     string
	CreatedAt     int64
	UpdatedAt     int64
	DeletedAt     sql.NullInt64
	DoneAt        sql.NullInt64
	ArchivedAt    sql.NullInt64
}

const expenseCols = `id, title, amount_cents, label_id, project_id, notes, payer_id,
	payment_method, spent_at, step, position, created_by, created_at, updated_at,
	deleted_at, done_at, archived_at`

func scanExpenseRow(sc scanner) (*expenseRow, error) {
	var e expenseRow
	err := sc.Scan(&e.ID, &e.Title, &e.AmountCents, &e.LabelID, &e.ProjectID, &e.Notes,
		&e.PayerID, &e.PaymentMethod, &e.SpentAt, &e.Step, &e.Position,
		&e.CreatedBy, &e.CreatedAt, &e.UpdatedAt, &e.DeletedAt, &e.DoneAt, &e.ArchivedAt)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

type expenseHyd struct {
	expenseRow
	CreatedByUsername string
	CreatedByColor    sql.NullString
	PayerUsername     string
	PayerColor        sql.NullString
	ProjectName       sql.NullString
	CommentCount      int
	AttachmentCount   int
	LabelName         sql.NullString
	LabelColor        sql.NullString
}

// expenseSelect mirrors the Node EXPENSE_SELECT: e.* plus resolved usernames,
// project name, comment/attachment counts and label name/color.
const expenseSelect = `
SELECT e.id, e.title, e.amount_cents, e.label_id, e.project_id, e.notes,
       e.payer_id, e.payment_method, e.spent_at, e.step, e.position,
       e.created_by, e.created_at, e.updated_at, e.deleted_at, e.done_at, e.archived_at,
       u.username, u.color, pu.username, pu.color, p.name,
       (SELECT COUNT(*) FROM expense_comments c WHERE c.expense_id = e.id),
       (SELECT COUNT(*) FROM expense_attachments a WHERE a.expense_id = e.id),
       l.name, l.color
FROM expenses e
JOIN users u ON u.id = e.created_by
JOIN users pu ON pu.id = e.payer_id
LEFT JOIN projects p ON p.id = e.project_id
LEFT JOIN labels l ON l.id = e.label_id`

func scanExpenseHyd(sc scanner) (*expenseHyd, error) {
	var h expenseHyd
	err := sc.Scan(&h.ID, &h.Title, &h.AmountCents, &h.LabelID, &h.ProjectID, &h.Notes,
		&h.PayerID, &h.PaymentMethod, &h.SpentAt, &h.Step, &h.Position,
		&h.CreatedBy, &h.CreatedAt, &h.UpdatedAt, &h.DeletedAt, &h.DoneAt, &h.ArchivedAt,
		&h.CreatedByUsername, &h.CreatedByColor, &h.PayerUsername, &h.PayerColor, &h.ProjectName,
		&h.CommentCount, &h.AttachmentCount, &h.LabelName, &h.LabelColor)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

// --- helpers -------------------------------------------------------------------

func shapeExpense(h expenseHyd, shares []expenseShareJSON) expenseJSON {
	return expenseJSON{
		ID:                h.ID,
		Title:             h.Title,
		AmountCents:       h.AmountCents,
		LabelID:           nstr(h.LabelID),
		LabelName:         nstr(h.LabelName),
		LabelColor:        nstr(h.LabelColor),
		ProjectID:         nstr(h.ProjectID),
		ProjectName:       nstr(h.ProjectName),
		Notes:             nstr(h.Notes),
		PayerID:           nstrPtr(h.PayerID),
		PayerUsername:     nstrPtr(h.PayerUsername),
		PayerColor:        nstr(h.PayerColor),
		PaymentMethod:     nstr(h.PaymentMethod),
		SpentAt:           nint(h.SpentAt),
		Shares:            shares,
		Step:              h.Step,
		Position:          h.Position,
		CreatedBy:         h.CreatedBy,
		CreatedByUsername: h.CreatedByUsername,
		CreatedByColor:    nstr(h.CreatedByColor),
		CreatedAt:         h.CreatedAt,
		UpdatedAt:         h.UpdatedAt,
		DeletedAt:         nint(h.DeletedAt),
		ArchivedAt:        nint(h.ArchivedAt),
		Counts:            expenseCounts{Comments: h.CommentCount, Attachments: h.AttachmentCount},
	}
}

// nstrPtr wraps a non-null string as a pointer (payer_id/payer_username are
// NOT NULL in the schema but the Node emits them as nullable fields).
func nstrPtr(s string) *string {
	v := s
	return &v
}

func getExpense(q querier, id string) (*expenseRow, error) {
	row := q.QueryRow("SELECT "+expenseCols+" FROM expenses WHERE id = ? AND deleted_at IS NULL", id)
	e, err := scanExpenseRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return e, err
}

func hydrateExpense(q querier, id string) (*expenseJSON, error) {
	row := q.QueryRow(expenseSelect+" WHERE e.id = ?", id)
	h, err := scanExpenseHyd(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	shares := sharesFor(q, []string{h.ID})[h.ID]
	if shares == nil {
		shares = []expenseShareJSON{}
	}
	e := shapeExpense(*h, shares)
	return &e, nil
}

func listExpenses(q querier) ([]expenseJSON, error) {
	rows, err := q.Query(expenseSelect + " WHERE e.deleted_at IS NULL ORDER BY e.step, e.position")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var hyds []expenseHyd
	var ids []string
	for rows.Next() {
		h, err := scanExpenseHyd(rows)
		if err != nil {
			return nil, err
		}
		hyds = append(hyds, *h)
		ids = append(ids, h.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	byID := sharesFor(q, ids)
	out := make([]expenseJSON, 0, len(hyds))
	for _, h := range hyds {
		shares := byID[h.ID]
		if shares == nil {
			shares = []expenseShareJSON{}
		}
		out = append(out, shapeExpense(h, shares))
	}
	return out, nil
}

// sharesFor loads shares for the given expense ids, ordered by share_cents
// DESC (same as the Node, which the frontend relies on for ordering).
func sharesFor(q querier, ids []string) map[string][]expenseShareJSON {
	out := map[string][]expenseShareJSON{}
	if len(ids) == 0 {
		return out
	}
	ph := strings.Repeat("?,", len(ids))
	ph = ph[:len(ph)-1]
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := q.Query(
		`SELECT s.expense_id, s.user_id, u.username, u.color, s.share_cents, s.paid
		 FROM expense_shares s JOIN users u ON u.id = s.user_id
		 WHERE s.expense_id IN (`+ph+`)
		 ORDER BY s.share_cents DESC`, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var expenseID, userID, username string
		var color sql.NullString
		var shareCents, paid int64
		if err := rows.Scan(&expenseID, &userID, &username, &color, &shareCents, &paid); err != nil {
			return out
		}
		out[expenseID] = append(out[expenseID], expenseShareJSON{
			UserID: userID, Username: username, UserColor: nstr(color),
			ShareCents: shareCents, Paid: paid != 0,
		})
	}
	return out
}

func addExpenseEvent(q querier, expenseID any, userID, typ string, data map[string]any) {
	b, _ := json.Marshal(data)
	_, _ = q.Exec(
		"INSERT INTO expense_activity_events (id, expense_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		ids.New(), expenseID, userID, typ, string(b), nowMs())
}

func writeShares(q querier, expenseID string, shares []expenseShareIn, payerID *string) {
	_, _ = q.Exec("DELETE FROM expense_shares WHERE expense_id = ?", expenseID)
	for _, sh := range shares {
		paid := 0
		if payerID != nil && sh.UserID == *payerID {
			paid = 1
		}
		_, _ = q.Exec(
			"INSERT INTO expense_shares (expense_id, user_id, share_cents, paid) VALUES (?, ?, ?, ?)",
			expenseID, sh.UserID, sh.ShareCents, paid)
	}
}

// validateShares rejects duplicate users (422 VALIDATION_FAILED) and unknown
// users (422 ASSIGNEE_NOT_MEMBER). The sum may mismatch the amount (allowed).
func validateShares(q querier, shares []expenseShareIn) *errors.HTTPError {
	seen := map[string]bool{}
	for _, sh := range shares {
		if seen[sh.UserID] {
			return errors.New(422, errors.ValidationFailed)
		}
		seen[sh.UserID] = true
		var id string
		if err := q.QueryRow("SELECT id FROM users WHERE id = ?", sh.UserID).Scan(&id); err != nil {
			return errors.New(422, errors.AssigneeNotMember)
		}
	}
	return nil
}

// resolveStep derives the lifecycle step from shares + invites (spec issue
// #113). payerID may be nil (NULL in SQL: user_id != NULL is never true).
func resolveStep(q querier, expenseID string, payerID *string, requestedStep string) string {
	var payerArg any
	if payerID != nil {
		payerArg = *payerID
	}
	var sharesN, invitesN int64
	var sharesPending, invitesPending sql.NullInt64
	_ = q.QueryRow(
		"SELECT COUNT(*), SUM(CASE WHEN user_id != ? AND paid = 0 THEN 1 ELSE 0 END) FROM expense_shares WHERE expense_id = ?",
		payerArg, expenseID).Scan(&sharesN, &sharesPending)
	_ = q.QueryRow(
		"SELECT COUNT(*), SUM(CASE WHEN paid = 0 THEN 1 ELSE 0 END) FROM expense_invites WHERE expense_id = ?",
		expenseID).Scan(&invitesN, &invitesPending)
	declared := sharesN + invitesN
	if declared == 0 {
		return requestedStep
	}
	pending := int64(0)
	if sharesPending.Valid {
		pending += sharesPending.Int64
	}
	if invitesPending.Valid {
		pending += invitesPending.Int64
	}
	if pending == 0 {
		return "hecho"
	}
	if requestedStep == "nuevo" || requestedStep == "hecho" {
		return "en-curso"
	}
	return requestedStep
}

// applyStepFlags sets done_at when entering 'hecho' (else NULL) and always
// clears archived_at (any step change reactivates the expense).
func applyStepFlags(q querier, id, newStep string) {
	var doneAt any
	if newStep == "hecho" {
		doneAt = nowMs()
	}
	_, _ = q.Exec("UPDATE expenses SET done_at = ?, archived_at = NULL WHERE id = ?", doneAt, id)
}

// expenseEnabled reports whether the plugin gate is open (kv flag
// plugin_expenses_enabled === '1', read from the PRODUCTION db like the Node).
func (s *Server) expenseEnabled() bool {
	return s.Prod.KVGet("plugin_expenses_enabled", "0") == "1"
}

// expenseGate is the plugin gate (app.use('/api/expenses/*') in the Node):
// 404 NOT_FOUND when the plugin is disabled.
func (s *Server) expenseGate(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.expenseEnabled() {
			errors.Write(w, errors.New(http.StatusNotFound, errors.NotFound))
			return
		}
		next(w, r)
	}
}

// --- request bodies ------------------------------------------------------------

var validExpenseSteps = map[string]bool{"nuevo": true, "en-curso": true, "hecho": true}
var validPaymentMethods = map[string]bool{"bizum": true, "transfer": true, "efectivo": true}

type expenseShareIn struct {
	UserID     string `json:"user_id"`
	ShareCents int64  `json:"share_cents"`
}

type expenseCreateBody struct {
	Title         string           `json:"title"`
	AmountCents   int64            `json:"amount_cents"`
	LabelID       *string          `json:"label_id"`
	ProjectID     *string          `json:"project_id"`
	Notes         string           `json:"notes"`
	PayerID       *string          `json:"payer_id"`
	SpentAt       *int64           `json:"spent_at"`
	Shares        []expenseShareIn `json:"shares"`
	PaymentMethod *string          `json:"payment_method"`
	Step          string           `json:"step"`
}

type expenseUpdateBody struct {
	Title         *string           `json:"title"`
	AmountCents   *int64            `json:"amount_cents"`
	LabelID       json.RawMessage   `json:"label_id"`
	ProjectID     json.RawMessage   `json:"project_id"`
	Notes         *string           `json:"notes"`
	PayerID       *string           `json:"payer_id"`
	SpentAt       *int64            `json:"spent_at"`
	Shares        *[]expenseShareIn `json:"shares"`
	PaymentMethod json.RawMessage   `json:"payment_method"`
	Step          *string           `json:"step"`
}

type expenseMyShareBody struct {
	Paid bool `json:"paid"`
}

type expenseMoveBody struct {
	Step     string `json:"step"`
	Position int64  `json:"position"`
}

type expenseCommentBody struct {
	Body string `json:"body"`
}

type expenseSettleBody struct {
	OtherUserID string `json:"other_user_id"`
}

// --- route registration --------------------------------------------------------

func (s *Server) registerExpenseRoutes(r *rtr) {
	r.Post("/api/expenses/settle", s.expenseGate(s.handleExpenseSettle))
	r.Get("/api/expenses", s.expenseGate(s.handleExpenseList))
	r.Get("/api/expenses/:id/detail", s.expenseGate(s.handleExpenseDetail))
	r.Post("/api/expenses/parse", s.expenseGate(s.handleExpenseParse))
	r.Post("/api/expenses", s.expenseGate(s.handleExpenseCreate))
	r.Get("/api/expenses/:id", s.expenseGate(s.handleExpenseGet))
	r.Put("/api/expenses/:id", s.expenseGate(s.handleExpenseUpdate))
	r.Put("/api/expenses/:id/my-share", s.expenseGate(s.handleExpenseMyShare))
	r.Put("/api/expenses/:id/move", s.expenseGate(s.handleExpenseMove))
	r.Post("/api/expenses/:id/archive", s.expenseGate(s.handleExpenseArchive))
	r.Post("/api/expenses/:id/unarchive", s.expenseGate(s.handleExpenseUnarchive))
	r.Delete("/api/expenses/:id", s.expenseGate(s.handleExpenseDelete))
	r.Get("/api/expenses/:id/comments", s.expenseGate(s.handleExpenseCommentsList))
	r.Post("/api/expenses/:id/comments", s.expenseGate(s.handleExpenseCommentCreate))
	r.Post("/api/expenses/:id/attachments", s.expenseGate(s.handleExpenseAttachmentCreate))
	r.Get("/api/expenses/:id/attachments/:attId", s.expenseGate(s.handleExpenseAttachmentGet))
	r.Delete("/api/expenses/:id/attachments/:attId", s.expenseGate(s.handleExpenseAttachmentDelete))
}

// --- handlers ------------------------------------------------------------------

func (s *Server) handleExpenseSettle(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	var body expenseSettleBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if len(body.OtherUserID) < 1 || len(body.OtherUserID) > 100 {
		validationFailed(w, []issue{{Path: []string{"other_user_id"}, Message: "invalid other_user_id"}})
		return
	}
	if body.OtherUserID == user.ID {
		errors.Write(w, errors.New(422, errors.ValidationFailed))
		return
	}
	var targetID, targetUsername string
	if err := d.QueryRow("SELECT id, username FROM users WHERE id = ?", body.OtherUserID).Scan(&targetID, &targetUsername); err != nil {
		errors.Write(w, errors.New(422, errors.AssigneeNotMember))
		return
	}

	type pendingRow struct {
		expenseID  string
		userID     string
		shareCents int64
		step       string
		payerID    sql.NullString
		title      string
	}
	rows, err := d.Query(
		`SELECT s.expense_id, s.user_id, s.share_cents, e.step, e.payer_id, e.title
		 FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
		 WHERE e.deleted_at IS NULL AND s.paid = 0
		   AND ((s.user_id = ? AND e.payer_id = ?) OR (s.user_id = ? AND e.payer_id = ?))`,
		user.ID, body.OtherUserID, body.OtherUserID, user.ID)
	if err != nil {
		internalErr(w)
		return
	}
	var pending []pendingRow
	for rows.Next() {
		var p pendingRow
		if err := rows.Scan(&p.expenseID, &p.userID, &p.shareCents, &p.step, &p.payerID, &p.title); err != nil {
			rows.Close()
			internalErr(w)
			return
		}
		pending = append(pending, p)
	}
	rows.Close()

	if len(pending) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"settled": 0})
		return
	}

	var total int64
	for _, p := range pending {
		total += p.shareCents
	}
	now := nowMs()

	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	for _, p := range pending {
		if _, err := tx.Exec("UPDATE expense_shares SET paid = 1 WHERE expense_id = ? AND user_id = ?", p.expenseID, p.userID); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		addExpenseEvent(tx, p.expenseID, user.ID, "paid", map[string]any{"share": true, "settle": true})
	}
	seen := map[string]bool{}
	for _, p := range pending {
		if seen[p.expenseID] {
			continue
		}
		seen[p.expenseID] = true
		var step string
		var payerID sql.NullString
		if err := tx.QueryRow("SELECT step, payer_id FROM expenses WHERE id = ?", p.expenseID).Scan(&step, &payerID); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		newStep := resolveStep(tx, p.expenseID, nstr(payerID), step)
		if _, err := tx.Exec("UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?", newStep, now, p.expenseID); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		if newStep != step {
			applyStepFlags(tx, p.expenseID, newStep)
			addExpenseEvent(tx, p.expenseID, user.ID, "moved", map[string]any{"from": step, "to": newStep})
		}
	}
	addExpenseEvent(tx, nil, user.ID, "settled", map[string]any{
		"other_user_id":  body.OtherUserID,
		"other_username": targetUsername,
		"count":          len(pending),
		"total_cents":    total,
	})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}

	s.Hub.Broadcast("expenses")
	// TODO(phase-6): notifyUsers(db, [otherId], 'pago_completado', ...) push
	// notification (fire-and-forget in the Node; phase 3 drops it).

	writeJSON(w, http.StatusOK, map[string]any{"settled": len(pending), "total_cents": total})
}

func (s *Server) handleExpenseList(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	list, err := listExpenses(d)
	if err != nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"expenses": list})
}

func (s *Server) handleExpenseDetail(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	id := param(r, "id")
	expense, err := hydrateExpense(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	if expense == nil || expense.DeletedAt != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}

	// attachments (with resolved uploaded_by_username)
	arows, err := d.Query(
		`SELECT a.id, a.filename, a.size, a.mime, a.created_at, a.uploaded_by, u.username
		 FROM expense_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
		 WHERE a.expense_id = ? ORDER BY a.created_at`, id)
	if err != nil {
		internalErr(w)
		return
	}
	attachments := []map[string]any{}
	for arows.Next() {
		var aid, filename, mime string
		var size, createdAt int64
		var uploadedBy, uploadedByUsername sql.NullString
		if err := arows.Scan(&aid, &filename, &size, &mime, &createdAt, &uploadedBy, &uploadedByUsername); err != nil {
			arows.Close()
			internalErr(w)
			return
		}
		attachments = append(attachments, map[string]any{
			"id": aid, "filename": filename, "size": size, "mime": mime,
			"created_at": createdAt, "uploaded_by": nstr(uploadedBy),
			"uploaded_by_username": nstr(uploadedByUsername),
		})
	}
	arows.Close()

	// comments (raw c.* + username, no fallback here)
	crows, err := d.Query(
		`SELECT c.id, c.expense_id, c.user_id, c.author_name, c.body, c.created_at, u.username, u.color
		 FROM expense_comments c LEFT JOIN users u ON u.id = c.user_id
		 WHERE c.expense_id = ? ORDER BY c.created_at`, id)
	if err != nil {
		internalErr(w)
		return
	}
	comments := []map[string]any{}
	for crows.Next() {
		var cid, expenseID, body string
		var userID, authorName, username, userColor sql.NullString
		var createdAt int64
		if err := crows.Scan(&cid, &expenseID, &userID, &authorName, &body, &createdAt, &username, &userColor); err != nil {
			crows.Close()
			internalErr(w)
			return
		}
		comments = append(comments, map[string]any{
			"id": cid, "expense_id": expenseID, "user_id": nstr(userID),
			"author_name": nstr(authorName), "body": body, "created_at": createdAt,
			"username": nstr(username), "user_color": nstr(userColor),
		})
	}
	crows.Close()

	// activity (data parsed from JSON string)
	erows, err := d.Query(
		`SELECT e.id, e.expense_id, e.user_id, e.type, e.data, e.created_at, u.username
		 FROM expense_activity_events e LEFT JOIN users u ON u.id = e.user_id
		 WHERE e.expense_id = ? ORDER BY e.created_at`, id)
	if err != nil {
		internalErr(w)
		return
	}
	activity := []map[string]any{}
	for erows.Next() {
		var eid, expenseID, typ string
		var userID, username sql.NullString
		var data sql.NullString
		var createdAt int64
		if err := erows.Scan(&eid, &expenseID, &userID, &typ, &data, &createdAt, &username); err != nil {
			erows.Close()
			internalErr(w)
			return
		}
		activity = append(activity, map[string]any{
			"id": eid, "expense_id": expenseID, "user_id": nstr(userID), "type": typ,
			"data": json.RawMessage(orEmpty(data)), "created_at": createdAt, "username": nstr(username),
		})
	}
	erows.Close()

	writeJSON(w, http.StatusOK, map[string]any{
		"expense": expense, "attachments": attachments, "comments": comments, "activity": activity,
	})
}

func (s *Server) handleExpenseGet(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	expense, err := hydrateExpense(d, param(r, "id"))
	if err != nil {
		internalErr(w)
		return
	}
	if expense == nil || expense.DeletedAt != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"expense": expense})
}

func (s *Server) handleExpenseCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	var body expenseCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if body.Step == "" {
		body.Step = "nuevo"
	}
	var issues []issue
	if len(body.Title) < 1 || len(body.Title) > 200 {
		issues = append(issues, issue{Path: []string{"title"}, Message: "title must be 1-200 characters"})
	}
	if body.AmountCents < 1 {
		issues = append(issues, issue{Path: []string{"amount_cents"}, Message: "amount_cents must be >= 1"})
	}
	if len(body.Notes) > 5000 {
		issues = append(issues, issue{Path: []string{"notes"}, Message: "notes too long"})
	}
	if body.PayerID != nil && (len(*body.PayerID) < 1 || len(*body.PayerID) > 100) {
		issues = append(issues, issue{Path: []string{"payer_id"}, Message: "invalid payer_id"})
	}
	if body.SpentAt != nil && *body.SpentAt < 0 {
		issues = append(issues, issue{Path: []string{"spent_at"}, Message: "invalid spent_at"})
	}
	if len(body.Shares) > 50 {
		issues = append(issues, issue{Path: []string{"shares"}, Message: "too many shares"})
	}
	for i, sh := range body.Shares {
		if len(sh.UserID) < 1 || len(sh.UserID) > 100 {
			issues = append(issues, issue{Path: []string{"shares", strconv.Itoa(i), "user_id"}, Message: "invalid user_id"})
		}
		if sh.ShareCents < 0 {
			issues = append(issues, issue{Path: []string{"shares", strconv.Itoa(i), "share_cents"}, Message: "invalid share_cents"})
		}
	}
	if body.PaymentMethod != nil && !validPaymentMethods[*body.PaymentMethod] {
		issues = append(issues, issue{Path: []string{"payment_method"}, Message: "invalid payment_method"})
	}
	if !validExpenseSteps[body.Step] {
		issues = append(issues, issue{Path: []string{"step"}, Message: "invalid step"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}
	if body.LabelID != nil && *body.LabelID == "" {
		body.LabelID = nil
	}
	if body.ProjectID != nil && *body.ProjectID == "" {
		body.ProjectID = nil
	}
	if body.PaymentMethod != nil && *body.PaymentMethod == "" {
		body.PaymentMethod = nil
	}

	payerID := user.ID
	if body.PayerID != nil {
		payerID = *body.PayerID
	}
	var payerExists string
	if err := d.QueryRow("SELECT id FROM users WHERE id = ?", payerID).Scan(&payerExists); err != nil {
		errors.Write(w, errors.New(422, errors.AssigneeNotMember))
		return
	}
	if body.ProjectID != nil {
		var pid string
		if err := d.QueryRow("SELECT id FROM projects WHERE id = ?", *body.ProjectID).Scan(&pid); err != nil {
			errors.Write(w, errors.New(422, errors.ValidationFailed))
			return
		}
	}
	if herr := validateShares(d, body.Shares); herr != nil {
		errors.Write(w, herr)
		return
	}

	id := ids.New()
	now := nowMs()
	var maxPos int64
	_ = d.QueryRow("SELECT COALESCE(MAX(position), -1) FROM expenses WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL", body.Step).Scan(&maxPos)
	position := maxPos + 1

	spentAt := now
	if body.SpentAt != nil {
		spentAt = *body.SpentAt
	}
	var doneAt any
	if body.Step == "hecho" {
		doneAt = now
	}

	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec(
		`INSERT INTO expenses (id, title, amount_cents, label_id, project_id, notes, payer_id,
		 payment_method, spent_at, step, position, created_by, created_at, updated_at, done_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, body.Title, body.AmountCents, body.LabelID, body.ProjectID, body.Notes,
		payerID, body.PaymentMethod, spentAt, body.Step, position, user.ID, now, now, doneAt); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	writeShares(tx, id, body.Shares, &payerID)
	step := resolveStep(tx, id, &payerID, body.Step)
	if step != body.Step {
		if _, err := tx.Exec("UPDATE expenses SET step = ? WHERE id = ?", step, id); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		applyStepFlags(tx, id, step)
	}
	addExpenseEvent(tx, id, user.ID, "created", map[string]any{})
	if body.Notes != "" {
		addExpenseEvent(tx, id, user.ID, "notes", map[string]any{})
	}
	if len(body.Shares) > 0 {
		addExpenseEvent(tx, id, user.ID, "shares", map[string]any{"count": len(body.Shares)})
	}
	if body.PaymentMethod != nil {
		addExpenseEvent(tx, id, user.ID, "payment_method", map[string]any{"method": *body.PaymentMethod})
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}

	s.Hub.Broadcast("expenses")
	// TODO(phase-6): notifyUsers(db, debtors, 'pago_requerido', ...) push
	// notification (fire-and-forget in the Node; phase 3 drops it).

	expense, err := hydrateExpense(d, id)
	if err != nil || expense == nil {
		internalErr(w)
		return
	}
	w.Header().Set("Location", "/api/expenses/"+id)
	writeJSON(w, http.StatusCreated, map[string]any{"expense": expense})
}

func (s *Server) handleExpenseUpdate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	current, err := getExpense(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	if current == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}
	if current.CreatedBy != user.ID && current.PayerID != user.ID {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotMember))
		return
	}
	var body expenseUpdateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	var issues []issue
	if body.Title != nil && (len(*body.Title) < 1 || len(*body.Title) > 200) {
		issues = append(issues, issue{Path: []string{"title"}, Message: "title must be 1-200 characters"})
	}
	if body.AmountCents != nil && *body.AmountCents < 1 {
		issues = append(issues, issue{Path: []string{"amount_cents"}, Message: "amount_cents must be >= 1"})
	}
	if body.Notes != nil && len(*body.Notes) > 5000 {
		issues = append(issues, issue{Path: []string{"notes"}, Message: "notes too long"})
	}
	if body.PayerID != nil && (len(*body.PayerID) < 1 || len(*body.PayerID) > 100) {
		issues = append(issues, issue{Path: []string{"payer_id"}, Message: "invalid payer_id"})
	}
	if body.SpentAt != nil && *body.SpentAt < 0 {
		issues = append(issues, issue{Path: []string{"spent_at"}, Message: "invalid spent_at"})
	}
	if body.Step != nil && !validExpenseSteps[*body.Step] {
		issues = append(issues, issue{Path: []string{"step"}, Message: "invalid step"})
	}
	labelID, labelSet := decodeNullableStrField(body.LabelID, &issues, "label_id")
	projectID, projectSet := decodeNullableStrField(body.ProjectID, &issues, "project_id")
	paymentMethod, paymentMethodSet := decodePaymentMethodField(body.PaymentMethod, &issues)
	if body.Shares != nil {
		if len(*body.Shares) > 50 {
			issues = append(issues, issue{Path: []string{"shares"}, Message: "too many shares"})
		}
		for i, sh := range *body.Shares {
			if len(sh.UserID) < 1 || len(sh.UserID) > 100 {
				issues = append(issues, issue{Path: []string{"shares", strconv.Itoa(i), "user_id"}, Message: "invalid user_id"})
			}
			if sh.ShareCents < 0 {
				issues = append(issues, issue{Path: []string{"shares", strconv.Itoa(i), "share_cents"}, Message: "invalid share_cents"})
			}
		}
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}

	payerID := current.PayerID
	if body.PayerID != nil {
		payerID = *body.PayerID
		var u string
		if err := d.QueryRow("SELECT id FROM users WHERE id = ?", payerID).Scan(&u); err != nil {
			errors.Write(w, errors.New(422, errors.AssigneeNotMember))
			return
		}
	}
	if projectSet && projectID != nil {
		var pid string
		if err := d.QueryRow("SELECT id FROM projects WHERE id = ?", *projectID).Scan(&pid); err != nil {
			errors.Write(w, errors.New(422, errors.ValidationFailed))
			return
		}
	}
	amount := current.AmountCents
	if body.AmountCents != nil {
		amount = *body.AmountCents
	}
	if body.Shares != nil {
		if herr := validateShares(d, *body.Shares); herr != nil {
			errors.Write(w, herr)
			return
		}
	} else if body.AmountCents != nil && *body.AmountCents != current.AmountCents {
		var n int64
		_ = d.QueryRow("SELECT COUNT(*) FROM expense_shares WHERE expense_id = ?", id).Scan(&n)
		if n > 0 {
			errors.Write(w, errors.New(422, errors.ValidationFailed))
			return
		}
	}

	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	newTitle := current.Title
	if body.Title != nil {
		newTitle = *body.Title
	}
	newLabel := current.LabelID
	if labelSet {
		newLabel = toNullString(labelID)
	}
	newProject := current.ProjectID
	if projectSet {
		newProject = toNullString(projectID)
	}
	newNotes := current.Notes
	if body.Notes != nil {
		newNotes = sql.NullString{String: *body.Notes, Valid: true}
	}
	newPayment := current.PaymentMethod
	if paymentMethodSet {
		newPayment = toNullString(paymentMethod)
	}
	newSpent := current.SpentAt
	if body.SpentAt != nil {
		newSpent = sql.NullInt64{Int64: *body.SpentAt, Valid: true}
	}
	if _, err := tx.Exec(
		`UPDATE expenses SET title = ?, amount_cents = ?, label_id = ?, project_id = ?, notes = ?,
		 payer_id = ?, payment_method = ?, spent_at = ?, updated_at = ? WHERE id = ?`,
		newTitle, amount, sqlStr(newLabel), sqlStr(newProject), sqlStr(newNotes),
		payerID, sqlStr(newPayment), sqlInt(newSpent), now, id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if body.Shares != nil {
		writeShares(tx, id, *body.Shares, &payerID)
	}
	requested := current.Step
	if body.Step != nil {
		requested = *body.Step
	}
	newStep := resolveStep(tx, id, &payerID, requested)
	if _, err := tx.Exec("UPDATE expenses SET step = ? WHERE id = ?", newStep, id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if newStep != current.Step {
		applyStepFlags(tx, id, newStep)
	}

	if body.Title != nil && *body.Title != current.Title {
		addExpenseEvent(tx, id, user.ID, "title", map[string]any{"from": current.Title, "to": *body.Title})
	}
	if body.AmountCents != nil && *body.AmountCents != current.AmountCents {
		addExpenseEvent(tx, id, user.ID, "amount", map[string]any{"from": current.AmountCents, "to": *body.AmountCents})
	}
	if body.Notes != nil && *body.Notes != current.Notes.String {
		addExpenseEvent(tx, id, user.ID, "notes", map[string]any{})
	}
	if body.Shares != nil {
		addExpenseEvent(tx, id, user.ID, "shares", map[string]any{"count": len(*body.Shares)})
	}
	if body.PayerID != nil && *body.PayerID != current.PayerID {
		addExpenseEvent(tx, id, user.ID, "payer", map[string]any{})
	}
	if paymentMethodSet && !nullStringEq(newPayment, current.PaymentMethod) {
		addExpenseEvent(tx, id, user.ID, "payment_method", map[string]any{"to": nstr(newPayment)})
	}
	if newStep != current.Step {
		addExpenseEvent(tx, id, user.ID, "moved", map[string]any{"from": current.Step, "to": newStep})
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}

	s.Hub.Broadcast("expenses")
	expense, err := hydrateExpense(d, id)
	if err != nil || expense == nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"expense": expense})
}

func (s *Server) handleExpenseMyShare(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	var body expenseMyShareBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	current, err := getExpense(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	if current == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}
	var shareUser string
	if err := d.QueryRow("SELECT user_id FROM expense_shares WHERE expense_id = ? AND user_id = ?", id, user.ID).Scan(&shareUser); err != nil {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotMember))
		return
	}

	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	paidInt := 0
	if body.Paid {
		paidInt = 1
	}
	if _, err := tx.Exec("UPDATE expense_shares SET paid = ? WHERE expense_id = ? AND user_id = ?", paidInt, id, user.ID); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	newStep := resolveStep(tx, id, &current.PayerID, current.Step)
	if _, err := tx.Exec("UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?", newStep, nowMs(), id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if newStep != current.Step {
		applyStepFlags(tx, id, newStep)
	}
	addExpenseEvent(tx, id, user.ID, "paid", map[string]any{"share": true, "paid": body.Paid})
	if newStep != current.Step {
		addExpenseEvent(tx, id, user.ID, "moved", map[string]any{"from": current.Step, "to": newStep})
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}

	s.Hub.Broadcast("expenses")
	// TODO(phase-6): notifyUsers(db, [payer], 'pago_completado', ...) push
	// notification when the payer is not the actor (phase 3 drops it).

	expense, err := hydrateExpense(d, id)
	if err != nil || expense == nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"expense": expense})
}

func (s *Server) handleExpenseMove(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	var body expenseMoveBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if !validExpenseSteps[body.Step] {
		validationFailed(w, []issue{{Path: []string{"step"}, Message: "invalid step"}})
		return
	}
	if body.Position < 0 || body.Position > 100000 {
		validationFailed(w, []issue{{Path: []string{"position"}, Message: "invalid position"}})
		return
	}
	current, err := getExpense(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	if current == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}

	var maxPos int64
	_ = d.QueryRow("SELECT COALESCE(MAX(position), -1) FROM expenses WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL", body.Step).Scan(&maxPos)
	clamped := body.Position
	if clamped > maxPos+1 {
		clamped = maxPos + 1
	}

	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if current.ArchivedAt.Valid {
		if _, err := tx.Exec("UPDATE expenses SET position = position + 1 WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL AND position >= ?", body.Step, clamped); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
	} else {
		if _, err := tx.Exec("UPDATE expenses SET position = position - 1 WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL AND position > ?", current.Step, current.Position); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
		if _, err := tx.Exec("UPDATE expenses SET position = position + 1 WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL AND position >= ?", body.Step, clamped); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
	}
	if _, err := tx.Exec("UPDATE expenses SET step = ?, position = ?, updated_at = ? WHERE id = ?", body.Step, clamped, nowMs(), id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	applyStepFlags(tx, id, body.Step)
	addExpenseEvent(tx, id, user.ID, "moved", map[string]any{"from": current.Step, "to": body.Step})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}

	s.Hub.Broadcast("expenses")
	expense, err := hydrateExpense(d, id)
	if err != nil || expense == nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"expense": expense})
}

func (s *Server) handleExpenseArchive(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	current, err := getExpense(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	if current == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}
	if current.CreatedBy != user.ID && current.PayerID != user.ID {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotMember))
		return
	}
	if current.Step != "hecho" {
		errors.Write(w, errors.New(422, errors.ExpenseNotDone))
		return
	}
	if current.ArchivedAt.Valid {
		expense, err := hydrateExpense(d, id)
		if err != nil || expense == nil {
			internalErr(w)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"expense": expense})
		return
	}
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE expenses SET archived_at = ? WHERE id = ?", nowMs(), id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE expenses SET position = position - 1 WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL AND position > ?", current.Step, current.Position); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("expenses")
	expense, err := hydrateExpense(d, id)
	if err != nil || expense == nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"expense": expense})
}

func (s *Server) handleExpenseUnarchive(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	current, err := getExpense(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	if current == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}
	if current.CreatedBy != user.ID && current.PayerID != user.ID {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotMember))
		return
	}
	if !current.ArchivedAt.Valid {
		expense, err := hydrateExpense(d, id)
		if err != nil || expense == nil {
			internalErr(w)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"expense": expense})
		return
	}
	now := nowMs()
	var pos int64
	_ = d.QueryRow("SELECT COALESCE(MAX(position) + 1, 0) FROM expenses WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL", "hecho").Scan(&pos)
	if _, err := d.Exec("UPDATE expenses SET archived_at = NULL, done_at = ?, step = ?, position = ? WHERE id = ?", now, "hecho", pos, id); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("expenses")
	expense, err := hydrateExpense(d, id)
	if err != nil || expense == nil {
		internalErr(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"expense": expense})
}

func (s *Server) handleExpenseDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	row := d.QueryRow("SELECT "+expenseCols+" FROM expenses WHERE id = ? AND deleted_at IS NULL", id)
	current, err := scanExpenseRow(row)
	if err == sql.ErrNoRows || current == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}
	if err != nil {
		internalErr(w)
		return
	}
	if current.CreatedBy != user.ID {
		errors.Write(w, errors.New(http.StatusForbidden, errors.ProjectNotMember))
		return
	}
	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?", now, now, id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if !current.ArchivedAt.Valid {
		if _, err := tx.Exec("UPDATE expenses SET position = position - 1 WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL AND position > ?", current.Step, current.Position); err != nil {
			_ = tx.Rollback()
			internalErr(w)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("expenses")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleExpenseCommentsList(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	id := param(r, "id")
	exp, err := getExpense(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	if exp == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}
	rows, err := d.Query(
		`SELECT c.id, c.expense_id, c.user_id, c.author_name, c.body, c.created_at, u.username, u.color
		 FROM expense_comments c LEFT JOIN users u ON u.id = c.user_id
		 WHERE c.expense_id = ? ORDER BY c.created_at`, id)
	if err != nil {
		internalErr(w)
		return
	}
	defer rows.Close()
	comments := []map[string]any{}
	for rows.Next() {
		var cid, expenseID, body string
		var userID, authorName, username, userColor sql.NullString
		var createdAt int64
		if err := rows.Scan(&cid, &expenseID, &userID, &authorName, &body, &createdAt, &username, &userColor); err != nil {
			internalErr(w)
			return
		}
		name := nstr(username)
		if name == nil {
			name = nstr(authorName)
		}
		if name == nil {
			q := "?"
			name = &q
		}
		comments = append(comments, map[string]any{
			"id": cid, "expense_id": expenseID, "user_id": nstr(userID),
			"author_name": nstr(authorName), "body": body, "created_at": createdAt,
			"username": name, "user_color": nstr(userColor),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"comments": comments})
}

func (s *Server) handleExpenseCommentCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	expense, err := getExpense(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	if expense == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}
	var body expenseCommentBody
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
	if _, err := d.Exec("INSERT INTO expense_comments (id, expense_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
		commentID, id, user.ID, body.Body, now); err != nil {
		internalErr(w)
		return
	}
	if _, err := d.Exec("UPDATE expenses SET updated_at = ? WHERE id = ?", now, id); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("expenses")
	// TODO(phase-6): notifyUsers(db, interested, 'comentario', ...) push
	// notification (fire-and-forget in the Node; phase 3 drops it).

	w.Header().Set("Location", "/api/expenses/"+id+"/comments/"+commentID)
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "id": commentID})
}

func (s *Server) handleExpenseAttachmentCreate(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	user := auth.UserFrom(r)
	id := param(r, "id")
	expense, err := getExpense(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	if expense == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
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

	attID := ids.New()
	now := nowMs()
	tx, err := d.Begin()
	if err != nil {
		internalErr(w)
		return
	}
	if _, err := tx.Exec("INSERT INTO expense_attachments (id, expense_id, filename, stored_name, size, mime, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		attID, id, filename, stored, len(buf), mime, user.ID, now); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	if _, err := tx.Exec("UPDATE expenses SET updated_at = ? WHERE id = ?", now, id); err != nil {
		_ = tx.Rollback()
		internalErr(w)
		return
	}
	addExpenseEvent(tx, id, user.ID, "attachment", map[string]any{"filename": filename})
	if err := tx.Commit(); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("expenses")
	w.Header().Set("Location", "/api/expenses/"+id+"/attachments/"+attID)
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "id": attID, "filename": filename})
}

func (s *Server) handleExpenseAttachmentGet(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	id := param(r, "id")
	attID := param(r, "attId")
	exp, err := getExpense(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	if exp == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}
	var storedName, filename, mime string
	var size int64
	if err := d.QueryRow("SELECT stored_name, filename, mime, size FROM expense_attachments WHERE id = ? AND expense_id = ?", attID, id).Scan(&storedName, &filename, &mime, &size); err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.AttachmentNotFound))
		return
	}
	filePath := filepath.Join(s.UploadsDir, filepath.Base(storedName))
	buf, err := os.ReadFile(filePath)
	if err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.AttachmentFileMiss))
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(filename))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf)
}

func (s *Server) handleExpenseAttachmentDelete(w http.ResponseWriter, r *http.Request) {
	d := auth.DBFrom(r)
	id := param(r, "id")
	attID := param(r, "attId")
	exp, err := getExpense(d, id)
	if err != nil {
		internalErr(w)
		return
	}
	if exp == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}
	var storedName string
	if err := d.QueryRow("SELECT stored_name FROM expense_attachments WHERE id = ? AND expense_id = ?", attID, id).Scan(&storedName); err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.AttachmentNotFound))
		return
	}
	_ = os.Remove(filepath.Join(s.UploadsDir, filepath.Base(storedName)))
	if _, err := d.Exec("DELETE FROM expense_attachments WHERE id = ?", attID); err != nil {
		internalErr(w)
		return
	}
	s.Hub.Broadcast("expenses")
	w.WriteHeader(http.StatusNoContent)
}

// --- small decode / null helpers -----------------------------------------------

func decodeNullableStrField(raw json.RawMessage, issues *[]issue, field string) (val *string, set bool) {
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
	return &s, true
}

func decodePaymentMethodField(raw json.RawMessage, issues *[]issue) (val *string, set bool) {
	if len(raw) == 0 {
		return nil, false
	}
	if string(raw) == "null" {
		return nil, true
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil || !validPaymentMethods[s] {
		*issues = append(*issues, issue{Path: []string{"payment_method"}, Message: "invalid payment_method"})
		return nil, true
	}
	return &s, true
}

func toNullString(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}

func sqlInt(i sql.NullInt64) any {
	if i.Valid {
		return i.Int64
	}
	return nil
}

func nullStringEq(a, b sql.NullString) bool {
	if a.Valid != b.Valid {
		return false
	}
	if !a.Valid {
		return true
	}
	return a.String == b.String
}

// --- natural-language expense concept parser (server/src/nlp.ts parseExpenseText) ---

type expenseParseResult struct {
	SpentAt      *string `json:"spent_at"`
	AmountCents  *int64  `json:"amount_cents"`
	CleanedTitle string  `json:"cleanedTitle"`
}

type expenseDayEntry struct {
	word string
	idx  int
}

var expenseDaysES = []expenseDayEntry{
	{"domingo", 0}, {"domingos", 0}, {"lunes", 1}, {"martes", 2}, {"miércoles", 3}, {"miercoles", 3},
	{"jueves", 4}, {"viernes", 5}, {"sábado", 6}, {"sabado", 6}, {"sábados", 6}, {"sabados", 6},
}

var expenseDaysEN = []expenseDayEntry{
	{"sunday", 0}, {"sundays", 0}, {"monday", 1}, {"mondays", 1}, {"tuesday", 2}, {"tuesdays", 2},
	{"wednesday", 3}, {"wednesdays", 3}, {"thursday", 4}, {"thursdays", 4},
	{"friday", 5}, {"fridays", 5}, {"saturday", 6}, {"saturdays", 6},
}

var (
	isoDateExpRe   = regexp.MustCompile(`\b(\d{4})-(\d{2})-(\d{2})\b`)
	agoESExpRe     = regexp.MustCompile(`\bhace\s+(\d+)\s+(d[ií]as?|semanas?)\b`)
	agoENExpRe     = regexp.MustCompile(`\b(\d+)\s+(days?|weeks?)\s+ago\b`)
	amountExpRe    = regexp.MustCompile(`(?:€\s*(\d{1,6})(?:[.,](\d{1,3}))?)|(?:\b(\d{1,6})(?:[.,](\d{1,3}))?\s*(?:€|euros?\b|eur\b))`)
	wordStartExpRe = regexp.MustCompile(`^\w`)
	wordEndExpRe   = regexp.MustCompile(`\w$`)
)

func fmtISODate(t time.Time) string { return t.Format("2006-01-02") }

func addDaysISO(base string, n int) string {
	t, err := time.ParseInLocation("2006-01-02", base, time.Local)
	if err != nil {
		return base
	}
	return fmtISODate(t.AddDate(0, 0, n))
}

func lastWeekdayISO(base string, weekday int) string {
	t, err := time.ParseInLocation("2006-01-02", base, time.Local)
	if err != nil {
		return base
	}
	diff := (int(t.Weekday()) - weekday + 7) % 7
	return fmtISODate(t.AddDate(0, 0, -diff))
}

func stripExpenseParts(text string, parts []string) string {
	sorted := append([]string(nil), parts...)
	sort.Slice(sorted, func(i, j int) bool { return len(sorted[i]) > len(sorted[j]) })
	out := text
	for _, p := range sorted {
		esc := regexp.QuoteMeta(p)
		pre := ""
		if wordStartExpRe.MatchString(p) {
			pre = `\b`
		}
		post := ""
		if wordEndExpRe.MatchString(p) {
			post = `\b`
		}
		out = regexp.MustCompile("(?i)"+pre+esc+post).ReplaceAllString(out, " ")
	}
	out = strings.Join(strings.Fields(out), " ")
	out = strings.TrimSpace(out)
	out = strings.TrimRight(out, ", \t\n")
	return out
}

func parseExpenseText(text, lang string) *expenseParseResult {
	if text == "" {
		return nil
	}
	low := strings.ToLower(text)
	var days []expenseDayEntry
	if lang == "en" {
		days = expenseDaysEN
	} else {
		days = expenseDaysES
	}
	var spentAt string
	var amountCents int64
	hasSpent := false
	hasAmount := false
	var parts []string
	today := fmtISODate(time.Now())

	// ISO date
	if m := isoDateExpRe.FindStringSubmatch(low); m != nil {
		spentAt = m[0]
		hasSpent = true
		parts = append(parts, m[0])
	}

	// relative: hoy / ayer / anteayer (past)
	var relWords []expenseDayEntry
	if lang == "en" {
		relWords = []expenseDayEntry{{"day before yesterday", -2}, {"yesterday", -1}, {"today", 0}}
	} else {
		relWords = []expenseDayEntry{{"anteayer", -2}, {"ayer", -1}, {"hoy", 0}}
	}
	if !hasSpent {
		for _, rw := range relWords {
			if regexp.MustCompile("(?i)" + `\b` + regexp.QuoteMeta(rw.word) + `\b`).MatchString(text) {
				spentAt = addDaysISO(today, rw.idx)
				hasSpent = true
				parts = append(parts, rw.word)
				break
			}
		}
	}

	// hace N días/semanas / N days/weeks ago
	if !hasSpent {
		var m []string
		if lang == "en" {
			m = agoENExpRe.FindStringSubmatch(low)
		} else {
			m = agoESExpRe.FindStringSubmatch(low)
		}
		if m != nil {
			n, _ := strconv.Atoi(m[1])
			days := n
			if strings.HasPrefix(m[2], "sem") || strings.HasPrefix(m[2], "week") {
				days = n * 7
			}
			spentAt = addDaysISO(today, -days)
			hasSpent = true
			parts = append(parts, m[0])
		}
	}

	// "el <día> (pasado)" / "last|on <weekday>" -> most recent
	if !hasSpent {
		for _, d := range days {
			var re *regexp.Regexp
			if lang == "en" {
				re = regexp.MustCompile(`\b(?:last|on)\s+` + regexp.QuoteMeta(d.word) + `\b`)
			} else {
				re = regexp.MustCompile(`\bel\s+` + regexp.QuoteMeta(d.word) + `(?:\s+pasado)?\b`)
			}
			if m := re.FindString(low); m != "" {
				spentAt = lastWeekdayISO(today, d.idx)
				hasSpent = true
				parts = append(parts, m)
				break
			}
		}
	}

	// amount with currency mark
	if m := amountExpRe.FindStringSubmatch(low); m != nil {
		whole := m[1]
		frac := m[2]
		if whole == "" {
			whole = m[3]
			frac = m[4]
		}
		if frac == "" || len(frac) <= 2 {
			w, _ := strconv.ParseInt(whole, 10, 64)
			var cents int64
			if frac != "" {
				if len(frac) == 1 {
					frac += "0"
				}
				fr, _ := strconv.ParseInt(frac, 10, 64)
				cents = w*100 + fr
			} else {
				cents = w * 100
			}
			amountCents = cents
			hasAmount = true
			parts = append(parts, m[0])
		}
	}

	if !hasSpent && !hasAmount {
		return nil
	}
	cleaned := stripExpenseParts(text, parts)
	if cleaned == "" {
		return nil
	}
	res := &expenseParseResult{CleanedTitle: cleaned}
	if hasSpent {
		res.SpentAt = &spentAt
	}
	if hasAmount {
		res.AmountCents = &amountCents
	}
	return res
}

func (s *Server) handleExpenseParse(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
		Lang string `json:"lang"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if body.Lang == "" {
		body.Lang = "es"
	}
	if len(body.Text) < 1 || len(body.Text) > 200 {
		validationFailed(w, []issue{{Path: []string{"text"}, Message: "text must be 1-200 characters"}})
		return
	}
	if body.Lang != "es" && body.Lang != "en" {
		validationFailed(w, []issue{{Path: []string{"lang"}, Message: "invalid lang"}})
		return
	}
	result := parseExpenseText(body.Text, body.Lang)
	if result == nil {
		writeJSON(w, http.StatusOK, map[string]any{"parsed": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"parsed":       true,
		"spent_at":     result.SpentAt,
		"amount_cents": result.AmountCents,
		"cleanedTitle": result.CleanedTitle,
	})
}
