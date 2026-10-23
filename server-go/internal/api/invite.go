// Package api: invitation flows (server/src/routes-invite.ts). Invitations
// split an expense with a non-user (by name); the token lives ONLY as a
// SHA-256 hash in the DB (plaintext is generated once, returned to the
// creator, and never stored). Public GET/pay/comments routes resolve by token
// hash without leaking whether an unknown token exists (404 EXPENSE_NOT_FOUND).
package api

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gnacho/deltos/server-go/internal/errors"
	"github.com/gnacho/deltos/server-go/internal/ids"
)

func (s *Server) registerInviteRoutes(r *rtr) {
	r.Get("/api/expenses/:id/invites", s.expenseGate(s.handleInviteList))
	r.Post("/api/invite/create", s.handleInviteCreate)
	r.Get("/api/invite/:token", s.handleInviteGet)
	r.Put("/api/invite/:token/pay", s.handleInvitePay)
	r.Post("/api/invite/:token/comments", s.handleInviteComment)
	r.Delete("/api/invite/:id", s.handleInviteDelete)
}

type inviteCreateBody struct {
	InviteName string `json:"invite_name"`
	ShareCents int64  `json:"share_cents"`
	ExpenseID  string `json:"expense_id"`
	Notes      string `json:"notes"`
}

type invitePayBody struct {
	PaymentMethod *string `json:"payment_method"`
}

type inviteCommentBody struct {
	Body string `json:"body"`
}

type inviteRow struct {
	ID            string
	ExpenseID     string
	InviteName    string
	ShareCents    int64
	Paid          int64
	Notes         sql.NullString
	PaymentMethod sql.NullString
}

func scanInviteRow(sc scanner) (*inviteRow, error) {
	var i inviteRow
	err := sc.Scan(&i.ID, &i.ExpenseID, &i.InviteName, &i.ShareCents, &i.Paid, &i.Notes, &i.PaymentMethod)
	if err != nil {
		return nil, err
	}
	return &i, nil
}

// inviteByToken resolves an invite by its SHA-256 token hash (nil when unknown,
// mirroring the Node's silent 404 on unknown tokens).
func inviteByToken(q querier, rawToken string) (*inviteRow, error) {
	if rawToken == "" || len(rawToken) > 200 {
		return nil, nil
	}
	row := q.QueryRow("SELECT id, expense_id, invite_name, share_cents, paid, notes, payment_method FROM expense_invites WHERE token_hash = ?", sha256Hex(rawToken))
	i, err := scanInviteRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return i, err
}

