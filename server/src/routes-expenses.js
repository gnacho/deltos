import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { kvGet, kvSet } from './db.js'
import { httpError, validationHook } from './errors.js'
import { ERROR_CODES } from './error-codes.js'
import { notifyUsers } from './push.js'
import { logger } from './logger.js'

const log = logger.child({ component: 'expenses' })

const SPLIT_TYPES = ['half', 'custom', 'full']
const STEPS = ['nuevo', 'en-curso', 'hecho']

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

const idParamSchema = z.object({ id: z.string().min(1).max(100) })

const createSchema = z.object({
  title: z.string().min(1).max(200),
  amount_cents: z.number().int().min(1),
  label_id: z.string().nullable().optional(),
  notes: z.string().max(5000).default(''),
  paid_by_creator: z.boolean().default(false),
  requested_user_id: z.string().nullable().optional(),
  split_type: z.enum(SPLIT_TYPES).nullable().optional(),
  split_amount_cents: z.number().int().min(1).nullable().optional(),
  payment_method: z.enum(['bizum', 'transfer', 'efectivo']).nullable().optional(),
  step: z.enum(STEPS).default('nuevo'),
})

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  amount_cents: z.number().int().min(1).optional(),
  label_id: z.string().nullable().optional(),
  notes: z.string().max(5000).optional(),
  paid_by_creator: z.boolean().optional(),
  requested_user_id: z.string().nullable().optional(),
  split_type: z.enum(SPLIT_TYPES).nullable().optional(),
  split_amount_cents: z.number().int().min(1).nullable().optional(),
  paid_by_requested: z.boolean().optional(),
  payment_method: z.enum(['bizum', 'transfer', 'efectivo']).nullable().optional(),
  step: z.enum(STEPS).optional(),
})

const moveSchema = z.object({
  step: z.enum(STEPS),
  position: z.number().int().min(0),
})

const commentSchema = z.object({ body: z.string().min(1).max(5000) })

function pluginEnabled(prod) {
  return kvGet(prod, 'plugin_expenses_enabled', '0') === '1'
}

