// idempotency.ts — middleware para POST idempotentes con Idempotency-Key.
// Si la key ya existe y tiene menos de 24h, devuelve la respuesta cacheada.
// Si no, procesa la petición y guarda el resultado.
import type { MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from './types.js'
import { logger } from './logger.js'

const log = logger.child({ component: 'idempotency' })
const TTL_MS = 24 * 60 * 60 * 1000

interface IdempotencyRow {
  key: string
  user_id: string
  status: number
  response_body: string | null
  created_at: number
}

export function idempotencyMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method !== 'POST') return next()
    const key = c.req.header('idempotency-key')
    if (!key) return next()
    const user = c.get('user')
    if (!user) return next()
    const db = c.get('db')

    const existing = db
      .prepare('SELECT * FROM idempotency_keys WHERE key = ? AND user_id = ?')
      .get(key, user.id) as IdempotencyRow | undefined
    if (existing && Date.now() - existing.created_at < TTL_MS) {
      log.info('idempotency_hit', { key: key.slice(0, 12) })
      return c.json(JSON.parse(existing.response_body || 'null'), existing.status as ContentfulStatusCode)
    }

    if (existing) {
      db.prepare('DELETE FROM idempotency_keys WHERE key = ?').run(key)
    }

    await next()

    if (c.res.status >= 200 && c.res.status < 300) {
      try {
        const body: unknown = await c.res.clone().json().catch(() => null)
        db.prepare(
          'INSERT INTO idempotency_keys (key, user_id, status, response_body, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(key, user.id, c.res.status, JSON.stringify(body), Date.now())
      } catch {
        // si no se puede serializar, no cacheamos
      }
    }

    // Limpieza de keys expiradas (mejor esfuerzo)
    db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(Date.now() - TTL_MS)
  }
}
