// auth.test.js — login ok/ko, rotación de sesión, rate-limit en SQLite,
// cambio de contraseña, perfil y registro.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'

describe('auth', () => {
  it('login correcto devuelve cookie y /api/auth/me funciona', async () => {
    const { app } = await makeInstance()
    const cookie = await loginAdmin(app)
    expect(cookie).toMatch(/^deltos_session=.+\..+/)

    const me = await app.request('/api/auth/me', { headers: { cookie } })
    expect(me.status).toBe(200)
    const body = await me.json()
    expect(body.user.username).toBe('admin')
    expect(body.user.role).toBe('admin')
    expect(body.demo).toBe(false)
    expect(body.user.password_hash).toBeUndefined()
  })

  it('login incorrecto devuelve 401', async () => {
    const { app } = await makeInstance()
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'mal' }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('credenciales')
  })

  it('sin sesión las rutas /api devuelven 401', async () => {
    const { app } = await makeInstance()
    const res = await app.request('/api/bootstrap')
    expect(res.status).toBe(401)
  })

  it('rate-limit: tras 5 fallos bloquea con 429 aunque la contraseña sea buena', async () => {
    const { app } = await makeInstance()
    const attempt = (password) =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password }),
      })
    for (let i = 0; i < 5; i++) {
      expect((await attempt('mal')).status).toBe(401)
    }
    // 6.º intento: bloqueado, incluso con la contraseña correcta
    const blocked = await attempt('admin123')
    expect(blocked.status).toBe(429)
    const body = await blocked.json()
    expect(body.error).toContain('demasiados intentos')
  })

  it('rota la sesión al hacer login de nuevo (la anterior muere)', async () => {
    const { app } = await makeInstance()
    const cookie1 = await loginAdmin(app)
    // el segundo login envía la cookie previa (como haría el navegador):
    // el servidor debe destruir esa sesión (anti session fixation)
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookie1 },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })
    expect(res.status).toBe(200)
    const cookie2 = res.headers.get('set-cookie').split(';')[0]
    expect(cookie2).not.toBe(cookie1)
    const old = await app.request('/api/auth/me', { headers: { cookie: cookie1 } })
    expect(old.status).toBe(401)
    const current = await app.request('/api/auth/me', { headers: { cookie: cookie2 } })
    expect(current.status).toBe(200)
  })

  it('logout invalida la sesión', async () => {
    const { app } = await makeInstance()
    const cookie = await loginAdmin(app)
    const res = await app.request('/api/auth/logout', jsonReq(cookie, 'POST', '/api/auth/logout'))
    expect(res.status).toBe(200)
    const me = await app.request('/api/auth/me', { headers: { cookie } })
    expect(me.status).toBe(401)
  })

  it('PUT /api/auth/password exige la actual correcta y permite entrar con la nueva', async () => {
    const { app } = await makeInstance()
    const cookie = await loginAdmin(app)

    const wrong = await app.request(
      '/api/auth/password',
      jsonReq(cookie, 'PUT', '/api/auth/password', { current: 'no-es', next: 'nueva123' })
    )
    expect(wrong.status).toBe(400)
    expect((await wrong.json()).error).toContain('actual')

    const short = await app.request(
      '/api/auth/password',
      jsonReq(cookie, 'PUT', '/api/auth/password', { current: 'admin123', next: '123' })
    )
    expect(short.status).toBe(400)

    const ok = await app.request(
      '/api/auth/password',
      jsonReq(cookie, 'PUT', '/api/auth/password', { current: 'admin123', next: 'nueva123' })
    )
    expect(ok.status).toBe(200)

    const relogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'nueva123' }),
    })
    expect(relogin.status).toBe(200)
  })

  it('PUT /api/auth/profile actualiza color/idioma', async () => {
    const { app } = await makeInstance()
    const cookie = await loginAdmin(app)
    const res = await app.request(
      '/api/auth/profile',
      jsonReq(cookie, 'PUT', '/api/auth/profile', { color: 'teal', language: 'es' })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.color).toBe('teal')
    expect(body.user.language).toBe('es')
  })

  it('registro solo admin: 401 sin sesión, crea con rol user y rechaza duplicados', async () => {
    const { app } = await makeInstance()

    // Sin sesión: 401 (antes era registro público)
    const anon = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'lucia', password: 'secreta1' }),
    })
    expect(anon.status).toBe(401)

    const cookie = await loginAdmin(app)
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ username: 'lucia', password: 'secreta1' }),
    })
    expect(res.status).toBe(201)
    expect((await res.json()).user.role).toBe('user')

    const dup = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ username: 'lucia', password: 'secreta1' }),
    })
    expect(dup.status).toBe(409)

    const short = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ username: 'otro', password: '123' }),
    })
    expect(short.status).toBe(400)
  })

  it('admin puede crear usuarios por /api/users; un user normal no', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const created = await app.request(
      '/api/users',
      jsonReq(admin, 'POST', '/api/users', { username: 'pepe', password: 'pepe123', color: 'teal' })
    )
    expect(created.status).toBe(201)

    const pepeLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pepe', password: 'pepe123' }),
    })
    const pepeCookie = pepeLogin.headers.get('set-cookie').split(';')[0]
    const denied = await app.request('/api/users', { headers: { cookie: pepeCookie } })
    expect(denied.status).toBe(403)

    const list = await app.request('/api/users', { headers: { cookie: admin } })
    expect(list.status).toBe(200)
    const body = await list.json()
    expect(body.users.map((u) => u.username).sort()).toEqual(['admin', 'pepe'])
  })
})
