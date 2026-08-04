// app.js — fábrica de la app Hono: wide event, headers de seguridad, auth,
// rutas, SSE, estáticos y SPA fallback. Exportada para tests (sin listen).
// Convenciones API (CONVENTIONS.md, skill api-stack): zValidator en cada ruta,
// envelope de errores único vía app.onError, 201+Location, 204 en DELETE.
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import * as auth from './auth.js'
import { kvGet } from './db.js'
import { registerDomainRoutes } from './routes-domain.js'
import { registerPushRoutes } from './routes-push.js'
import { registerHealth } from './health.js'
import { wideEvent } from './wide-event.js'
import { httpError, onError, validationHook } from './errors.js'
import { ERROR_CODES } from './error-codes.js'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const registerSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(6, 'la contraseña debe tener al menos 6 caracteres').max(100),
  color: z.string().regex(/^[a-z]{2,20}$/).default('slate'),
  language: z.enum(['auto', 'es', 'en']).default('auto'),
})

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(100),
})

const profileSchema = z
  .object({
    email: z.string().email().max(120).nullable(),
    phone: z.string().max(30).nullable(),
    language: z.enum(['auto', 'es', 'en']),
    color: z.string().regex(/^[a-z]{2,20}$/),
  })
  .partial()

const passwordSchema = z.object({
  current: z.string().min(1, 'indica la contraseña actual'),
  next: z.string().min(6, 'la nueva contraseña debe tener al menos 6 caracteres').max(100),
})