func (s *Server) handleInviteList(w http.ResponseWriter, r *http.Request) {
	d := s.Prod
	expenseID := param(r, "id")
	rows, err := d.Query(
		"SELECT id, invite_name, share_cents, paid, payment_method, notes, created_at FROM expense_invites WHERE expense_id = ? ORDER BY created_at",
		expenseID)
	if err != nil {
		internalErr(w)
		return
	}
	defer rows.Close()
	invites := []map[string]any{}
	for rows.Next() {
		var id, inviteName string
		var shareCents, paid, createdAt int64
		var paymentMethod, notes sql.NullString
		if err := rows.Scan(&id, &inviteName, &shareCents, &paid, &paymentMethod, &notes, &createdAt); err != nil {
			internalErr(w)
			return
		}
		invites = append(invites, map[string]any{
			"id": id, "invite_name": inviteName, "share_cents": shareCents,
			"paid": paid, "payment_method": nstr(paymentMethod), "notes": nstr(notes),
			"created_at": createdAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": invites})
}

func (s *Server) handleInviteCreate(w http.ResponseWriter, r *http.Request) {
	d := s.Prod
	var body inviteCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	var issues []issue
	if len(body.InviteName) < 1 || len(body.InviteName) > 100 {
		issues = append(issues, issue{Path: []string{"invite_name"}, Message: "invite_name must be 1-100 characters"})
	}
	if body.ShareCents < 0 {
		issues = append(issues, issue{Path: []string{"share_cents"}, Message: "share_cents must be >= 0"})
	}
	if len(body.ExpenseID) < 1 || len(body.ExpenseID) > 100 {
		issues = append(issues, issue{Path: []string{"expense_id"}, Message: "invalid expense_id"})
	}
	if len(body.Notes) > 500 {
		issues = append(issues, issue{Path: []string{"notes"}, Message: "notes too long"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}

	var expenseID, createdBy string
	var amountCents int64
	if err := d.QueryRow("SELECT id, created_by, amount_cents FROM expenses WHERE id = ? AND deleted_at IS NULL", body.ExpenseID).
		Scan(&expenseID, &createdBy, &amountCents); err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}

	token := ids.New()
	tokenHash := sha256Hex(token)
	id := ids.New()
	now := nowMs()

	if _, err := d.Exec(
		"INSERT INTO expense_invites (id, expense_id, token_hash, invite_name, share_cents, paid, notes, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
		id, expenseID, tokenHash, body.InviteName, body.ShareCents, body.Notes, now); err != nil {
		internalErr(w)
		return
	}

	var step string
	var payerID sql.NullString
	if err := d.QueryRow("SELECT step, payer_id FROM expenses WHERE id = ?", expenseID).Scan(&step, &payerID); err != nil {
		internalErr(w)
		return
	}
	newStep := resolveStep(d, expenseID, nstr(payerID), step)
	if newStep != step {
		if _, err := d.Exec("UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?", newStep, now, expenseID); err != nil {
			internalErr(w)
			return
		}
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"invite": map[string]any{
			"id":          id,
			"expense_id":  expenseID,
			"invite_name": body.InviteName,
			"share_cents": body.ShareCents,
			"paid":        false,
			"notes":       body.Notes,
			"token":       token,
			"url":         r.Header.Get("Origin") + "/invite/" + token,
		},
	})
}

func (s *Server) handleInviteGet(w http.ResponseWriter, r *http.Request) {
	d := s.Prod
	rawToken := param(r, "token")
	invite, err := inviteByToken(d, rawToken)
	if err != nil {
		internalErr(w)
		return
	}
	if invite == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}

	var expenseID, title, createdByUsername string
	var amountCents int64
	var paymentMethod, payerID, notes sql.NullString
	var step string
	if err := d.QueryRow(
		`SELECT e.id, e.title, e.amount_cents, e.payment_method, e.step, e.payer_id, e.notes, u.username
		 FROM expenses e JOIN users u ON u.id = e.created_by
		 WHERE e.id = ? AND e.deleted_at IS NULL`, invite.ExpenseID).
		Scan(&expenseID, &title, &amountCents, &paymentMethod, &step, &payerID, &notes, &createdByUsername); err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}

	notesVal := ""
	if notes.Valid {
		notesVal = notes.String
	}
	inviteNotes := ""
	if invite.Notes.Valid {
		inviteNotes = invite.Notes.String
	}

	attachments := []map[string]any{}
	arows, err := d.Query("SELECT id, filename, size, mime FROM expense_attachments WHERE expense_id = ? ORDER BY created_at", invite.ExpenseID)
	if err == nil {
		defer arows.Close()
		for arows.Next() {
			var aid, filename, mime string
			var size int64
			if arows.Scan(&aid, &filename, &size, &mime) == nil {
				attachments = append(attachments, map[string]any{"id": aid, "filename": filename, "size": size, "mime": mime})
			}
		}
	}

	activity := []map[string]any{}
	erows, err := d.Query(
		`SELECT ae.id, ae.type, ae.data, ae.created_at, u.username
		 FROM expense_activity_events ae JOIN users u ON u.id = ae.user_id
		 WHERE ae.expense_id = ? ORDER BY ae.created_at DESC LIMIT 50`, invite.ExpenseID)
	if err == nil {
		defer erows.Close()
		for erows.Next() {
			var eid, typ, data string
			var createdAt int64
			var username string
			if erows.Scan(&eid, &typ, &data, &createdAt, &username) == nil {
				activity = append(activity, map[string]any{
					"id": eid, "type": typ, "data": data, "created_at": createdAt, "username": username,
				})
			}
		}
	}

	comments := []map[string]any{}
	crows, err := d.Query(
		`SELECT c.id, c.body, c.created_at, u.username, u.color, c.author_name
		 FROM expense_comments c LEFT JOIN users u ON u.id = c.user_id
		 WHERE c.expense_id = ? ORDER BY c.created_at`, invite.ExpenseID)
	if err == nil {
		defer crows.Close()
		for crows.Next() {
			var cid, body string
			var createdAt int64
			var username, userColor, authorName sql.NullString
			if crows.Scan(&cid, &body, &createdAt, &username, &userColor, &authorName) == nil {
				name := nstr(username)
				if name == nil {
					name = nstr(authorName)
				}
				if name == nil {
					q := "?"
					name = &q
				}
				comments = append(comments, map[string]any{
					"id": cid, "body": body, "created_at": createdAt,
					"username": name, "user_color": nstr(userColor), "author_name": nstr(authorName),
				})
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"expense": map[string]any{
			"id":                  expenseID,
			"title":               title,
			"amount_cents":        amountCents,
			"payment_method":      nstr(paymentMethod),
			"step":                step,
			"payer_id":            nstr(payerID),
			"notes":               notesVal,
			"created_by_username": createdByUsername,
		},
		"invite": map[string]any{
			"id":             invite.ID,
			"invite_name":    invite.InviteName,
			"share_cents":    invite.ShareCents,
			"paid":           invite.Paid != 0,
			"payment_method": nstr(invite.PaymentMethod),
			"notes":          inviteNotes,
		},
		"attachments": attachments,
		"activity":    activity,
		"comments":    comments,
	})
}

func (s *Server) handleInvitePay(w http.ResponseWriter, r *http.Request) {
	d := s.Prod
	rawToken := param(r, "token")
	invite, err := inviteByToken(d, rawToken)
	if err != nil {
		internalErr(w)
		return
	}
	if invite == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}

	var body invitePayBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if body.PaymentMethod != nil && !validPaymentMethods[*body.PaymentMethod] {
		validationFailed(w, []issue{{Path: []string{"payment_method"}, Message: "invalid payment_method"}})
		return
	}

	if invite.Paid != 0 {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "already_paid": true})
		return
	}

	if _, err := d.Exec("UPDATE expense_invites SET paid = 1, payment_method = ? WHERE id = ?", body.PaymentMethod, invite.ID); err != nil {
		internalErr(w)
		return
	}

	var step string
	var payerID sql.NullString
	if err := d.QueryRow("SELECT step, payer_id FROM expenses WHERE id = ?", invite.ExpenseID).Scan(&step, &payerID); err != nil {
		internalErr(w)
		return
	}
	newStep := resolveStep(d, invite.ExpenseID, nstr(payerID), step)
	if newStep != step {
		if _, err := d.Exec("UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?", newStep, nowMs(), invite.ExpenseID); err != nil {
			internalErr(w)
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleInviteComment(w http.ResponseWriter, r *http.Request) {
	d := s.Prod
	rawToken := param(r, "token")
	invite, err := inviteByToken(d, rawToken)
	if err != nil {
		internalErr(w)
		return
	}
	if invite == nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}

	var body inviteCommentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	if len(body.Body) < 1 || len(body.Body) > 5000 {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "body must be 1-5000 characters"}})
		return
	}

	id := ids.New()
	now := nowMs()
	if _, err := d.Exec(
		"INSERT INTO expense_comments (id, expense_id, user_id, author_name, body, created_at) VALUES (?, ?, NULL, ?, ?, ?)",
		id, invite.ExpenseID, invite.InviteName, body.Body, now); err != nil {
		internalErr(w)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"ok": true})
}

