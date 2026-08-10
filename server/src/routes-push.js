// routes-push.js — endpoints de suscripción Web Push.
// Auth: cookie HttpOnly SameSite=Lax + CSRF token en cabecera x-csrf-token
// (ver middleware CSRF en app.js). El endpoint push es una capability URL
// SECRETA: nunca se loguea.
// Convenciones api-stack: zValidator + envelope de errores vía httpError().
import crypto from 'node:crypto'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { isPushConfigured, pushPublicKey } from './push.js'
import { httpError, validationHook } from './errors.js'
import { ERROR_CODES } from './error-codes.js'

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
})

// Tipos de notificación configurables por el usuario (toggle en Ajustes).
// notifyUsers (push.js) trata la AUSENCIA de fila como 'enabled'; una fila con
// enabled=0 la desactiva. Deben ir sincronizados con el catálogo de push.js.
export const TIPOS_PUSH = ['asignacion', 'comentario', 'tarea_movida', 'mencion', 'vencimiento', 'pago_requerido', 'pago_completado']

const prefSchema = z.object({
  tipo: z.enum(TIPOS_PUSH),
  enabled: z.boolean(),
})

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
})

export function registerPushRoutes(app) {
  // Clave pública VAPID para applicationServerKey. No es secreta, pero solo
  // se sirve con sesión. En demo y sin claves configuradas la UI lo detecta.
  app.get('/api/push/vapid-public-key', (c) => {
    if (c.get('demo')) return c.json({ demo: true })
    if (!isPushConfigured()) httpError(503, ERROR_CODES.PUSH_NOT_CONFIGURED)
    return c.json({ publicKey: pushPublicKey() })
  })

  // Upsert por endpoint: re-suscripción o cambio de usuario en el mismo
  // navegador = UPDATE (el endpoint es único por dispositivo/navegador).
  app.post('/api/push/subscribe', zValidator('json', subscribeSchema, validationHook), (c) => {
    if (c.get('demo')) httpError(501, ERROR_CODES.PUSH_DEMO_UNAVAILABLE)
    if (!isPushConfigured()) httpError(503, ERROR_CODES.PUSH_NOT_CONFIGURED)
    const db = c.get('db')
    const user = c.get('user')
    const data = c.req.valid('json')
    const now = Date.now()
    db.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         updated_at = excluded.updated_at`
    ).run(
      crypto.randomUUID(),
      user.id,
      data.endpoint,
      data.keys.p256dh,
      data.keys.auth,
      c.req.header('user-agent') || null,
      now,
      now
    )
    return c.json({ ok: true }, 201)
  })

  // Borra SOLO si la suscripción pertenece al usuario de la sesión.
  app.delete('/api/push/unsubscribe', zValidator('json', unsubscribeSchema, validationHook), (c) => {
    if (c.get('demo')) return c.json({ demo: true }, 200) // demo: no hay nada que borrar
    const db = c.get('db')
    const data = c.req.valid('json')
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
      .run(data.endpoint, c.get('user').id)
    return c.body(null, 204)
  })

  // Preferencias por tipo (toggles en Ajustes). Ausencia = activado.
  app.get('/api/push/preferences', (c) => {
    const db = c.get('db')
    const user = c.get('user')
    const rows = db
      .prepare('SELECT tipo, enabled FROM notification_preferences WHERE user_id = ?')
      .all(user.id)
    const off = new Set(rows.filter((r) => !r.enabled).map((r) => r.tipo))
    const prefs = {}
    for (const tipo of TIPOS_PUSH) prefs[tipo] = !off.has(tipo)
    return c.json({ prefs })
  })

  app.put('/api/push/preferences', zValidator('json', prefSchema, validationHook), (c) => {
    if (c.get('demo')) httpError(403, ERROR_CODES.DEMO_READ_ONLY)
    const db = c.get('db')
    const user = c.get('user')
    const { tipo, enabled } = c.req.valid('json')
    db.prepare(
      `INSERT INTO notification_preferences (user_id, tipo, enabled, min_severity, updated_at)
       VALUES (?, ?, ?, 'normal', ?)
       ON CONFLICT(user_id, tipo) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
    ).run(user.id, tipo, enabled ? 1 : 0, Date.now())
    return c.json({ ok: true })
  })
}
