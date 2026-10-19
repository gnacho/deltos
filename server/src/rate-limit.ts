// rate-limit.js — rate-limit simple por usuario para mutaciones (POST/PUT/PATCH/DELETE).
// Ventana deslizante de 1 minuto, máximo 60 mutaciones por usuario.
// In-memory (suficiente para app self-hosted single-instance).
import { httpError } from './errors.js'
import { ERROR_CODES } from './error-codes.js'

const WINDOW_MS = 60 * 1000
const MAX_REQUESTS = 60

const buckets = new Map()

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS
  for (const [key, timestamps] of buckets) {
    const fresh = timestamps.filter((t) => t > cutoff)
    if (fresh.length === 0) buckets.delete(key)
    else buckets.set(key, fresh)
  }
}, WINDOW_MS).unref()

export function mutationRateLimit() {
  return async (c, next) => {
    const method = c.req.method
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next()
    const user = c.get('user')
    if (!user) return next()
    const key = user.id
    const now = Date.now()
    const cutoff = now - WINDOW_MS
    let timestamps = buckets.get(key) || []
    timestamps = timestamps.filter((t) => t > cutoff)
    if (timestamps.length >= MAX_REQUESTS) {
      httpError(429, ERROR_CODES.RATE_LIMITED)
    }
    timestamps.push(now)
    buckets.set(key, timestamps)
    await next()
  }
}
