import crypto from 'node:crypto'
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

function pluginEnabled(prod) {
  return kvGet(prod, 'plugin_expenses_enabled', '0') === '1'
}

function hydrateExpense(db, id) {
  const row = db
    .prepare(
      `SELECT e.*, u.username AS created_by_username, u.color AS created_by_color,
              ru.username AS requested_username, ru.color AS requested_color,
              l.name AS label_name, l.color AS label_color
       FROM expenses e
       JOIN users u ON u.id = e.created_by
       LEFT JOIN users ru ON ru.id = e.requested_user_id
       LEFT JOIN labels l ON l.id = e.label_id
       WHERE e.id = ?`
    )
    .get(id)
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    amount_cents: row.amount_cents,
    label_id: row.label_id,
    label_name: row.label_name,
    label_color: row.label_color,
    notes: row.notes,
    paid_by_creator: !!row.paid_by_creator,
    requested_user_id: row.requested_user_id,
    requested_username: row.requested_username,
    requested_color: row.requested_color,
    split_type: row.split_type,
    split_amount_cents: row.split_amount_cents,
    paid_by_requested: !!row.paid_by_requested,
    payment_method: row.payment_method,
    step: row.step,
    position: row.position,
    created_by: row.created_by,
    created_by_username: row.created_by_username,
    created_by_color: row.created_by_color,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  }
}

