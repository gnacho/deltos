// routes-decisions.js - módulo "Decisiones" (problema -> soluciones -> voto
// -> decision). Replica los patrones del plugin de gastos: tablas propias,
// rutas propias, dominio SSE único `decisions` -> `decision.changed`.
// Convenciones api-stack (CONVENTIONS.md): zValidator en cada ruta, errores por
// httpError(), 201+Location al crear, 204 sin cuerpo en DELETE, transacción
// cuando tocan >=2 tablas y hub.broadcast('decisions') al final de cada mutación.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { httpError, validationHook } from './errors.js'
import { ERROR_CODES } from './error-codes.js'
import { logger } from './logger.js'

const log = logger.child({ component: 'decisions' })

const idParamSchema = z.object({ id: z.string().min(1).max(100) })
const aidParamSchema = z.object({ aid: z.string().min(1).max(100) })
const solutionParamSchema = z.object({ id: z.string().min(1).max(100), solutionId: z.string().min(1).max(100) })

const createSchema = z.object({
  project_id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
})

const patchSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000),
  })
  .partial()

const solutionCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
})

const solutionPatchSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000),
  })
  .partial()

const voteSchema = z.object({ solution_id: z.string().min(1).max(100) })
const chooseSchema = z.object({ solution_id: z.string().min(1).max(100).nullable().optional() })
const commentSchema = z.object({ body: z.string().min(1).max(5000) })

const listQuerySchema = z.object({
  project_id: z.string().min(1).max(100).optional(),
  status: z.enum(['open', 'decided']).optional(),
})

// --- Adjuntos (issue #279) ---------------------------------------------------
// Allowlist MÁS ESTRICTA que tareas/gastos: sin office ni comprimidos.
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'text/plain',
  'text/csv',
  'application/json',
  'application/pdf',
])
// Límite de adjuntos por decisión (constante local; el de tareas es kv).
const MAX_ATTACHMENTS_PER_DECISION = 50

// --- Membresía y permisos ---------------------------------------------------

function isMember(db, userId, projectId) {
  return !!db
    .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId)
}

function getDecision(db, id) {
  return db.prepare('SELECT * FROM decisions WHERE id = ? AND deleted_at IS NULL').get(id)
}

// Carga la decisión y verifica membresía. No-miembro -> 403 (spec §6 exige 403
// en todas las rutas). Inexistente/borrada -> 404.
function loadDecision(db, user, id) {
  const decision = getDecision(db, id)
  if (!decision) httpError(404, ERROR_CODES.DECISION_NOT_FOUND)
  if (!isMember(db, user.id, decision.project_id)) httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)
  return decision
}

// Solo el creador de la decisión (o admin) puede elegir/reabrir/borrar.
function canDecide(db, user, decision) {
  return user.role === 'admin' || decision.created_by === user.id
}

function requireCanDecide(db, user, decision) {
  if (!canDecide(db, user, decision)) httpError(403, ERROR_CODES.PROJECT_NOT_OWNER)
}

function addDecisionEvent(db, decisionId, userId, type, data = {}) {
  db.prepare(
    'INSERT INTO decision_activity_events (id, decision_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), decisionId, userId, type, JSON.stringify(data), Date.now())
}

// --- Hydratación ------------------------------------------------------------

function shapeListRow(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    status: row.status,
    chosen_solution_id: row.chosen_solution_id ?? null,
    chosen_solution_title: row.chosen_solution_title ?? null,
    created_by: row.created_by,
    created_by_username: row.created_by_username,
    created_by_color: row.created_by_color,
    created_at: row.created_at,
    updated_at: row.updated_at,
    decided_at: row.decided_at ?? null,
    counts: { solutions: row.solutions_count ?? 0, votes: row.votes_count ?? 0, comments: row.comments_count ?? 0 },
  }
}

