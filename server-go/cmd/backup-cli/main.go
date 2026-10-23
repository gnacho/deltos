// Command backup-cli is the systemd-timer entrypoint (deploy/deltos-backup.sh):
// a command-line backup using the same logic as the server (consistent snapshot
// by the SQLite online API + verification). It opens the DB directly, without
// the migrations, so it never races the running server.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/gnacho/deltos/server-go/internal/backup"
	"github.com/gnacho/deltos/server-go/internal/db"
)

func main() {
	dataDir := ""
	if len(os.Args) > 1 {
		dataDir = os.Args[1]
	}
	if dataDir == "" {
		dataDir = os.Getenv("DATA_DIR")
	}
	if dataDir == "" {
		fmt.Fprintln(os.Stderr, "backup-cli: falta DATA_DIR (argumento o variable de entorno)")
		os.Exit(2)
	}

	d, err := db.Open(filepath.Join(dataDir, "app.db"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "backup-cli: falló: %v\n", err)
		os.Exit(1)
	}
	res := backup.ExecBackup(d, dataDir)
	_ = d.Close()

	if !res.OK {
		fmt.Fprintf(os.Stderr, "backup-cli: falló: %s\n", res.Error)
		os.Exit(1)
	}
	fmt.Printf("backup-cli: %s (%d bytes)\n", res.Path, res.Size)
}
