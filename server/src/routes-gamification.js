// routes-gamification.js - gamificacion: puntos por completar tareas,
// recompensas canjeables y resumen (karma semanal, rachas, saldo).
//
// Reglas de puntos:
//   - Al mover una tarea a 'hecho' (move o done-and-archive desde otra
//     columna), quien la completa gana base 5 + bonus por prioridad
//     (alta +5, media +2, baja +0).
//   - Anti-farming: una tarea solo concede puntos una vez cada 23 h
//     (independientemente del usuario), comprobado contra el ledger activo.
//   - Reversion: si una tarea sale de 'hecho', su ultima entrada activa se
//     marca como revertida (reverted_at). Al volver a 'hecho' se reactiva la
//     entrada revertida si aun esta dentro de la ventana anti-farming;
//     si no, se crea una nueva.
// El saldo de un usuario es SUM(ledger activo) - SUM(canjes). Todas las rutas
// bajo requireAuth (middleware global /api/*).
import crypto from 'node:crypto'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { httpError, validationHook } from './errors.js'
import { ERROR_CODES } from './error-codes.js'

const BASE_POINTS = 5
const PRIORITY_BONUS = { alta: 5, media: 2, baja: 0 }
const ANTI_FARMING_MS = 23 * 60 * 60 * 1000

const idParamSchema = z.object({ id: z.string().min(1).max(64) })

const rewardSchema = z.object({
  title: z.string().min(1).max(120),
  emoji: z.string().max(16).default('🎁'),
  cost: z.number().int().min(1).max(100000),
})

/**
 * Concede puntos por completar una tarea. Pensado para llamarse DENTRO de la
 * transaccion del move. Devuelve los puntos concedidos (0 si el anti-farming
 * bloquea una nueva concesion).
 *
 * Logica:
 *  - Si hay una entrada activa reciente (< 23 h) de la tarea: no concede.
 *  - Si hay una entrada revertida reciente (< 23 h): la reactiva.
 *  - En cualquier otro caso: inserta una entrada nueva.
 */
export function grantCompletionPoints(db, task, userId) {
  const cutoff = Date.now() - ANTI_FARMING_MS
  const activeRecent = db
    .prepare(
      'SELECT 1 FROM gam_points_ledger WHERE task_id = ? AND created_at >= ? AND reverted_at IS NULL LIMIT 1'
    )
    .get(task.id, cutoff)
  if (activeRecent) return 0

  const reverted = db
    .prepare(
      'SELECT id, points FROM gam_points_ledger WHERE task_id = ? AND created_at >= ? AND reverted_at IS NOT NULL ORDER BY created_at DESC LIMIT 1'
    )
    .get(task.id, cutoff)
  if (reverted) {
    db.prepare('UPDATE gam_points_ledger SET reverted_at = NULL WHERE id = ?').run(reverted.id)
    return reverted.points
  }

  const points = BASE_POINTS + (PRIORITY_BONUS[task.priority] ?? 0)
  db.prepare(
    `INSERT INTO gam_points_ledger (id, user_id, task_id, points, reason, created_at, reverted_at)
     VALUES (?, ?, ?, ?, 'task_done', ?, NULL)`
  ).run(crypto.randomUUID(), userId, task.id, points, Date.now())
  return points
}

/**
 * Revierte los puntos de una tarea al salir de 'hecho'. Marca la ultima
 * entrada activa como revertida. Devuelve los puntos revertidos (0 si no
 * habia entrada activa).
 */
export function revertCompletionPoints(db, taskId) {
  const entry = db
    .prepare(
      'SELECT id, points FROM gam_points_ledger WHERE task_id = ? AND reverted_at IS NULL ORDER BY created_at DESC LIMIT 1'
    )
    .get(taskId)
  if (!entry) return 0
  db.prepare('UPDATE gam_points_ledger SET reverted_at = ? WHERE id = ?').run(Date.now(), entry.id)
  return entry.points
}

/** Lunes 00:00 local de la semana actual (epoch ms). */
function mondayStartMs(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // getDay: domingo=0 -> lunes=0
  return d.getTime()
}