function listDecisions(db, userId, projectId, status) {
  const where = []
  const params = []
  where.push('d.deleted_at IS NULL')
  where.push('d.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)')
  params.push(userId)
  if (projectId) {
    where.push('d.project_id = ?')
    params.push(projectId)
  }
  if (status) {
    where.push('d.status = ?')
    params.push(status)
  }
  const rows = db
    .prepare(
      `SELECT d.*, u.username AS created_by_username, u.color AS created_by_color,
              cs.title AS chosen_solution_title,
              (SELECT COUNT(*) FROM decision_solutions s WHERE s.decision_id = d.id) AS solutions_count,
              (SELECT COUNT(*) FROM decision_votes v WHERE v.decision_id = d.id) AS votes_count,
              (SELECT COUNT(*) FROM decision_comments c WHERE c.decision_id = d.id) AS comments_count
       FROM decisions d
       JOIN users u ON u.id = d.created_by
       LEFT JOIN decision_solutions cs ON cs.id = d.chosen_solution_id
       WHERE ${where.join(' AND ')}
       ORDER BY (d.status = 'open') DESC, d.created_at DESC`
    )
    .all(...params)
  return rows.map(shapeListRow)
}

function hydrateDetail(db, user, id) {
  const decision = getDecision(db, id)
  if (!decision) return null
  const solutions = db
    .prepare(
      `SELECT s.*, u.username AS proposer_username, u.color AS proposer_color,
              (SELECT COUNT(*) FROM decision_votes v WHERE v.solution_id = s.id) AS votes,
              EXISTS(SELECT 1 FROM decision_votes mv WHERE mv.solution_id = s.id AND mv.user_id = ?) AS my_vote
       FROM decision_solutions s
       JOIN users u ON u.id = s.proposer_id
       WHERE s.decision_id = ?
       ORDER BY votes DESC, s.created_at ASC`
    )
    .all(user.id, id)
    .map((s) => ({
      id: s.id,
      decision_id: s.decision_id,
      title: s.title,
      description: s.description,
      proposer_id: s.proposer_id,
      proposer_username: s.proposer_username,
      proposer_color: s.proposer_color,
      votes: s.votes,
      my_vote: !!s.my_vote,
      created_at: s.created_at,
      updated_at: s.updated_at,
    }))
  const comments = db
    .prepare(
      `SELECT c.*, u.username, u.color AS user_color
       FROM decision_comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.decision_id = ? ORDER BY c.created_at`
    )
    .all(id)
  const activity = db
    .prepare(
      `SELECT e.*, u.username
       FROM decision_activity_events e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.decision_id = ? ORDER BY e.created_at`
    )
    .all(id)
    .map((e) => ({ ...e, data: JSON.parse(e.data || '{}') }))
  // Adjuntos en array plano (todos los de la decisión): solution_id distingue
  // los de cada solución (NULL = adjuntos de la descripción).
  const attachments = db
    .prepare(
      `SELECT a.id, a.decision_id, a.solution_id, a.filename, a.size, a.mime, a.created_at,
              a.uploaded_by, u.username AS uploaded_by_username, u.color AS uploaded_by_color
       FROM decision_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.decision_id = ? ORDER BY a.created_at`
    )
    .all(id)
  const row = db
    .prepare(
      `SELECT d.*, u.username AS created_by_username, u.color AS created_by_color
       FROM decisions d JOIN users u ON u.id = d.created_by WHERE d.id = ?`
    )
    .get(id)
  return {
    decision: {
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      description: row.description,
      status: row.status,
      chosen_solution_id: row.chosen_solution_id ?? null,
      created_by: row.created_by,
      created_by_username: row.created_by_username,
      created_by_color: row.created_by_color,
      created_at: row.created_at,
      updated_at: row.updated_at,
      decided_at: row.decided_at ?? null,
    },
    solutions,
    comments,
    activity,
    attachments,
  }
}

// --- Rutas ------------------------------------------------------------------