// ctx: { prod, demo, secret, config: { cookieSecure, maxSseClients, maxUploadBytes, staticDir }, hub, uploadsDir }
export function createApp(ctx) {
  const { prod, demo, secret, config, hub } = ctx
  const app = new Hono()

  // --- Wide event: lo más arriba posible. UN evento JSON por request al
  // final (skill log-ops). Excluye /health, /api/events (SSE) y estáticos OK.
  app.use('*', wideEvent())

  // --- Headers de seguridad (la SPA se sirve del mismo origen: CSP cerrada) ---
  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
    // HSTS solo con HTTPS real (COOKIE_SECURE=true); en dev http rompería el acceso
    if (config.cookieSecure) {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.github.com"
    )
    await next()
  })

  // --- Límite de tamaño de petición (adjuntos ≤ 10 MB + margen multipart) ---
  app.use('/api/*', async (c, next) => {
    const len = parseInt(c.req.header('content-length') || '0', 10)
    if (len > config.maxUploadBytes + 1024 * 1024) {
      httpError(413, ERROR_CODES.PAYLOAD_TOO_LARGE)
    }
    c.set('maxUploadBytes', config.maxUploadBytes)
    await next()
  })

  // --- Auth: todo /api/* requiere sesión salvo login/register/demo/logout ---
  app.use('/api/*', auth.requireAuth({ prod, demo, secret }))

  // --- CSRF: mutaciones POST/PUT/PATCH/DELETE requieren cabecera x-csrf-token
  // que coincida con el token de la sesión. GET/HEAD exentos (idempotentes).
  // Rutas públicas (sin sesión) exentas: login/demo/logout no tienen sesión.
  app.use('/api/*', async (c, next) => {
    const method = c.req.method
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next()
    if (!c.get('user')) return next()
    const session = auth.resolveSession({ prod, demo, secret }, c.req.header('cookie'))
    const expected = session?.csrfToken
    const given = c.req.header('x-csrf-token')
    if (!expected || !given || expected !== given) {
      httpError(403, ERROR_CODES.CSRF_INVALID)
    }
    await next()
  })

  const cookieOpts = { secure: config.cookieSecure }

  // --- Autenticación ---
  // Alta de usuarios: solo admin (registro público eliminado, regla base común)
  app.post('/api/auth/register', zValidator('json', registerSchema, validationHook), async (c) => {
    auth.requireAdmin(c)
    const data = c.req.valid('json')
    const user = await auth.registerUser(prod, data.username, data.password, {
      color: data.color,
      language: data.language,
    })
    if (!user) httpError(409, ERROR_CODES.USER_ALREADY_EXISTS)
    hub.broadcast('users')
    c.header('Location', `/api/users/${user.id}`)
    return c.json({ ok: true, user }, 201)
  })

  app.post('/api/auth/login', zValidator('json', loginSchema, validationHook), async (c) => {
    if (auth.loginRateLimited(prod, c)) {
      httpError(429, ERROR_CODES.AUTH_RATE_LIMITED)
    }
    const data = c.req.valid('json')
    const user = await auth.verifyLogin(prod, data.username, data.password)
    if (!user) {
      auth.registerLoginFail(prod, c)
      httpError(401, ERROR_CODES.AUTH_INVALID_CREDENTIALS)
    }
    auth.loginOk(prod, c)
    // Rotación de sesión tras login exitoso (previene session fixation)
    const previous = auth.resolveSession({ prod, demo, secret }, c.req.header('cookie'))
    if (previous) auth.destroySession(previous.db, previous.sessionId)
    const { id: sessionId, csrfToken } = auth.createSession(prod, user.id, c.req.header('user-agent'))
    c.header('Set-Cookie', auth.cookieFor(secret, sessionId, cookieOpts))
    return c.json({ user, demo: false, csrfToken })
  })

  // Modo demo: un clic, sin contraseña. 403 si está desactivado en Ajustes.
  app.post('/api/auth/demo', (c) => {
    if (kvGet(prod, 'demo_enabled', '1') !== '1') {
      httpError(403, ERROR_CODES.AUTH_DEMO_DISABLED)
    }
    const user = demo
      .prepare('SELECT id, username, email, phone, color, language, role, created_at FROM users WHERE username = ?')
      .get('demo')
    if (!user) httpError(503, ERROR_CODES.DEMO_UNAVAILABLE)
    const previous = auth.resolveSession({ prod, demo, secret }, c.req.header('cookie'))
    if (previous) auth.destroySession(previous.db, previous.sessionId)
    const { id: sessionId, csrfToken } = auth.createSession(demo, user.id, c.req.header('user-agent'))
    c.header('Set-Cookie', auth.cookieFor(secret, sessionId, cookieOpts))
    return c.json({ user, demo: true, csrfToken })
  })

  app.post('/api/auth/logout', (c) => {
    const session = auth.resolveSession({ prod, demo, secret }, c.req.header('cookie'))
    if (session) auth.destroySession(session.db, session.sessionId)
    c.header('Set-Cookie', auth.clearCookie(cookieOpts))
    return c.json({ ok: true })
  })

  // GET /api/auth/me — devuelve user + {demo:true} + csrfToken de la sesión
  app.get('/api/auth/me', (c) => {
    const session = auth.resolveSession({ prod, demo, secret }, c.req.header('cookie'))
    return c.json({ user: c.get('user'), demo: c.get('demo'), csrfToken: session?.csrfToken ?? null })
  })

  app.put('/api/auth/profile', zValidator('json', profileSchema, validationHook), (c) => {
    const data = c.req.valid('json')
    const updated = auth.updateUser(c.get('db'), c.get('user').id, data)
    if (!updated) httpError(400, ERROR_CODES.BAD_REQUEST)
    hub.broadcast('users')
    return c.json({ ok: true, user: updated })
  })

  // Cambio de contraseña: verifica la actual, re-hashea e invalida las demás
  // sesiones del usuario (la actual sobrevive para no desconectar al propio).
  app.put('/api/auth/password', zValidator('json', passwordSchema, validationHook), async (c) => {
    const data = c.req.valid('json')
    const result = await auth.changePassword(c.get('db'), c.get('user').id, data.current, data.next)
    if (result === 'wrong-current') httpError(400, ERROR_CODES.AUTH_WRONG_CURRENT_PASSWORD)
    if (result !== 'ok') httpError(500, ERROR_CODES.INTERNAL_ERROR)
    auth.destroyOtherSessions(c.get('db'), c.get('user').id, c.get('sessionId'))
    return c.json({ ok: true })
  })

  // --- SSE (contrato api-stack): eventos nombrados <dominio>.changed con id
  // monótono, resync vía Last-Event-ID, heartbeat ': ping' cada 20 s (crítico
  // tras Nginx Proxy Manager) y máx N clientes. Excluido del wide event.
  app.get('/api/events', (c) => {
    if (hub.size() >= hub.maxClients) {
      httpError(429, ERROR_CODES.SSE_TOO_MANY_CLIENTS)
    }
    c.header('X-Accel-Buffering', 'no') // imprescindible detrás de nginx
    c.header('Cache-Control', 'no-cache')
    return streamSSE(c, async (stream) => {
      hub.add(stream)
      await hub.hello(stream)
      // Resync: si el navegador reconecta con Last-Event-ID y perdió eventos,
      // UN 'sync.resync' le dice que refetchee todo vía REST.
      await hub.resync(stream, c.req.header('last-event-id'))
      const heartbeat = setInterval(() => {
        // Comentario SSE ': ping' (no es un evento: no mueve lastEventId).
        stream.write(': ping\n\n').catch(() => {})
      }, 20000)
      // Mantiene el stream abierto hasta que el cliente desconecta
      await new Promise((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat)
          hub.remove(stream)
          resolve()
        })
      })
    })
  })

  // --- Dominio + push + health ---
  // Versión del PROPIO servidor: el banner anti pantalla-negra del front la
  // sondea (poll 10 min) y avisa cuando cambia tras un despliegue.
  app.get('/api/version', (c) =>
    c.json({ version: pkg.version, build: process.env.BUILD_SHA || pkg.version })
  )
  registerDomainRoutes(app, { hub, uploadsDir: ctx.uploadsDir, prod, config, dataDir: ctx.dataDir })
  registerPushRoutes(app)
  registerHealth(app, { prod, demo })

  // --- Estáticos + SPA fallback (excluyendo /api/* y /assets/*) ---
  // Caché (canon webapp-shell/actualizaciones): assets con hash = immutable;
  // index.html y sw.js = no-cache (revalidan siempre → el despliegue se ve).
  app.use('/assets/*', async (c, next) => {
    await next()
    if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
  })
  app.use('/sw.js', async (c, next) => {
    await next()
    if (c.res.ok) c.header('Cache-Control', 'no-cache')
  })
  // Sin onNotFound (la firma no es la del contexto Hono → 500 en assets).
  app.use('/*', serveStatic({ root: config.staticDir }))
  app.get('*', (c) => {
    const p = c.req.path
    if (p.startsWith('/api/') || p.startsWith('/assets/')) {
      httpError(404, ERROR_CODES.NOT_FOUND)
    }
    // index.html se lee EN CADA PETICIÓN (deploy por rsync sin restart)
    c.header('Cache-Control', 'no-cache')
    try {
      const html = fs.readFileSync(path.join(config.staticDir, 'index.html'), 'utf8')
      return c.html(html)
    } catch {
      return c.html(
        '<!doctype html><html lang="es"><meta charset="utf-8"><title>Deltos</title>' +
          '<body><h1>Deltos — API</h1><p>El frontend aún no está compilado (app/dist). La API responde en /api/* y /health.</p></body></html>'
      )
    }
  })

  // Envelope de errores único (skill api-stack): TODO 4xx/5xx sale por aquí.
  app.onError(onError)

  return app
}
