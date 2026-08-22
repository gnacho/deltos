// routes-ha.js — integración con Home Assistant (dominio todo vía REST).
// HA no tiene dominio `todo` nativo por REST: se consume como sensor REST
// (lista de tareas pendientes) + rest_command (crear/completar), ambos con un
// Bearer token de larga duración.
//
// Seguridad (regla del stack): el token se guarda en kv SOLO como hash SHA-256;
// el valor en claro se muestra UNA vez al generarlo (admin). El token se revoca
// borrando el hash. scope limitado: solo las rutas /api/ha/*.
import crypto from 'node:crypto'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { kvGet, kvSet } from './db.js'
import { httpError, validationHook } from './errors.js'
import { ERROR_CODES } from './error-codes.js'
import { logger } from './logger.js'
import { normalizeRecurrence, serializeRecurrence, computeNextDue, todayLocal } from './recurrence.js'

const log = logger.child({ component: 'ha' })

const HA_TOKEN_KEY = 'ha_token_hash'
const HA_USERNAME_KEY = 'ha_username'

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function isMember(db, userId, projectId) {
  return !!db
    .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId)
}

// Middleware: exige Authorization: Bearer <token> con hash en kv.
// Comparación en tiempo constante del hash SHA-256 (issue #171).
export function requireHaToken(prod) {
  return async (c, next) => {
    const header = c.req.header('authorization') || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const expected = kvGet(prod, HA_TOKEN_KEY)
    if (!token || !expected) {
      httpError(401, ERROR_CODES.AUTH_REQUIRED)
    }
    const givenHash = Buffer.from(sha256(token), 'hex')
    const expectedHash = Buffer.from(expected, 'hex')
    if (
      givenHash.length !== expectedHash.length ||
      !crypto.timingSafeEqual(givenHash, expectedHash)
    ) {
      httpError(401, ERROR_CODES.AUTH_REQUIRED)
    }
    await next()
  }
}

