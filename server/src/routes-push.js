// routes-push.js — endpoints de suscripción Web Push.
// Auth: la sesión viaja por cookie HttpOnly SameSite=Lax mismo-origen (como el
// resto de mutaciones de la app; no hay cabecera CSRF separada en Deltos).
// El endpoint push es una capability URL SECRETA: nunca se loguea.
import crypto from 'node:crypto'
import { z } from 'zod'
import { isPushConfigured, pushPublicKey } from './push.js'

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
})

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
})

export function registerPushRoutes(app) {
  // Clave pública VAPID para applicationServerKey. No es secreta, pero solo
  // se sirve con sesión. En demo y sin claves configuradas la UI lo detecta.
  app.get('/api/push/vapid-public-key', (c) => {
    if (c.get('demo')) return c.json({ demo: true })
    if (!isPushConfigured()) return c.json({ error: 'push no configurado en el servidor' }, 503)
    return c.json({ publicKey: pushPublicKey() })
  })

  // Upsert por endpoint: re-suscripción o cambio de usuario en el mismo
  // navegador = UPDATE (el endpoint es único por dispositivo/navegador).
  app.post('/api/push/subscribe', async (c) => {
    if (c.get('demo')) return c.json({ demo: true, error: 'sin push real en modo demo' }, 501)
    if (!isPushConfigured()) return c.json({ error: 'push no configurado en el servidor' }, 503)
    const body = await c.req.json().catch(() => null)
    const parsed = subscribeSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: 'suscripción inválida' }, 400)
    const db = c.get('db')
    const user = c.get('user')
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
      parsed.data.endpoint,
      parsed.data.keys.p256dh,
      parsed.data.keys.auth,
      c.req.header('user-agent') || null,
      now,
      now
    )
    return c.json({ ok: true }, 201)
  })

  // Borra SOLO si la suscripción pertenece al usuario de la sesión.
  app.delete('/api/push/unsubscribe', async (c) => {
    if (c.get('demo')) return c.json({ demo: true }, 200)
    const body = await c.req.json().catch(() => null)
    const parsed = unsubscribeSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: 'petición inválida' }, 400)
    const db = c.get('db')
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
      .run(parsed.data.endpoint, c.get('user').id)
    return c.json({ ok: true })
  })
}
