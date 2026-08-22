// auth.js — sesiones con cookie HMAC, bcrypt, rate-limit en SQLite, middleware.
// Cookie: session = "id.hmac" (HMAC-SHA256), httpOnly, SameSite=Lax, 30 días.
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { serialize, parse } from 'cookie'
import { kvGet, kvSet } from './db.js'
import { logger } from './logger.js'
import { httpError } from './errors.js'
import { ERROR_CODES } from './error-codes.js'

const log = logger.child({ component: 'auth' })

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 días
export const COOKIE_NAME = 'deltos_session'
const LOCK_MS = 5 * 60 * 1000 // 5 min de bloqueo tras 5 intentos fallidos

// Secret HMAC: env SESSION_SECRET o autogenerado persistido en kv
// (así la cookie sobrevive reinicios).
export function getSecret(prodDb, envSecret) {
  if (envSecret) return envSecret
  let secret = kvGet(prodDb, 'session_secret')
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
    kvSet(prodDb, 'session_secret', secret)
    log.info('session_secret_generated')
  }
  return secret
}

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex')
}

function validSignature(secret, id, sig) {
  const expected = Buffer.from(hmac(secret, id), 'hex')
  const given = Buffer.from(String(sig), 'hex')
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

export function cookieFor(secret, sessionId, { secure, maxAgeMs = SESSION_TTL_MS }) {
  return serialize(COOKIE_NAME, `${sessionId}.${hmac(secret, sessionId)}`, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: Math.floor(maxAgeMs / 1000),
    path: '/',
  })
}

export function clearCookie({ secure }) {
  return serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
}

export function createSession(db, userId, ua) {
  const id = crypto.randomUUID()
  const csrfToken = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, csrf_token) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, now, now + SESSION_TTL_MS, ua || null, csrfToken)
  return { id, csrfToken }
}

export function destroySession(db, sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}

const USER_PUBLIC_COLS = 'id, username, display_name, email, phone, color, language, role, expenses_enabled, created_at'

// Resuelve la cookie de sesión contra la BD de producción y, si no está,
// contra la BD demo. Devuelve { db, demo, user, sessionId } o null.
export function resolveSession({ prod, demo, secret }, cookieHeader, ua) {
  const cookies = parse(cookieHeader || '')
  const raw = cookies[COOKIE_NAME]
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot < 1) return null
  const id = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  if (!validSignature(secret, id, sig)) return null

  const now = Date.now()
  for (const [db, isDemo] of [[prod, false], [demo, true]]) {
    if (!db) continue
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
    if (!s || s.expires_at <= now) continue
    if (s.ua && ua && s.ua !== ua) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
      return null
    }
    const user = db.prepare(`SELECT ${USER_PUBLIC_COLS} FROM users WHERE id = ?`).get(s.user_id)
    if (user) return { db, demo: isDemo, user, sessionId: id, csrfToken: s.csrf_token }
  }
  return null
}

// Rutas públicas bajo /api (todo lo demás requiere sesión)
const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/demo',
  '/api/auth/logout',
])

export function requireAuth(ctx) {
  return async (c, next) => {
    const path = c.req.path
    // GET /api/settings/demo es público: la pantalla de login lo consulta
    // para saber si debe mostrar el botón "Entrar como demo".
    const isPublic =
      PUBLIC_PATHS.has(path) ||
      path.startsWith('/api/ha/tasks') ||
      (path.startsWith('/api/invite/') &&
        (c.req.method === 'GET' || c.req.method === 'PUT' || (c.req.method === 'POST' && path.endsWith('/comments')))) ||
      (path === '/api/settings/demo' && c.req.method === 'GET')
    if (isPublic) return next()

    const session = resolveSession(ctx, c.req.header('cookie'), c.req.header('user-agent'))
    if (!session) httpError(401, ERROR_CODES.AUTH_REQUIRED)
    c.set('db', session.db)
    c.set('user', session.user)
    c.set('demo', session.demo)
    c.set('sessionId', session.sessionId)
    await next()
  }
}

// Lanza 403 AUTH_FORBIDDEN si el usuario de la sesión no es admin.
// (Antes devolvía una Response; ahora el envelope lo construye app.onError.)
export function requireAdmin(c) {
  const user = c.get('user')
  if (!user || user.role !== 'admin') {
    httpError(403, ERROR_CODES.AUTH_FORBIDDEN)
  }
}

// --- Login / logout -------------------------------------------------------

export async function verifyLogin(db, username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user) return null
  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return null
  const { password_hash, ...pub } = user
  return pub
}

export async function registerUser(db, username, password, { color = 'slate', language = 'auto', role = 'user' } = {}) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) return null
  const hash = await bcrypt.hash(password, 10)
  const id = crypto.randomUUID()
  db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, color, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, username, username, hash, color, language, role, Date.now())
  return db.prepare(`SELECT ${USER_PUBLIC_COLS} FROM users WHERE id = ?`).get(id)
}

export function updateUser(db, id, updates) {
  const fields = []
  const values = []
  for (const key of ['display_name', 'email', 'phone', 'language', 'color', 'expenses_enabled']) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = ?`)
      // SQLite no acepta booleans: coerción explícita a 1/0 (bug #172).
      values.push(key === 'expenses_enabled' ? (updates[key] ? 1 : 0) : updates[key])
    }
  }
  if (fields.length === 0) return null
  values.push(id)
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return db.prepare(`SELECT ${USER_PUBLIC_COLS} FROM users WHERE id = ?`).get(id)
}

export async function changePassword(db, userId, current, next) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId)
  if (!row) return 'error'
  const valid = await bcrypt.compare(current, row.password_hash)
  if (!valid) return 'wrong-current'
  const hash = await bcrypt.hash(next, 10)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId)
  return 'ok'
}

export function destroyOtherSessions(db, userId, currentSessionId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, currentSessionId)
}

// Bootstrap: crea el admin inicial en users desde .env (idempotente).
export async function ensureBootstrapAdmin(db, username, password) {
  if (!password) {
    log.warn('bootstrap_admin_skipped', { reason: 'auth_pass_missing' })
    return false
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) return false
  const hash = await bcrypt.hash(password, 10)
  db.prepare(
    "INSERT INTO users (id, username, display_name, password_hash, color, language, role, created_at) VALUES (?, ?, ?, ?, 'violet', 'auto', 'admin', ?)"
  ).run(crypto.randomUUID(), username, username, hash, Date.now())
  log.info('bootstrap_admin_created', { username })
  return true
}

// --- Rate-limit de login en SQLite (persiste tras reinicios) --------------

function clientIp(c) {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.env?.incoming?.socket?.remoteAddress ||
    'unknown'
  )
}

export function loginRateLimited(db, c) {
  const row = db.prepare('SELECT locked_until FROM login_attempts WHERE ip = ?').get(clientIp(c))
  return !!row && row.locked_until > Date.now()
}

export function registerLoginFail(db, c) {
  const ip = clientIp(c)
  db.prepare(
    `INSERT INTO login_attempts (ip, attempts, locked_until) VALUES (?, 1, 0)
     ON CONFLICT(ip) DO UPDATE SET
       attempts = attempts + 1,
       locked_until = CASE WHEN attempts >= 4 THEN ? ELSE locked_until END`
  ).run(ip, Date.now() + LOCK_MS)
}

export function loginOk(db, c) {
  db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(clientIp(c))
}
