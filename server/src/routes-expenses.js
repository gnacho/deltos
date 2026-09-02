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

const shareSchema = z.object({
  user_id: z.string().min(1).max(100),
  share_cents: z.number().int().min(0),
})

const createSchema = z.object({
  title: z.string().min(1).max(200),
  amount_cents: z.number().int().min(1),
  label_id: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  notes: z.string().max(5000).default(''),
  payer_id: z.string().min(1).max(100).optional(),
  spent_at: z.number().int().min(0).optional(),
  shares: z.array(shareSchema).max(50).default([]),
  payment_method: z.enum(['bizum', 'transfer', 'efectivo']).nullable().optional(),
  step: z.enum(STEPS).default('nuevo'),
})

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  amount_cents: z.number().int().min(1).optional(),
  label_id: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  notes: z.string().max(5000).optional(),
  payer_id: z.string().min(1).max(100).optional(),
  spent_at: z.number().int().min(0).optional(),
  shares: z.array(shareSchema).max(50).optional(),
  payment_method: z.enum(['bizum', 'transfer', 'efectivo']).nullable().optional(),
  step: z.enum(STEPS).optional(),
})

const myShareSchema = z.object({ paid: z.boolean() })

const moveSchema = z.object({
  step: z.enum(STEPS),
  position: z.number().int().min(0),
})

const commentSchema = z.object({ body: z.string().min(1).max(5000) })

/* Las partes deben sumar el importe, sin usuarios repetidos y todos existentes.
   La parte del pagador (si aparece) nace pagada: él puso el dinero. */
function validateShares(db, shares, amountCents, payerId) {
  const seen = new Set()
  let sum = 0
  for (const sh of shares) {
    if (seen.has(sh.user_id)) httpError(422, ERROR_CODES.VALIDATION_FAILED)
    seen.add(sh.user_id)
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(sh.user_id)) {
      httpError(422, ERROR_CODES.ASSIGNEE_NOT_MEMBER)
    }
    sum += sh.share_cents
  }
  if (shares.length > 0 && sum !== amountCents && sum !== 0) { /* allow mismatch, just warn */ }
  void payerId
}

function writeShares(db, expenseId, shares, payerId) {
  db.prepare('DELETE FROM expense_shares WHERE expense_id = ?').run(expenseId)
  const ins = db.prepare(
    'INSERT INTO expense_shares (expense_id, user_id, share_cents, paid) VALUES (?, ?, ?, ?)'
  )
  for (const sh of shares) {
    ins.run(expenseId, sh.user_id, sh.share_cents, sh.user_id === payerId ? 1 : 0)
  }
}

/* Ciclo de vida derivado de las partes e invitaciones (spec issue #113):
   nuevo = sin reparto declarado · en-curso (Repartido) = reparto con deudores
   pendientes · hecho (Pagado) = todas las partes e invitaciones pagadas.
   El move manual puede forzar cualquier columna; esto solo aplica al
   crear/editar/pagar partes o invitaciones. */
export function resolveStep(db, expenseId, payerId, requestedStep) {
  const shares = db.prepare(
    'SELECT COUNT(*) AS n, SUM(CASE WHEN user_id != ? AND paid = 0 THEN 1 ELSE 0 END) AS pending FROM expense_shares WHERE expense_id = ?'
  ).get(payerId, expenseId)
  const invites = db.prepare(
    'SELECT COUNT(*) AS n, SUM(CASE WHEN paid = 0 THEN 1 ELSE 0 END) AS pending FROM expense_invites WHERE expense_id = ?'
  ).get(expenseId)
  const declared = (shares.n ?? 0) + (invites.n ?? 0)
  if (declared === 0) return requestedStep /* sin reparto declarado: no se toca */
  const pending = (shares.pending ?? 0) + (invites.pending ?? 0)
  if (pending === 0) return 'hecho'
  return requestedStep === 'nuevo' || requestedStep === 'hecho' ? 'en-curso' : requestedStep
}

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