function listExpenses(db) {
  return db
    .prepare(
      `SELECT e.*, u.username AS created_by_username, u.color AS created_by_color,
              ru.username AS requested_username, ru.color AS requested_color,
              l.name AS label_name, l.color AS label_color
       FROM expenses e
       JOIN users u ON u.id = e.created_by
       LEFT JOIN users ru ON ru.id = e.requested_user_id
       LEFT JOIN labels l ON l.id = e.label_id
       WHERE e.deleted_at IS NULL
       ORDER BY e.step, e.position`
    )
    .all()
    .map((row) => ({
      id: row.id,
      title: row.title,
      amount_cents: row.amount_cents,
      label_id: row.label_id,
      label_name: row.label_name,
      label_color: row.label_color,
      notes: row.notes,
      paid_by_creator: !!row.paid_by_creator,
      requested_user_id: row.requested_user_id,
      requested_username: row.requested_username,
      requested_color: row.requested_color,
      split_type: row.split_type,
      split_amount_cents: row.split_amount_cents,
      paid_by_requested: !!row.paid_by_requested,
      step: row.step,
      position: row.position,
      created_by: row.created_by,
      created_by_username: row.created_by_username,
      created_by_color: row.created_by_color,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
}

export function registerExpenseRoutes(app, { prod, hub }) {
  // Gate: plugin desactivado → 404 en todo
  app.use('/api/expenses/*', async (c, next) => {
    if (!pluginEnabled(prod)) httpError(404, ERROR_CODES.NOT_FOUND)
    await next()
  })

  // Listar gastos
  app.get('/api/expenses', (c) => {
    return c.json({ expenses: listExpenses(c.get('db')) })
  })

  // Crear gasto
  app.post('/api/expenses', zValidator('json', createSchema, validationHook), async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const data = c.req.valid('json')
    const now = Date.now()

    if (data.requested_user_id) {
      if (!data.split_type) httpError(422, ERROR_CODES.VALIDATION_FAILED)
      if (data.split_type === 'custom' && !data.split_amount_cents) {
        httpError(422, ERROR_CODES.VALIDATION_FAILED)
      }
      const target = db.prepare('SELECT id FROM users WHERE id = ?').get(data.requested_user_id)
      if (!target) httpError(422, ERROR_CODES.ASSIGNEE_NOT_MEMBER)
      if (data.requested_user_id === user.id) httpError(422, ERROR_CODES.VALIDATION_FAILED)
    }

    const id = crypto.randomUUID()
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS mx FROM expenses WHERE step = ? AND deleted_at IS NULL').get(data.step).mx
    const position = maxPos + 1

    db.prepare(
      `INSERT INTO expenses (id, title, amount_cents, label_id, notes, paid_by_creator,
       requested_user_id, split_type, split_amount_cents, payment_method, step, position, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, data.title, data.amount_cents, data.label_id || null, data.notes,
      data.paid_by_creator ? 1 : 0, data.requested_user_id || null, data.split_type || null,
      data.split_amount_cents || null, data.payment_method || null, data.step, position, user.id, now, now
    )

    hub.broadcast('expenses')

    // Push al usuario requerido
    if (data.requested_user_id && data.requested_user_id !== user.id) {
      const creador = db.prepare('SELECT username FROM users WHERE id = ?').get(user.id)
      notifyUsers(db, [data.requested_user_id], 'pago_requerido', {
        usuario: creador.username,
        titulo: data.title,
        importe: data.amount_cents,
        split_type: data.split_type,
        split_amount: data.split_amount_cents,
      }, { demo: c.get('demo'), url: '/expenses' }).catch((err) =>
        log.error('push_notify_failed', { tipo: 'pago_requerido', error: err })
      )
    }

    const expense = hydrateExpense(db, id)
    c.header('Location', `/api/expenses/${id}`)
    return c.json({ expense }, 201)
  })

  // Obtener un gasto
  app.get('/api/expenses/:id', (c) => {
    const expense = hydrateExpense(c.get('db'), c.req.param('id'))
    if (!expense || expense.deleted_at) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)
    return c.json({ expense })
  })

  // Actualizar gasto
  app.put('/api/expenses/:id', zValidator('json', updateSchema, validationHook), async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const data = c.req.valid('json')
    const id = c.req.param('id')
    const now = Date.now()

    const current = db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!current) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)

    // Authz: solo creador o usuario requerido pueden editar
    if (current.created_by !== user.id && current.requested_user_id !== user.id) {
      httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)
    }

    // Si requested_user_id cambia, validar split y existencia del usuario
    if (data.requested_user_id !== undefined && data.requested_user_id !== current.requested_user_id) {
      if (data.requested_user_id && !data.split_type && !current.split_type) {
        httpError(422, ERROR_CODES.VALIDATION_FAILED)
      }
      if (data.requested_user_id) {
        const target = db.prepare('SELECT id FROM users WHERE id = ?').get(data.requested_user_id)
        if (!target) httpError(422, ERROR_CODES.ASSIGNEE_NOT_MEMBER)
        if (data.requested_user_id === user.id) httpError(422, ERROR_CODES.VALIDATION_FAILED)
      }
    }

    // Solo el usuario requerido puede marcar paid_by_requested
    if (data.paid_by_requested !== undefined && user.id !== current.requested_user_id) {
      httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)
    }

    // Si ambos han pagado → auto-transición a 'hecho'
    let newStep = data.step !== undefined ? data.step : current.step
    const creatorPaid = data.paid_by_creator !== undefined ? data.paid_by_creator : !!current.paid_by_creator
    const requestedPaid = data.paid_by_requested !== undefined ? data.paid_by_requested : !!current.paid_by_requested
    const hasRequest = data.requested_user_id !== undefined ? !!data.requested_user_id : !!current.requested_user_id

    if (creatorPaid && (!hasRequest || requestedPaid) && current.step !== 'hecho') {
      newStep = 'hecho'
    }

    db.prepare(
      `UPDATE expenses SET
       title = ?, amount_cents = ?, label_id = ?, notes = ?,
       paid_by_creator = ?, requested_user_id = ?, split_type = ?, split_amount_cents = ?,
       paid_by_requested = ?, payment_method = ?, step = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      data.title ?? current.title,
      data.amount_cents ?? current.amount_cents,
      data.label_id !== undefined ? (data.label_id || null) : current.label_id,
      data.notes ?? current.notes,
      data.paid_by_creator !== undefined ? (data.paid_by_creator ? 1 : 0) : current.paid_by_creator,
      data.requested_user_id !== undefined ? (data.requested_user_id || null) : current.requested_user_id,
      data.split_type !== undefined ? (data.split_type || null) : current.split_type,
      data.split_amount_cents !== undefined ? (data.split_amount_cents || null) : current.split_amount_cents,
      data.paid_by_requested !== undefined ? (data.paid_by_requested ? 1 : 0) : current.paid_by_requested,
      data.payment_method !== undefined ? (data.payment_method || null) : current.payment_method,
      newStep,
      now,
      id
    )

    hub.broadcast('expenses')

    // Notificar si cambia requested_user_id
    const newRequested = data.requested_user_id !== undefined ? data.requested_user_id : current.requested_user_id
    if (newRequested && newRequested !== current.requested_user_id && newRequested !== user.id) {
      const creador = db.prepare('SELECT username FROM users WHERE id = ?').get(user.id)
      const st = data.split_type || current.split_type
      const sa = data.split_amount_cents ?? current.split_amount_cents
      notifyUsers(db, [newRequested], 'pago_requerido', {
        usuario: creador.username,
        titulo: data.title ?? current.title,
        importe: data.amount_cents ?? current.amount_cents,
        split_type: st,
        split_amount: sa,
      }, { demo: c.get('demo'), url: '/expenses' }).catch((err) =>
        log.error('push_notify_failed', { tipo: 'pago_requerido', error: err })
      )
    }

    // Notificar al creador si el requerido marca paid_by_requested
    if (data.paid_by_requested && current.created_by !== user.id) {
      const pagador = db.prepare('SELECT username FROM users WHERE id = ?').get(user.id)
      notifyUsers(db, [current.created_by], 'pago_completado', {
        usuario: pagador.username,
        titulo: data.title ?? current.title,
        importe: data.amount_cents ?? current.amount_cents,
      }, { demo: c.get('demo'), url: '/expenses' }).catch((err) =>
        log.error('push_notify_failed', { tipo: 'pago_completado', error: err })
      )
    }

    const expense = hydrateExpense(db, id)
    return c.json({ expense })
  })

  // Mover gasto (cambiar columna + reordenar)
  app.put('/api/expenses/:id/move', zValidator('json', moveSchema, validationHook), (c) => {
    const db = c.get('db')
    const { step, position } = c.req.valid('json')
    const id = c.req.param('id')

    const current = db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!current) httpError(404, ERROR_CODES.TASK_NOT_FOUND)

    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS mx FROM expenses WHERE step = ? AND deleted_at IS NULL').get(step).mx
    const clamped = Math.min(position, maxPos + 1)

    db.transaction(() => {
      // Quitar de la columna actual
      db.prepare('UPDATE expenses SET position = position - 1 WHERE step = ? AND deleted_at IS NULL AND position > ?')
        .run(current.step, current.position)
      // Insertar en la nueva columna
      db.prepare('UPDATE expenses SET position = position + 1 WHERE step = ? AND deleted_at IS NULL AND position >= ?')
        .run(step, clamped)
      db.prepare('UPDATE expenses SET step = ?, position = ?, updated_at = ? WHERE id = ?')
        .run(step, clamped, Date.now(), id)
    })()

    hub.broadcast('expenses')
    const expense = hydrateExpense(db, id)
    return c.json({ expense })
  })

  // Soft-delete
  app.delete('/api/expenses/:id', (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const id = c.req.param('id')

    const current = db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!current) httpError(404, ERROR_CODES.TASK_NOT_FOUND)
    if (current.created_by !== user.id) httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)

    db.transaction(() => {
      db.prepare('UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?')
        .run(Date.now(), Date.now(), id)
      db.prepare('UPDATE expenses SET position = position - 1 WHERE step = ? AND deleted_at IS NULL AND position > ?')
        .run(current.step, current.position)
    })()

    hub.broadcast('expenses')
    return c.body(null, 204)
  })
}
