// backup.ts — copia de seguridad de la BD de producción con retención.
// Usa la API de backup online de SQLite (better-sqlite3 db.backup), que produce
// un snapshot consistente aunque la BD esté en WAL y el server esté escribiendo.
// No depende del CLI `sqlite3`. Antes se llamaba a `sqlite3 .backup` y, si
// fallaba, se copiaba el fichero a pelo: con WAL eso puede dejar un snapshot
// inconsistente (se pierde el -wal), así que ese fallback se elimina.
// Los backups se guardan en DATA_DIR/backups/ con timestamp.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { kvGet, kvSet } from './db.js'
import { logger } from './logger.js'

const execFileAsync = promisify(execFile)

const log = logger.child({ component: 'backup' })

// Tablas núcleo cuyo recuento se compara origen vs backup como sanity check.
const CORE_TABLES = ['users', 'projects', 'tasks'] as const

export interface BackupResult {
  ok: boolean
  path?: string
  size?: number
  error?: string
}

export async function isBackupTimerActive(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', 'deltos-backup.timer'])
    return stdout.trim() === 'active'
  } catch {
    return false
  }
}

type Counts = Record<string, number>

function countsOf(db: Database.Database): Counts {
  const counts: Counts = {}
  for (const table of CORE_TABLES) {
    counts[table] = (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
  }
  return counts
}

/**
 * Verifica que el backup es un snapshot válido: integridad estructural y el
 * mismo número de filas que el origen en las tablas núcleo. Lanza si no lo es.
 *
 * Los recuentos del origen se toman antes y después del backup: si cambiaron,
 * hubo escrituras concurrentes durante el copiado y el snapshot (consistente
 * por la API de SQLite) puede reflejar un instante legítimamente distinto, así
 * que se omite la comparación de filas en vez de tirar un backup válido.
 */
function verifyBackup(sourceDb: Database.Database, backupPath: string, before: Counts): void {
  const check = new Database(backupPath, { readonly: true, fileMustExist: true })
  try {
    const integrity = check.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`integrity_check: ${integrity}`)

    const after = countsOf(sourceDb)
    if (CORE_TABLES.some((table) => before[table] !== after[table])) {
      log.warn('backup_counts_skipped', { reason: 'concurrent writes during backup' })
      return
    }
    for (const table of CORE_TABLES) {
      const backup = (check.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
      if (after[table] !== backup) {
        throw new Error(`row count mismatch on ${table}: source ${after[table]}, backup ${backup}`)
      }
    }
  } finally {
    check.close()
  }
}

export async function execBackup(
  prodDb: Database.Database,
  config: { DATA_DIR: string }
): Promise<BackupResult> {
  const dataDir = config.DATA_DIR
  const dbPath = path.join(dataDir, 'app.db')
  const backupsDir = path.join(dataDir, 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })

  const now = new Date()
  const ts = now.toISOString().replace(/[:.]/g, '-')
  const backupName = `deltos-${ts}.db`
  const backupPath = path.join(backupsDir, backupName)

  if (!fs.existsSync(dbPath)) {
    log.error('backup_failed', { error: 'database not found', path: dbPath })
    return { ok: false, error: 'database not found' }
  }

  try {
    // Snapshot consistente por la API online de SQLite, con la BD en WAL.
    const before = countsOf(prodDb)
    await prodDb.backup(backupPath)
    verifyBackup(prodDb, backupPath, before)

    const stat = fs.statSync(backupPath)
    kvSet(prodDb, 'backup_last_run', now.toISOString())
    kvSet(prodDb, 'backup_path', backupPath)
    log.info('backup_completed', { path: backupPath, size: stat.size })
    pruneBackups(prodDb, backupsDir)
    return { ok: true, path: backupPath, size: stat.size }
  } catch (err) {
    // Un backup que no pasa la verificación no se conserva: dejarlo ahí daría
    // por buena una copia que no lo es.
    fs.rmSync(backupPath, { force: true })
    const message = err instanceof Error ? err.message : String(err)
    log.error('backup_failed', { error: message })
    return { ok: false, error: message }
  }
}

function pruneBackups(prodDb: Database.Database, backupsDir: string): void {
  const retentionDays = parseInt(kvGet(prodDb, 'backup_retention_days', '3') ?? '3', 10)
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