function addExpenseEvent(db, expenseId, userId, type, data = {}) {
  db.prepare(
    'INSERT INTO expense_activity_events (id, expense_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), expenseId, userId, type, JSON.stringify(data), Date.now())
}

function removeAttachmentFiles(db, uploadsDir, expenseId) {
  const rows = db.prepare('SELECT stored_name FROM expense_attachments WHERE expense_id = ?').all(expenseId)
  for (const r of rows) {
    try { fs.unlinkSync(path.join(uploadsDir, path.basename(r.stored_name))) } catch {}
  }
}

function hydrateExpense(db, id) {
  const row = db.prepare(
    `SELECT e.*, u.username AS created_by_username, u.color AS created_by_color,
            ru.username AS requested_username, ru.color AS requested_color,
            (SELECT COUNT(*) FROM expense_comments c WHERE c.expense_id = e.id) AS comment_count,
            (SELECT COUNT(*) FROM expense_attachments a WHERE a.expense_id = e.id) AS attachment_count,
            l.name AS label_name, l.color AS label_color
     FROM expenses e
     JOIN users u ON u.id = e.created_by
     LEFT JOIN users ru ON ru.id = e.requested_user_id
     LEFT JOIN labels l ON l.id = e.label_id
     WHERE e.id = ?`
  ).get(id)
  if (!row) return null
  return {
    id: row.id, title: row.title, amount_cents: row.amount_cents,
    label_id: row.label_id, label_name: row.label_name, label_color: row.label_color,
    notes: row.notes,
    paid_by_creator: !!row.paid_by_creator,
    requested_user_id: row.requested_user_id,
    requested_username: row.requested_username, requested_color: row.requested_color,
    split_type: row.split_type, split_amount_cents: row.split_amount_cents,
    paid_by_requested: !!row.paid_by_requested,
    payment_method: row.payment_method,
    step: row.step, position: row.position,
    created_by: row.created_by, created_by_username: row.created_by_username,
    created_by_color: row.created_by_color,
    created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at,
    counts: { comments: row.comment_count ?? 0, attachments: row.attachment_count ?? 0 },
  }
}

function listExpenses(db) {
  return db.prepare(
    `SELECT e.*, u.username AS created_by_username, u.color AS created_by_color,
            ru.username AS requested_username, ru.color AS requested_color,
            (SELECT COUNT(*) FROM expense_comments c WHERE c.expense_id = e.id) AS comment_count,
            (SELECT COUNT(*) FROM expense_attachments a WHERE a.expense_id = e.id) AS attachment_count,
            l.name AS label_name, l.color AS label_color
     FROM expenses e
     JOIN users u ON u.id = e.created_by
     LEFT JOIN users ru ON ru.id = e.requested_user_id
     LEFT JOIN labels l ON l.id = e.label_id
     WHERE e.deleted_at IS NULL
     ORDER BY e.step, e.position`
  ).all().map((row) => ({
    id: row.id, title: row.title, amount_cents: row.amount_cents,
    label_id: row.label_id, label_name: row.label_name, label_color: row.label_color,
    notes: row.notes,
    paid_by_creator: !!row.paid_by_creator,
    requested_user_id: row.requested_user_id,
    requested_username: row.requested_username, requested_color: row.requested_color,
    split_type: row.split_type, split_amount_cents: row.split_amount_cents,
    paid_by_requested: !!row.paid_by_requested,
    payment_method: row.payment_method,
    step: row.step, position: row.position,
    created_by: row.created_by, created_by_username: row.created_by_username,
    created_by_color: row.created_by_color,
    created_at: row.created_at, updated_at: row.updated_at,
    counts: { comments: row.comment_count ?? 0, attachments: row.attachment_count ?? 0 },
  }))
}

function expenseDetail(db, id) {
  const expense = hydrateExpense(db, id)
  if (!expense || expense.deleted_at) return null
  const attachments = db.prepare(
    'SELECT id, filename, size, mime, created_at, uploaded_by FROM expense_attachments WHERE expense_id = ? ORDER BY created_at'
  ).all(id).map((a) => ({
    ...a, uploaded_by_username: db.prepare('SELECT username FROM users WHERE id = ?').get(a.uploaded_by)?.username || null,
  }))
  const comments = db.prepare(
    `SELECT c.*, u.username, u.color AS user_color
     FROM expense_comments c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.expense_id = ? ORDER BY c.created_at`
  ).all(id)
  const activity = db.prepare(
    `SELECT e.*, u.username
     FROM expense_activity_events e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.expense_id = ? ORDER BY e.created_at`
  ).all(id).map((e) => ({ ...e, data: JSON.parse(e.data || '{}') }))
  return { expense, attachments, comments, activity }
}

function getExpense(db, id) {
  return db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL').get(id)
}

export function registerExpenseRoutes(app, { prod, hub, uploadsDir }) {
  app.use('/api/expenses/*', async (c, next) => {
    if (!pluginEnabled(prod)) httpError(404, ERROR_CODES.NOT_FOUND)
    await next()
  })

  // --- Listar gastos ---
  app.get('/api/expenses', (c) => {
    return c.json({ expenses: listExpenses(c.get('db')) })
  })

  // --- Detalle completo (attachments + comments + activity) ---
  app.get('/api/expenses/:id/detail', zValidator('param', idParamSchema, validationHook), (c) => {
    const detail = expenseDetail(c.get('db'), c.req.valid('param').id)
    if (!detail) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)
    return c.json(detail)
  })

  // --- Crear gasto ---
  app.post('/api/expenses', zValidator('json', createSchema, validationHook), async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const data = c.req.valid('json')
    const now = Date.now()

    if (data.requested_user_id) {
      if (!data.split_type) httpError(422, ERROR_CODES.VALIDATION_FAILED)
      if (data.split_type === 'custom' && !data.split_amount_cents) httpError(422, ERROR_CODES.VALIDATION_FAILED)
      const target = db.prepare('SELECT id FROM users WHERE id = ?').get(data.requested_user_id)
      if (!target) httpError(422, ERROR_CODES.ASSIGNEE_NOT_MEMBER)
      if (data.requested_user_id === user.id) httpError(422, ERROR_CODES.VALIDATION_FAILED)
    }

    const id = crypto.randomUUID()
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS mx FROM expenses WHERE step = ? AND deleted_at IS NULL').get(data.step).mx
    const position = maxPos + 1

    db.transaction(() => {
      db.prepare(
        `INSERT INTO expenses (id, title, amount_cents, label_id, notes, paid_by_creator,
         requested_user_id, split_type, split_amount_cents, payment_method, step, position, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, data.title, data.amount_cents, data.label_id || null, data.notes,
        data.paid_by_creator ? 1 : 0, data.requested_user_id || null, data.split_type || null,
        data.split_amount_cents || null, data.payment_method || null, data.step, position, user.id, now, now)
      addExpenseEvent(db, id, user.id, 'created', {})
      if (data.notes) addExpenseEvent(db, id, user.id, 'notes', {})
      if (data.paid_by_creator) addExpenseEvent(db, id, user.id, 'paid', {})
      if (data.requested_user_id) addExpenseEvent(db, id, user.id, 'requested', { split_type: data.split_type })
      if (data.payment_method) addExpenseEvent(db, id, user.id, 'payment_method', { method: data.payment_method })
    })()

    hub.broadcast('expenses')

    if (data.requested_user_id && data.requested_user_id !== user.id) {
      const creador = db.prepare('SELECT username FROM users WHERE id = ?').get(user.id)
      notifyUsers(db, [data.requested_user_id], 'pago_requerido', {
        usuario: creador.username, titulo: data.title, importe: data.amount_cents,
        split_type: data.split_type, split_amount: data.split_amount_cents,
      }, { demo: c.get('demo'), url: '/expenses' }).catch((err) =>
        log.error('push_notify_failed', { tipo: 'pago_requerido', error: err }))
    }

    c.header('Location', `/api/expenses/${id}`)
    return c.json({ expense: hydrateExpense(db, id) }, 201)
  })

  // --- Obtener un gasto ---
  app.get('/api/expenses/:id', zValidator('param', idParamSchema, validationHook), (c) => {
    const expense = hydrateExpense(c.get('db'), c.req.valid('param').id)
    if (!expense || expense.deleted_at) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)
    return c.json({ expense })
  })

  // --- Actualizar gasto ---
  app.put('/api/expenses/:id', zValidator('param', idParamSchema, validationHook), zValidator('json', updateSchema, validationHook), async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const data = c.req.valid('json')
    const id = c.req.valid('param').id
    const now = Date.now()

    const current = db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!current) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)

    if (current.created_by !== user.id && current.requested_user_id !== user.id) {
      httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)
    }

    if (data.requested_user_id !== undefined && data.requested_user_id !== current.requested_user_id) {
      if (data.requested_user_id && !data.split_type && !current.split_type) httpError(422, ERROR_CODES.VALIDATION_FAILED)
      if (data.requested_user_id) {
        const target = db.prepare('SELECT id FROM users WHERE id = ?').get(data.requested_user_id)
        if (!target) httpError(422, ERROR_CODES.ASSIGNEE_NOT_MEMBER)
        if (data.requested_user_id === user.id) httpError(422, ERROR_CODES.VALIDATION_FAILED)
      }
    }

    if (data.paid_by_requested !== undefined && user.id !== current.requested_user_id) {
      httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)
    }

    let newStep = data.step !== undefined ? data.step : current.step
    const creatorPaid = data.paid_by_creator !== undefined ? data.paid_by_creator : !!current.paid_by_creator
    const requestedPaid = data.paid_by_requested !== undefined ? data.paid_by_requested : !!current.paid_by_requested
    const hasRequest = data.requested_user_id !== undefined ? !!data.requested_user_id : !!current.requested_user_id
    if (creatorPaid && (!hasRequest || requestedPaid)) newStep = 'hecho'

    db.transaction(() => {
      db.prepare(
        `UPDATE expenses SET title = ?, amount_cents = ?, label_id = ?, notes = ?,
         paid_by_creator = ?, requested_user_id = ?, split_type = ?, split_amount_cents = ?,
         paid_by_requested = ?, payment_method = ?, step = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        data.title ?? current.title, data.amount_cents ?? current.amount_cents,
        data.label_id !== undefined ? (data.label_id || null) : current.label_id,
        data.notes ?? current.notes,
        data.paid_by_creator !== undefined ? (data.paid_by_creator ? 1 : 0) : current.paid_by_creator,
        data.requested_user_id !== undefined ? (data.requested_user_id || null) : current.requested_user_id,
        data.split_type !== undefined ? (data.split_type || null) : current.split_type,
        data.split_amount_cents !== undefined ? (data.split_amount_cents || null) : current.split_amount_cents,
        data.paid_by_requested !== undefined ? (data.paid_by_requested ? 1 : 0) : current.paid_by_requested,
        data.payment_method !== undefined ? (data.payment_method || null) : current.payment_method,
        newStep, now, id)

      if (data.title !== undefined && data.title !== current.title) addExpenseEvent(db, id, user.id, 'title', { from: current.title, to: data.title })
      if (data.amount_cents !== undefined && data.amount_cents !== current.amount_cents) addExpenseEvent(db, id, user.id, 'amount', { from: current.amount_cents, to: data.amount_cents })
      if (data.notes !== undefined && data.notes !== current.notes) addExpenseEvent(db, id, user.id, 'notes', {})
      if (data.paid_by_creator !== undefined && data.paid_by_creator !== !!current.paid_by_creator) addExpenseEvent(db, id, user.id, 'paid', { paid: data.paid_by_creator })
      if (data.requested_user_id !== undefined && data.requested_user_id !== current.requested_user_id) addExpenseEvent(db, id, user.id, 'requested', {})
      if (data.split_type !== undefined && data.split_type !== current.split_type) addExpenseEvent(db, id, user.id, 'split', { from: current.split_type, to: data.split_type })
      if (data.payment_method !== undefined && data.payment_method !== current.payment_method) addExpenseEvent(db, id, user.id, 'payment_method', { to: data.payment_method })
      if (data.paid_by_requested !== undefined && data.paid_by_requested !== !!current.paid_by_requested) addExpenseEvent(db, id, user.id, 'paid', { paid_by_requested: true })
      if (newStep !== current.step) addExpenseEvent(db, id, user.id, 'moved', { from: current.step, to: newStep })
    })()

    hub.broadcast('expenses')

    const newRequested = data.requested_user_id !== undefined ? data.requested_user_id : current.requested_user_id
    if (newRequested && newRequested !== current.requested_user_id && newRequested !== user.id) {
      const creador = db.prepare('SELECT username FROM users WHERE id = ?').get(user.id)
      const st = data.split_type || current.split_type
      notifyUsers(db, [newRequested], 'pago_requerido', {
        usuario: creador.username, titulo: data.title ?? current.title,
        importe: data.amount_cents ?? current.amount_cents,
        split_type: st, split_amount: data.split_amount_cents ?? current.split_amount_cents,
      }, { demo: c.get('demo'), url: '/expenses' }).catch((err) =>
        log.error('push_notify_failed', { tipo: 'pago_requerido', error: err }))
    }

    if (data.paid_by_requested && current.created_by !== user.id) {
      const pagador = db.prepare('SELECT username FROM users WHERE id = ?').get(user.id)
      notifyUsers(db, [current.created_by], 'pago_completado', {
        usuario: pagador.username, titulo: data.title ?? current.title,
        importe: data.amount_cents ?? current.amount_cents,
      }, { demo: c.get('demo'), url: '/expenses' }).catch((err) =>
        log.error('push_notify_failed', { tipo: 'pago_completado', error: err }))
    }

    return c.json({ expense: hydrateExpense(db, id) })
  })

  // --- Mover gasto ---
  app.put('/api/expenses/:id/move', zValidator('param', idParamSchema, validationHook), zValidator('json', moveSchema, validationHook), (c) => {
    const db = c.get('db')
    const { step, position } = c.req.valid('json')
    const id = c.req.valid('param').id
    const current = db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!current) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)

    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS mx FROM expenses WHERE step = ? AND deleted_at IS NULL').get(step).mx
    const clamped = Math.min(position, maxPos + 1)

    db.transaction(() => {
      db.prepare('UPDATE expenses SET position = position - 1 WHERE step = ? AND deleted_at IS NULL AND position > ?').run(current.step, current.position)
      db.prepare('UPDATE expenses SET position = position + 1 WHERE step = ? AND deleted_at IS NULL AND position >= ?').run(step, clamped)
      db.prepare('UPDATE expenses SET step = ?, position = ?, updated_at = ? WHERE id = ?').run(step, clamped, Date.now(), id)
      addExpenseEvent(db, id, c.get('user').id, 'moved', { from: current.step, to: step })
    })()

    hub.broadcast('expenses')
    return c.json({ expense: hydrateExpense(db, id) })
  })

  // --- Soft-delete ---
  app.delete('/api/expenses/:id', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const id = c.req.valid('param').id
    const current = db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!current) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)
    if (current.created_by !== user.id) httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)

    db.transaction(() => {
      db.prepare('UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), id)
      db.prepare('UPDATE expenses SET position = position - 1 WHERE step = ? AND deleted_at IS NULL AND position > ?').run(current.step, current.position)
    })()

    hub.broadcast('expenses')
    return c.body(null, 204)
  })

  // --- Comentarios ---
  app.get('/api/expenses/:id/comments', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const id = c.req.valid('param').id
    if (!getExpense(db, id)) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)
    const comments = db.prepare(
      `SELECT c.*, u.username, u.color AS user_color
       FROM expense_comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.expense_id = ? ORDER BY c.created_at`
    ).all(id)
    return c.json({ comments })
  })

  app.post('/api/expenses/:id/comments', zValidator('param', idParamSchema, validationHook), zValidator('json', commentSchema, validationHook), async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const id = c.req.valid('param').id
    const expense = getExpense(db, id)
    if (!expense) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)

    const data = c.req.valid('json')
    const commentId = crypto.randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO expense_comments (id, expense_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(commentId, id, user.id, data.body, now)
    db.prepare('UPDATE expenses SET updated_at = ? WHERE id = ?').run(now, id)
    hub.broadcast('expenses')

    // Notificar a interesados (creador + requested)
    const ids = [expense.created_by, expense.requested_user_id].filter((uid) => uid && uid !== user.id)
    if (ids.length > 0) {
      const actor = db.prepare('SELECT username FROM users WHERE id = ?').get(user.id)
      notifyUsers(db, [...new Set(ids)], 'comentario', {
        usuario: actor.username, titulo: expense.title,
      }, { demo: c.get('demo'), url: '/expenses' }).catch(() => {})
    }

    c.header('Location', `/api/expenses/${id}/comments/${commentId}`)
    return c.json({ ok: true, id: commentId }, 201)
  })

  // --- Adjuntos ---
  app.post('/api/expenses/:id/attachments', zValidator('param', idParamSchema, validationHook), async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const id = c.req.valid('param').id
    const expense = getExpense(db, id)
    if (!expense) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)

    const body = await c.req.parseBody().catch(() => null)
    const file = body?.file
    if (!file || typeof file.arrayBuffer !== 'function') httpError(400, ERROR_CODES.UPLOAD_FILE_REQUIRED)
    if (file.size > c.get('maxUploadBytes')) httpError(413, ERROR_CODES.UPLOAD_TOO_LARGE)
    const mime = String(file.type || 'application/octet-stream').slice(0, 100)
    if (!ALLOWED_MIME_TYPES.has(mime)) httpError(415, ERROR_CODES.UPLOAD_INVALID_MIME)

    const ext = path.extname(file.name || '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10)
    const stored = `${crypto.randomUUID()}${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    fs.mkdirSync(uploadsDir, { recursive: true })
    fs.writeFileSync(path.join(uploadsDir, stored), buffer)

    const attId = crypto.randomUUID()
    const now = Date.now()
    const filename = String(file.name || 'adjunto').slice(0, 200)
    db.transaction(() => {
      db.prepare('INSERT INTO expense_attachments (id, expense_id, filename, stored_name, size, mime, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(attId, id, filename, stored, buffer.length, mime, user.id, now)
      db.prepare('UPDATE expenses SET updated_at = ? WHERE id = ?').run(now, id)
      addExpenseEvent(db, id, user.id, 'attachment', { filename })
    })()

    hub.broadcast('expenses')
    c.header('Location', `/api/expenses/${id}/attachments/${attId}`)
    return c.json({ ok: true, id: attId, filename }, 201)
  })

  app.get('/api/expenses/:id/attachments/:attId', zValidator('param', idParamSchema.extend({ attId: z.string().min(1).max(100) }), validationHook), (c) => {
    const db = c.get('db')
    const params = c.req.valid('param')
    if (!getExpense(db, params.id)) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)
    const att = db.prepare('SELECT * FROM expense_attachments WHERE id = ? AND expense_id = ?').get(params.attId, params.id)
    if (!att) httpError(404, ERROR_CODES.ATTACHMENT_NOT_FOUND)
    const filePath = path.join(uploadsDir, path.basename(att.stored_name))
    if (!fs.existsSync(filePath)) httpError(404, ERROR_CODES.ATTACHMENT_FILE_MISSING)
    c.header('Content-Type', att.mime)
    c.header('Content-Length', String(att.size))
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`)
    return c.body(fs.readFileSync(filePath))
  })

  app.delete('/api/expenses/:id/attachments/:attId', zValidator('param', idParamSchema.extend({ attId: z.string().min(1).max(100) }), validationHook), (c) => {
    const db = c.get('db')
    const params = c.req.valid('param')
    if (!getExpense(db, params.id)) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)
    const att = db.prepare('SELECT * FROM expense_attachments WHERE id = ? AND expense_id = ?').get(params.attId, params.id)
    if (!att) httpError(404, ERROR_CODES.ATTACHMENT_NOT_FOUND)
    const filePath = path.join(uploadsDir, path.basename(att.stored_name))
    try { fs.unlinkSync(filePath) } catch {}
    db.prepare('DELETE FROM expense_attachments WHERE id = ?').run(params.attId)
    hub.broadcast('expenses')
    return c.body(null, 204)
  })
}
