// db.js — better-sqlite3: esquema, apertura, migraciones y checkpoint WAL.
// SQL directo, sin ORM. Todo síncrono.
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

// Esquema completo: base común (users/sessions/login_attempts/kv) + dominio Nido.
// Las fechas son epoch ms (INTEGER) salvo due_date, que es 'YYYY-MM-DD'.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
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
  ua TEXT
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
  created_at INTEGER NOT NULL
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
  updated_at INTEGER NOT NULL
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
    ('created','moved','priority','due','assigned','attachment','title','description')),
  data TEXT DEFAULT '{}',  -- JSON; 'moved' guarda {from, to}
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks("column", position);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_task_labels_task ON task_labels(task_id);
CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
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
  if (!userCols.includes('color')) {
    db.exec("ALTER TABLE users ADD COLUMN color TEXT DEFAULT 'slate'")
    console.log('[db] migración: columna color añadida a users')
  }
}

// Checkpoint WAL periódico (llamado cada hora desde index.js): sin esto el WAL
// crece indefinidamente. También limpia sesiones caducadas.
export function hourlyMaintenance(db, label) {
  db.pragma('wal_checkpoint(TRUNCATE)')
  const { changes } = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  if (changes > 0) console.log(`[db] ${label}: ${changes} sesiones caducadas eliminadas`)
}

export function kvGet(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function kvSet(db, key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))
}
