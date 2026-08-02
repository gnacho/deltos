// users.test.js — gestión de usuarios por admin: PATCH role/language/password + DELETE.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'

async function createUser(app, cookie, username = 'pepe', role = 'user') {
  const res = await app.request('/api/users', jsonReq(cookie, 'POST', '/api/users', {
    username, password: 'pepe123', role,
  }))
  expect(res.status).toBe(201)
  return (await res.json()).user
}

async function loginAs(app, username, password) {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (res.status !== 200) return null
  return res.headers.get('set-cookie').split(';')[0]
}

describe('users admin', () => {
  it('admin cambia el rol de otro usuario', async () => {
    const { app } = await makeInstance()
    const cookie = await loginAdmin(app)
    const u = await createUser(app, cookie)
    const res = await app.request(`/api/users/${u.id}/role`, jsonReq(cookie, 'PUT', `/api/users/${u.id}/role`, { role: 'admin' }))
    expect(res.status).toBe(200)
    expect((await res.json()).user.role).toBe('admin')
  })

  it('un no-admin recibe 403 en PATCH y DELETE', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const u = await createUser(app, admin)
    const pepe = await loginAs(app, 'pepe', 'pepe123')
    const r1 = await app.request(`/api/users/${u.id}/role`, jsonReq(pepe, 'PUT', `/api/users/${u.id}/role`, { role: 'admin' }))
    expect(r1.status).toBe(403)
    const r2 = await app.request(`/api/users/${u.id}`, jsonReq(pepe, 'DELETE', `/api/users/${u.id}`))
    expect(r2.status).toBe(403)
  })

  it('no puedes cambiar tu propio rol', async () => {
    const { app, prod } = await makeInstance()
    const cookie = await loginAdmin(app)
    const me = prod.prepare('SELECT id FROM users WHERE username = ?').get('admin')
    const res = await app.request(`/api/users/${me.id}/role`, jsonReq(cookie, 'PUT', `/api/users/${me.id}/role`, { role: 'user' }))
    expect(res.status).toBe(400)
  })

  it('un admin no puede quedar como último admin degradado: auto-cambio bloqueado antes', async () => {
    // Con un solo admin, las reglas auto-* (rol/borrado) impiden llegar al
    // escenario "último admin" vía API; la guarda de countAdmins es defensa
    // en profundidad. Aquí comprobamos que el auto-borrado se rechaza.
    const { app, prod } = await makeInstance()
    const cookie = await loginAdmin(app)
    const me = prod.prepare('SELECT id FROM users WHERE username = ?').get('admin')
    const res = await app.request(`/api/users/${me.id}`, jsonReq(cookie, 'DELETE', `/api/users/${me.id}`))
    expect(res.status).toBe(400)
  })

  it('borrar usuario elimina sus sesiones', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const u = await createUser(app, admin)
    const pepe = await loginAs(app, 'pepe', 'pepe123')
    expect(pepe).toBeTruthy()
    const res = await app.request(`/api/users/${u.id}`, jsonReq(admin, 'DELETE', `/api/users/${u.id}`))
    expect(res.status).toBe(204)
    const meRes = await app.request('/api/auth/me', { headers: { cookie: pepe } })
    expect(meRes.status).toBe(401)
  })

  it('no puedes eliminarte a ti mismo', async () => {
    const { app, prod } = await makeInstance()
    const cookie = await loginAdmin(app)
    const me = prod.prepare('SELECT id FROM users WHERE username = ?').get('admin')
    const res = await app.request(`/api/users/${me.id}`, jsonReq(cookie, 'DELETE', `/api/users/${me.id}`))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('USER_SELF_DELETE')
  })

  it('reset de contraseña destruye sesiones y permite entrar con la nueva', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const u = await createUser(app, admin)
    const pepe = await loginAs(app, 'pepe', 'pepe123')
    const res = await app.request(`/api/users/${u.id}/password`, jsonReq(admin, 'PUT', `/api/users/${u.id}/password`, { password: 'nueva-pass-1' }))
    expect(res.status).toBe(200)
    const meRes = await app.request('/api/auth/me', { headers: { cookie: pepe } })
    expect(meRes.status).toBe(401)
    expect(await loginAs(app, 'pepe', 'pepe123')).toBeNull()
    expect(await loginAs(app, 'pepe', 'nueva-pass-1')).toBeTruthy()
  })

  it('admin cambia el idioma de otro usuario', async () => {
    const { app } = await makeInstance()
    const cookie = await loginAdmin(app)
    const u = await createUser(app, cookie)
    const res = await app.request(`/api/users/${u.id}/language`, jsonReq(cookie, 'PUT', `/api/users/${u.id}/language`, { language: 'en' }))
    expect(res.status).toBe(200)
    expect((await res.json()).user.language).toBe('en')
  })

  it('degradar al último admin estando otro admin presente sí funciona', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const u2 = await createUser(app, admin, 'segundo', 'admin')
    const res = await app.request(`/api/users/${u2.id}/role`, jsonReq(admin, 'PUT', `/api/users/${u2.id}/role`, { role: 'user' }))
    expect(res.status).toBe(200) // queda admin (bootstrap) → permitido
  })
})
