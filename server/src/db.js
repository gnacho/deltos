// db.js — better-sqlite3: esquema, apertura, migraciones y checkpoint WAL.
// SQL directo, sin ORM. Todo síncrono.
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { logger } from './logger.js'

const log = logger.child({ component: 'db' })

// Esquema completo: base común (users/sessions/login_attempts/kv) + dominio Deltos.
// Las fechas son epoch ms (INTEGER) salvo due_date, que es 'YYYY-MM-DD'.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  color TEXT DEFAULT 'slate',
  language TEXT DEFAULT 'auto',  -- 'auto' | 'es' | 'en'
  role TEXT DEFAULT 'user',      -- 'admin' | 'user'
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ua TEXT,
  csrf_token TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  attempts INTEGER DEFAULT 0,
  locked_until INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '',
  color TEXT DEFAULT 'sky',
  position INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,  -- creador; NULL = legado (todos los miembros pueden gestionar)
  created_at INTEGER NOT NULL
);

-- Membresía de proyecto: quién ve un proyecto. Un proyecto "personal" es
-- simplemente uno sin más miembros que su owner. role: 'owner' (creador) |
-- 'member'. Los proyectos legados (owner_id NULL) se migran con todos los
-- usuarios existentes como miembros para no perder acceso nadie.
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

-- Etiquetas globales (no por proyecto)
CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT 'slate'
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  "column" TEXT NOT NULL DEFAULT 'nuevo' CHECK ("column" IN ('nuevo','encurso','hecho')),
  position INTEGER NOT NULL DEFAULT 0,  -- posición dentro de la columna (global, no por proyecto)
  priority TEXT CHECK (priority IN ('alta','media','baja') OR priority IS NULL),
  due_date TEXT,  -- 'YYYY-MM-DD' o NULL
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS task_labels (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,       -- nombre original mostrado al usuario
  stored_name TEXT NOT NULL,    -- nombre aleatorio en disco (DATA_DIR/uploads)
  size INTEGER NOT NULL,
  mime TEXT DEFAULT 'application/octet-stream',
  uploaded_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Historial de cambios de la tarjeta. Los comentarios NO van aquí (tabla comments).
CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN
    ('created','moved','priority','due','assigned','attachment','title','description','project')),
  data TEXT DEFAULT '{}',  -- JSON; 'moved' guarda {from, to}
  created_at INTEGER NOT NULL
);

-- Web Push: una fila por dispositivo/navegador suscrito (un usuario puede tener N).
-- endpoint = capability URL: SECRETA, nunca en logs. Ciclo de vida: upsert por
-- endpoint en subscribe; DELETE cuando el push service devuelve 404/410.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Preferencias por usuario y tipo de alerta (sin fila = activado, normal).
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  min_severity TEXT NOT NULL DEFAULT 'normal',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, tipo)
);

-- Quiet hours (hora local del usuario; NULL = sin ventana). Puede cruzar medianoche.
CREATE TABLE IF NOT EXISTS notification_quiet_hours (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  quiet_start INTEGER,
  quiet_end INTEGER,
  tz TEXT NOT NULL DEFAULT 'Europe/Madrid',
  updated_at INTEGER NOT NULL
);

-- Cola de alertas pospuestas por quiet hours: el mantenimiento horario las
-- consolida (un resumen por usuario+tipo) al terminar la ventana.
CREATE TABLE IF NOT EXISTS notification_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal',
  datos_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks("column", position);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_task_labels_task ON task_labels(task_id);
CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_user ON notification_queue(user_id, tipo);

-- Audit log de acciones admin (quién hizo qué, cuándo, sobre quién/quién).
CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  data TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);

-- Gastos (plugin activable): gastos globales sin proyecto, con flujo kanban
-- (nuevo → en-curso → hecho) y splits de pago entre usuarios.
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  label_id TEXT REFERENCES labels(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  paid_by_creator INTEGER NOT NULL DEFAULT 0,
  requested_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  split_type TEXT CHECK (split_type IN ('half','custom','full')),
  split_amount_cents INTEGER,
  paid_by_requested INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('bizum','transfer','efectivo')),
  step TEXT NOT NULL DEFAULT 'nuevo' CHECK (step IN ('nuevo','en-curso','hecho')),
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_expenses_step ON expenses(step, position);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON expenses(created_by);
CREATE INDEX IF NOT EXISTS idx_expenses_requested ON expenses(requested_user_id);

-- Idempotency: cache de respuestas POST para reintentos seguros (TTL 24h).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status INTEGER NOT NULL,
  response_body TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(created_at);
