package backup

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/gnacho/deltos/server-go/internal/db"

	_ "modernc.org/sqlite"
)

// seedBackupDB seeds a production DB with core-table rows (a user, a project and
// two tasks).
func seedBackupDB(t *testing.T, d *db.DB) {
	t.Helper()
	if _, err := d.Exec(
		"INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u1', 'mar', 'x', 'admin', 1000)"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(
		"INSERT INTO projects (id, name, position, created_at) VALUES ('p1', 'Casa', 0, 1000)"); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"t1", "t2"} {
		if _, err := d.Exec(
			"INSERT INTO tasks (id, project_id, title, \"column\", position, created_at, updated_at) VALUES (?, 'p1', 'T', 'nuevo', 0, 1000, 1000)", id); err != nil {
			t.Fatal(err)
		}
	}
}

func TestBackupRoundTrip(t *testing.T) {
	dir := t.TempDir()
	d, err := db.Open(filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	seedBackupDB(t, d)

	res := ExecBackup(d, dir)
	if !res.OK {
		t.Fatalf("backup failed: %s", res.Error)
	}
	if res.Path == "" || res.Size == 0 {
		t.Fatalf("backup result: %+v", res)
	}
	var lastRun string
	if err := d.QueryRow("SELECT value FROM kv WHERE key = 'backup_last_run'").Scan(&lastRun); err != nil {
		t.Fatalf("backup_last_run not set: %v", err)
	}

	// Restore into a fresh file: open the backup read-only and compare schema +
	// row counts against the source.
	check, err := sql.Open("sqlite", "file:"+res.Path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	check.SetMaxOpenConns(1)

	// Same table list (core tables present).
	for _, tbl := range []string{"users", "projects", "tasks", "kv", "sessions"} {
		var name string
		if err := check.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", tbl).Scan(&name); err != nil {
			t.Fatalf("table %s missing from backup: %v", tbl, err)
		}
	}

	// Same row counts.
	for _, tbl := range []string{"users", "projects", "tasks"} {
		var src, dst int
		_ = d.QueryRow("SELECT COUNT(*) FROM " + tbl).Scan(&src)
		_ = check.QueryRow("SELECT COUNT(*) FROM " + tbl).Scan(&dst)
		if src != dst {
			t.Fatalf("%s: source %d vs backup %d", tbl, src, dst)
		}
	}
}

func TestBackupIdempotentRetention(t *testing.T) {
	dir := t.TempDir()
	d, err := db.Open(filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	seedBackupDB(t, d)

	r1 := ExecBackup(d, dir)
	if !r1.OK {
		t.Fatalf("first backup: %s", r1.Error)
	}
	r2 := ExecBackup(d, dir)
	if !r2.OK {
		t.Fatalf("second backup: %s", r2.Error)
	}
	entries, err := filepath.Glob(filepath.Join(dir, "backups", "deltos-*.db"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) < 2 {
		t.Fatalf("expected >= 2 backups, got %d", len(entries))
	}
}
