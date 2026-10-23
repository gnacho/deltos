// Package db ports server/src/db.ts: schema open, tolerant migrations,
// inbox project, hourly maintenance, kv helpers and auto-archive. SQL
// straight, no ORM. Timestamps are epoch ms except due_date ('YYYY-MM-DD').
package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gnacho/deltos/server-go/internal/logger"

	_ "modernc.org/sqlite"
)

var log = logger.L().Child(map[string]any{"component": "db"})

// DB wraps *sql.DB for the production or demo database.
type DB struct {
	*sql.DB
}

// Open mirrors openDb: create dir, open with pragmas, drop pre-v2 expenses
// table if present, run the schema and the tolerant migrations.
func Open(file string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return nil, fmt.Errorf("mkdir data dir: %w", err)
	}
	dsn := "file:" + file +
		"?_pragma=journal_mode(WAL)" +
		"&_pragma=synchronous(NORMAL)" + // not FULL: better perf, enough with WAL
		"&_pragma=foreign_keys(1)" +
		"&_pragma=busy_timeout(5000)"
	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// modernc/sqlite serializes writes; one connection keeps the single-writer
	// discipline explicit and avoids SQLITE_BUSY under concurrency.
	sqlDB.SetMaxOpenConns(1)
	d := &DB{sqlDB}

	// Pre-schema migration: v1 expenses had requested_user_id; the v2 layout
	// (shares) replaces the whole family (db.ts openDb).
	if expensesExists(d) {
		cols, err := columnNames(d, "expenses")
		if err != nil {
			sqlDB.Close()
			return nil, err
		}
		if contains(cols, "requested_user_id") {
			for _, t := range []string{
				"expense_shares", "expense_activity_events", "expense_comments",
				"expense_attachments", "expenses",
			} {
				if _, err := d.Exec("DROP TABLE IF EXISTS " + t); err != nil {
					sqlDB.Close()
					return nil, err
				}
			}
			log.Warn("schema_migrated", "table", "expenses", "action", "recreated_v2_shares_pre")
		}
	}

	if _, err := d.Exec(Schema); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	if err := d.Migrate(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return d, nil
}

func expensesExists(d *DB) bool {
	var name string
	err := d.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='expenses'").Scan(&name)
	return err == nil
}

