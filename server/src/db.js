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
  is_inbox INTEGER NOT NULL DEFAULT 0,  -- 1 = proyecto "Sin proyecto" (bandeja de tareas sin proyecto; no editable)
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
  deleted_at INTEGER,
  recurrence TEXT,  -- JSON: {freq, interval, weekdays?, mode} o NULL
  recurrence_group_id TEXT,  -- id de la primera instancia de la serie recurrente
  done_at INTEGER,       -- epoch ms de la última entrada en 'hecho' (para auto-archivo)
  archived_at INTEGER    -- epoch ms de archivado; NULL = tarea activa en el tablero
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

-- Subtareas de una tarea. Anidables: parent_id NULL = nivel 1 (hija directa
-- de la tarea), no NULL = sub-subtarea. Al completar una tarea recurrente, las
-- subtareas se copian a la nueva instancia con done=0 (reset automático).
CREATE TABLE IF NOT EXISTS task_subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES task_subtasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON task_subtasks(task_id, position);

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
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  payer_id TEXT NOT NULL REFERENCES users(id),
  payment_method TEXT CHECK (payment_method IN ('bizum','transfer','efectivo')),
  spent_at INTEGER NOT NULL,
  step TEXT NOT NULL DEFAULT 'nuevo' CHECK (step IN ('nuevo','en-curso','hecho')),
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  done_at INTEGER,       -- epoch ms de la última entrada en 'hecho' (para auto-archivo)
  archived_at INTEGER    -- epoch ms de archivado; NULL = gasto activo en el tablero
);

CREATE INDEX IF NOT EXISTS idx_expenses_step ON expenses(step, position);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON expenses(created_by);
CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses(project_id);

CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_cents INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (expense_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_expense_shares_user ON expense_shares(user_id);

CREATE TABLE IF NOT EXISTS expense_invites (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  token TEXT,
  invite_name TEXT NOT NULL,
  share_cents INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('bizum','transfer','efectivo')),
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expense_invites_token ON expense_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_expense_invites_expense ON expense_invites(expense_id);

CREATE TABLE IF NOT EXISTS expense_attachments (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT DEFAULT 'application/octet-stream',
  uploaded_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_expense ON expense_attachments(expense_id);

CREATE TABLE IF NOT EXISTS expense_comments (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  author_name TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expense_comments_expense ON expense_comments(expense_id);

CREATE TABLE IF NOT EXISTS expense_activity_events (
  id TEXT PRIMARY KEY,
  expense_id TEXT REFERENCES expenses(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN
    ('created','title','amount','category','notes','paid','shares','payer','settled','payment_method','moved','attachment')),
  data TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expense_activity_expense ON expense_activity_events(expense_id, created_at);

-- Idempotency: cache de respuestas POST para reintentos seguros (TTL 24h).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status INTEGER NOT NULL,
  response_body TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(created_at);

-- Gamificación: libro mayor de puntos (una fila por concesión; el saldo es
-- SUM(puntos) − SUM(canjes)). El anti-farming (una concesión por tarea cada
-- 23 h) se aplica en routes-gamification.js, no con un UNIQUE: la tarea puede
-- ganar puntos de nuevo pasado el enfriamiento.
CREATE TABLE IF NOT EXISTS gam_points_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'task_done',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gam_ledger_user ON gam_points_ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gam_ledger_task ON gam_points_ledger(task_id, created_at);

-- Recompensas canjeables con puntos (borrado lógico con active=0).
CREATE TABLE IF NOT EXISTS gam_rewards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  emoji TEXT DEFAULT '🎁',
  cost INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gam_rewards_active ON gam_rewards(active, created_at);

-- Canjes: guardan el coste en el momento del canje (la recompensa puede
-- cambiar de precio después sin reescribir el historial).
CREATE TABLE IF NOT EXISTS gam_redemptions (
  id TEXT PRIMARY KEY,
  reward_id TEXT NOT NULL REFERENCES gam_rewards(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  cost INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gam_redemptions_user ON gam_redemptions(user_id, created_at);
`

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL') // no FULL: mejor rendimiento, suficiente con WAL
  db.pragma('foreign_keys = ON')

  const expensesExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='expenses'"
  ).get()
  if (expensesExists) {
    const expenseCols = db.prepare('PRAGMA table_info(expenses)').all().map((c) => c.name)
    if (expenseCols.includes('requested_user_id')) {
      db.exec('DROP TABLE IF EXISTS expense_shares')
      db.exec('DROP TABLE IF EXISTS expense_activity_events')
      db.exec('DROP TABLE IF EXISTS expense_comments')
      db.exec('DROP TABLE IF EXISTS expense_attachments')
      db.exec('DROP TABLE IF EXISTS expenses')
      log.warn('schema_migrated', { table: 'expenses', action: 'recreated_v2_shares_pre' })
    }
  }

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
  if (!userCols.includes('expenses_enabled')) {
    db.exec('ALTER TABLE users ADD COLUMN expenses_enabled INTEGER NOT NULL DEFAULT 0')
    log.info('schema_migrated', { table: 'users', column: 'expenses_enabled' })
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
  if (!taskCols.includes('recurrence')) {
    db.exec('ALTER TABLE tasks ADD COLUMN recurrence TEXT')
    log.info('schema_migrated', { table: 'tasks', column: 'recurrence' })
  }
  if (!taskCols.includes('recurrence_group_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN recurrence_group_id TEXT')
    log.info('schema_migrated', { table: 'tasks', column: 'recurrence_group_id' })
  }
  if (!taskCols.includes('done_at')) {
    db.exec('ALTER TABLE tasks ADD COLUMN done_at INTEGER')
    log.info('schema_migrated', { table: 'tasks', column: 'done_at' })
  }
  if (!taskCols.includes('archived_at')) {
    db.exec('ALTER TABLE tasks ADD COLUMN archived_at INTEGER')
    log.info('schema_migrated', { table: 'tasks', column: 'archived_at' })
  }
  if (!taskCols.includes('recurrence_paused')) {
    db.exec('ALTER TABLE tasks ADD COLUMN recurrence_paused INTEGER DEFAULT 0')
    log.info('schema_migrated', { table: 'tasks', column: 'recurrence_paused' })
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
  if (!projectCols.includes('is_inbox')) {
    db.exec('ALTER TABLE projects ADD COLUMN is_inbox INTEGER NOT NULL DEFAULT 0')
    log.info('schema_migrated', { table: 'projects', column: 'is_inbox' })
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
  let expenseCols = db.prepare('PRAGMA table_info(expenses)').all().map((c) => c.name)
  if (!expenseCols.includes('deleted_at')) {
    db.exec('ALTER TABLE expenses ADD COLUMN deleted_at INTEGER')
    log.info('schema_migrated', { table: 'expenses', column: 'deleted_at' })
  }
  if (!expenseCols.includes('done_at')) {
    db.exec('ALTER TABLE expenses ADD COLUMN done_at INTEGER')
    log.info('schema_migrated', { table: 'expenses', column: 'done_at' })
  }
  if (!expenseCols.includes('archived_at')) {
    db.exec('ALTER TABLE expenses ADD COLUMN archived_at INTEGER')
    log.info('schema_migrated', { table: 'expenses', column: 'archived_at' })
  }
  if (!expenseCols.includes('payment_method')) {
    db.exec("ALTER TABLE expenses ADD COLUMN payment_method TEXT CHECK (payment_method IN ('bizum','transfer','efectivo'))")
    log.info('schema_migrated', { table: 'expenses', column: 'payment_method' })
  }
  const inviteCols = db.prepare('PRAGMA table_info(expense_invites)').all().map((c) => c.name)
  if (!inviteCols.includes('payment_method')) {
    db.exec("ALTER TABLE expense_invites ADD COLUMN payment_method TEXT CHECK (payment_method IN ('bizum','transfer','efectivo'))")
    log.info('schema_migrated', { table: 'expense_invites', column: 'payment_method' })
  }
  if (!inviteCols.includes('notes')) {
    db.exec("ALTER TABLE expense_invites ADD COLUMN notes TEXT DEFAULT ''")
    log.info('schema_migrated', { table: 'expense_invites', column: 'notes' })
  }
  if (!inviteCols.includes('token')) {
    db.exec('ALTER TABLE expense_invites ADD COLUMN token TEXT')
    log.info('schema_migrated', { table: 'expense_invites', column: 'token' })
  }
  // security: los tokens de invitación NUNCA se guardan en claro (solo hash).
  // Limpia cualquier token en claro que exista de versiones anteriores.
  const { changes: clearedTokens } = db
    .prepare('UPDATE expense_invites SET token = NULL WHERE token IS NOT NULL')
    .run()
  if (clearedTokens > 0) {
    log.info('invite_plaintext_tokens_cleared', { rows: clearedTokens })
  }
  const exCommentCols = db.prepare('PRAGMA table_info(expense_comments)').all().map((c) => c.name)
  if (!exCommentCols.includes('author_name')) {
    db.exec('ALTER TABLE expense_comments ADD COLUMN author_name TEXT')
    log.info('schema_migrated', { table: 'expense_comments', column: 'author_name' })
  }

  // Id corto legible por tarea (p. ej. CASA-3) + contador por proyecto.
  const taskColsShort = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name)
  if (!taskColsShort.includes('short_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN short_id TEXT')
    log.info('schema_migrated', { table: 'tasks', column: 'short_id' })
  }
  const projectColsShort = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name)
  if (!projectColsShort.includes('task_seq')) {
    db.exec('ALTER TABLE projects ADD COLUMN task_seq INTEGER NOT NULL DEFAULT 0')
    log.info('schema_migrated', { table: 'projects', column: 'task_seq' })
  }
  backfillShortIds(db)
}

/** Prefijo legible de un proyecto para el id corto de tarea ("Casa" -> CASA). */
export function projectPrefix(name) {
  const cleaned = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  return cleaned.slice(0, 4) || 'T'
}

/**
 * Reserva el siguiente id corto de un proyecto. Debe llamarse DENTRO de la
 * transacción que inserta la tarea: better-sqlite3 es síncrono y el escritor es
 * único, así que no hay carrera posible.
 */
export function allocateShortId(db, projectId) {
  const project = db.prepare('SELECT name, task_seq FROM projects WHERE id = ?').get(projectId)
  if (!project) return null
  const seq = (project.task_seq ?? 0) + 1
  db.prepare('UPDATE projects SET task_seq = ? WHERE id = ?').run(seq, projectId)
  return `${projectPrefix(project.name)}-${seq}`
}

/** Asigna short_id a las tareas que no lo tengan, por proyecto y en orden de
 *  creación. Idempotente: no toca las que ya lo tienen. */
function backfillShortIds(db) {
  const missing = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE short_id IS NULL').get().n
  if (missing === 0) return
  const updTask = db.prepare('UPDATE tasks SET short_id = ? WHERE id = ?')
  const updSeq = db.prepare('UPDATE projects SET task_seq = ? WHERE id = ?')
  const tx = db.transaction(() => {
    for (const p of db.prepare('SELECT id, name, task_seq FROM projects').all()) {
      let seq = p.task_seq ?? 0
      const tasks = db
        .prepare('SELECT id FROM tasks WHERE project_id = ? AND short_id IS NULL ORDER BY created_at, id')
        .all(p.id)
      for (const t of tasks) {
        seq += 1
        updTask.run(`${projectPrefix(p.name)}-${seq}`, t.id)
      }
      updSeq.run(seq, p.id)
    }
  })
  tx()
  log.info('schema_backfilled', { table: 'tasks', column: 'short_id', rows: missing })
}

// Proyecto "Sin proyecto" (bandeja de tareas sin proyecto). Es un proyecto real
// para no romper la membresía, el tablero ni los contadores, pero está marcado
// con is_inbox: no se puede renombrar/borrar y no aparece en la página Proyectos.
// El nombre se muestra traducido en el front (task.noProject); el guardado es
// solo un fallback para clientes que no conocen la marca.
export const INBOX_PROJECT_ID = 'inbox'
const INBOX_PROJECT_NAME = 'Inbox'

/** Garantiza que existe el proyecto inbox y que TODOS los usuarios son miembros
 *  (las tareas sin proyecto deben ser visibles para cualquiera). Idempotente. */
export function ensureInbox(db) {
  const now = Date.now()
  let project = db.prepare('SELECT id FROM projects WHERE is_inbox = 1').get()
  if (!project) {
    const fixed = db.prepare('SELECT id FROM projects WHERE id = ?').get(INBOX_PROJECT_ID)
    if (fixed) {
      db.prepare('UPDATE projects SET is_inbox = 1 WHERE id = ?').run(INBOX_PROJECT_ID)
    } else {
      const pos = db.prepare('SELECT COALESCE(MIN(position) - 1, 0) AS p FROM projects').get().p
      db.prepare(
        `INSERT INTO projects (id, name, emoji, color, position, owner_id, is_inbox, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, 1, ?)`
      ).run(INBOX_PROJECT_ID, INBOX_PROJECT_NAME, 'inbox', 'slate', pos, now)
      log.info('inbox_project_created', { id: INBOX_PROJECT_ID })
    }
    project = { id: INBOX_PROJECT_ID }
  }
  const { changes } = db
    .prepare(
      `INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at)
       SELECT ?, id, 'member', ? FROM users`
    )
    .run(project.id, now)
  if (changes > 0) log.info('inbox_members_added', { rows: changes })
  return project.id
}

/** Añade un usuario recién creado como miembro del inbox (idempotente). */
export function ensureUserInInbox(db, userId) {
  db.prepare(
    `INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at)
     SELECT id, ?, 'member', ? FROM projects WHERE is_inbox = 1`
  ).run(userId, Date.now())
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

export function getArchiveAfterDays(db) {
  const raw = kvGet(db, 'archive_after_days', '3')
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3
}

// Auto-archivo: las tareas de 'hecho' llevan más de N días (configurable vía
// archive_after_days, por defecto 3) completadas → archived_at (desaparecen del
// tablero; se recuperan con "mostrar archivadas"). Llamado desde index.js al
// arrancar y cada hora. Devuelve el número de tareas archivadas (0 si no tocaba).
// El primer UPDATE auto-cura done_at de tareas 'hecho' sin marca (semillas
// demo nuevas o BDs pre-migración): les da updated_at como fecha de entrada.
export function archiveStaleDoneTasks(db) {
  const days = getArchiveAfterDays(db)
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tasks SET done_at = updated_at
       WHERE "column" = 'hecho' AND done_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL`
    ).run()
    const stale = db
      .prepare(
        `SELECT id, position FROM tasks
         WHERE "column" = 'hecho' AND archived_at IS NULL AND deleted_at IS NULL
           AND done_at IS NOT NULL AND done_at < ?`
      )
      .all(cutoff)
    if (stale.length === 0) return 0
    const now = Date.now()
    const archive = db.prepare('UPDATE tasks SET archived_at = ? WHERE id = ?')
    const compact = db.prepare(
      `UPDATE tasks SET position = position - 1
       WHERE "column" = ? AND position > ? AND archived_at IS NULL AND deleted_at IS NULL`
    )
    for (const t of stale) {
      archive.run(now, t.id)
      compact.run('hecho', t.position)
    }
    return stale.length
  })
  const archived = tx()
  if (archived > 0) log.info('tasks_auto_archived', { count: archived })
  return archived
}

// Auto-archivo de GASTOS: espejo del de tareas, sobre el paso 'hecho' (Pagado).
export function archiveStaleDoneExpenses(db) {
  const days = getArchiveAfterDays(db)
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE expenses SET done_at = updated_at
       WHERE step = 'hecho' AND done_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL`
    ).run()
    const stale = db
      .prepare(
        `SELECT id, position FROM expenses
         WHERE step = 'hecho' AND archived_at IS NULL AND deleted_at IS NULL
           AND done_at IS NOT NULL AND done_at < ?`
      )
      .all(cutoff)
    if (stale.length === 0) return 0
    const now = Date.now()
    const archive = db.prepare('UPDATE expenses SET archived_at = ? WHERE id = ?')
    const compact = db.prepare(
      `UPDATE expenses SET position = position - 1
       WHERE step = ? AND position > ? AND archived_at IS NULL AND deleted_at IS NULL`
    )
    for (const e of stale) {
      archive.run(now, e.id)
      compact.run('hecho', e.position)
    }
    return stale.length
  })
  const archived = tx()
  if (archived > 0) log.info('expenses_auto_archived', { count: archived })
  return archived
}

export function kvSet(db, key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))
}
