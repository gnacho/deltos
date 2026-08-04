// users.test.js — gestión de usuarios por admin: PATCH role/language/password + DELETE.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, loginUser, jsonReq } from './helpers.js'

async function createUser(app, auth, username = 'pepe', role = 'user') {
  const res = await app.request('/api/users', jsonReq(auth, 'POST', '/api/users', {
    username, password: 'pepe123', role,
  }))
  expect(res.status).toBe(201)
  return (await res.json()).user
}

describe('users admin', () => {
  it('admin cambia el rol de otro usuario', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const u = await createUser(app, admin)
    const res = await app.request(`/api/users/${u.id}/role`, jsonReq(admin, 'PUT', `/api/users/${u.id}/role`, { role: 'admin' }))
    expect(res.status).toBe(200)
    expect((await res.json()).user.role).toBe('admin')
  })

  it('un no-admin recibe 403 en PATCH y DELETE', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const u = await createUser(app, admin)
    const pepe = await loginUser(app, 'pepe', 'pepe123')
    const patch = await app.request(`/api/users/${u.id}/role`, jsonReq(pepe, 'PUT', `/api/users/${u.id}/role`, { role: 'admin' }))
    expect(patch.status).toBe(403)
    const del = await app.request(`/api/users/${u.id}`, jsonReq(pepe, 'DELETE', ''))
    expect(del.status).toBe(403)
  })

  it('no puedes cambiar tu propio rol', async () => {
    const { app, prod } = await makeInstance()
    const admin = await loginAdmin(app)
    const me = prod.prepare('SELECT id FROM users WHERE username = ?').get('admin')
    const res = await app.request(`/api/users/${me.id}/role`, jsonReq(admin, 'PUT', `/api/users/${me.id}/role`, { role: 'user' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('USER_SELF_ROLE')
  })

  it('un admin no puede quedar como último admin degradado: auto-cambio bloqueado antes', async () => {
    const { app, prod } = await makeInstance()
    const admin = await loginAdmin(app)
    const me = prod.prepare('SELECT id FROM users WHERE username = ?').get('admin')
    const res = await app.request(`/api/users/${me.id}/role`, jsonReq(admin, 'PUT', `/api/users/${me.id}/role`, { role: 'user' }))
    expect(res.status).toBe(400)
  })

  it('borrar usuario elimina sus sesiones', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const u = await createUser(app, admin)
    const pepe = await loginUser(app, 'pepe', 'pepe123')
    expect(pepe).toBeTruthy()
    const res = await app.request(`/api/users/${u.id}`, jsonReq(admin, 'DELETE', `/api/users/${u.id}`))
    expect(res.status).toBe(204)
    const meRes = await app.request('/api/auth/me', { headers: { cookie: pepe.cookie } })
    expect(meRes.status).toBe(401)
  })

  it('no puedes eliminarte a ti mismo', async () => {
    const { app, prod } = await makeInstance()
    const admin = await loginAdmin(app)
    const me = prod.prepare('SELECT id FROM users WHERE username = ?').get('admin')
    const res = await app.request(`/api/users/${me.id}`, jsonReq(admin, 'DELETE', `/api/users/${me.id}`))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('USER_SELF_DELETE')
  })

  it('reset de contraseña destruye sesiones y permite entrar con la nueva', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const u = await createUser(app, admin)
    const pepe = await loginUser(app, 'pepe', 'pepe123')
    const res = await app.request(`/api/users/${u.id}/password`, jsonReq(admin, 'PUT', `/api/users/${u.id}/password`, { password: 'nueva-pass-1' }))
    expect(res.status).toBe(200)
    const meRes = await app.request('/api/auth/me', { headers: { cookie: pepe.cookie } })
    expect(meRes.status).toBe(401)
    expect(await loginUser(app, 'pepe', 'pepe123')).toBeNull()
    expect(await loginUser(app, 'pepe', 'nueva-pass-1')).toBeTruthy()
  })

  it('admin cambia el idioma de otro usuario', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const u = await createUser(app, admin)
    const res = await app.request(`/api/users/${u.id}/language`, jsonReq(admin, 'PUT', `/api/users/${u.id}/language`, { language: 'en' }))
    expect(res.status).toBe(200)
    expect((await res.json()).user.language).toBe('en')
  })

  it('degradar al último admin estando otro admin presente sí funciona', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    const u2 = await createUser(app, admin, 'segundo', 'admin')
    const res = await app.request(`/api/users/${u2.id}/role`, jsonReq(admin, 'PUT', `/api/users/${u2.id}/role`, { role: 'user' }))
    expect(res.status).toBe(200)
  })
})