export function registerDecisionRoutes(app, { hub, uploadsDir }) {
  // --- Listar decisiones ---
  app.get('/api/decisions', zValidator('query', listQuerySchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const { project_id: projectId, status } = c.req.valid('query')
    return c.json({ decisions: listDecisions(db, user.id, projectId, status) })
  })

  // --- Crear decisión ---
  app.post('/api/decisions', zValidator('json', createSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const data = c.req.valid('json')
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(data.project_id)) {
      httpError(404, ERROR_CODES.PROJECT_NOT_FOUND)
    }
    if (!isMember(db, user.id, data.project_id)) httpError(403, ERROR_CODES.PROJECT_NOT_MEMBER)
    const id = crypto.randomUUID()
    const now = Date.now()
    db.transaction(() => {
      db.prepare(
        `INSERT INTO decisions (id, project_id, title, description, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`
      ).run(id, data.project_id, data.title, data.description, user.id, now, now)
      addDecisionEvent(db, id, user.id, 'created', {})
    })()
    hub.broadcast('decisions')
    c.header('Location', `/api/decisions/${id}`)
    return c.json({ decision: hydrateDetail(db, user, id)?.decision }, 201)
  })

  // --- Detalle completo ---
  app.get('/api/decisions/:id', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const id = c.req.valid('param').id
    loadDecision(db, user, id)
    const detail = hydrateDetail(db, user, id)
    if (!detail) httpError(404, ERROR_CODES.DECISION_NOT_FOUND)
    return c.json(detail)
  })

  // --- Editar title/description (cualquier miembro; matizar) ---
  app.patch(
    '/api/decisions/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', patchSchema, validationHook),
    (c) => {
      const db = c.get('db')
      const user = c.get('user')
      const id = c.req.valid('param').id
      const current = loadDecision(db, user, id)
      const data = c.req.valid('json')
      const now = Date.now()
      db.transaction(() => {
        if (data.title !== undefined && data.title !== current.title) {
          db.prepare('UPDATE decisions SET title = ?, updated_at = ? WHERE id = ?').run(data.title, now, id)
          addDecisionEvent(db, id, user.id, 'title', { from: current.title, to: data.title })
        }
        if (data.description !== undefined && data.description !== current.description) {
          db.prepare('UPDATE decisions SET description = ?, updated_at = ? WHERE id = ?').run(data.description, now, id)
          addDecisionEvent(db, id, user.id, 'description', {})
        }
        db.prepare('UPDATE decisions SET updated_at = ? WHERE id = ?').run(now, id)
      })()
      hub.broadcast('decisions')
      return c.json({ decision: hydrateDetail(db, user, id).decision })
    }
  )

  // --- Soft delete (solo creador/admin) ---
  app.delete('/api/decisions/:id', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const id = c.req.valid('param').id
    const current = loadDecision(db, user, id)
    requireCanDecide(db, user, current)
    db.transaction(() => {
      db.prepare('UPDATE decisions SET deleted_at = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), id)
      addDecisionEvent(db, id, user.id, 'deleted', {})
    })()
    hub.broadcast('decisions')
    return c.body(null, 204)
  })

  // --- Proponer solución (solo si status='open') ---
  app.post(
    '/api/decisions/:id/solutions',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', solutionCreateSchema, validationHook),
    (c) => {
      const db = c.get('db')
      const user = c.get('user')
      const id = c.req.valid('param').id
      const current = loadDecision(db, user, id)
      if (current.status !== 'open') httpError(409, ERROR_CODES.DECISION_NOT_OPEN)
      const data = c.req.valid('json')
      const solutionId = crypto.randomUUID()
      const now = Date.now()
      db.transaction(() => {
        db.prepare(
          `INSERT INTO decision_solutions (id, decision_id, title, description, proposer_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(solutionId, id, data.title, data.description, user.id, now, now)
        db.prepare('UPDATE decisions SET updated_at = ? WHERE id = ?').run(now, id)
        addDecisionEvent(db, id, user.id, 'solution_added', { solution_id: solutionId, title: data.title })
      })()
      hub.broadcast('decisions')
      c.header('Location', `/api/decisions/${id}/solutions/${solutionId}`)
      return c.json({ solution: { id: solutionId, decision_id: id, ...data } }, 201)
    }
  )

  // --- Editar solución (autor o admin) ---
  app.patch(
    '/api/decisions/:id/solutions/:solutionId',
    zValidator('param', solutionParamSchema, validationHook),
    zValidator('json', solutionPatchSchema, validationHook),
    (c) => {
      const db = c.get('db')
      const user = c.get('user')
      const { id, solutionId } = c.req.valid('param')
      loadDecision(db, user, id)
      const solution = db
        .prepare('SELECT * FROM decision_solutions WHERE id = ? AND decision_id = ?')
        .get(solutionId, id)
      if (!solution) httpError(404, ERROR_CODES.SOLUTION_NOT_FOUND)
      if (user.role !== 'admin' && solution.proposer_id !== user.id) {
        httpError(403, ERROR_CODES.PROJECT_NOT_OWNER)
      }
      const data = c.req.valid('json')
      const now = Date.now()
      db.transaction(() => {
        db.prepare('UPDATE decision_solutions SET title = ?, description = ?, updated_at = ? WHERE id = ?')
          .run(data.title ?? solution.title, data.description ?? solution.description, now, solutionId)
        addDecisionEvent(db, id, user.id, 'solution_edited', { solution_id: solutionId })
      })()
      hub.broadcast('decisions')
      return c.json({ ok: true })
    }
  )

  // --- Borrar solución (autor o admin). Si era la elegida -> reabre. ---
  app.delete('/api/decisions/:id/solutions/:solutionId', zValidator('param', solutionParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const { id, solutionId } = c.req.valid('param')
    const current = loadDecision(db, user, id)
    const solution = db
      .prepare('SELECT * FROM decision_solutions WHERE id = ? AND decision_id = ?')
      .get(solutionId, id)
    if (!solution) httpError(404, ERROR_CODES.SOLUTION_NOT_FOUND)
    if (user.role !== 'admin' && solution.proposer_id !== user.id) {
      httpError(403, ERROR_CODES.PROJECT_NOT_OWNER)
    }
    const wasChosen = current.chosen_solution_id === solutionId
    db.transaction(() => {
      db.prepare('DELETE FROM decision_solutions WHERE id = ?').run(solutionId)
      if (wasChosen) {
        db.prepare(
          "UPDATE decisions SET chosen_solution_id = NULL, status = 'open', decided_at = NULL, updated_at = ? WHERE id = ?"
        ).run(Date.now(), id)
      }
      addDecisionEvent(db, id, user.id, 'solution_removed', { solution_id: solutionId, reopen: wasChosen })
    })()
    hub.broadcast('decisions')
    return c.body(null, 204)
  })

  // --- Votar (mover voto; 409 si no está open) ---
  app.put(
    '/api/decisions/:id/vote',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', voteSchema, validationHook),
    (c) => {
      const db = c.get('db')
      const user = c.get('user')
      const id = c.req.valid('param').id
      const current = loadDecision(db, user, id)
      if (current.status !== 'open') httpError(409, ERROR_CODES.DECISION_NOT_OPEN)
      const { solution_id: solutionId } = c.req.valid('json')
      if (!db.prepare('SELECT id FROM decision_solutions WHERE id = ? AND decision_id = ?').get(solutionId, id)) {
        httpError(404, ERROR_CODES.SOLUTION_NOT_FOUND)
      }
      const now = Date.now()
      db.transaction(() => {
        db.prepare(
          `INSERT INTO decision_votes (decision_id, solution_id, user_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(decision_id, user_id) DO UPDATE SET solution_id = excluded.solution_id, created_at = excluded.created_at`
        ).run(id, solutionId, user.id, now)
        db.prepare('UPDATE decisions SET updated_at = ? WHERE id = ?').run(now, id)
        addDecisionEvent(db, id, user.id, 'voted', { solution_id: solutionId })
      })()
      hub.broadcast('decisions')
      return c.json({ ok: true })
    }
  )

  // --- Retirar voto ---
  app.delete('/api/decisions/:id/vote', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const id = c.req.valid('param').id
    loadDecision(db, user, id)
    db.transaction(() => {
      db.prepare('DELETE FROM decision_votes WHERE decision_id = ? AND user_id = ?').run(id, user.id)
      db.prepare('UPDATE decisions SET updated_at = ? WHERE id = ?').run(Date.now(), id)
      addDecisionEvent(db, id, user.id, 'voted', { removed: true })
    })()
    hub.broadcast('decisions')
    return c.body(null, 204)
  })

  // --- Elegir solución o cerrar sin solución (solo creador/admin) ---
  app.post(
    '/api/decisions/:id/choose',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', chooseSchema, validationHook),
    (c) => {
      const db = c.get('db')
      const user = c.get('user')
      const id = c.req.valid('param').id
      const current = loadDecision(db, user, id)
      requireCanDecide(db, user, current)
      const { solution_id: solutionId } = c.req.valid('json')
      const now = Date.now()
      db.transaction(() => {
        if (solutionId) {
          if (!db.prepare('SELECT id FROM decision_solutions WHERE id = ? AND decision_id = ?').get(solutionId, id)) {
            httpError(404, ERROR_CODES.SOLUTION_NOT_FOUND)
          }
          db.prepare(
            "UPDATE decisions SET chosen_solution_id = ?, status = 'decided', decided_at = ?, updated_at = ? WHERE id = ?"
          ).run(solutionId, now, now, id)
          addDecisionEvent(db, id, user.id, 'chosen', { solution_id: solutionId })
        } else {
          db.prepare(
            "UPDATE decisions SET chosen_solution_id = NULL, status = 'decided', decided_at = ?, updated_at = ? WHERE id = ?"
          ).run(now, now, id)
          addDecisionEvent(db, id, user.id, 'unchosen', {})
        }
      })()
      hub.broadcast('decisions')
      return c.json({ decision: hydrateDetail(db, user, id).decision })
    }
  )

  // --- Reabrir (solo creador/admin) ---
  app.post('/api/decisions/:id/reopen', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const id = c.req.valid('param').id
    const current = loadDecision(db, user, id)
    requireCanDecide(db, user, current)
    db.transaction(() => {
      db.prepare(
        "UPDATE decisions SET status = 'open', chosen_solution_id = NULL, decided_at = NULL, updated_at = ? WHERE id = ?"
      ).run(Date.now(), id)
      addDecisionEvent(db, id, user.id, 'reopened', {})
    })()
    hub.broadcast('decisions')
    return c.json({ decision: hydrateDetail(db, user, id).decision })
  })

  // --- Comentarios ---
  app.get('/api/decisions/:id/comments', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const id = c.req.valid('param').id
    loadDecision(db, user, id)
    const comments = db
      .prepare(
        `SELECT c.*, u.username, u.color AS user_color
         FROM decision_comments c LEFT JOIN users u ON u.id = c.user_id
         WHERE c.decision_id = ? ORDER BY c.created_at DESC LIMIT 200`
      )
      .all(id)
    return c.json({ comments })
  })

  app.post(
    '/api/decisions/:id/comments',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', commentSchema, validationHook),
    (c) => {
      const db = c.get('db')
      const user = c.get('user')
      const id = c.req.valid('param').id
      loadDecision(db, user, id)
      const data = c.req.valid('json')
      const commentId = crypto.randomUUID()
      const now = Date.now()
      db.transaction(() => {
        db.prepare('INSERT INTO decision_comments (id, decision_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(commentId, id, user.id, data.body, now)
        db.prepare('UPDATE decisions SET updated_at = ? WHERE id = ?').run(now, id)
        addDecisionEvent(db, id, user.id, 'comment', { comment_id: commentId })
      })()
      hub.broadcast('decisions')
      c.header('Location', `/api/decisions/${id}/comments/${commentId}`)
      return c.json({ ok: true, id: commentId }, 201)
    }
  )

  // --- Adjuntos (issue #279) ---
  // Subida multipart: cualquier miembro adjunta a la decisión (descripción);
  // a una solución solo su autor o admin (coherente con editar la propia).
  app.post(
    '/api/decisions/:id/attachments',
    zValidator('param', idParamSchema, validationHook),
    async (c) => {
      const db = c.get('db')
      const user = c.get('user')
      const id = c.req.valid('param').id
      loadDecision(db, user, id)
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
      const solutionId =
        typeof body.solution_id === 'string' && body.solution_id.trim() ? body.solution_id.trim() : null
      if (solutionId) {
        const solution = db
          .prepare('SELECT * FROM decision_solutions WHERE id = ? AND decision_id = ?')
          .get(solutionId, id)
        if (!solution) httpError(404, ERROR_CODES.SOLUTION_NOT_FOUND)
        if (user.role !== 'admin' && solution.proposer_id !== user.id) {
          httpError(403, ERROR_CODES.PROJECT_NOT_OWNER)
        }
      }
      const currentCount = db
        .prepare('SELECT COUNT(*) AS n FROM decision_attachments WHERE decision_id = ?')
        .get(id).n
      if (currentCount >= MAX_ATTACHMENTS_PER_DECISION) {
        httpError(409, ERROR_CODES.ATTACHMENTS_LIMIT_EXCEEDED)
      }
      // Nombre aleatorio en disco; la extensión se sanea (solo alfanumérica, máx 10)
      const ext = path.extname(file.name || '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10)
      const stored = `${crypto.randomUUID()}${ext}`
      const buffer = Buffer.from(await file.arrayBuffer())
      fs.mkdirSync(uploadsDir, { recursive: true })
      fs.writeFileSync(path.join(uploadsDir, stored), buffer)

      const attId = crypto.randomUUID()
      const now = Date.now()
      const filename = String(file.name || 'adjunto').slice(0, 200)
      db.transaction(() => {
        db.prepare(
          `INSERT INTO decision_attachments (id, decision_id, solution_id, filename, stored_name, size, mime, uploaded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(attId, id, solutionId, filename, stored, buffer.length, mime, user.id, now)
        db.prepare('UPDATE decisions SET updated_at = ? WHERE id = ?').run(now, id)
        addDecisionEvent(db, id, user.id, 'attachment', {
          filename,
          ...(solutionId ? { solution_id: solutionId } : {}),
        })
      })()
      hub.broadcast('decisions')
      c.header('Location', `/api/decisions/attachments/${attId}`)
      return c.json(
        {
          attachment: {
            id: attId,
            decision_id: id,
            solution_id: solutionId,
            filename,
            size: buffer.length,
            mime,
            created_at: now,
            uploaded_by: user.id,
            uploaded_by_username: user.username,
          },
        },
        201
      )
    }
  )

  // Descarga: solo miembros del proyecto de la decisión (404 para no revelar
  // existencia, mismo criterio que adjuntos de tarea).
  app.get('/api/decisions/attachments/:aid', zValidator('param', aidParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const att = db
      .prepare(
        `SELECT a.*, d.project_id FROM decision_attachments a
         JOIN decisions d ON d.id = a.decision_id WHERE a.id = ?`
      )
      .get(c.req.valid('param').aid)
    if (!att || !isMember(db, user.id, att.project_id)) {
      httpError(404, ERROR_CODES.ATTACHMENT_NOT_FOUND)
    }
    const filePath = path.join(uploadsDir, path.basename(att.stored_name))
    if (!fs.existsSync(filePath)) httpError(404, ERROR_CODES.ATTACHMENT_FILE_MISSING)
    c.header('Content-Type', att.mime || 'application/octet-stream')
    c.header(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`
    )
    return c.body(fs.readFileSync(filePath))
  })

  // Borrado: quien lo subió o admin.
  app.delete('/api/decisions/attachments/:aid', zValidator('param', aidParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const att = db
      .prepare(
        `SELECT a.*, d.project_id FROM decision_attachments a
         JOIN decisions d ON d.id = a.decision_id WHERE a.id = ?`
      )
      .get(c.req.valid('param').aid)
    if (!att) httpError(404, ERROR_CODES.ATTACHMENT_NOT_FOUND)
    if (!isMember(db, user.id, att.project_id)) httpError(404, ERROR_CODES.ATTACHMENT_NOT_FOUND)
    if (user.role !== 'admin' && att.uploaded_by !== user.id) {
      httpError(403, ERROR_CODES.PROJECT_NOT_OWNER)
    }
    const filePath = path.join(uploadsDir, path.basename(att.stored_name))
    try {
      fs.unlinkSync(filePath)
    } catch {}
    db.transaction(() => {
      db.prepare('DELETE FROM decision_attachments WHERE id = ?').run(att.id)
      db.prepare('UPDATE decisions SET updated_at = ? WHERE id = ?').run(Date.now(), att.decision_id)
      addDecisionEvent(db, att.decision_id, user.id, 'attachment', {
        filename: att.filename,
        removed: true,
      })
    })()
    hub.broadcast('decisions')
    return c.body(null, 204)
  })
}
