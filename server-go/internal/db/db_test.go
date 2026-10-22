package db

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func openTemp(t *testing.T) *DB {
	t.Helper()
	d, err := Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestSchemaTableCount(t *testing.T) {
	d := openTemp(t)
	rows, err := d.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	// The TS SCHEMA has 34 CREATE TABLE IF NOT EXISTS (a naive grep over
	// db.ts says 35 because line 468 is a comment; see verify-schema gate).
	if count < 34 {
		t.Fatalf("expected >= 34 tables, got %d", count)
	}
}

func TestLedgerIndexesOutsideSchema(t *testing.T) {
	// Lesson #246 / issue #282: idx_gam_ledger_decision must NOT be in the
	// SCHEMA (it would break old DBs where decision_id does not exist yet).
	// It must exist after open (Migrate creates it unconditionally).
	d := openTemp(t)
	var name string
	err := d.QueryRow("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_gam_ledger_decision'").Scan(&name)
	if err != nil {
		t.Fatalf("idx_gam_ledger_decision must exist after open: %v", err)
	}
}

// seedOld runs raw SQL without the current Schema, simulating a database
// from an older release.
func seedOld(t *testing.T, file, ddl string) {
	t.Helper()
	h, err := sql.Open("sqlite", "file:"+file)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.Exec(ddl); err != nil {
		t.Fatalf("seed old schema: %v", err)
	}
	if err := h.Close(); err != nil {
		t.Fatal(err)
	}
}

func hasColumn(t *testing.T, d *DB, table, column string) bool {
	t.Helper()
	cols, err := columnNames(d, table)
	if err != nil {
		t.Fatalf("table %s: %v", table, err)
	}
	return contains(cols, column)
}

func TestMigrationFromOldSchema(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "app.db")
	seedOld(t, file, `
	CREATE TABLE users (
	  id TEXT PRIMARY KEY,
	  username TEXT UNIQUE NOT NULL,
	  password_hash TEXT NOT NULL,
	  role TEXT DEFAULT 'user',
	  created_at INTEGER NOT NULL
	);
	CREATE TABLE sessions (
	  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
	  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ua TEXT
	);
	CREATE TABLE login_attempts (ip TEXT PRIMARY KEY, attempts INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0);
	CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);
	CREATE TABLE labels (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT DEFAULT 'slate');
	CREATE TABLE projects (
	  id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT DEFAULT '', color TEXT DEFAULT 'sky',
	  position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
	);
	CREATE TABLE tasks (
	  id TEXT PRIMARY KEY,
	  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	  title TEXT NOT NULL, description TEXT DEFAULT '',
	  "column" TEXT NOT NULL DEFAULT 'nuevo',
	  position INTEGER NOT NULL DEFAULT 0,
	  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
	);
	CREATE TABLE task_labels (task_id TEXT NOT NULL, label_id TEXT NOT NULL, PRIMARY KEY (task_id, label_id));
	CREATE TABLE attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, filename TEXT NOT NULL,
	  stored_name TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by TEXT, created_at INTEGER NOT NULL);
	CREATE TABLE comments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, user_id TEXT, body TEXT NOT NULL, created_at INTEGER NOT NULL);
	CREATE TABLE activity_events (
	  id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
	  user_id TEXT REFERENCES users(id), type TEXT NOT NULL CHECK (type IN
	    ('created','moved','priority','due','assigned','attachment','title','description')),
	  data TEXT DEFAULT '{}', created_at INTEGER NOT NULL
	);
	CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, endpoint TEXT UNIQUE NOT NULL,
	  p256dh TEXT NOT NULL, auth TEXT NOT NULL, user_agent TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
	CREATE TABLE notification_preferences (user_id TEXT NOT NULL, tipo TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
	  min_severity TEXT NOT NULL DEFAULT 'normal', updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, tipo));
	CREATE TABLE notification_quiet_hours (user_id TEXT PRIMARY KEY, quiet_start INTEGER, quiet_end INTEGER,
	  tz TEXT NOT NULL DEFAULT 'Europe/Madrid', updated_at INTEGER NOT NULL);
	CREATE TABLE notification_queue (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tipo TEXT NOT NULL,
	  severity TEXT NOT NULL DEFAULT 'normal', datos_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
	CREATE TABLE task_subtasks (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL,
	  done INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
	CREATE TABLE admin_audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
	  target_type TEXT, target_id TEXT, data TEXT DEFAULT '{}', created_at INTEGER NOT NULL);
	CREATE TABLE expenses (
	  id TEXT PRIMARY KEY, title TEXT NOT NULL, amount_cents INTEGER NOT NULL,
	  label_id TEXT, project_id TEXT, notes TEXT DEFAULT '', payer_id TEXT NOT NULL,
	  spent_at INTEGER NOT NULL, step TEXT NOT NULL DEFAULT 'nuevo', position INTEGER NOT NULL DEFAULT 0,
	  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
	);
	CREATE TABLE expense_shares (expense_id TEXT NOT NULL, user_id TEXT NOT NULL, share_cents INTEGER NOT NULL,
	  paid INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (expense_id, user_id));
	CREATE TABLE expense_invites (id TEXT PRIMARY KEY, expense_id TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
	  invite_name TEXT NOT NULL, share_cents INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
	CREATE TABLE expense_attachments (id TEXT PRIMARY KEY, expense_id TEXT NOT NULL, filename TEXT NOT NULL,
	  stored_name TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by TEXT, created_at INTEGER NOT NULL);
	CREATE TABLE expense_comments (id TEXT PRIMARY KEY, expense_id TEXT NOT NULL, user_id TEXT,
	  body TEXT NOT NULL, created_at INTEGER NOT NULL);
	CREATE TABLE expense_activity_events (id TEXT PRIMARY KEY, expense_id TEXT, user_id TEXT, type TEXT NOT NULL,
	  data TEXT DEFAULT '{}', created_at INTEGER NOT NULL);
	CREATE TABLE decisions (
	  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '',
	  status TEXT NOT NULL DEFAULT 'open', chosen_solution_id TEXT,
	  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
	  decided_at INTEGER, deleted_at INTEGER
	);
	CREATE TABLE decision_solutions (id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, title TEXT NOT NULL,
	  description TEXT DEFAULT '', proposer_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
	CREATE TABLE decision_votes (decision_id TEXT NOT NULL, solution_id TEXT NOT NULL, user_id TEXT NOT NULL,
	  created_at INTEGER NOT NULL, PRIMARY KEY (decision_id, user_id));
	CREATE TABLE decision_comments (id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, user_id TEXT,
	  body TEXT NOT NULL, created_at INTEGER NOT NULL);
	CREATE TABLE decision_activity_events (
	  id TEXT PRIMARY KEY, decision_id TEXT REFERENCES decisions(id) ON DELETE CASCADE,
	  user_id TEXT REFERENCES users(id), type TEXT NOT NULL CHECK (type IN
	    ('created','title','description','solution_added','solution_edited','solution_removed',
	     'voted','unchosen','chosen','comment','reopened','deleted')),
	  data TEXT DEFAULT '{}', created_at INTEGER NOT NULL
	);
	CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, user_id TEXT NOT NULL, status INTEGER NOT NULL,
	  response_body TEXT, created_at INTEGER NOT NULL);
	CREATE TABLE gam_points_ledger (
	  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL,
	  points INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT 'task_done', created_at INTEGER NOT NULL
	);
	CREATE TABLE gam_rewards (id TEXT PRIMARY KEY, title TEXT NOT NULL, emoji TEXT DEFAULT 'R',
	  cost INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at INTEGER NOT NULL);
	CREATE TABLE gam_redemptions (id TEXT PRIMARY KEY, reward_id TEXT NOT NULL, user_id TEXT NOT NULL,
	  cost INTEGER NOT NULL, created_at INTEGER NOT NULL);
	INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u1','nacho','x','admin',1);
	INSERT INTO projects (id, name, created_at) VALUES ('p1','Casa',1);
	INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES ('t1','p1','test',1,1);
	INSERT INTO activity_events (id, task_id, type, data, created_at) VALUES ('a1','t1','created','{}',1);
	INSERT INTO gam_points_ledger (id, user_id, task_id, points, created_at) VALUES ('g1','u1','t1',5,1);
	INSERT INTO expense_invites (id, expense_id, token_hash, invite_name, share_cents, created_at)
	  VALUES ('i1','e1','hash','ana',1000,1);
	`)

	d, err := Open(file)
	if err != nil {
		t.Fatalf("open over old schema must migrate: %v", err)
	}
	defer d.Close()

	// Columns added by Migrate.
	for _, c := range [][2]string{
		{"users", "display_name"}, {"users", "expenses_enabled"}, {"users", "color"}, {"users", "anti_slip_threshold"},
		{"sessions", "csrf_token"},
		{"tasks", "deleted_at"}, {"tasks", "recurrence"}, {"tasks", "recurrence_group_id"},
		{"tasks", "done_at"}, {"tasks", "archived_at"}, {"tasks", "recurrence_paused"}, {"tasks", "short_id"},
		{"projects", "owner_id"}, {"projects", "is_inbox"}, {"projects", "task_seq"},
		{"expenses", "deleted_at"}, {"expenses", "done_at"}, {"expenses", "archived_at"}, {"expenses", "payment_method"},
		{"expense_invites", "payment_method"}, {"expense_invites", "notes"}, {"expense_invites", "token"},
		{"expense_comments", "author_name"},
	} {
		if !hasColumn(t, d, c[0], c[1]) {
			t.Errorf("missing column %s.%s after migration", c[0], c[1])
		}
	}

	// activity_events rebuilt with 'project' in the CHECK and data preserved.
	var sqlText, evType string
	if err := d.QueryRow("SELECT sql FROM sqlite_master WHERE type='table' AND name='activity_events'").Scan(&sqlText); err != nil {
		t.Fatal(err)
	}
	if !containsSplit(sqlText, "'project'") {
		t.Error("activity_events CHECK must include 'project' after rebuild")
	}
	if err := d.QueryRow("SELECT type FROM activity_events WHERE id='a1'").Scan(&evType); err != nil || evType != "created" {
		t.Errorf("activity_events row must survive rebuild: %v %v", evType, err)
	}

	// decision_activity_events rebuilt with 'attachment'.
	if err := d.QueryRow("SELECT sql FROM sqlite_master WHERE type='table' AND name='decision_activity_events'").Scan(&sqlText); err != nil {
		t.Fatal(err)
	}
	if !containsSplit(sqlText, "'attachment'") {
		t.Error("decision_activity_events CHECK must include 'attachment' after rebuild")
	}

	// gam_points_ledger rebuilt: decision_id present, task_id nullable, row kept.
	gamCols, err := d.queryColumns("gam_points_ledger")
	if err != nil {
		t.Fatal(err)
	}
	if !contains(colNames(gamCols), "decision_id") {
		t.Error("gam_points_ledger must gain decision_id")
	}
	if c := findCol(gamCols, "task_id"); c == nil || c.notnull != 0 {
		t.Error("gam_points_ledger.task_id must be nullable after rebuild")
	}
	var points int
	if err := d.QueryRow("SELECT points FROM gam_points_ledger WHERE id='g1'").Scan(&points); err != nil || points != 5 {
		t.Errorf("ledger row must survive rebuild with points=5: %v %v", points, err)
	}

	// Membership backfill: legacy project got every user as member.
	var role string
	if err := d.QueryRow("SELECT role FROM project_members WHERE project_id='p1' AND user_id='u1'").Scan(&role); err != nil || role != "member" {
		t.Errorf("legacy project must be backfilled with members: %v %v", role, err)
	}

	// Inbox project created and user is member.
	inboxID, err := d.EnsureInbox()
	if err != nil || inboxID != "inbox" {
		t.Fatalf("inbox: %v %v", inboxID, err)
	}
}