`

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL') // no FULL: mejor rendimiento, suficiente con WAL
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  migrateSchema(db)
  return db
}

// CREATE TABLE IF NOT EXISTS no actualiza tablas existentes al añadir columnas:
// las migraciones verifican y añaden columnas al arrancar.
export function migrateSchema(db) {
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name)
  if (!userCols.includes('display_name')) {
    db.exec('ALTER TABLE users ADD COLUMN display_name TEXT')
    log.info('schema_migrated', { table: 'users', column: 'display_name' })
  }
  if (!userCols.includes('color')) {
    db.exec("ALTER TABLE users ADD COLUMN color TEXT DEFAULT 'slate'")
    log.info('schema_migrated', { table: 'users', column: 'color' })
  }
  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name)
  if (!sessionCols.includes('csrf_token')) {
    db.exec('ALTER TABLE sessions ADD COLUMN csrf_token TEXT')
    log.info('schema_migrated', { table: 'sessions', column: 'csrf_token' })
  }
  const taskCols = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name)
  if (!taskCols.includes('deleted_at')) {
    db.exec('ALTER TABLE tasks ADD COLUMN deleted_at INTEGER')
    log.info('schema_migrated', { table: 'tasks', column: 'deleted_at' })
  }
  // Project membership: owner_id en projects + backfill de project_members.
  // Los proyectos existentes (creados antes de esta feature) no tenían
  // membresía: para no dejarlos invisibles, sembramos a TODOS los usuarios
  // como miembros de TODOS los proyectos existentes (una sola vez, cuando
  // project_members está vacía y hay proyectos). El owner_id queda NULL
  // (legado): los miembros pueden gestionar esos proyectos.
  const projectCols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name)
  if (!projectCols.includes('owner_id')) {
    db.exec('ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL')
    log.info('schema_migrated', { table: 'projects', column: 'owner_id' })
  }
  const memberCount = db
    .prepare(
      `INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at)
       SELECT p.id, u.id, 'member', ?
       FROM projects p CROSS JOIN users u
       WHERE NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id)`
    )
    .run(Date.now())
  if (memberCount.changes > 0) {
    log.info('project_members_backfilled', { rows: memberCount.changes })
  }
  // v2: activity_events.type gana el valor 'project' (cambiar proyecto desde el detalle).
  // SQLite no permite ALTER de CHECK → reconstrucción por tabla temporal.
  const evSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='activity_events'").get()
  if (evSql && !evSql.sql.includes("'project'")) {
    db.exec(`
      ALTER TABLE activity_events RENAME TO activity_events_old;
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
      DROP TABLE activity_events_old;
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_activity_task ON activity_events(task_id, created_at)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at)')
    log.info('schema_migrated', { table: 'activity_events', change: 'type CHECK + project' })
  }
  const expenseCols = db.prepare('PRAGMA table_info(expenses)').all().map((c) => c.name)
  if (!expenseCols.includes('deleted_at')) {
    db.exec('ALTER TABLE expenses ADD COLUMN deleted_at INTEGER')
    log.info('schema_migrated', { table: 'expenses', column: 'deleted_at' })
  }
  if (!expenseCols.includes('payment_method')) {
    db.exec("ALTER TABLE expenses ADD COLUMN payment_method TEXT CHECK (payment_method IN ('bizum','transfer','efectivo'))")
    log.info('schema_migrated', { table: 'expenses', column: 'payment_method' })
  }
}

// Checkpoint WAL periódico (llamado cada hora desde index.js): sin esto el WAL
// crece indefinidamente. También limpia sesiones caducadas.
export function hourlyMaintenance(db, label) {
  db.pragma('wal_checkpoint(TRUNCATE)')
  const { changes: sessChanges } = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  if (sessChanges > 0) log.info('sessions_expired_purged', { db: label, count: sessChanges })
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const { changes: trashChanges } = db.prepare('DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(thirtyDaysAgo)
  if (trashChanges > 0) log.info('trash_purged', { db: label, count: trashChanges })
  const { changes: expenseTrashChanges } = db.prepare('DELETE FROM expenses WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(thirtyDaysAgo)
  if (expenseTrashChanges > 0) log.info('expense_trash_purged', { db: label, count: expenseTrashChanges })
  const oneHourAgo = Date.now() - 3600 * 1000
  const { changes: attChanges } = db.prepare('DELETE FROM login_attempts WHERE locked_until > 0 AND locked_until < ?').run(oneHourAgo)
  if (attChanges > 0) log.info('login_attempts_purged', { db: label, count: attChanges })
}

export function kvGet(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function kvSet(db, key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))
}