export function registerHaRoutes(app, ctx) {
  const { prod } = ctx
  const db = prod

  // --- Gestión del token (solo admin, sesión normal) ---

  // GET /api/ha/status: si hay token y a qué usuario apunta la lista.
  app.get('/api/ha/status', (c) => {
    const hash = kvGet(db, HA_TOKEN_KEY)
    return c.json({
      enabled: !!hash,
      username: kvGet(db, HA_USERNAME_KEY) ?? null,
    })
  })

  // POST /api/ha/token: genera un token nuevo (revoca el anterior).
  const tokenSchema = z.object({ username: z.string().min(1).max(50).optional() })
  app.post('/api/ha/token', zValidator('json', tokenSchema, validationHook), (c) => {
    const user = c.get('user')
    if (user.role !== 'admin') httpError(403, ERROR_CODES.AUTH_FORBIDDEN)
    const username = c.req.valid('json').username || null
    if (username) {
      const u = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
      if (!u) httpError(404, ERROR_CODES.USER_NOT_FOUND)
      kvSet(db, HA_USERNAME_KEY, username)
    } else {
      kvSet(db, HA_USERNAME_KEY, '')
    }
    const token = crypto.randomBytes(32).toString('hex')
    kvSet(db, HA_TOKEN_KEY, sha256(token))
    noopLog(c, 'ha_token_generated', { username })
    return c.json({ token, username })
  })

  // DELETE /api/ha/token: revoca (borra el hash).
  app.delete('/api/ha/token', (c) => {
    if (c.get('user').role !== 'admin') httpError(403, ERROR_CODES.AUTH_FORBIDDEN)
    kvSet(db, HA_TOKEN_KEY, '')
    kvSet(db, HA_USERNAME_KEY, '')
    return c.body(null, 204)
  })

  // --- Rutas públicas para HA (Bearer token) ---

  // GET /api/ha/tasks: lista de tareas pendientes del usuario configurado
  // (o de todos si no hay usuario). Formato compatible con sensor REST.
  app.get('/api/ha/tasks', requireHaToken(db), (c) => {
    const username = kvGet(db, HA_USERNAME_KEY)
    const base = `
      SELECT t.id, t.title, t."column", t.priority, t.due_date,
             p.name AS project_name, u.username AS assignee
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.deleted_at IS NULL AND t."column" != 'hecho'`
    const rows = username
      ? db
          .prepare(
            `${base} AND (t.assignee_id IS NULL OR t.assignee_id IN (SELECT id FROM users WHERE username = ?)) ORDER BY t.position`
          )
          .all(username)
      : db.prepare(`${base} ORDER BY t."column", t.position`).all()
    return c.json({
      username: username || null,
      count: rows.length,
      tasks: rows.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.title,
        status: r.column === 'encurso' ? 'in_progress' : 'needs_action',
        due_date: r.due_date,
        priority: r.priority,
        project: r.project_name,
        assignee: r.assignee,
      })),
    })
  })

  // POST /api/ha/tasks: crea una tarea (todo.create).
  const createSchema = z.object({
    title: z.string().min(1).max(200),
    project_id: z.string().max(64).nullish(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'usa YYYY-MM-DD').nullish(),
    priority: z.enum(['alta', 'media', 'baja']).nullish(),
  })
  app.post('/api/ha/tasks', requireHaToken(db), zValidator('json', createSchema, validationHook), (c) => {
    const data = c.req.valid('json')
    const username = kvGet(db, HA_USERNAME_KEY)
    const actor = username
      ? db.prepare('SELECT * FROM users WHERE username = ?').get(username)
      : db.prepare('SELECT * FROM users WHERE role = ? ORDER BY created_at LIMIT 1').get('admin')
    if (!actor) httpError(500, ERROR_CODES.INTERNAL_ERROR)
    let projectId = data.project_id
    if (!projectId) {
      const first = db
        .prepare(
          `SELECT p.id FROM project_members pm JOIN projects p ON p.id = pm.project_id
           WHERE pm.user_id = ? ORDER BY p.position LIMIT 1`
        )
        .get(actor.id)
      projectId = first?.id
    }
    if (!projectId || !db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
      httpError(404, ERROR_CODES.PROJECT_NOT_FOUND)
    }
    // Membresía: el usuario configurado (o el admin por defecto) solo crea
    // tareas en proyectos de los que es miembro (issue #170).
    if (!isMember(db, actor.id, projectId)) {
      httpError(403, ERROR_CODES.AUTH_FORBIDDEN)
    }
    const id = crypto.randomUUID()
    const now = Date.now()
    const pos = db
      .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE "column" = ?')
      .get('nuevo').p
    const create = db.transaction(() => {
      db.prepare(
        `INSERT INTO tasks (id, project_id, title, description, "column", position, priority, due_date, assignee_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, '', 'nuevo', ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, projectId, data.title, pos, data.priority ?? null, data.due_date ?? null, actor.id, actor.id, now, now)
      db.prepare(
        'INSERT INTO activity_events (id, task_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(crypto.randomUUID(), id, actor.id, 'created', '{}', now)
    })
    create()
    noopLog(c, 'ha_task_created', { task_id: id })
    return c.json({ task: { id, title: data.title, status: 'needs_action' } }, 201)
  })

  // PATCH /api/ha/tasks/:id/complete: marca una tarea como hecha (todo.update).
  app.patch('/api/ha/tasks/:id/complete', requireHaToken(db), (c) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL').get(c.req.param('id'))
    if (!task) httpError(404, ERROR_CODES.TASK_NOT_FOUND)
    const username = kvGet(db, HA_USERNAME_KEY)
    const actor = username
      ? db.prepare('SELECT * FROM users WHERE username = ?').get(username)
      : db.prepare('SELECT * FROM users WHERE role = ? ORDER BY created_at LIMIT 1').get('admin')
    if (!actor) httpError(500, ERROR_CODES.INTERNAL_ERROR)
    // Membresía: solo se completan tareas de proyectos del usuario configurado
    // (o del admin por defecto). 404 para no revelar la existencia (issue #170).
    if (!isMember(db, actor.id, task.project_id)) {
      httpError(404, ERROR_CODES.TASK_NOT_FOUND)
    }
    const now = Date.now()
    const update = db.transaction(() => {
      const targetCount = db
        .prepare('SELECT COUNT(*) AS n FROM tasks WHERE "column" = ? AND id != ?')
        .get('hecho', task.id).n
      db.prepare('UPDATE tasks SET position = position - 1 WHERE "column" = ? AND position > ?')
        .run(task.column, task.position)
      db.prepare('UPDATE tasks SET "column" = ?, position = ?, updated_at = ? WHERE id = ?')
        .run('hecho', targetCount, now, task.id)
      db.prepare(
        'INSERT INTO activity_events (id, task_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(crypto.randomUUID(), task.id, task.created_by, 'moved', JSON.stringify({ from: task.column, to: 'hecho' }), now)
    })
    update()
    // Recurrencia: crear la siguiente instancia igual que el move normal.
    let nextTask = null
    if (task.recurrence) {
      const rec = normalizeRecurrence(JSON.parse(task.recurrence))
      if (rec) {
        const nextDue = computeNextDue(db, task, todayLocal())
        if (nextDue) {
          const nid = crypto.randomUUID()
          const npos = db
            .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE "column" = ?')
            .get('nuevo').p
          const groupId = task.recurrence_group_id || task.id
          db.transaction(() => {
            db.prepare(
              `INSERT INTO tasks (id, project_id, title, description, "column", position, priority, due_date, assignee_id, created_by, created_at, updated_at, recurrence, recurrence_group_id)
               VALUES (?, ?, ?, ?, 'nuevo', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              nid, task.project_id, task.title, task.description, npos,
              task.priority ?? null, nextDue, task.assignee_id ?? null, task.created_by, now, now,
              serializeRecurrence(rec), groupId
            )
            db.prepare(
              'INSERT INTO activity_events (id, task_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(crypto.randomUUID(), nid, task.created_by, 'created', '{}', now)
          })()
          nextTask = { id: nid, title: task.title }
        }
      }
    }
    return c.json({ task: { id: task.id, status: 'completed' }, next: nextTask })
  })
}

function noopLog(c, msg, extra = {}) {
  log.info(msg, extra)
}
