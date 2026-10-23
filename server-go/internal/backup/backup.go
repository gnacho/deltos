// Package backup ports server/src/backup.ts: production database backup with
// retention. Uses SQLite's online snapshot (VACUUM INTO), which produces a
// consistent snapshot even while the server is writing under WAL. Backups are
// stored under DATA_DIR/backups/ with a timestamp.
package backup

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/logger"

	_ "modernc.org/sqlite"
)

var log = logger.L().Child(map[string]any{"component": "backup"})

// coreTables are the tables whose row count is compared source vs backup as a
// sanity check.
var coreTables = []string{"users", "projects", "tasks"}

// Result is the outcome of a backup run.
type Result struct {
	OK    bool
	Path  string
	Size  int64
	Error string
}

// queryRower is satisfied by *db.DB and *sql.DB.
type queryRower interface {
	QueryRow(query string, args ...any) *sql.Row
}

func countsOf(q queryRower) (map[string]int, error) {
	counts := map[string]int{}
	for _, t := range coreTables {
		var n int
		if err := q.QueryRow("SELECT COUNT(*) FROM " + t).Scan(&n); err != nil {
			return nil, err
		}
		counts[t] = n
	}
	return counts, nil
}

// verifyBackup opens the backup read-only and checks structural integrity and
// the same row counts as the source in the core tables (skipped when the source
// changed during the copy, which a consistent snapshot may legitimately show).
func verifyBackup(source *db.DB, backupPath string, before map[string]int) error {
	check, err := sql.Open("sqlite", "file:"+backupPath+"?mode=ro")
	if err != nil {
		return err
	}
	defer check.Close()
	check.SetMaxOpenConns(1)

	var integrity string
	if err := check.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil {
		return err
	}
	if integrity != "ok" {
		return fmt.Errorf("integrity_check: %s", integrity)
	}

	after, err := countsOf(source)
	if err != nil {
		return err
	}
	changed := false
	for _, t := range coreTables {
		if before[t] != after[t] {
			changed = true
			break
		}
	}
	if changed {
		log.Warn("backup_counts_skipped", "reason", "concurrent writes during backup")
		return nil
	}
	for _, t := range coreTables {
		var n int
		if err := check.QueryRow("SELECT COUNT(*) FROM " + t).Scan(&n); err != nil {
			return err
		}
		if after[t] != n {
			return fmt.Errorf("row count mismatch on %s: source %d, backup %d", t, after[t], n)
		}
	}
	return nil
}

// ExecBackup runs a backup of DATA_DIR/app.db into DATA_DIR/backups/ and prunes
// expired ones. Returns the result; a failed verification removes the backup.
func ExecBackup(prodDb *db.DB, dataDir string) Result {
	dbPath := filepath.Join(dataDir, "app.db")
	backupsDir := filepath.Join(dataDir, "backups")
	if err := os.MkdirAll(backupsDir, 0o755); err != nil {
		return Result{Error: err.Error()}
	}

	ts := strings.NewReplacer(":", "-", ".", "-").Replace(time.Now().UTC().Format("2006-01-02T15:04:05.000Z"))
	backupPath := filepath.Join(backupsDir, "deltos-"+ts+".db")

	if _, err := os.Stat(dbPath); err != nil {
		log.Error("backup_failed", "error", "database not found", "path", dbPath)
		return Result{Error: "database not found"}
	}

	before, err := countsOf(prodDb)
	if err != nil {
		return Result{Error: err.Error()}
	}

	escaped := strings.ReplaceAll(backupPath, "'", "''")
	if _, err := prodDb.Exec("VACUUM INTO '" + escaped + "'"); err != nil {
		log.Error("backup_failed", "error", err.Error())
		return Result{Error: err.Error()}
	}
	if err := verifyBackup(prodDb, backupPath, before); err != nil {
		_ = os.Remove(backupPath)
		log.Error("backup_failed", "error", err.Error())
		return Result{Error: err.Error()}
	}

	stat, err := os.Stat(backupPath)
	if err != nil {
		return Result{Error: err.Error()}
	}
	now := time.Now()
	_ = prodDb.KVSet("backup_last_run", now.Format(time.RFC3339Nano))
	_ = prodDb.KVSet("backup_path", backupPath)
	log.Info("backup_completed", "path", backupPath, "size", stat.Size())
	pruneBackups(prodDb, backupsDir)
	return Result{OK: true, Path: backupPath, Size: stat.Size()}
}

func pruneBackups(prodDb *db.DB, backupsDir string) {
	retention := prodDb.KVGet("backup_retention_days", "3")
	days, err := strconv.Atoi(retention)
	if err != nil || days <= 0 {
		days = 3
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	entries, err := os.ReadDir(backupsDir)
	if err != nil {
		return
	}
	pruned := 0
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, "deltos-") || !strings.HasSuffix(name, ".db") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(backupsDir, name))
			pruned++
		}
	}
	if pruned > 0 {
		log.Info("backup_pruned", "count", pruned, "retention_days", days)
	}
}