/** 'YYYY-MM-DD' en hora local (para comparar dias de racha). */
function localDay(ms) {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Racha: dias consecutivos con al menos una concesion activa, terminando hoy
 * o ayer (si hoy aun no hay, la racha viva es la que termino ayer).
 */
function streakDays(daysSet, nowMs = Date.now()) {
  let cursor = localDay(nowMs)
  if (!daysSet.has(cursor)) {
    cursor = localDay(nowMs - DAY_MS)
    if (!daysSet.has(cursor)) return 0
  }
  let streak = 0
  let cursorMs = new Date(`${cursor}T00:00:00`).getTime()
  while (daysSet.has(localDay(cursorMs))) {
    streak += 1
    cursorMs -= DAY_MS
  }
  return streak
}

export function registerGamificationRoutes(app, { hub }) {
  // Resumen global: por cada usuario del sistema, saldo, puntos de la semana
  // (desde el lunes 00:00 local), racha de dias y total de tareas completadas.
  app.get('/api/gamification/summary', (c) => {
    const db = c.get('db')
    const users = db
      .prepare('SELECT id, username, display_name, color FROM users ORDER BY created_at, username')
      .all()
    const weekStart = mondayStartMs()
    const activeWhere = 'reverted_at IS NULL'

    const earned = db
      .prepare(`SELECT user_id, SUM(points) AS total, COUNT(*) AS n FROM gam_points_ledger WHERE ${activeWhere} GROUP BY user_id`)
      .all()
    const earnedWeek = db
      .prepare(`SELECT user_id, SUM(points) AS total FROM gam_points_ledger WHERE created_at >= ? AND ${activeWhere} GROUP BY user_id`)
      .all(weekStart)
    const spent = db
      .prepare('SELECT user_id, SUM(cost) AS total FROM gam_redemptions GROUP BY user_id')
      .all()
    const days = db
      .prepare(`SELECT DISTINCT user_id, created_at FROM gam_points_ledger WHERE ${activeWhere} ORDER BY user_id, created_at`)
      .all()

    const earnedMap = new Map(earned.map((r) => [r.user_id, r]))
    const weekMap = new Map(earnedWeek.map((r) => [r.user_id, r.total]))
    const spentMap = new Map(spent.map((r) => [r.user_id, r.total]))
    const daysMap = new Map()
    for (const r of days) {
      if (!daysMap.has(r.user_id)) daysMap.set(r.user_id, new Set())
      daysMap.get(r.user_id).add(localDay(r.created_at))
    }

    const summary = users.map((u) => {
      const totalEarned = earnedMap.get(u.id)?.total ?? 0
      const totalSpent = spentMap.get(u.id) ?? 0
      return {
        user_id: u.id,
        display_name: u.display_name,
        username: u.username,
        color: u.color,
        balance: totalEarned - totalSpent,
        week_points: weekMap.get(u.id) ?? 0,
        streak_days: streakDays(daysMap.get(u.id) ?? new Set()),
        tasks_done_total: earnedMap.get(u.id)?.n ?? 0,
      }
    })

    const recent = db
      .prepare(
        `SELECT l.id, l.user_id, u.username, u.display_name, l.task_id, t.title AS task_title,
                l.points, l.reason, l.created_at
         FROM gam_points_ledger l
         JOIN users u ON u.id = l.user_id
         LEFT JOIN tasks t ON t.id = l.task_id
         WHERE l.reverted_at IS NULL
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT 10`
      )
      .all()

    const redemptions = db
      .prepare(
        `SELECT r.id, r.user_id, u.username, u.display_name, r.reward_id,
                w.title AS reward_title, w.emoji AS reward_emoji, r.cost, r.created_at
         FROM gam_redemptions r
         JOIN users u ON u.id = r.user_id
         JOIN gam_rewards w ON w.id = r.reward_id
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT 10`
      )
      .all()

    return c.json({ users: summary, recent, redemptions })
  })

  // Recompensas activas (cualquier usuario autenticado las ve y las crea).
  app.get('/api/rewards', (c) => {
    const db = c.get('db')
    const rewards = db
      .prepare('SELECT id, title, emoji, cost, created_by, created_at FROM gam_rewards WHERE active = 1 ORDER BY created_at')
      .all()
    return c.json({ rewards })
  })

  app.post('/api/rewards', zValidator('json', rewardSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const data = c.req.valid('json')
    const id = crypto.randomUUID()
    db.prepare(
      'INSERT INTO gam_rewards (id, title, emoji, cost, active, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    ).run(id, data.title, data.emoji, data.cost, user.id, Date.now())
    hub.broadcast('gamification')
    const reward = db.prepare('SELECT id, title, emoji, cost, created_by, created_at FROM gam_rewards WHERE id = ?').get(id)
    c.header('Location', `/api/rewards/${id}`)
    return c.json({ reward }, 201)
  })

  // Borrado logico: el historial de canjes sigue apuntando a la recompensa.
  app.delete('/api/rewards/:id', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const id = c.req.valid('param').id
    const reward = db.prepare('SELECT id FROM gam_rewards WHERE id = ? AND active = 1').get(id)
    if (!reward) httpError(404, ERROR_CODES.REWARD_NOT_FOUND)
    db.prepare('UPDATE gam_rewards SET active = 0 WHERE id = ?').run(id)
    hub.broadcast('gamification')
    return c.body(null, 204)
  })

  // Canje: valida saldo del usuario actual y descuenta (fila en redemptions
  // con el coste actual de la recompensa).
  app.post('/api/rewards/:id/redeem', zValidator('param', idParamSchema, validationHook), (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const id = c.req.valid('param').id
    const reward = db.prepare('SELECT * FROM gam_rewards WHERE id = ? AND active = 1').get(id)
    if (!reward) httpError(404, ERROR_CODES.REWARD_NOT_FOUND)

    const redeem = db.transaction(() => {
      const earned = db
        .prepare('SELECT COALESCE(SUM(points), 0) AS total FROM gam_points_ledger WHERE user_id = ? AND reverted_at IS NULL')
        .get(user.id).total
      const spent = db
        .prepare('SELECT COALESCE(SUM(cost), 0) AS total FROM gam_redemptions WHERE user_id = ?')
        .get(user.id).total
      const balance = earned - spent
      if (balance < reward.cost) httpError(400, ERROR_CODES.INSUFFICIENT_POINTS)
      const redemptionId = crypto.randomUUID()
      db.prepare(
        'INSERT INTO gam_redemptions (id, reward_id, user_id, cost, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(redemptionId, reward.id, user.id, reward.cost, Date.now())
      return { id: redemptionId, balance: balance - reward.cost }
    })
    const result = redeem()
    hub.broadcast('gamification')
    const redemption = db
      .prepare('SELECT id, reward_id, user_id, cost, created_at FROM gam_redemptions WHERE id = ?')
      .get(result.id)
    return c.json({ redemption, balance: result.balance }, 201)
  })
}
