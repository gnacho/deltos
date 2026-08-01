// app.js — fábrica de la app Hono: headers de seguridad, auth, rutas, SSE,
// estáticos y SPA fallback. Exportada para tests (sin listen).
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { streamSSE } from 'hono/streaming'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import * as auth from './auth.js'
import { kvGet } from './db.js'
import { registerDomainRoutes } from './routes-domain.js'
import { registerHealth } from './health.js'

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

async function parseJson(c, schema) {
  const body = await c.req.json().catch(() => null)
  if (body === null || typeof body !== 'object') return { error: 'cuerpo JSON inválido' }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { error: first ? `${first.path.join('.')}: ${first.message}` : 'formato inválido' }
  }
  return { data: parsed.data }
}

// ctx: { prod, demo, secret, config: { cookieSecure, maxSseClients, maxUploadBytes, staticDir }, hub, uploadsDir }
export function createApp(ctx) {
  const { prod, demo, secret, config, hub } = ctx
  const app = new Hono()

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
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
    )
    await next()
  })

  // --- Límite de tamaño de petición (adjuntos ≤ 10 MB + margen multipart) ---
  app.use('/api/*', async (c, next) => {
    const len = parseInt(c.req.header('content-length') || '0', 10)
    if (len > config.maxUploadBytes + 1024 * 1024) {
      return c.json({ error: 'petición demasiado grande' }, 413)
    }
    c.set('maxUploadBytes', config.maxUploadBytes)
    await next()
  })

  // --- Auth: todo /api/* requiere sesión salvo login/register/demo/logout ---
  app.use('/api/*', auth.requireAuth({ prod, demo, secret }))

  const cookieOpts = { secure: config.cookieSecure }

  // --- Autenticación ---
  // Alta de usuarios: solo admin (registro público eliminado, regla base común)
  app.post('/api/auth/register', async (c) => {
    const denied = auth.requireAdmin(c)
    if (denied) return denied
    const { data, error } = await parseJson(c, registerSchema)
    if (error) return c.json({ error }, 400)
    const user = await auth.registerUser(prod, data.username, data.password, {
      color: data.color,
      language: data.language,
    })
    if (!user) return c.json({ error: 'usuario ya existe' }, 409)
    hub.broadcast('users')
    return c.json({ ok: true, user }, 201)
  })

  app.post('/api/auth/login', async (c) => {
    if (auth.loginRateLimited(prod, c)) {
      return c.json({ error: 'demasiados intentos, espera 5 minutos' }, 429)
    }
    const { data, error } = await parseJson(c, loginSchema)
    if (error) return c.json({ error }, 400)
    const user = await auth.verifyLogin(prod, data.username, data.password)
    if (!user) {
      auth.registerLoginFail(prod, c)
      return c.json({ error: 'credenciales incorrectas' }, 401)
    }
    auth.loginOk(prod, c)
    // Rotación de sesión tras login exitoso (previene session fixation)
    const previous = auth.resolveSession({ prod, demo, secret }, c.req.header('cookie'))
    if (previous) auth.destroySession(previous.db, previous.sessionId)
    const sessionId = auth.createSession(prod, user.id, c.req.header('user-agent'))
    c.header('Set-Cookie', auth.cookieFor(secret, sessionId, cookieOpts))
    return c.json({ user, demo: false })
  })

  // Modo demo: un clic, sin contraseña. 403 si está desactivado en Ajustes.
  app.post('/api/auth/demo', (c) => {
    if (kvGet(prod, 'demo_enabled', '1') !== '1') {
      return c.json({ error: 'el modo demo está desactivado' }, 403)
    }
    const user = demo
      .prepare('SELECT id, username, email, phone, color, language, role, created_at FROM users WHERE username = ?')
      .get('demo')
    if (!user) return c.json({ error: 'modo demo no disponible' }, 503)
    const previous = auth.resolveSession({ prod, demo, secret }, c.req.header('cookie'))
    if (previous) auth.destroySession(previous.db, previous.sessionId)
    const sessionId = auth.createSession(demo, user.id, c.req.header('user-agent'))
    c.header('Set-Cookie', auth.cookieFor(secret, sessionId, cookieOpts))
    return c.json({ user, demo: true })
  })

  app.post('/api/auth/logout', (c) => {
    const session = auth.resolveSession({ prod, demo, secret }, c.req.header('cookie'))
    if (session) auth.destroySession(session.db, session.sessionId)
    c.header('Set-Cookie', auth.clearCookie(cookieOpts))
    return c.json({ ok: true })
  })

  // GET /api/auth/me — devuelve user + {demo:true} si la sesión es de la BD demo
  app.get('/api/auth/me', (c) => {
    return c.json({ user: c.get('user'), demo: c.get('demo') })
  })

  app.put('/api/auth/profile', async (c) => {
    const { data, error } = await parseJson(c, profileSchema)
    if (error) return c.json({ error }, 400)
    const updated = auth.updateUser(c.get('db'), c.get('user').id, data)
    if (!updated) return c.json({ error: 'no se pudo actualizar' }, 400)
    hub.broadcast('users')
    return c.json({ ok: true, user: updated })
  })

  // Cambio de contraseña: verifica la actual con bcrypt antes de re-hashear
  app.put('/api/auth/password', async (c) => {
    const { data, error } = await parseJson(c, passwordSchema)
    if (error) return c.json({ error }, 400)
    const result = await auth.changePassword(c.get('db'), c.get('user').id, data.current, data.next)
    if (result === 'wrong-current') return c.json({ error: 'la contraseña actual es incorrecta' }, 400)
    if (result !== 'ok') return c.json({ error: 'no se pudo cambiar la contraseña' }, 500)
    return c.json({ ok: true })
  })

  // --- SSE: un evento 'changed' tras cada mutación; heartbeat 25 s; máx N clientes ---
  app.get('/api/events', (c) => {
    if (hub.size() >= hub.maxClients) {
      return c.json({ error: 'demasiados clientes SSE' }, 429)
    }
    c.header('X-Accel-Buffering', 'no') // imprescindible detrás de nginx
    c.header('Cache-Control', 'no-cache')
    return streamSSE(c, async (stream) => {
      hub.add(stream)
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ ok: true }) })
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {})
      }, 25000)
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

  // --- Dominio + health ---
  registerDomainRoutes(app, { hub, uploadsDir: ctx.uploadsDir, prod })
  registerHealth(app, { prod, demo })

  // --- Estáticos + SPA fallback (excluyendo /api/* y /assets/*) ---
  // Sin onNotFound (la firma no es la del contexto Hono → 500 en assets).
  app.use('/*', serveStatic({ root: config.staticDir }))
  app.get('*', (c) => {
    const p = c.req.path
    if (p.startsWith('/api/') || p.startsWith('/assets/')) {
      return c.json({ error: 'no encontrado' }, 404)
    }
    // index.html se lee EN CADA PETICIÓN (deploy por rsync sin restart)
    try {
      const html = fs.readFileSync(path.join(config.staticDir, 'index.html'), 'utf8')
      return c.html(html)
    } catch {
      return c.html(
        '<!doctype html><html lang="es"><meta charset="utf-8"><title>Nido</title>' +
          '<body><h1>Nido — API</h1><p>El frontend aún no está compilado (app/dist). La API responde en /api/* y /health.</p></body></html>'
      )
    }
  })

  app.onError((err, c) => {
    console.error('[app] error no controlado:', err)
    return c.json({ error: 'error interno' }, 500)
  })

  return app
}
