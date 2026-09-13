// backup-cli.js — backup por línea de comandos para el timer de systemd
// (lo invoca deploy/deltos-backup.sh). Reutiliza la lógica de backup.js:
// snapshot consistente por la API online de SQLite y verificación.
// Abre la BD directamente, sin openDb, para no disparar migraciones desde un
// segundo proceso mientras el servidor está en marcha.
import path from 'node:path'
import Database from 'better-sqlite3'
import { execBackup } from './backup.js'

const dataDir = process.argv[2] || process.env.DATA_DIR
if (!dataDir) {
  console.error('backup-cli: falta DATA_DIR (argumento o variable de entorno)')
  process.exit(2)
}

try {
  const db = new Database(path.join(dataDir, 'app.db'), { fileMustExist: true })
  db.pragma('busy_timeout = 10000')
  const result = await execBackup(db, { DATA_DIR: dataDir })
  db.close()

  if (!result.ok) {
    console.error(`backup-cli: falló: ${result.error}`)
    process.exit(1)
  }
  console.log(`backup-cli: ${result.path} (${result.size} bytes)`)
} catch (err) {
  console.error(`backup-cli: falló: ${err.message}`)
  process.exit(1)
}
