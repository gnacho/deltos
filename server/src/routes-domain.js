// routes-domain.js — rutas del dominio Deltos: bootstrap, proyectos, etiquetas,
// tareas (CRUD + mover), comentarios, adjuntos, feed de actividad.
// Todas bajo requireAuth; c.get('db') apunta a la BD de la sesión (prod o demo).
// Convenciones api-stack (CONVENTIONS.md): zValidator en cada ruta, errores
// por httpError() (el envelope lo construye app.onError), 201+Location al
// crear, 204 sin cuerpo en DELETE, 409 ante UNIQUE, keyset en /api/activity.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { zValidator } from '@hono/zod-validator'
import { SqliteError } from 'better-sqlite3'
import { requireAdmin } from './auth.js'
import { kvGet, kvSet } from './db.js'
import { notifyUsers, notifyAllExcept } from './push.js'
import { httpError, validationHook } from './errors.js'
import { ERROR_CODES } from './error-codes.js'
import { decodeCursor, keysetPage } from './pagination.js'
import { logger } from './logger.js'

const log = logger.child({ component: 'domain' })

// Notificación fire-and-forget a usuarios concretos (nunca bloquea la HTTP).
function notifyIds(db, demo, ids, tipo, datos, opciones = {}) {
  if (!ids || ids.length === 0) return
  notifyUsers(db, ids, tipo, datos, { ...opciones, demo }).catch((err) =>
    log.error('push_notify_failed', { tipo, error: err })
  )
}

// --- Validación zod (límites de input) -------------------------------------

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'usa YYYY-MM-DD')
const colorSchema = z.string().regex(/^[a-z]{2,20}$/, 'color inválido')
const columnSchema = z.enum(['nuevo', 'encurso', 'hecho'])
const prioritySchema = z.enum(['alta', 'media', 'baja']).nullable()
// Los ids de Deltos son UUID strings; param suelto (no UUID estricto) para no
// rechazar ids legados: la autorización la da la sesión, no la forma del id.
const idParamSchema = z.object({ id: z.string().min(1).max(64) })

const projectSchema = z.object({
  name: z.string().min(1).max(80),
  emoji: z.string().max(8).default(''),
  color: colorSchema.default('sky'),
})
// PATCH: campos explícitamente opcionales SIN default — zod v4 mantiene el
// default del schema base dentro de .partial() y un PATCH que no envíe el
// campo lo RESETEARÍA al default (bug v1.6.0: renombrar etiqueta → slate).
const projectPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  emoji: z.string().max(8).optional(),
  color: colorSchema.optional(),
})

const labelSchema = z.object({
  name: z.string().min(1).max(40),
  color: colorSchema.default('slate'),
})
const labelPatchSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  color: colorSchema.optional(),
})

const taskCreateSchema = z.object({
  project_id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  column: columnSchema.default('nuevo'),
  priority: prioritySchema.optional(),
  due_date: dateSchema.nullable().optional(),
  assignee_id: z.string().max(64).nullable().optional(),
  labels: z.array(z.string().max(64)).max(20).default([]),
})

const taskPatchSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000),
    priority: prioritySchema,
    due_date: dateSchema.nullable(),
    assignee_id: z.string().max(64).nullable(),
    labels: z.array(z.string().max(64)).max(20),
  })
  .partial()

const moveSchema = z.object({
  column: columnSchema,
  position: z.number().int().min(0).max(100000),
})

const commentSchema = z.object({
  body: z.string().min(1).max(2000),
})

const userCreateSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(6, 'la contraseña inicial debe tener al menos 6 caracteres').max(100),
  color: colorSchema.default('slate'),
  role: z.enum(['admin', 'user']).default('user'),
})

const demoToggleSchema = z.object({ enabled: z.boolean() })

const userRoleSchema = z.object({ role: z.enum(['admin', 'user']) })
const userPasswordSchema = z.object({
  password: z.string().min(6, 'la contraseña debe tener al menos 6 caracteres').max(100),
})
const userLanguageSchema = z.object({ language: z.enum(['auto', 'es', 'en']) })