func (s *Server) handleInviteDelete(w http.ResponseWriter, r *http.Request) {
	d := s.Prod
	inviteID := param(r, "id")
	var expenseID string
	if err := d.QueryRow(
		"SELECT i.expense_id FROM expense_invites i JOIN expenses e ON e.id = i.expense_id WHERE i.id = ?",
		inviteID).Scan(&expenseID); err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}
	var payerID, step string
	if err := d.QueryRow("SELECT payer_id, step FROM expenses WHERE id = ? AND deleted_at IS NULL", expenseID).
		Scan(&payerID, &step); err != nil {
		errors.Write(w, errors.New(http.StatusNotFound, errors.ExpenseNotFound))
		return
	}

	if _, err := d.Exec("DELETE FROM expense_invites WHERE id = ?", inviteID); err != nil {
		internalErr(w)
		return
	}

	var remaining int64
	_ = d.QueryRow(
		`SELECT (SELECT COUNT(*) FROM expense_shares WHERE expense_id = ?)
		      + (SELECT COUNT(*) FROM expense_invites WHERE expense_id = ?)`,
		expenseID, expenseID).Scan(&remaining)
	newStep := ""
	if remaining == 0 {
		newStep = "nuevo"
	} else {
		newStep = resolveStep(d, expenseID, &payerID, step)
	}
	if newStep != step {
		if _, err := d.Exec("UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?", newStep, nowMs(), expenseID); err != nil {
			internalErr(w)
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