func containsSplit(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestEnsureInboxIdempotent(t *testing.T) {
	d := openTemp(t)
	id1, err := d.EnsureInbox()
	if err != nil {
		t.Fatal(err)
	}
	id2, err := d.EnsureInbox()
	if err != nil || id1 != id2 {
		t.Fatalf("inbox must be idempotent: %v vs %v (%v)", id1, id2, err)
	}
	if err := d.KVSet("k", 42); err != nil {
		t.Fatal(err)
	}
	if got := d.KVGet("k", "x"); got != "42" {
		t.Fatalf("kv roundtrip: %q", got)
	}
	if got := d.KVGet("missing", "def"); got != "def" {
		t.Fatalf("kv fallback: %q", got)
	}
}

func TestArchiveStaleDoneTasks(t *testing.T) {
	d := openTemp(t)
	if _, err := d.EnsureInbox(); err != nil {
		t.Fatal(err)
	}
	old := now() - 10*24*60*60*1000
	if _, err := d.Exec(`INSERT INTO projects (id, name, position, created_at) VALUES ('p1','Casa',0,1)`); err != nil {
		t.Fatal(err)
	}
	// done_at old -> archives; done_at fresh -> stays.
	if _, err := d.Exec(`INSERT INTO tasks (id, project_id, title, "column", position, done_at, created_at, updated_at)
		VALUES ('t1','p1','old','hecho',0,?,1,1)`, old); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO tasks (id, project_id, title, "column", position, done_at, created_at, updated_at)
		VALUES ('t2','p1','fresh','hecho',1,?,1,1)`, now()); err != nil {
		t.Fatal(err)
	}
	archived, err := d.ArchiveStaleDoneTasks()
	if err != nil {
		t.Fatal(err)
	}
	if archived != 1 {
		t.Fatalf("expected 1 archived, got %d", archived)
	}
	var archivedAt, position int64
	if err := d.QueryRow(`SELECT archived_at, position FROM tasks WHERE id='t1'`).Scan(&archivedAt, &position); err != nil {
		t.Fatal(err)
	}
	if archivedAt == 0 || position != 0 {
		t.Errorf("t1 must be archived and compacted to 0, got archived_at=%d position=%d", archivedAt, position)
	}
	if err := d.QueryRow(`SELECT position FROM tasks WHERE id='t2'`).Scan(&position); err != nil {
		t.Fatal(err)
	}
	if position != 0 {
		t.Errorf("t2 must be compacted to 0, got %d", position)
	}
}

func TestHourlyMaintenancePurgesExpiredSessions(t *testing.T) {
	d := openTemp(t)
	past := now() - 1000
	future := now() + 10_000_000
	if _, err := d.Exec(`INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1','n','x',1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('s1','u1',1,?), ('s2','u1',1,?)`, past, future); err != nil {
		t.Fatal(err)
	}
	d.HourlyMaintenance("test")
	var count int
	if err := d.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected 1 surviving session, got %d", count)
	}
}