const serverSettingsSchema = z.object({
  backup_enabled: z.boolean(),
  backup_retention_days: z.number().int().min(1).max(365),
  max_attachments_per_task: z.number().int().min(5).max(50),
})

// Query del feed de actividad: keyset por cursor opaco (sin page/offset).
const activityQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

function countAdmins(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n
}

const USER_COLS = 'id, username, email, phone, color, language, role, created_at'

// --- Helpers ----------------------------------------------------------------

function addEvent(db, taskId, userId, type, data = {}) {
  db.prepare(
    'INSERT INTO activity_events (id, task_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), taskId, userId, type, JSON.stringify(data), Date.now())
}

// Hidrata tareas con labels[], assignee y counts {comments, attachments}
function hydrateTasks(db, whereSql = '', params = []) {
  const tasks = db
    .prepare(
      `SELECT t.*, u.username AS assignee_username, u.color AS assignee_color,
              (SELECT COUNT(*) FROM comments cm WHERE cm.task_id = t.id) AS comments_count,
              (SELECT COUNT(*) FROM attachments at WHERE at.task_id = t.id) AS attachments_count
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       ${whereSql}
       ORDER BY t."column", t.position`
    )
    .all(...params)
  if (tasks.length === 0) return []
  const labels = db
    .prepare(
      `SELECT tl.task_id, l.id, l.name, l.color
       FROM task_labels tl JOIN labels l ON l.id = tl.label_id`
    )
    .all()
  const byTask = new Map()
  for (const l of labels) {
    if (!byTask.has(l.task_id)) byTask.set(l.task_id, [])
    byTask.get(l.task_id).push({ id: l.id, name: l.name, color: l.color })
  }
  return tasks.map((t) => ({
    id: t.id,
    project_id: t.project_id,
    title: t.title,
    description: t.description,
    column: t.column,
    position: t.position,
    priority: t.priority,
    due_date: t.due_date,
    assignee_id: t.assignee_id,
    assignee: t.assignee_id
      ? { id: t.assignee_id, username: t.assignee_username, color: t.assignee_color }
      : null,
    created_by: t.created_by,
    created_at: t.created_at,
    updated_at: t.updated_at,
    labels: byTask.get(t.id) || [],
    counts: { comments: t.comments_count, attachments: t.attachments_count },
  }))
}

function replaceTaskLabels(db, taskId, labelIds) {
  db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(taskId)
  const ins = db.prepare('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)')
  for (const labelId of labelIds) ins.run(taskId, labelId)
}

function getTask(db, id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
}

// Borra de disco los adjuntos de una tarea (mejor esfuerzo)
function removeAttachmentFiles(db, uploadsDir, taskId) {
  const rows = db.prepare('SELECT stored_name FROM attachments WHERE task_id = ?').all(taskId)
  for (const r of rows) {
    try {
      fs.unlinkSync(path.join(uploadsDir, path.basename(r.stored_name)))
    } catch {
      // el fichero puede no existir: no es fatal
    }
  }
}

// --- Rutas ------------------------------------------------------------------

export function registerDomainRoutes(app, { hub, uploadsDir, prod, config, dataDir }) {
  // GET /api/bootstrap — UNA llamada para pintar el tablero
  app.get('/api/bootstrap', (c) => {
    const db = c.get('db')
    const users = db.prepare('SELECT id, username, color FROM users ORDER BY username').all()
    const projects = db
      .prepare(
        `SELECT p.id, p.name, p.emoji, p.color, p.position,
                COALESCE(SUM(CASE WHEN t."column" = 'nuevo' THEN 1 ELSE 0 END), 0) AS nuevo,
                COALESCE(SUM(CASE WHEN t."column" = 'encurso' THEN 1 ELSE 0 END), 0) AS encurso,
                COALESCE(SUM(CASE WHEN t."column" = 'hecho' THEN 1 ELSE 0 END), 0) AS hecho
         FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
         GROUP BY p.id ORDER BY p.position`
      )
      .all()
      .map((p) => ({
        id: p.id,
        name: p.name,
        emoji: p.emoji,
        color: p.color,
        position: p.position,
        counts: { nuevo: p.nuevo, encurso: p.encurso, hecho: p.hecho },
      }))
    const labels = db.prepare('SELECT id, name, color FROM labels ORDER BY name').all()
    const tasks = hydrateTasks(db)
    return c.json({ users, projects, labels, tasks })
  })

  // --- Proyectos ---
  app.post('/api/projects', zValidator('json', projectSchema, validationHook), (c) => {
    const db = c.get('db')
    const data = c.req.valid('json')
    const id = crypto.randomUUID()
    const pos = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM projects').get().p
    db.prepare('INSERT INTO projects (id, name, emoji, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, data.name, data.emoji, data.color, pos, Date.now())
    hub.broadcast('projects')
    c.header('Location', `/api/projects/${id}`)
    return c.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(id) }, 201)
  })

  app.patch(
    '/api/projects/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', projectPatchSchema, validationHook),
    (c) => {
      const db = c.get('db')
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(c.req.valid('param').id)
      if (!project) httpError(404, ERROR_CODES.PROJECT_NOT_FOUND)
      const data = c.req.valid('json')
      db.prepare('UPDATE projects SET name = ?, emoji = ?, color = ? WHERE id = ?').run(
        data.name ?? project.name,
        data.emoji ?? project.emoji,
        data.color ?? project.color,
        project.id
      )
      hub.broadcast('projects')
      return c.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id) })
    }
  )

  app.delete('/api/projects/:id', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(c.req.valid('param').id)
    if (!project) httpError(404, ERROR_CODES.PROJECT_NOT_FOUND)
    const taskIds = db.prepare('SELECT id FROM tasks WHERE project_id = ?').all(project.id)
    for (const t of taskIds) removeAttachmentFiles(db, uploadsDir, t.id)
    db.prepare('DELETE FROM projects WHERE id = ?').run(project.id) // cascada a tareas
    hub.broadcast('projects')
    hub.broadcast('tasks')
    return c.body(null, 204)
  })

  // --- Etiquetas (globales) ---
  app.post('/api/labels', zValidator('json', labelSchema, validationHook), (c) => {
    const db = c.get('db')
    const data = c.req.valid('json')
    if (db.prepare('SELECT id FROM labels WHERE name = ?').get(data.name)) {
      httpError(409, ERROR_CODES.LABEL_NAME_TAKEN)
    }
    const id = crypto.randomUUID()
    try {
      db.prepare('INSERT INTO labels (id, name, color) VALUES (?, ?, ?)').run(id, data.name, data.color)
    } catch (err) {
      // Carrera entre el chequeo y el INSERT: UNIQUE con código de dominio.
      if (err instanceof SqliteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        httpError(409, ERROR_CODES.LABEL_NAME_TAKEN)
      }
      throw err
    }
    hub.broadcast('labels')
    c.header('Location', `/api/labels/${id}`)
    return c.json({ label: { id, ...data } }, 201)
  })

  app.patch(
    '/api/labels/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', labelPatchSchema, validationHook),
    (c) => {
      const db = c.get('db')
      const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(c.req.valid('param').id)
      if (!label) httpError(404, ERROR_CODES.LABEL_NOT_FOUND)
      const data = c.req.valid('json')
      try {
        db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(
          data.name ?? label.name,
          data.color ?? label.color,
          label.id
        )
      } catch (err) {
        if (err instanceof SqliteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          httpError(409, ERROR_CODES.LABEL_NAME_TAKEN)
        }
        throw err
      }
      hub.broadcast('labels')
      return c.json({ label: db.prepare('SELECT * FROM labels WHERE id = ?').get(label.id) })
    }
  )

  app.delete('/api/labels/:id', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const { changes } = db.prepare('DELETE FROM labels WHERE id = ?').run(c.req.valid('param').id)
    if (!changes) httpError(404, ERROR_CODES.LABEL_NOT_FOUND)
    hub.broadcast('labels')
    hub.broadcast('tasks')
    return c.body(null, 204)
  })

  // --- Tareas ---
  app.post('/api/tasks', zValidator('json', taskCreateSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const data = c.req.valid('json')
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(data.project_id)) {
      httpError(404, ERROR_CODES.PROJECT_NOT_FOUND)
    }
    if (data.assignee_id && !db.prepare('SELECT id FROM users WHERE id = ?').get(data.assignee_id)) {
      httpError(404, ERROR_CODES.ASSIGNEE_NOT_FOUND)
    }
    const id = crypto.randomUUID()
    const now = Date.now()
    const pos = db
      .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE "column" = ?')
      .get(data.column).p
    const create = db.transaction(() => {
      db.prepare(
        `INSERT INTO tasks (id, project_id, title, description, "column", position, priority, due_date, assignee_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, data.project_id, data.title, data.description, data.column, pos,
        data.priority ?? null, data.due_date ?? null, data.assignee_id ?? null, user.id, now, now
      )
      replaceTaskLabels(db, id, data.labels)
      addEvent(db, id, user.id, 'created')
    })
    create()
    hub.broadcast('tasks')
    // Push: 'tarea_creada' a todos menos actor y asignado; el asignado recibe
    // 'asignacion' (así no le llegan dos avisos de la misma tarjeta).
    const datosPush = { usuario: user.username, titulo: data.title }
    const asignado = data.assignee_id && data.assignee_id !== user.id ? data.assignee_id : null
    if (asignado) notifyIds(db, c.get('demo'), [asignado], 'asignacion', datosPush)
    const otros = db.prepare('SELECT id FROM users WHERE id != ? AND id != ?').all(user.id, asignado || '').map((r) => r.id)
    notifyIds(db, c.get('demo'), otros, 'tarea_creada', datosPush)
    c.header('Location', `/api/tasks/${id}`)
    return c.json({ task: hydrateTasks(db, 'WHERE t.id = ?', [id])[0] }, 201)
  })

  app.patch(
    '/api/tasks/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', taskPatchSchema, validationHook),
    (c) => {
      const db = c.get('db')
      const user = c.get('user')
      const task = getTask(db, c.req.valid('param').id)
      if (!task) httpError(404, ERROR_CODES.TASK_NOT_FOUND)
      const data = c.req.valid('json')
      if (data.assignee_id && !db.prepare('SELECT id FROM users WHERE id = ?').get(data.assignee_id)) {
        httpError(404, ERROR_CODES.ASSIGNEE_NOT_FOUND)
      }

      const now = Date.now()
      const update = db.transaction(() => {
        // Cada cambio registra su activity_event
        if (data.title !== undefined && data.title !== task.title) {
          db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(data.title, task.id)
          addEvent(db, task.id, user.id, 'title', { from: task.title, to: data.title })
        }
        if (data.description !== undefined && data.description !== task.description) {
          db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(data.description, task.id)
          addEvent(db, task.id, user.id, 'description', { from: task.description, to: data.description })
        }
        if (data.priority !== undefined && data.priority !== task.priority) {
          db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(data.priority, task.id)
          addEvent(db, task.id, user.id, 'priority', { from: task.priority, to: data.priority })
        }
        if (data.due_date !== undefined && data.due_date !== task.due_date) {
          db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(data.due_date, task.id)
          addEvent(db, task.id, user.id, 'due', { from: task.due_date, to: data.due_date })
        }
        if (data.assignee_id !== undefined && data.assignee_id !== task.assignee_id) {
          db.prepare('UPDATE tasks SET assignee_id = ? WHERE id = ?').run(data.assignee_id, task.id)
          addEvent(db, task.id, user.id, 'assigned', { from: task.assignee_id, to: data.assignee_id })
        }
        if (data.labels !== undefined) replaceTaskLabels(db, task.id, data.labels)
        db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, task.id)
      })
      update()
      hub.broadcast('tasks')
      // Push: cambio de asignación → aviso al nuevo asignado.
      if (data.assignee_id !== undefined && data.assignee_id && data.assignee_id !== task.assignee_id && data.assignee_id !== user.id) {
        notifyIds(db, c.get('demo'), [data.assignee_id], 'asignacion', { usuario: user.username, titulo: task.title })
      }
      return c.json({ task: hydrateTasks(db, 'WHERE t.id = ?', [task.id])[0] })
    }
  )

  // Mover tarjeta: reordena posiciones de ambas columnas en transacción + evento 'moved'
  app.post(
    '/api/tasks/:id/move',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', moveSchema, validationHook),
    (c) => {
      const db = c.get('db')
      const user = c.get('user')
      const task = getTask(db, c.req.valid('param').id)
      if (!task) httpError(404, ERROR_CODES.TASK_NOT_FOUND)
      const data = c.req.valid('json')

      const fromCol = task.column
      const fromPos = task.position
      const toCol = data.column
      const targetCount = db
        .prepare('SELECT COUNT(*) AS n FROM tasks WHERE "column" = ? AND id != ?')
        .get(toCol, task.id).n
      const toPos = Math.min(data.position, targetCount)

      const move = db.transaction(() => {
        if (fromCol === toCol) {
          if (toPos === fromPos) return false // sin cambio
          if (toPos < fromPos) {
            db.prepare(
              'UPDATE tasks SET position = position + 1 WHERE "column" = ? AND position >= ? AND position < ?'
            ).run(toCol, toPos, fromPos)
          } else {
            db.prepare(
              'UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ? AND position <= ?'
            ).run(toCol, fromPos, toPos)
          }
        } else {
          // compacta la columna origen y abre hueco en la destino
          db.prepare('UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ?').run(fromCol, fromPos)
          db.prepare('UPDATE tasks SET position = position + 1 WHERE "column" = ? AND position >= ?').run(toCol, toPos)
        }
        db.prepare('UPDATE tasks SET "column" = ?, position = ?, updated_at = ? WHERE id = ?')
          .run(toCol, toPos, Date.now(), task.id)
        addEvent(db, task.id, user.id, 'moved', { from: fromCol, to: toCol })
        return true
      })
      move()
      hub.broadcast('tasks')
      notifyAllExcept(db, c.get('demo'), user.id, 'tarea_movida', { usuario: user.username, titulo: task.title, columna: toCol })
      return c.json({ task: hydrateTasks(db, 'WHERE t.id = ?', [task.id])[0] })
    }
  )

  app.delete('/api/tasks/:id', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const task = getTask(db, c.req.valid('param').id)
    if (!task) httpError(404, ERROR_CODES.TASK_NOT_FOUND)
    removeAttachmentFiles(db, uploadsDir, task.id)
    const del = db.transaction(() => {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id) // cascada: labels/comments/adjuntos/eventos
      db.prepare('UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ?')
        .run(task.column, task.position)
    })
    del()
    hub.broadcast('tasks')
    return c.body(null, 204)
  })

  // Detalle completo: task + labels + attachments + comments + activity (paginado LIMIT 50)
  app.get('/api/tasks/:id', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const hydrated = hydrateTasks(db, 'WHERE t.id = ?', [c.req.valid('param').id])[0]
    if (!hydrated) httpError(404, ERROR_CODES.TASK_NOT_FOUND)
    const attachments = db
      .prepare(
        `SELECT a.id, a.filename, a.size, a.mime, a.created_at, a.uploaded_by, u.username AS uploaded_by_username
         FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
         WHERE a.task_id = ? ORDER BY a.created_at`
      )
      .all(hydrated.id)
    const comments = db
      .prepare(
        `SELECT cm.id, cm.body, cm.created_at, cm.user_id, u.username, u.color AS user_color
         FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
         WHERE cm.task_id = ? ORDER BY cm.created_at`
      )
      .all(hydrated.id)
    const activity = db
      .prepare(
        `SELECT e.id, e.type, e.data, e.created_at, e.user_id, u.username
         FROM activity_events e LEFT JOIN users u ON u.id = e.user_id
         WHERE e.task_id = ? ORDER BY e.created_at DESC LIMIT 50`
      )
      .all(hydrated.id)
      .map((e) => ({ ...e, data: JSON.parse(e.data || '{}') }))
    return c.json({ task: hydrated, attachments, comments, activity })
  })

  // --- Comentarios ---
  app.post(
    '/api/tasks/:id/comments',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', commentSchema, validationHook),
    (c) => {
      const db = c.get('db')
      const user = c.get('user')
      const task = getTask(db, c.req.valid('param').id)
      if (!task) httpError(404, ERROR_CODES.TASK_NOT_FOUND)
      const data = c.req.valid('json')
      const id = crypto.randomUUID()
      const now = Date.now()
      db.prepare('INSERT INTO comments (id, task_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, task.id, user.id, data.body, now)
      db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, task.id)
      hub.broadcast('comments')
      notifyAllExcept(db, c.get('demo'), user.id, 'comentario', { usuario: user.username, titulo: task.title })
      // Location: no hay GET de comentario individual; apunta a la tarea que lo contiene.
      c.header('Location', `/api/tasks/${task.id}`)
      return c.json(
        { comment: { id, body: data.body, created_at: now, user_id: user.id, username: user.username, user_color: user.color } },
        201
      )
    }
  )

  // --- Adjuntos ---
  const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/zip', 'application/gzip',
    'application/x-tar',
  ])
  app.post(
    '/api/tasks/:id/attachments',
    zValidator('param', idParamSchema, validationHook),
    async (c) => {
      const db = c.get('db')
      const user = c.get('user')
      const task = getTask(db, c.req.valid('param').id)
      if (!task) httpError(404, ERROR_CODES.TASK_NOT_FOUND)
      // Multipart: no va por zValidator('json'); se validan presencia y tamaño.
      const body = await c.req.parseBody().catch(() => null)
      const file = body?.file
      if (!file || typeof file.arrayBuffer !== 'function') {
        httpError(400, ERROR_CODES.UPLOAD_FILE_REQUIRED)
      }
      if (file.size > c.get('maxUploadBytes')) {
        httpError(413, ERROR_CODES.UPLOAD_TOO_LARGE)
      }
      const mime = String(file.type || 'application/octet-stream').slice(0, 100)
      if (!ALLOWED_MIME_TYPES.has(mime)) {
        httpError(415, ERROR_CODES.UPLOAD_INVALID_MIME)
      }
      const maxAttachments = parseInt(kvGet(prod, 'max_attachments_per_task', '50'), 10)
      const currentCount = db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE task_id = ?').get(task.id).n
      if (currentCount >= maxAttachments) {
        httpError(409, ERROR_CODES.ATTACHMENTS_LIMIT_EXCEEDED)
      }
      // Nombre aleatorio en disco; la extensión se sanea (solo alfanumérica, máx 10)
      const ext = path.extname(file.name || '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10)
      const stored = `${crypto.randomUUID()}${ext}`
      const buffer = Buffer.from(await file.arrayBuffer())
      fs.mkdirSync(uploadsDir, { recursive: true })
      fs.writeFileSync(path.join(uploadsDir, stored), buffer)

      const id = crypto.randomUUID()
      const now = Date.now()
      const filename = String(file.name || 'adjunto').slice(0, 200)
      const insert = db.transaction(() => {
        db.prepare(
          'INSERT INTO attachments (id, task_id, filename, stored_name, size, mime, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(id, task.id, filename, stored, buffer.length, mime, user.id, now)
        db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, task.id)
        addEvent(db, task.id, user.id, 'attachment', { filename })
      })
      insert()
      hub.broadcast('attachments')
      hub.broadcast('tasks')
      c.header('Location', `/api/attachments/${id}`)
      return c.json(
        { attachment: { id, filename, size: buffer.length, mime, created_at: now, uploaded_by: user.id, uploaded_by_username: user.username } },
        201
      )
    }
  )

  app.get('/api/attachments/:id', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(c.req.valid('param').id)
    if (!att) httpError(404, ERROR_CODES.ATTACHMENT_NOT_FOUND)
    const filePath = path.join(uploadsDir, path.basename(att.stored_name))
    if (!fs.existsSync(filePath)) httpError(404, ERROR_CODES.ATTACHMENT_FILE_MISSING)
    c.header('Content-Type', att.mime || 'application/octet-stream')
    c.header(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`
    )
    return c.body(fs.readFileSync(filePath))
  })

  // --- Feed global de actividad: paginación KEYSET (skill api-stack) ---------
  // Cursor opaco base64url {ts, id} sobre (created_at DESC, id DESC); LIMIT n+1;
  // respuesta { items, nextCursor, hasMore }. Cursor malformado → 400
  // INVALID_CURSOR. (Antes: page/limit/total con OFFSET — cambio de contrato,
  // ver CONVENTIONS.md para la fase 2 del frontend.)
  app.get('/api/activity', zValidator('query', activityQuerySchema, validationHook), (c) => {
    const db = c.get('db')
    const { cursor, limit } = c.req.valid('query')
    const decoded = cursor ? decodeCursor(cursor) : null
    const keyset = decoded
      ? 'WHERE (e.created_at < @cts OR (e.created_at = @cts AND e.id < @cid))'
      : ''
    const rows = db
      .prepare(
        `SELECT e.id, e.type, e.data, e.created_at, e.task_id,
                t.title AS task_title, t.project_id, p.name AS project_name,
                u.username, u.color AS user_color
         FROM activity_events e
         JOIN tasks t ON t.id = e.task_id
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = e.user_id
         ${keyset}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT @limitPlusOne`
      )
      .all({
        ...(decoded ? { cts: decoded.ts, cid: decoded.id } : {}),
        limitPlusOne: limit + 1,
      })
      .map((e) => ({ ...e, data: JSON.parse(e.data || '{}') }))
    const page = keysetPage(rows, limit)
    return c.json({ items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore })
  })

  // --- Admin: usuarios ---
  app.get('/api/users', (c) => {
    requireAdmin(c)
    const db = c.get('db')
    const users = db
      .prepare('SELECT id, username, email, phone, color, language, role, created_at FROM users ORDER BY username')
      .all()
    return c.json({ users })
  })

  app.post('/api/users', zValidator('json', userCreateSchema, validationHook), async (c) => {
    requireAdmin(c)
    const db = c.get('db')
    const data = c.req.valid('json')
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(data.username)) {
      httpError(409, ERROR_CODES.USER_ALREADY_EXISTS)
    }
    const hash = await bcrypt.hash(data.password, 10)
    const id = crypto.randomUUID()
    try {
      db.prepare(
        'INSERT INTO users (id, username, password_hash, color, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, data.username, hash, data.color, 'auto', data.role, Date.now())
    } catch (err) {
      if (err instanceof SqliteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        httpError(409, ERROR_CODES.USER_ALREADY_EXISTS)
      }
      throw err
    }
    hub.broadcast('users')
    c.header('Location', `/api/users/${id}`)
    return c.json(
      { user: db.prepare('SELECT id, username, email, phone, color, language, role, created_at FROM users WHERE id = ?').get(id) },
      201
    )
  })

  // Cambio de rol (admin). Salvaguardas: no auto-cambio y protección último admin.
  app.put(
    '/api/users/:id/role',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', userRoleSchema, validationHook),
    (c) => {
      requireAdmin(c)
      const db = c.get('db')
      const me = c.get('user')
      const id = c.req.valid('param').id
      if (id === me.id) httpError(400, ERROR_CODES.USER_SELF_ROLE)
      const data = c.req.valid('json')
      const target = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id)
      if (!target) httpError(404, ERROR_CODES.USER_NOT_FOUND)
      if (target.role === 'admin' && data.role === 'user' && countAdmins(db) <= 1) {
        httpError(400, ERROR_CODES.USER_LAST_ADMIN)
      }
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(data.role, id)
      hub.broadcast('users')
      return c.json({ user: db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) })
    }
  )

  // Reset de contraseña (admin): re-hashea y destruye las sesiones del usuario.
  app.put(
    '/api/users/:id/password',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', userPasswordSchema, validationHook),
    async (c) => {
      requireAdmin(c)
      const db = c.get('db')
      const id = c.req.valid('param').id
      const data = c.req.valid('json')
      if (!db.prepare('SELECT id FROM users WHERE id = ?').get(id)) {
        httpError(404, ERROR_CODES.USER_NOT_FOUND)
      }
      const hash = await bcrypt.hash(data.password, 10)
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id)
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
      hub.broadcast('users')
      return c.json({ ok: true })
    }
  )

  // Idioma de un usuario (admin): users.language es la fuente de verdad.
  app.put(
    '/api/users/:id/language',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', userLanguageSchema, validationHook),
    (c) => {
      requireAdmin(c)
      const db = c.get('db')
      const id = c.req.valid('param').id
      const data = c.req.valid('json')
      if (!db.prepare('SELECT id FROM users WHERE id = ?').get(id)) {
        httpError(404, ERROR_CODES.USER_NOT_FOUND)
      }
      db.prepare('UPDATE users SET language = ? WHERE id = ?').run(data.language, id)
      hub.broadcast('users')
      return c.json({ user: db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) })
    }
  )

  // Borrado (admin). Salvaguardas: no auto-borrado, protección último admin;
  // destruye las sesiones del usuario eliminado.
  app.delete('/api/users/:id', zValidator('param', idParamSchema, validationHook), (c) => {
    requireAdmin(c)
    const db = c.get('db')
    const me = c.get('user')
    const id = c.req.valid('param').id
    if (id === me.id) httpError(400, ERROR_CODES.USER_SELF_DELETE)
    const target = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id)
    if (!target) httpError(404, ERROR_CODES.USER_NOT_FOUND)
    if (target.role === 'admin' && countAdmins(db) <= 1) {
      httpError(400, ERROR_CODES.USER_LAST_ADMIN)
    }
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    hub.broadcast('users')
    return c.body(null, 204)
  })

  // --- Ajustes: modo demo (flag en kv de producción) ---
  // GET público (la pantalla de login lo consulta para mostrar el botón demo).
  app.get('/api/settings/demo', (c) => {
    return c.json({ demo_enabled: kvGet(prod, 'demo_enabled', '1') === '1' })
  })

  // PUT solo admin de producción: conmuta el modo demo
  app.put('/api/settings/demo', zValidator('json', demoToggleSchema, validationHook), (c) => {
    requireAdmin(c)
    if (c.get('demo')) httpError(403, ERROR_CODES.SETTINGS_PROD_ONLY)
    const data = c.req.valid('json')
    kvSet(prod, 'demo_enabled', data.enabled ? '1' : '0')
    hub.broadcast('settings')
    return c.json({ demo_enabled: data.enabled })
  })

  // --- Ajustes del servidor (admin): backup y adjuntos ---
  app.get('/api/settings/server', (c) => {
    requireAdmin(c)
    return c.json({
      backup_enabled: kvGet(prod, 'backup_enabled', '1') === '1',
      backup_retention_days: parseInt(kvGet(prod, 'backup_retention_days', '7'), 10),
      max_attachments_per_task: parseInt(kvGet(prod, 'max_attachments_per_task', '50'), 10),
      backup_last_run: kvGet(prod, 'backup_last_run'),
      backup_path: kvGet(prod, 'backup_path'),
    })
  })

  app.put('/api/settings/server', zValidator('json', serverSettingsSchema, validationHook), (c) => {
    requireAdmin(c)
    if (c.get('demo')) httpError(403, ERROR_CODES.SETTINGS_PROD_ONLY)
    const data = c.req.valid('json')
    kvSet(prod, 'backup_enabled', data.backup_enabled ? '1' : '0')
    kvSet(prod, 'backup_retention_days', String(data.backup_retention_days))
    kvSet(prod, 'max_attachments_per_task', String(data.max_attachments_per_task))
    hub.broadcast('settings')
    return c.json({
      backup_enabled: data.backup_enabled,
      backup_retention_days: data.backup_retention_days,
      max_attachments_per_task: data.max_attachments_per_task,
    })
  })

  // Backup manual: ejecuta el script de backup y registra resultado
  app.post('/api/settings/backup/run', async (c) => {
    requireAdmin(c)
    if (c.get('demo')) httpError(403, ERROR_CODES.SETTINGS_PROD_ONLY)
    const { execBackup } = await import('./backup.js')
    const result = await execBackup(prod, { DATA_DIR: dataDir })
    if (!result.ok) httpError(500, ERROR_CODES.SETTINGS_BACKUP_FAILED)
    return c.json({ ok: true, path: result.path, size: result.size })
  })
}
