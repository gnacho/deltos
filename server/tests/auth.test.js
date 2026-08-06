// auth.test.js — login ok/ko, rotación de sesión, rate-limit en SQLite,
// cambio de contraseña, perfil y registro.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, loginUser, jsonReq } from './helpers.js'

describe('auth', () => {
  it('login correcto devuelve cookie y /api/auth/me funciona', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    expect(auth.cookie).toMatch(/^deltos_session=.+\..+/)
    expect(auth.csrfToken).toBeTruthy()

    const me = await app.request('/api/auth/me', { headers: { cookie: auth.cookie } })
    expect(me.status).toBe(200)
    const body = await me.json()
    expect(body.user.username).toBe('admin')
    expect(body.user.role).toBe('admin')
    expect(body.demo).toBe(false)
    expect(body.user.password_hash).toBeUndefined()
    expect(body.csrfToken).toBe(auth.csrfToken)
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
    expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS')
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
    const blocked = await attempt('admin1234567')
    expect(blocked.status).toBe(429)
    const body = await blocked.json()
    expect(body.error.code).toBe('AUTH_RATE_LIMITED')
  })

  it('rota la sesión al hacer login de nuevo (la anterior muere)', async () => {
    const { app } = await makeInstance()
    const auth1 = await loginAdmin(app)
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: auth1.cookie },
      body: JSON.stringify({ username: 'admin', password: 'admin1234567' }),
    })
    expect(res.status).toBe(200)
    const cookie2 = res.headers.get('set-cookie').split(';')[0]
    expect(cookie2).not.toBe(auth1.cookie)
    const old = await app.request('/api/auth/me', { headers: { cookie: auth1.cookie } })
    expect(old.status).toBe(401)
    const current = await app.request('/api/auth/me', { headers: { cookie: cookie2 } })
    expect(current.status).toBe(200)
  })

  it('logout invalida la sesión', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const res = await app.request('/api/auth/logout', jsonReq(auth, 'POST', '/api/auth/logout'))
    expect(res.status).toBe(200)
    const me = await app.request('/api/auth/me', { headers: { cookie: auth.cookie } })
    expect(me.status).toBe(401)
  })

  it('PUT /api/auth/password exige la actual correcta y permite entrar con la nueva', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)

    const wrong = await app.request(
      '/api/auth/password',
      jsonReq(auth, 'PUT', '/api/auth/password', { current: 'no-es', next: 'nueva1234567' })
    )
    expect(wrong.status).toBe(400)
    expect((await wrong.json()).error.code).toBe('AUTH_WRONG_CURRENT_PASSWORD')

    const short = await app.request(
      '/api/auth/password',
      jsonReq(auth, 'PUT', '/api/auth/password', { current: 'admin1234567', next: '123' })
    )
    expect(short.status).toBe(422)
    expect((await short.json()).error.code).toBe('VALIDATION_FAILED')

    const ok = await app.request(
      '/api/auth/password',
      jsonReq(auth, 'PUT', '/api/auth/password', { current: 'admin1234567', next: 'nueva1234567' })
    )
    expect(ok.status).toBe(200)

    const relogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'nueva1234567' }),
    })
    expect(relogin.status).toBe(200)
  })

  it('PUT /api/auth/profile actualiza color/idioma', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const res = await app.request(
      '/api/auth/profile',
      jsonReq(auth, 'PUT', '/api/auth/profile', { color: 'teal', language: 'es' })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.color).toBe('teal')
    expect(body.user.language).toBe('es')
  })

  it('registro solo admin: 401 sin sesión, crea con rol user y rechaza duplicados', async () => {
    const { app } = await makeInstance()

    const anon = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'lucia', password: 'secreta12345' }),
    })
    expect(anon.status).toBe(401)

    const auth = await loginAdmin(app)
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: auth.cookie, 'x-csrf-token': auth.csrfToken },
      body: JSON.stringify({ username: 'lucia', password: 'secreta12345' }),
    })
    expect(res.status).toBe(201)
    expect((await res.json()).user.role).toBe('user')

    const dup = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: auth.cookie, 'x-csrf-token': auth.csrfToken },
      body: JSON.stringify({ username: 'lucia', password: 'secreta12345' }),
    })
    expect(dup.status).toBe(409)

    const short = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: auth.cookie, 'x-csrf-token': auth.csrfToken },
      body: JSON.stringify({ username: 'otro', password: '123' }),
    })
    expect(short.status).toBe(422)
  })

  it('admin puede crear usuarios por /api/users; un user normal no', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const created = await app.request(
      '/api/users',
      jsonReq(admin, 'POST', '/api/users', { username: 'pepe', password: 'pepe1234567', color: 'teal' })
    )
    expect(created.status).toBe(201)

    const pepeLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pepe', password: 'pepe1234567' }),
    })
    const pepeCookie = pepeLogin.headers.get('set-cookie').split(';')[0]
    const denied = await app.request('/api/users', { headers: { cookie: pepeCookie } })
    expect(denied.status).toBe(403)

    const list = await app.request('/api/users', { headers: { cookie: admin.cookie } })
    expect(list.status).toBe(200)
    const body = await list.json()
    expect(body.users.map((u) => u.username).sort()).toEqual(['admin', 'pepe'])
  })

  it('CSRF: mutación sin x-csrf-token → 403 CSRF_INVALID', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const noCsrf = await app.request('/api/projects', {
      method: 'POST',
      headers: { cookie: auth.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sin CSRF' }),
    })
    expect(noCsrf.status).toBe(403)
    expect((await noCsrf.json()).error.code).toBe('CSRF_INVALID')
  })

  it('CSRF: token incorrecto → 403 CSRF_INVALID', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const badCsrf = await app.request('/api/projects', {
      method: 'POST',
      headers: { cookie: auth.cookie, 'Content-Type': 'application/json', 'x-csrf-token': 'no-es-el-token' },
      body: JSON.stringify({ name: 'CSRF mal' }),
    })
    expect(badCsrf.status).toBe(403)
    expect((await badCsrf.json()).error.code).toBe('CSRF_INVALID')
  })

  it('CSRF: GET no requiere token', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const res = await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })
    expect(res.status).toBe(200)
  })

  it('cambiar contraseña invalida las demás sesiones del usuario (la actual sobrevive)', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    await app.request('/api/users', jsonReq(admin, 'POST', '/api/users', { username: 'pepe', password: 'pepe1234567' }))
    const pepe1 = await loginUser(app, 'pepe', 'pepe1234567')
    const pepe2 = await loginUser(app, 'pepe', 'pepe1234567')
    expect(pepe1.cookie).not.toBe(pepe2.cookie)
    const changed = await app.request('/api/auth/password', {
      method: 'PUT',
      headers: { cookie: pepe2.cookie, 'Content-Type': 'application/json', 'x-csrf-token': pepe2.csrfToken },
      body: JSON.stringify({ current: 'pepe1234567', next: 'nueva4567890' }),
    })
    expect(changed.status).toBe(200)
    const oldSession = await app.request('/api/auth/me', { headers: { cookie: pepe1.cookie } })
    expect(oldSession.status).toBe(401)
    const currentSession = await app.request('/api/auth/me', { headers: { cookie: pepe2.cookie } })
    expect(currentSession.status).toBe(200)
  })
})