func columnNames(d *DB, table string) ([]string, error) {
	rows, err := d.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	return cols, rows.Err()
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// Migrate ports migrateSchema: CREATE TABLE IF NOT EXISTS does not update
// existing tables, so every added column is checked and applied on start.
func (d *DB) Migrate() error {
	// users
	userCols, err := columnNames(d, "users")
	if err != nil {
		return err
	}
	type colAdd struct {
		table, column, ddl string
	}
	for _, c := range []colAdd{
		{"users", "display_name", "ALTER TABLE users ADD COLUMN display_name TEXT"},
		{"users", "expenses_enabled", "ALTER TABLE users ADD COLUMN expenses_enabled INTEGER NOT NULL DEFAULT 0"},
		{"users", "color", "ALTER TABLE users ADD COLUMN color TEXT DEFAULT 'slate'"},
		{"users", "anti_slip_threshold", "ALTER TABLE users ADD COLUMN anti_slip_threshold INTEGER NOT NULL DEFAULT 3"},
	} {
		if !contains(userCols, c.column) {
			if _, err := d.Exec(c.ddl); err != nil {
				return err
			}
			log.Info("schema_migrated", "table", c.table, "column", c.column)
		}
	}

	// sessions
	sessionCols, err := columnNames(d, "sessions")
	if err != nil {
		return err
	}
	if !contains(sessionCols, "csrf_token") {
		if _, err := d.Exec("ALTER TABLE sessions ADD COLUMN csrf_token TEXT"); err != nil {
			return err
		}
		log.Info("schema_migrated", "table", "sessions", "column", "csrf_token")
	}

	// tasks
	taskCols, err := columnNames(d, "tasks")
	if err != nil {
		return err
	}
	for _, c := range []colAdd{
		{"tasks", "deleted_at", "ALTER TABLE tasks ADD COLUMN deleted_at INTEGER"},
		{"tasks", "recurrence", "ALTER TABLE tasks ADD COLUMN recurrence TEXT"},
		{"tasks", "recurrence_group_id", "ALTER TABLE tasks ADD COLUMN recurrence_group_id TEXT"},
		{"tasks", "done_at", "ALTER TABLE tasks ADD COLUMN done_at INTEGER"},
		{"tasks", "archived_at", "ALTER TABLE tasks ADD COLUMN archived_at INTEGER"},
		{"tasks", "recurrence_paused", "ALTER TABLE tasks ADD COLUMN recurrence_paused INTEGER DEFAULT 0"},
		{"tasks", "short_id", "ALTER TABLE tasks ADD COLUMN short_id TEXT"},
	} {
		if !contains(taskCols, c.column) {
			if _, err := d.Exec(c.ddl); err != nil {
				return err
			}
			log.Info("schema_migrated", "table", c.table, "column", c.column)
		}
	}

	// projects + membership backfill (db.ts: legacy projects get every user as
	// member so nothing becomes invisible; owner_id stays NULL = legacy).
	projectCols, err := columnNames(d, "projects")
	if err != nil {
		return err
	}
	if !contains(projectCols, "owner_id") {
		if _, err := d.Exec("ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL"); err != nil {
			return err
		}
		log.Info("schema_migrated", "table", "projects", "column", "owner_id")
	}
	if !contains(projectCols, "is_inbox") {
		if _, err := d.Exec("ALTER TABLE projects ADD COLUMN is_inbox INTEGER NOT NULL DEFAULT 0"); err != nil {
			return err
		}
		log.Info("schema_migrated", "table", "projects", "column", "is_inbox")
	}
	projectCols, err = columnNames(d, "projects")
	if err != nil {
		return err
	}
	if !contains(projectCols, "task_seq") {
		if _, err := d.Exec("ALTER TABLE projects ADD COLUMN task_seq INTEGER NOT NULL DEFAULT 0"); err != nil {
			return err
		}
		log.Info("schema_migrated", "table", "projects", "column", "task_seq")
	}
	res, err := d.Exec(
		`INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at)
		 SELECT p.id, u.id, 'member', ?
		 FROM projects p CROSS JOIN users u
		 WHERE NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id)`, now())
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Info("project_members_backfilled", "rows", n)
	}

	// activity_events: type CHECK gains 'project' (v2). SQLite cannot ALTER a
	// CHECK: rebuild through a temp table when the stored SQL lacks it.
	if err := d.rebuildTableIfSQLMissing("activity_events", "'project'", `
		CREATE TABLE activity_events (
		  id TEXT PRIMARY KEY,
		  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
		  user_id TEXT REFERENCES users(id),
		  type TEXT NOT NULL CHECK (type IN
		    ('created','moved','priority','due','assigned','attachment','title','description','project')),
		  data TEXT DEFAULT '{}',
		  created_at INTEGER NOT NULL
		);
		INSERT INTO activity_events (id, task_id, user_id, type, data, created_at)
		  SELECT id, task_id, user_id, type, data, created_at FROM activity_events_old;
	`); err != nil {
		return err
	}

	// decision_activity_events: gains 'attachment' (issue #279).
	if err := d.rebuildTableIfSQLMissing("decision_activity_events", "'attachment'", `
		CREATE TABLE decision_activity_events (
		  id TEXT PRIMARY KEY,
		  decision_id TEXT REFERENCES decisions(id) ON DELETE CASCADE,
		  user_id TEXT REFERENCES users(id),
		  type TEXT NOT NULL CHECK (type IN
		    ('created','title','description','solution_added','solution_edited','solution_removed',
		     'voted','unchosen','chosen','comment','reopened','deleted','attachment')),
		  data TEXT DEFAULT '{}',
		  created_at INTEGER NOT NULL
		);
		INSERT INTO decision_activity_events (id, decision_id, user_id, type, data, created_at)
		  SELECT id, decision_id, user_id, type, data, created_at FROM decision_activity_events_old;
	`); err != nil {
		return err
	}

	// gam_points_ledger: gains decision_id + nullable task_id (issue #280).
	gamColsInfo, err := d.queryColumns("gam_points_ledger")
	if err != nil {
		return err
	}
	if !contains(colNames(gamColsInfo), "reverted_at") {
		if _, err := d.Exec("ALTER TABLE gam_points_ledger ADD COLUMN reverted_at INTEGER"); err != nil {
			return err
		}
		log.Info("schema_migrated", "table", "gam_points_ledger", "column", "reverted_at")
	}
	taskCol := findCol(gamColsInfo, "task_id")
	needsRebuild := !contains(colNames(gamColsInfo), "decision_id") ||
		(taskCol != nil && taskCol.notnull == 1)
	if needsRebuild {
		tx, err := d.Begin()
		if err != nil {
			return err
		}
		stmts := []string{
			`ALTER TABLE gam_points_ledger RENAME TO gam_points_ledger_old`,
			`CREATE TABLE gam_points_ledger (
			   id TEXT PRIMARY KEY,
			   user_id TEXT NOT NULL REFERENCES users(id),
			   task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
			   decision_id TEXT REFERENCES decisions(id) ON DELETE CASCADE,
			   points INTEGER NOT NULL,
			   reason TEXT NOT NULL DEFAULT 'task_done',
			   created_at INTEGER NOT NULL,
			   reverted_at INTEGER
			 )`,
			`INSERT INTO gam_points_ledger (id, user_id, task_id, decision_id, points, reason, created_at, reverted_at)
			   SELECT id, user_id, task_id, NULL, points, reason, created_at, reverted_at FROM gam_points_ledger_old`,
			`DROP TABLE gam_points_ledger_old`,
		}
		for _, s := range stmts {
			if _, err := tx.Exec(s); err != nil {
				_ = tx.Rollback()
				return err
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		log.Info("schema_migrated", "table", "gam_points_ledger", "change", "decision_id + task_id nullable")
	}
	// Ledger indexes ALWAYS here, outside the Schema (issue #282, lesson #246).
	for _, idx := range []string{
		"CREATE INDEX IF NOT EXISTS idx_gam_ledger_user ON gam_points_ledger(user_id, created_at)",
		"CREATE INDEX IF NOT EXISTS idx_gam_ledger_task ON gam_points_ledger(task_id, created_at)",
		"CREATE INDEX IF NOT EXISTS idx_gam_ledger_decision ON gam_points_ledger(decision_id, created_at)",
		"CREATE INDEX IF NOT EXISTS idx_gam_ledger_reverted ON gam_points_ledger(task_id, reverted_at)",
	} {
		if _, err := d.Exec(idx); err != nil {
			return err
		}
	}

	// expenses
	expenseCols, err := columnNames(d, "expenses")
	if err != nil {
		return err
	}
	for _, c := range []colAdd{
		{"expenses", "deleted_at", "ALTER TABLE expenses ADD COLUMN deleted_at INTEGER"},
		{"expenses", "done_at", "ALTER TABLE expenses ADD COLUMN done_at INTEGER"},
		{"expenses", "archived_at", "ALTER TABLE expenses ADD COLUMN archived_at INTEGER"},
		{"expenses", "payment_method", "ALTER TABLE expenses ADD COLUMN payment_method TEXT CHECK (payment_method IN ('bizum','transfer','efectivo'))"},
	} {
		if !contains(expenseCols, c.column) {
			if _, err := d.Exec(c.ddl); err != nil {
				return err
			}
			log.Info("schema_migrated", "table", c.table, "column", c.column)
		}
	}

	// expense_invites
	inviteCols, err := columnNames(d, "expense_invites")
	if err != nil {
		return err
	}
	for _, c := range []colAdd{
		{"expense_invites", "payment_method", "ALTER TABLE expense_invites ADD COLUMN payment_method TEXT CHECK (payment_method IN ('bizum','transfer','efectivo'))"},
		{"expense_invites", "notes", "ALTER TABLE expense_invites ADD COLUMN notes TEXT DEFAULT ''"},
		{"expense_invites", "token", "ALTER TABLE expense_invites ADD COLUMN token TEXT"},
	} {
		if !contains(inviteCols, c.column) {
			if _, err := d.Exec(c.ddl); err != nil {
				return err
			}
			log.Info("schema_migrated", "table", c.table, "column", c.column)
		}
	}
	// security: invitation tokens are NEVER stored in plaintext; clear any
	// leftovers from older versions.
	res, err = d.Exec("UPDATE expense_invites SET token = NULL WHERE token IS NOT NULL")
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Info("invite_plaintext_tokens_cleared", "rows", n)
	}

	// expense_comments
	exCommentCols, err := columnNames(d, "expense_comments")
	if err != nil {
		return err
	}
	if !contains(exCommentCols, "author_name") {
		if _, err := d.Exec("ALTER TABLE expense_comments ADD COLUMN author_name TEXT"); err != nil {
			return err
		}
		log.Info("schema_migrated", "table", "expense_comments", "column", "author_name")
	}

	return d.backfillShortIds()
}

type pragmaColumn struct {
	name    string
	notnull int
}

func (d *DB) queryColumns(table string) ([]pragmaColumn, error) {
	rows, err := d.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []pragmaColumn
	for rows.Next() {
		var cid int
		var c pragmaColumn
		var ctype string
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &c.name, &ctype, &c.notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols = append(cols, c)
	}
	return cols, rows.Err()
}

func colNames(cols []pragmaColumn) []string {
	out := make([]string, len(cols))
	for i, c := range cols {
		out[i] = c.name
	}
	return out
}

func findCol(cols []pragmaColumn, name string) *pragmaColumn {
	for i := range cols {
		if cols[i].name == name {
			return &cols[i]
		}
	}
	return nil
}

// rebuildTableIfSQLMissing recreates table through *_old when the stored
// CREATE SQL does not contain marker (CHECK constraints cannot be ALTERed).
func (d *DB) rebuildTableIfSQLMissing(table, marker, createAndCopy string) error {
	var sqlText string
	err := d.QueryRow("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&sqlText)
	if err == sql.ErrNoRows {
		return nil // table does not exist yet: the Schema will create it fresh
	}
	if err != nil {
		return err
	}
	if strings.Contains(sqlText, marker) {
		return nil
	}
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	stmts := []string{
		"ALTER TABLE " + table + " RENAME TO " + table + "_old",
		createAndCopy,
		"DROP TABLE " + table + "_old",
	}
	for _, s := range stmts {
		if _, err := tx.Exec(s); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	// The DROP of the old table removes its indexes: recreate them.
	switch table {
	case "activity_events":
		_, _ = d.Exec("CREATE INDEX IF NOT EXISTS idx_activity_task ON activity_events(task_id, created_at)")
		_, _ = d.Exec("CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at)")
	case "decision_activity_events":
		_, _ = d.Exec("CREATE INDEX IF NOT EXISTS idx_decision_activity_decision ON decision_activity_events(decision_id, created_at)")
	}
	log.Info("schema_migrated", "table", table, "change", "rebuild")
	return nil
}

func now() int64 { return time.Now().UnixMilli() }

// --- Short ids -------------------------------------------------------------

var nonAlnum = regexp.MustCompile(`[^A-Z0-9]`)

// ProjectPrefix is the readable prefix of a project ("Casa" -> CASA).
func ProjectPrefix(name string) string {
	cleaned := nonAlnum.ReplaceAllString(strings.ToUpper(strings.TrimSpace(name)), "")
	if cleaned == "" {
		return "T"
	}
	if len(cleaned) > 4 {
		cleaned = cleaned[:4]
	}
	return cleaned
}

// AllocateShortId reserves the next short id of a project. Call it INSIDE the
// transaction that inserts the task (single writer, no race).
func (d *DB) AllocateShortId(tx *sql.Tx, projectID string) (string, error) {
	var name string
	var seq sql.NullInt64
	err := tx.QueryRow("SELECT name, task_seq FROM projects WHERE id = ?", projectID).Scan(&name, &seq)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	next := seq.Int64 + 1
	if _, err := tx.Exec("UPDATE projects SET task_seq = ? WHERE id = ?", next, projectID); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%d", ProjectPrefix(name), next), nil
}

// backfillShortIds assigns short_id to tasks missing it, per project in
// creation order. Idempotent.
func (d *DB) backfillShortIds() error {
	var missing int
	if err := d.QueryRow("SELECT COUNT(*) FROM tasks WHERE short_id IS NULL").Scan(&missing); err != nil {
		return err
	}
	if missing == 0 {
		return nil
	}
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	rows, err := tx.Query("SELECT id, name, task_seq FROM projects")
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	type proj struct {
		id   string
		name string
		seq  int64
	}
	var projects []proj
	for rows.Next() {
		var p proj
		var seq sql.NullInt64
		if err := rows.Scan(&p.id, &p.name, &seq); err != nil {
			rows.Close()
			_ = tx.Rollback()
			return err
		}
		p.seq = seq.Int64
		projects = append(projects, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		_ = tx.Rollback()
		return err
	}
	total := int64(0)
	for _, p := range projects {
		seq := p.seq
		trows, err := tx.Query("SELECT id FROM tasks WHERE project_id = ? AND short_id IS NULL ORDER BY created_at, id", p.id)
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		var ids []string
		for trows.Next() {
			var id string
			if err := trows.Scan(&id); err != nil {
				trows.Close()
				_ = tx.Rollback()
				return err
			}
			ids = append(ids, id)
		}
		trows.Close()
		for _, id := range ids {
			seq++
			if _, err := tx.Exec("UPDATE tasks SET short_id = ? WHERE id = ?", fmt.Sprintf("%s-%d", ProjectPrefix(p.name), seq), id); err != nil {
				_ = tx.Rollback()
				return err
			}
		}
		if _, err := tx.Exec("UPDATE projects SET task_seq = ? WHERE id = ?", seq, p.id); err != nil {
			_ = tx.Rollback()
			return err
		}
		total += int64(len(ids))
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	log.Info("schema_backfilled", "table", "tasks", "column", "short_id", "rows", total)
	return nil
}

// --- Inbox project ----------------------------------------------------------

// InboxProjectID is the "Sin proyecto" tray: a real project (membership,
// board, counters keep working) marked is_inbox: not editable, hidden from
// the Projects page. The front translates the name (task.noProject).
const InboxProjectID = "inbox"

const inboxProjectName = "Inbox"

// EnsureInbox guarantees the inbox project exists and EVERY user is a member
// (tasks without project must be visible to everyone). Idempotent.
func (d *DB) EnsureInbox() (string, error) {
	n := now()
	var id string
	err := d.QueryRow("SELECT id FROM projects WHERE is_inbox = 1").Scan(&id)
	if err == sql.ErrNoRows {
		err = d.QueryRow("SELECT id FROM projects WHERE id = ?", InboxProjectID).Scan(&id)
		if err == sql.ErrNoRows {
			var pos sql.NullInt64
			if err := d.QueryRow("SELECT COALESCE(MIN(position) - 1, 0) FROM projects").Scan(&pos); err != nil {
				return "", err
			}
			if _, err := d.Exec(
				`INSERT INTO projects (id, name, emoji, color, position, owner_id, is_inbox, created_at)
				 VALUES (?, ?, ?, ?, ?, NULL, 1, ?)`,
				InboxProjectID, inboxProjectName, "inbox", "slate", pos.Int64, n,
			); err != nil {
				return "", err
			}
			log.Info("inbox_project_created", "id", InboxProjectID)
		} else if err != nil {
			return "", err
		} else if _, err := d.Exec("UPDATE projects SET is_inbox = 1 WHERE id = ?", InboxProjectID); err != nil {
			return "", err
		}
		id = InboxProjectID
	} else if err != nil {
		return "", err
	}
	res, err := d.Exec(
		`INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at)
		 SELECT ?, id, 'member', ? FROM users`, id, n)
	if err != nil {
		return "", err
	}
	if c, _ := res.RowsAffected(); c > 0 {
		log.Info("inbox_members_added", "rows", c)
	}
	return id, nil
}

// EnsureUserInInbox adds a newly created user as inbox member (idempotent).
func (d *DB) EnsureUserInInbox(userID string) error {
	_, err := d.Exec(
		`INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at)
		 SELECT id, ?, 'member', ? FROM projects WHERE is_inbox = 1`, userID, now())
	return err
}

// --- Maintenance -------------------------------------------------------------

// HourlyMaintenance ports hourlyMaintenance: WAL truncate checkpoint +
// expired sessions, 30-day trash, stale login attempts.
func (d *DB) HourlyMaintenance(label string) {
	if _, err := d.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		log.Error("wal_checkpoint_failed", "db", label, "error", err.Error())
	}
	purge := func(q string, args ...any) {
		res, err := d.Exec(q, args...)
		if err != nil {
			log.Error("maintenance_purge_failed", "db", label, "error", err.Error())
			return
		}
		if c, _ := res.RowsAffected(); c > 0 {
			log.Info("maintenance_purged", "db", label, "rows", c)
		}
	}
	purge("DELETE FROM sessions WHERE expires_at < ?", now())
	cutoff := now() - 30*24*60*60*1000
	purge("DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?", cutoff)
	purge("DELETE FROM expenses WHERE deleted_at IS NOT NULL AND deleted_at < ?", cutoff)
	purge("DELETE FROM decisions WHERE deleted_at IS NOT NULL AND deleted_at < ?", cutoff)
	oneHourAgo := now() - 3600*1000
	purge("DELETE FROM login_attempts WHERE locked_until > 0 AND locked_until < ?", oneHourAgo)
}

// --- kv -----------------------------------------------------------------------

// KVGet returns the value of key or fallback when missing.
func (d *DB) KVGet(key, fallback string) string {
	var v string
	err := d.QueryRow("SELECT value FROM kv WHERE key = ?", key).Scan(&v)
	if err != nil {
		return fallback
	}
	return v
}

// KVSet upserts a value (converted to string, as kvSet in db.ts).
func (d *DB) KVSet(key string, value any) error {
	s := fmt.Sprint(value)
	_, err := d.Exec(
		"INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, s)
	return err
}

// GetArchiveAfterDays returns archive_after_days (default 3).
func (d *DB) GetArchiveAfterDays() int {
	raw := d.KVGet("archive_after_days", "3")
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 3
	}
	return n
}

// ArchiveStaleDoneTasks ports archiveStaleDoneTasks: tasks in 'hecho' done
// more than N days ago get archived_at (they leave the board; recoverable
// with "show archived"). The first UPDATE self-heals done_at of 'hecho'
// tasks without the mark. Returns the number archived.
func (d *DB) ArchiveStaleDoneTasks() (int, error) {
	return archiveStaleDone(d, "tasks", `"column"`)
}

// ArchiveStaleDoneExpenses is the expenses mirror over step 'hecho'.
func (d *DB) ArchiveStaleDoneExpenses() (int, error) {
	return archiveStaleDone(d, "expenses", "step")
}

func archiveStaleDone(d *DB, table, col string) (int, error) {
	days := d.GetArchiveAfterDays()
	cutoff := now() - int64(days)*24*60*60*1000
	tx, err := d.Begin()
	if err != nil {
		return 0, err
	}
	selfHeal := "UPDATE " + table + " SET done_at = updated_at WHERE " + col +
		" = 'hecho' AND done_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL"
	if _, err := tx.Exec(selfHeal); err != nil {
		_ = tx.Rollback()
		return 0, err
	}
	query := "SELECT id, position FROM " + table + " WHERE " + col +
		" = 'hecho' AND archived_at IS NULL AND deleted_at IS NULL AND done_at IS NOT NULL AND done_at < ?"
	rows, err := tx.Query(query, cutoff)
	if err != nil {
		_ = tx.Rollback()
		return 0, err
	}
	type row struct {
		id       string
		position int64
	}
	var stale []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.position); err != nil {
			rows.Close()
			_ = tx.Rollback()
			return 0, err
		}
		stale = append(stale, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		_ = tx.Rollback()
		return 0, err
	}
	if len(stale) == 0 {
		if err := tx.Commit(); err != nil {
			return 0, err
		}
		return 0, nil
	}
	n := now()
	for _, r := range stale {
		if _, err := tx.Exec("UPDATE "+table+" SET archived_at = ? WHERE id = ?", n, r.id); err != nil {
			_ = tx.Rollback()
			return 0, err
		}
		compact := "UPDATE " + table + " SET position = position - 1 WHERE " + col +
			" = ? AND position > ? AND archived_at IS NULL AND deleted_at IS NULL"
		if _, err := tx.Exec(compact, "hecho", r.position); err != nil {
			_ = tx.Rollback()
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	event := "tasks_auto_archived"
	if table == "expenses" {
		event = "expenses_auto_archived"
	}
	log.Info(event, "count", len(stale))
	return len(stale), nil
}