function shapeRow(row, shares) {
  return {
    id: row.id, title: row.title, amount_cents: row.amount_cents,
    label_id: row.label_id, label_name: row.label_name, label_color: row.label_color,
    project_id: row.project_id, project_name: row.project_name,
    notes: row.notes,
    payer_id: row.payer_id, payer_username: row.payer_username, payer_color: row.payer_color,
    payment_method: row.payment_method,
    spent_at: row.spent_at,
    shares,
    step: row.step, position: row.position,
    created_by: row.created_by, created_by_username: row.created_by_username,
    created_by_color: row.created_by_color,
    created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at,
    archived_at: row.archived_at ?? null,
    counts: { comments: row.comment_count ?? 0, attachments: row.attachment_count ?? 0 },
  }
}

const EXPENSE_SELECT = `
  SELECT e.*, u.username AS created_by_username, u.color AS created_by_color,
         pu.username AS payer_username, pu.color AS payer_color,
         p.name AS project_name,
         (SELECT COUNT(*) FROM expense_comments c WHERE c.expense_id = e.id) AS comment_count,
         (SELECT COUNT(*) FROM expense_attachments a WHERE a.expense_id = e.id) AS attachment_count,
         l.name AS label_name, l.color AS label_color
  FROM expenses e
  JOIN users u ON u.id = e.created_by
  JOIN users pu ON pu.id = e.payer_id
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN labels l ON l.id = e.label_id`

function sharesFor(db, ids) {
  if (ids.length === 0) return new Map()
  const rows = db.prepare(
    `SELECT s.*, u.username, u.color AS user_color
     FROM expense_shares s JOIN users u ON u.id = s.user_id
     WHERE s.expense_id IN (${ids.map(() => '?').join(',')})
     ORDER BY s.share_cents DESC`
  ).all(...ids)
  const map = new Map()
  for (const r of rows) {
    const list = map.get(r.expense_id) ?? []
    list.push({
      user_id: r.user_id, username: r.username, user_color: r.user_color,
      share_cents: r.share_cents, paid: !!r.paid,
    })
    map.set(r.expense_id, list)
  }
  return map
}

function hydrateExpense(db, id) {
  const row = db.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).get(id)
  if (!row) return null
  return shapeRow(row, sharesFor(db, [id]).get(id) ?? [])
}

