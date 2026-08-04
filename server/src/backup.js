// backup.js — copia de seguridad de la BD de producción con retención.
// Usa sqlite3 .backup si está disponible, si no copia el fichero directamente.
// Los backups se guardan en DATA_DIR/backups/ con timestamp.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { kvGet, kvSet } from './db.js'
import { logger } from './logger.js'

const log = logger.child({ component: 'backup' })

export async function execBackup(prodDb, config) {
  const dataDir = config.DATA_DIR
  const dbPath = path.join(dataDir, 'app.db')
  const backupsDir = path.join(dataDir, 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })

  const now = new Date()
  const ts = now.toISOString().replace(/[:.]/g, '-')
  const backupName = `deltos-${ts}.db`
  const backupPath = path.join(backupsDir, backupName)

  try {
    if (fs.existsSync(dbPath)) {
      try {
        execFileSync('sqlite3', [dbPath, `.backup '${backupPath}'`], { timeout: 30000 })
      } catch {
        fs.copyFileSync(dbPath, backupPath)
      }
    }
    const stat = fs.statSync(backupPath)
    kvSet(prodDb, 'backup_last_run', now.toISOString())
    kvSet(prodDb, 'backup_path', backupPath)
    log.info('backup_completed', { path: backupPath, size: stat.size })
    pruneBackups(prodDb, backupsDir)
    return { ok: true, path: backupPath, size: stat.size }
  } catch (err) {
    log.error('backup_failed', { error: err.message })
    return { ok: false, error: err.message }
  }
}

function pruneBackups(prodDb, backupsDir) {
  const retentionDays = parseInt(kvGet(prodDb, 'backup_retention_days', '7'), 10)
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const files = fs.readdirSync(backupsDir).filter((f) => f.startsWith('deltos-') && f.endsWith('.db'))
  let pruned = 0
  for (const f of files) {
    const fp = path.join(backupsDir, f)
    const stat = fs.statSync(fp)
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(fp)
      pruned++
    }
  }
  if (pruned > 0) log.info('backup_pruned', { count: pruned, retention_days: retentionDays })
}
