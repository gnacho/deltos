// Package db holds the SQLite schema. Ported verbatim from
// server/src/db.ts (SCHEMA constant): same tables, same order, same SQL.
package db

// Schema is executed with IF NOT EXISTS semantics on open.
// The gam_points_ledger indexes intentionally live in MigrateSchema, not
// here (lesson #246 / issue #282: this runs before migrations and old
// databases do not have decision_id yet).
const Schema = `
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

-- Decisiones (problema -> soluciones -> voto -> decision). Pertenece a un
-- proyecto (misma visibilidad que tasks). Soft-delete en decisions; las
-- entidades interiores (soluciones/votos/comentarios) van en cascada real.
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','decided')),
  chosen_solution_id TEXT,             -- FK lógica a decision_solutions (por el ciclo)
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  decided_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id, status, created_at);

-- Soluciones propuestas. Un autor puede proponer varias.
CREATE TABLE IF NOT EXISTS decision_solutions (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  proposer_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decision_solutions_decision ON decision_solutions(decision_id, created_at);

-- Votos: un voto por usuario y decisión (UNIQUE lo garantiza; mover voto = UPDATE).
CREATE TABLE IF NOT EXISTS decision_votes (
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  solution_id TEXT NOT NULL REFERENCES decision_solutions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (decision_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_decision_votes_solution ON decision_votes(solution_id);

-- Comentarios de matización (espejo de expense_comments; sin author_name).
CREATE TABLE IF NOT EXISTS decision_comments (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decision_comments_decision ON decision_comments(decision_id, created_at);

-- Historial (espejo de expense_activity_events) para el feed de actividad.
CREATE TABLE IF NOT EXISTS decision_activity_events (
  id TEXT PRIMARY KEY,
  decision_id TEXT REFERENCES decisions(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN
    ('created','title','description','solution_added','solution_edited','solution_removed',
     'voted','unchosen','chosen','comment','reopened','deleted','attachment')),
  data TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decision_activity_decision ON decision_activity_events(decision_id, created_at);

-- Adjuntos de decisiones: solution_id NULL = adjunto de la descripción; con
-- valor, adjunto de esa solución. Patrón de attachments (nombre original +
-- stored_name aleatorio en DATA_DIR/uploads).
CREATE TABLE IF NOT EXISTS decision_attachments (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  solution_id TEXT REFERENCES decision_solutions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,       -- nombre original mostrado al usuario
  stored_name TEXT NOT NULL,    -- nombre aleatorio en disco (DATA_DIR/uploads)
  size INTEGER NOT NULL,
  mime TEXT DEFAULT 'application/octet-stream',
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decision_attachments_decision ON decision_attachments(decision_id);

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
-- SUM(puntos activos) - SUM(canjes)). El anti-farming (una concesión por
-- tarea cada 23 h) se aplica en routes-gamification.js. Una fila puede
-- revertirse (reverted_at) si la tarea sale de 'hecho'. task_id y decision_id
-- son excluyentes: una fila de decisión (decision_chosen/decision_vote) lleva
-- task_id NULL (issue #280).
CREATE TABLE IF NOT EXISTS gam_points_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  decision_id TEXT REFERENCES decisions(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'task_done',
  created_at INTEGER NOT NULL,
  reverted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_gam_ledger_user ON gam_points_ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gam_ledger_task ON gam_points_ledger(task_id, created_at);
-- SIN indice por decision aqui: el SCHEMA corre ANTES de migrateSchema y en
-- BD viejas la tabla aun no tiene esa columna (leccion #246, issue #282). Lo
-- crea migrateSchema siempre.

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
