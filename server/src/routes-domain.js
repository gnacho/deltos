// routes-domain.js — rutas del dominio Deltos: bootstrap, proyectos, etiquetas,
// tareas (CRUD + mover), comentarios, adjuntos, feed de actividad.
// Todas bajo requireAuth; c.get('db') apunta a la BD de la sesión (prod o demo).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { requireAdmin } from './auth.js'
import { kvGet, kvSet } from './db.js'

// --- Validación zod (límites de input) -------------------------------------

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'usa YYYY-MM-DD')
const colorSchema = z.string().regex(/^[a-z]{2,20}$/, 'color inválido')
const columnSchema = z.enum(['nuevo', 'encurso', 'hecho'])
const prioritySchema = z.enum(['alta', 'media', 'baja']).nullable()

const projectSchema = z.object({
  name: z.string().min(1).max(80),
  emoji: z.string().max(8).default(''),
  color: colorSchema.default('sky'),
})
const projectPatchSchema = projectSchema.partial()

const labelSchema = z.object({
  name: z.string().min(1).max(40),
  color: colorSchema.default('slate'),
})
const labelPatchSchema = labelSchema.partial()

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

function countAdmins(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n
}

const USER_COLS = 'id, username, email, phone, color, language, role, created_at'

// --- Helpers ----------------------------------------------------------------

async function parseJson(c, schema) {
  const body = await c.req.json().catch(() => null)
  if (body === null || typeof body !== 'object') return { error: 'cuerpo JSON inválido' }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { error: first ? `${first.path.join('.')}: ${first.message}` : 'formato inválido' }
  }
  return { data: parsed.data }
}

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