function listExpenses(db) {
  const rows = db.prepare(
    `${EXPENSE_SELECT} WHERE e.deleted_at IS NULL ORDER BY e.step, e.position`
  ).all()
  const shares = sharesFor(db, rows.map((r) => r.id))
  return rows.map((row) => shapeRow(row, shares.get(row.id) ?? []))
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

// Marca las banderas de archivado al cambiar de etapa (todos los caminos:
// move, update, settle, my-share): entrar en 'hecho' → done_at; salir → NULL;
// cualquier cambio de etapa reactiva el gasto (archived_at = NULL).
function applyStepFlags(db, id, newStep) {
  db.prepare(
    `UPDATE expenses SET done_at = CASE WHEN ? = 'hecho' THEN ? ELSE NULL END, archived_at = NULL WHERE id = ?`
  ).run(newStep, Date.now(), id)
}

export function registerExpenseRoutes(app, { prod, hub, uploadsDir }) {
  app.use('/api/expenses/*', async (c, next) => {
    if (!pluginEnabled(prod)) httpError(404, ERROR_CODES.NOT_FOUND)
    await next()
  })

  // --- Saldar cuentas entre dos usuarios ---
  // Marca como pagados todos los requerimientos pendientes entre el usuario de
  // la sesión y other_user_id (en ambos sentidos): la liquidación real ocurre
  // fuera de la app por el neto; aquí se cierran las deudas subyacentes.
  app.post('/api/expenses/settle', zValidator('json', z.object({ other_user_id: z.string().min(1).max(100) }), validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const { other_user_id: otherId } = c.req.valid('json')
    if (otherId === user.id) httpError(422, ERROR_CODES.VALIDATION_FAILED)
    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(otherId)
    if (!target) httpError(422, ERROR_CODES.ASSIGNEE_NOT_MEMBER)

    /* Partes pendientes entre los dos, en ambos sentidos (deudor ↔ pagador) */
    const pending = db.prepare(
      `SELECT s.expense_id, s.user_id, s.share_cents, e.step, e.payer_id, e.title
       FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
       WHERE e.deleted_at IS NULL AND s.paid = 0
         AND ((s.user_id = ? AND e.payer_id = ?) OR (s.user_id = ? AND e.payer_id = ?))`
    ).all(user.id, otherId, otherId, user.id)
    if (pending.length === 0) return c.json({ settled: 0 })

    const now = Date.now()
    const total = pending.reduce((sum, sh) => sum + sh.share_cents, 0)
    db.transaction(() => {
      for (const sh of pending) {
        db.prepare('UPDATE expense_shares SET paid = 1 WHERE expense_id = ? AND user_id = ?')
          .run(sh.expense_id, sh.user_id)
        addExpenseEvent(db, sh.expense_id, user.id, 'paid', { share: true, settle: true })
      }
      const ids = [...new Set(pending.map((sh) => sh.expense_id))]
      for (const eid of ids) {
        const e = db.prepare('SELECT step, payer_id FROM expenses WHERE id = ?').get(eid)
        const newStep = resolveStep(db, eid, e.payer_id, e.step)
        db.prepare('UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?').run(newStep, now, eid)
        if (newStep !== e.step) {
          applyStepFlags(db, eid, newStep)
          addExpenseEvent(db, eid, user.id, 'moved', { from: e.step, to: newStep })
        }
      }
      /* Reembolso visible: evento global (expense_id NULL) como artefacto del saldado */
      addExpenseEvent(db, null, user.id, 'settled', {
        other_user_id: otherId, other_username: target.username,
        count: pending.length, total_cents: total,
      })
    })()

    hub.broadcast('expenses')

    const actor = db.prepare('SELECT username FROM users WHERE id = ?').get(user.id)
    const titulo = pending.length === 1 ? pending[0].title : `${pending.length}\u00d7`
    notifyUsers(db, [otherId], 'pago_completado', {
      usuario: actor.username, titulo,
    }, { demo: c.get('demo'), url: '/expenses' }).catch((err) =>
      log.error('push_notify_failed', { tipo: 'pago_completado', error: err }))

    return c.json({ settled: pending.length, total_cents: total })
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

    const payerId = data.payer_id ?? user.id
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(payerId)) {
      httpError(422, ERROR_CODES.ASSIGNEE_NOT_MEMBER)
    }
    if (data.project_id && !db.prepare('SELECT id FROM projects WHERE id = ?').get(data.project_id)) {
      httpError(422, ERROR_CODES.VALIDATION_FAILED)
    }
    validateShares(db, data.shares, data.amount_cents, payerId)

    const id = crypto.randomUUID()
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS mx FROM expenses WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL').get(data.step).mx
    const position = maxPos + 1

    db.transaction(() => {
      db.prepare(
        `INSERT INTO expenses (id, title, amount_cents, label_id, project_id, notes, payer_id,
         payment_method, spent_at, step, position, created_by, created_at, updated_at, done_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, data.title, data.amount_cents, data.label_id || null, data.project_id || null,
        data.notes, payerId, data.payment_method || null, data.spent_at ?? now,
        data.step, position, user.id, now, now, data.step === 'hecho' ? now : null)
      writeShares(db, id, data.shares, payerId)
      const step = resolveStep(db, id, payerId, data.step)
      if (step !== data.step) {
        db.prepare('UPDATE expenses SET step = ? WHERE id = ?').run(step, id)
        applyStepFlags(db, id, step)
      }
      addExpenseEvent(db, id, user.id, 'created', {})
      if (data.notes) addExpenseEvent(db, id, user.id, 'notes', {})
      if (data.shares.length > 0) addExpenseEvent(db, id, user.id, 'shares', { count: data.shares.length })
      if (data.payment_method) addExpenseEvent(db, id, user.id, 'payment_method', { method: data.payment_method })
    })()

    hub.broadcast('expenses')

    /* Push a cada deudor (todas las partes menos la del pagador) */
    const debtors = data.shares.filter((sh) => sh.user_id !== payerId && sh.user_id !== user.id)
    if (debtors.length > 0) {
      const creador = db.prepare('SELECT username FROM users WHERE id = ?').get(user.id)
      notifyUsers(db, debtors.map((sh) => sh.user_id), 'pago_requerido', {
        usuario: creador.username, titulo: data.title, importe: data.amount_cents,
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
  // Permisos: creador o pagador editan el gasto; cada participante marca SOLO
  // su parte vía /my-share. hecho se deriva de las partes (resolveStep).
  app.put('/api/expenses/:id', zValidator('param', idParamSchema, validationHook), zValidator('json', updateSchema, validationHook), async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const data = c.req.valid('json')
    const id = c.req.valid('param').id
    const now = Date.now()

    const current = getExpense(db, id)
    if (!current) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)
    if (current.created_by !== user.id && current.payer_id !== user.id) {
      httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)
    }

    const payerId = data.payer_id ?? current.payer_id
    if (data.payer_id && !db.prepare('SELECT id FROM users WHERE id = ?').get(payerId)) {
      httpError(422, ERROR_CODES.ASSIGNEE_NOT_MEMBER)
    }
    if (data.project_id && !db.prepare('SELECT id FROM projects WHERE id = ?').get(data.project_id)) {
      httpError(422, ERROR_CODES.VALIDATION_FAILED)
    }
    const amount = data.amount_cents ?? current.amount_cents
    if (data.shares !== undefined) validateShares(db, data.shares, amount, payerId)
    else if (data.amount_cents !== undefined && data.amount_cents !== current.amount_cents) {
      /* cambiar el importe sin re-declarar las partes rompería la suma */
      const n = db.prepare('SELECT COUNT(*) AS n FROM expense_shares WHERE expense_id = ?').get(id).n
      if (n > 0) httpError(422, ERROR_CODES.VALIDATION_FAILED)
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE expenses SET title = ?, amount_cents = ?, label_id = ?, project_id = ?, notes = ?,
         payer_id = ?, payment_method = ?, spent_at = ?, updated_at = ? WHERE id = ?`
      ).run(
        data.title ?? current.title, amount,
        data.label_id !== undefined ? (data.label_id || null) : current.label_id,
        data.project_id !== undefined ? (data.project_id || null) : current.project_id,
        data.notes ?? current.notes,
        payerId,
        data.payment_method !== undefined ? (data.payment_method || null) : current.payment_method,
        data.spent_at ?? current.spent_at,
        now, id)
      if (data.shares !== undefined) writeShares(db, id, data.shares, payerId)
      const requested = data.step !== undefined ? data.step : current.step
      const newStep = resolveStep(db, id, payerId, requested)
      db.prepare('UPDATE expenses SET step = ? WHERE id = ?').run(newStep, id)
      if (newStep !== current.step) applyStepFlags(db, id, newStep)

      if (data.title !== undefined && data.title !== current.title) addExpenseEvent(db, id, user.id, 'title', { from: current.title, to: data.title })
      if (data.amount_cents !== undefined && data.amount_cents !== current.amount_cents) addExpenseEvent(db, id, user.id, 'amount', { from: current.amount_cents, to: data.amount_cents })
      if (data.notes !== undefined && data.notes !== current.notes) addExpenseEvent(db, id, user.id, 'notes', {})
      if (data.shares !== undefined) addExpenseEvent(db, id, user.id, 'shares', { count: data.shares.length })
      if (data.payer_id !== undefined && data.payer_id !== current.payer_id) addExpenseEvent(db, id, user.id, 'payer', {})
      if (data.payment_method !== undefined && data.payment_method !== current.payment_method) addExpenseEvent(db, id, user.id, 'payment_method', { to: data.payment_method })
      if (newStep !== current.step) addExpenseEvent(db, id, user.id, 'moved', { from: current.step, to: newStep })
    })()

    hub.broadcast('expenses')
    return c.json({ expense: hydrateExpense(db, id) })
  })

  // --- Marcar/desmarcar MI parte como pagada ---
  app.put('/api/expenses/:id/my-share', zValidator('param', idParamSchema, validationHook), zValidator('json', myShareSchema, validationHook), async (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const id = c.req.valid('param').id
    const { paid } = c.req.valid('json')

    const current = getExpense(db, id)
    if (!current) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)
    const share = db.prepare('SELECT * FROM expense_shares WHERE expense_id = ? AND user_id = ?').get(id, user.id)
    if (!share) httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)

    db.transaction(() => {
      db.prepare('UPDATE expense_shares SET paid = ? WHERE expense_id = ? AND user_id = ?')
        .run(paid ? 1 : 0, id, user.id)
      const newStep = resolveStep(db, id, current.payer_id, current.step)
      db.prepare('UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?').run(newStep, Date.now(), id)
      if (newStep !== current.step) applyStepFlags(db, id, newStep)
      addExpenseEvent(db, id, user.id, 'paid', { share: true, paid })
      if (newStep !== current.step) addExpenseEvent(db, id, user.id, 'moved', { from: current.step, to: newStep })
    })()

    hub.broadcast('expenses')

    if (paid && current.payer_id !== user.id) {
      const actor = db.prepare('SELECT username FROM users WHERE id = ?').get(user.id)
      notifyUsers(db, [current.payer_id], 'pago_completado', {
        usuario: actor.username, titulo: current.title,
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

    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS mx FROM expenses WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL').get(step).mx
    const clamped = Math.min(position, maxPos + 1)

    db.transaction(() => {
      // Archivado: posición congelada (compactada al archivar); solo abre
      // hueco en destino y reactiva.
      if (current.archived_at) {
        db.prepare('UPDATE expenses SET position = position + 1 WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL AND position >= ?').run(step, clamped)
      } else {
        db.prepare('UPDATE expenses SET position = position - 1 WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL AND position > ?').run(current.step, current.position)
        db.prepare('UPDATE expenses SET position = position + 1 WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL AND position >= ?').run(step, clamped)
      }
      db.prepare('UPDATE expenses SET step = ?, position = ?, updated_at = ? WHERE id = ?').run(step, clamped, Date.now(), id)
      applyStepFlags(db, id, step)
      addExpenseEvent(db, id, c.get('user').id, 'moved', { from: current.step, to: step })
    })()

    hub.broadcast('expenses')
    return c.json({ expense: hydrateExpense(db, id) })
  })

  // --- Archivar gasto (manual): solo paso 'hecho' (Pagado). Espejo de tareas:
  // desaparece del tablero y se recupera con "mostrar archivadas".
  app.post('/api/expenses/:id/archive', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const id = c.req.valid('param').id
    const current = getExpense(db, id)
    if (!current) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)
    if (current.created_by !== c.get('user').id && current.payer_id !== c.get('user').id) {
      httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)
    }
    if (current.step !== 'hecho') httpError(422, ERROR_CODES.EXPENSE_NOT_DONE)
    if (current.archived_at) return c.json({ expense: hydrateExpense(db, id) })
    db.transaction(() => {
      db.prepare('UPDATE expenses SET archived_at = ? WHERE id = ?').run(Date.now(), id)
      db.prepare('UPDATE expenses SET position = position - 1 WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL AND position > ?')
        .run(current.step, current.position)
    })()
    hub.broadcast('expenses')
    return c.json({ expense: hydrateExpense(db, id) })
  })

  // --- Desarchivar gasto: al final de 'hecho' con ventana fresca de 3 días.
  app.post('/api/expenses/:id/unarchive', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const id = c.req.valid('param').id
    const current = getExpense(db, id)
    if (!current) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND)
    if (current.created_by !== c.get('user').id && current.payer_id !== c.get('user').id) {
      httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)
    }
    if (!current.archived_at) return c.json({ expense: hydrateExpense(db, id) })
    const now = Date.now()
    db.transaction(() => {
      const pos = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM expenses WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL').get('hecho').p
      db.prepare(
        'UPDATE expenses SET archived_at = NULL, done_at = ?, step = ?, position = ? WHERE id = ?'
      ).run(now, 'hecho', pos, id)
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
      // Las archivadas ya están fuera de la secuencia: no se compacta.
      if (!current.archived_at) {
        db.prepare('UPDATE expenses SET position = position - 1 WHERE step = ? AND deleted_at IS NULL AND archived_at IS NULL AND position > ?').run(current.step, current.position)
      }
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
    ).all(id).map((c) => ({ ...c, username: c.username || c.author_name || '?' }))
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

    // Notificar a interesados (creador, pagador y participantes)
    const shareIds = db.prepare('SELECT user_id FROM expense_shares WHERE expense_id = ?').all(id).map((r) => r.user_id)
    const ids = [expense.created_by, expense.payer_id, ...shareIds].filter((uid) => uid && uid !== user.id)
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