export function registerDomainRoutes(app, { hub, uploadsDir, prod }) {
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
  app.post('/api/projects', async (c) => {
    const db = c.get('db')
    const { data, error } = await parseJson(c, projectSchema)
    if (error) return c.json({ error }, 400)
    const id = crypto.randomUUID()
    const pos = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM projects').get().p
    db.prepare('INSERT INTO projects (id, name, emoji, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, data.name, data.emoji, data.color, pos, Date.now())
    hub.broadcast('projects')
    return c.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(id) }, 201)
  })

  app.patch('/api/projects/:id', async (c) => {
    const db = c.get('db')
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(c.req.param('id'))
    if (!project) return c.json({ error: 'proyecto no encontrado' }, 404)
    const { data, error } = await parseJson(c, projectPatchSchema)
    if (error) return c.json({ error }, 400)
    db.prepare('UPDATE projects SET name = ?, emoji = ?, color = ? WHERE id = ?').run(
      data.name ?? project.name,
      data.emoji ?? project.emoji,
      data.color ?? project.color,
      project.id
    )
    hub.broadcast('projects')
    return c.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id) })
  })

  app.delete('/api/projects/:id', (c) => {
    const db = c.get('db')
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(c.req.param('id'))
    if (!project) return c.json({ error: 'proyecto no encontrado' }, 404)
    const taskIds = db.prepare('SELECT id FROM tasks WHERE project_id = ?').all(project.id)
    for (const t of taskIds) removeAttachmentFiles(db, uploadsDir, t.id)
    db.prepare('DELETE FROM projects WHERE id = ?').run(project.id) // cascada a tareas
    hub.broadcast('projects')
    hub.broadcast('tasks')
    return c.json({ ok: true })
  })

  // --- Etiquetas (globales) ---
  app.post('/api/labels', async (c) => {
    const db = c.get('db')
    const { data, error } = await parseJson(c, labelSchema)
    if (error) return c.json({ error }, 400)
    if (db.prepare('SELECT id FROM labels WHERE name = ?').get(data.name)) {
      return c.json({ error: 'ya existe una etiqueta con ese nombre' }, 409)
    }
    const id = crypto.randomUUID()
    db.prepare('INSERT INTO labels (id, name, color) VALUES (?, ?, ?)').run(id, data.name, data.color)
    hub.broadcast('labels')
    return c.json({ label: { id, ...data } }, 201)
  })

  app.patch('/api/labels/:id', async (c) => {
    const db = c.get('db')
    const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(c.req.param('id'))
    if (!label) return c.json({ error: 'etiqueta no encontrada' }, 404)
    const { data, error } = await parseJson(c, labelPatchSchema)
    if (error) return c.json({ error }, 400)
    db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(
      data.name ?? label.name,
      data.color ?? label.color,
      label.id
    )
    hub.broadcast('labels')
    return c.json({ label: db.prepare('SELECT * FROM labels WHERE id = ?').get(label.id) })
  })

  app.delete('/api/labels/:id', (c) => {
    const db = c.get('db')
    const { changes } = db.prepare('DELETE FROM labels WHERE id = ?').run(c.req.param('id'))
    if (!changes) return c.json({ error: 'etiqueta no encontrada' }, 404)
    hub.broadcast('labels')
    hub.broadcast('tasks')
    return c.json({ ok: true })
  })

  // --- Tareas ---
  app.post('/api/tasks', async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const { data, error } = await parseJson(c, taskCreateSchema)
    if (error) return c.json({ error }, 400)
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(data.project_id)) {
      return c.json({ error: 'proyecto no encontrado' }, 404)
    }
    if (data.assignee_id && !db.prepare('SELECT id FROM users WHERE id = ?').get(data.assignee_id)) {
      return c.json({ error: 'usuario asignado no encontrado' }, 404)
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
    return c.json({ task: hydrateTasks(db, 'WHERE t.id = ?', [id])[0] }, 201)
  })

  app.patch('/api/tasks/:id', async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const task = getTask(db, c.req.param('id'))
    if (!task) return c.json({ error: 'tarea no encontrada' }, 404)
    const { data, error } = await parseJson(c, taskPatchSchema)
    if (error) return c.json({ error }, 400)
    if (data.assignee_id && !db.prepare('SELECT id FROM users WHERE id = ?').get(data.assignee_id)) {
      return c.json({ error: 'usuario asignado no encontrado' }, 404)
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
    return c.json({ task: hydrateTasks(db, 'WHERE t.id = ?', [task.id])[0] })
  })

  // Mover tarjeta: reordena posiciones de ambas columnas en transacción + evento 'moved'
  app.post('/api/tasks/:id/move', async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const task = getTask(db, c.req.param('id'))
    if (!task) return c.json({ error: 'tarea no encontrada' }, 404)
    const { data, error } = await parseJson(c, moveSchema)
    if (error) return c.json({ error }, 400)

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
    return c.json({ task: hydrateTasks(db, 'WHERE t.id = ?', [task.id])[0] })
  })

  app.delete('/api/tasks/:id', (c) => {
    const db = c.get('db')
    const task = getTask(db, c.req.param('id'))
    if (!task) return c.json({ error: 'tarea no encontrada' }, 404)
    removeAttachmentFiles(db, uploadsDir, task.id)
    const del = db.transaction(() => {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id) // cascada: labels/comments/adjuntos/eventos
      db.prepare('UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ?')
        .run(task.column, task.position)
    })
    del()
    hub.broadcast('tasks')
    return c.json({ ok: true })
  })

  // Detalle completo: task + labels + attachments + comments + activity (paginado LIMIT 50)
  app.get('/api/tasks/:id', (c) => {
    const db = c.get('db')
    const hydrated = hydrateTasks(db, 'WHERE t.id = ?', [c.req.param('id')])[0]
    if (!hydrated) return c.json({ error: 'tarea no encontrada' }, 404)
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
  app.post('/api/tasks/:id/comments', async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const task = getTask(db, c.req.param('id'))
    if (!task) return c.json({ error: 'tarea no encontrada' }, 404)
    const { data, error } = await parseJson(c, commentSchema)
    if (error) return c.json({ error }, 400)
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO comments (id, task_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, task.id, user.id, data.body, now)
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, task.id)
    hub.broadcast('comments')
    return c.json(
      { comment: { id, body: data.body, created_at: now, user_id: user.id, username: user.username, user_color: user.color } },
      201
    )
  })

  // --- Adjuntos ---
  app.post('/api/tasks/:id/attachments', async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const task = getTask(db, c.req.param('id'))
    if (!task) return c.json({ error: 'tarea no encontrada' }, 404)
    const body = await c.req.parseBody().catch(() => null)
    const file = body?.file
    if (!file || typeof file.arrayBuffer !== 'function') {
      return c.json({ error: 'falta el fichero (campo "file" en multipart)' }, 400)
    }
    if (file.size > c.get('maxUploadBytes')) {
      return c.json({ error: 'el fichero supera el límite de 10 MB' }, 413)
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
    const mime = String(file.type || 'application/octet-stream').slice(0, 100)
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
    return c.json(
      { attachment: { id, filename, size: buffer.length, mime, created_at: now, uploaded_by: user.id, uploaded_by_username: user.username } },
      201
    )
  })

  app.get('/api/attachments/:id', (c) => {
    const db = c.get('db')
    const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(c.req.param('id'))
    if (!att) return c.json({ error: 'adjunto no encontrado' }, 404)
    const filePath = path.join(uploadsDir, path.basename(att.stored_name))
    if (!fs.existsSync(filePath)) return c.json({ error: 'fichero no disponible en disco' }, 404)
    c.header('Content-Type', att.mime || 'application/octet-stream')
    c.header(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`
    )
    return c.body(fs.readFileSync(filePath))
  })

  // --- Feed global de actividad (paginado) ---
  app.get('/api/activity', (c) => {
    const db = c.get('db')
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '30', 10) || 30))
    const total = db.prepare('SELECT COUNT(*) AS n FROM activity_events').get().n
    const items = db
      .prepare(
        `SELECT e.id, e.type, e.data, e.created_at, e.task_id,
                t.title AS task_title, t.project_id, p.name AS project_name,
                u.username, u.color AS user_color
         FROM activity_events e
         JOIN tasks t ON t.id = e.task_id
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = e.user_id
         ORDER BY e.created_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, (page - 1) * limit)
      .map((e) => ({ ...e, data: JSON.parse(e.data || '{}') }))
    return c.json({ items, page, limit, total })
  })

  // --- Admin: usuarios ---
  app.get('/api/users', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const db = c.get('db')
    const users = db
      .prepare('SELECT id, username, email, phone, color, language, role, created_at FROM users ORDER BY username')
      .all()
    return c.json({ users })
  })

  app.post('/api/users', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const db = c.get('db')
    const { data, error } = await parseJson(c, userCreateSchema)
    if (error) return c.json({ error }, 400)
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(data.username)) {
      return c.json({ error: 'usuario ya existe' }, 409)
    }
    const hash = await bcrypt.hash(data.password, 10)
    const id = crypto.randomUUID()
    db.prepare(
      'INSERT INTO users (id, username, password_hash, color, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.username, hash, data.color, 'auto', data.role, Date.now())
    hub.broadcast('users')
    return c.json(
      { user: db.prepare('SELECT id, username, email, phone, color, language, role, created_at FROM users WHERE id = ?').get(id) },
      201
    )
  })

  // Cambio de rol (admin). Salvaguardas: no auto-cambio y protección último admin.
  app.put('/api/users/:id/role', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const db = c.get('db')
    const me = c.get('user')
    const id = c.req.param('id')
    if (id === me.id) return c.json({ error: 'no puedes cambiar tu propio rol' }, 400)
    const { data, error } = await parseJson(c, userRoleSchema)
    if (error) return c.json({ error }, 400)
    const target = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id)
    if (!target) return c.json({ error: 'usuario no encontrado' }, 404)
    if (target.role === 'admin' && data.role === 'user' && countAdmins(db) <= 1) {
      return c.json({ error: 'debe quedar al menos un administrador' }, 400)
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(data.role, id)
    hub.broadcast('users')
    return c.json({ user: db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) })
  })

  // Reset de contraseña (admin): re-hashea y destruye las sesiones del usuario.
  app.put('/api/users/:id/password', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const db = c.get('db')
    const id = c.req.param('id')
    const { data, error } = await parseJson(c, userPasswordSchema)
    if (error) return c.json({ error }, 400)
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(id)) {
      return c.json({ error: 'usuario no encontrado' }, 404)
    }
    const hash = await bcrypt.hash(data.password, 10)
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
    hub.broadcast('users')
    return c.json({ ok: true })
  })

  // Idioma de un usuario (admin): users.language es la fuente de verdad.
  app.put('/api/users/:id/language', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const db = c.get('db')
    const id = c.req.param('id')
    const { data, error } = await parseJson(c, userLanguageSchema)
    if (error) return c.json({ error }, 400)
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(id)) {
      return c.json({ error: 'usuario no encontrado' }, 404)
    }
    db.prepare('UPDATE users SET language = ? WHERE id = ?').run(data.language, id)
    hub.broadcast('users')
    return c.json({ user: db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) })
  })

  // Borrado (admin). Salvaguardas: no auto-borrado, protección último admin;
  // destruye las sesiones del usuario eliminado.
  app.delete('/api/users/:id', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const db = c.get('db')
    const me = c.get('user')
    const id = c.req.param('id')
    if (id === me.id) return c.json({ error: 'no puedes eliminarte a ti mismo' }, 400)
    const target = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id)
    if (!target) return c.json({ error: 'usuario no encontrado' }, 404)
    if (target.role === 'admin' && countAdmins(db) <= 1) {
      return c.json({ error: 'debe quedar al menos un administrador' }, 400)
    }
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    hub.broadcast('users')
    return c.json({ ok: true })
  })

  // --- Ajustes: modo demo (flag en kv de producción) ---
  // GET público (la pantalla de login lo consulta para mostrar el botón demo).
  app.get('/api/settings/demo', (c) => {
    return c.json({ demo_enabled: kvGet(prod, 'demo_enabled', '1') === '1' })
  })

  // PUT solo admin de producción: conmuta el modo demo
  app.put('/api/settings/demo', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    if (c.get('demo')) return c.json({ error: 'ajuste solo disponible desde la sesión de producción' }, 403)
    const { data, error } = await parseJson(c, demoToggleSchema)
    if (error) return c.json({ error }, 400)
    kvSet(prod, 'demo_enabled', data.enabled ? '1' : '0')
    hub.broadcast('settings')
    return c.json({ demo_enabled: data.enabled })
  })
}
