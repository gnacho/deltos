// audit.test.js — audit log de acciones admin: registro y consulta.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq, loginUser } from './helpers.js'

describe('audit log admin', () => {
  it('GET /api/admin/audit → 403 sin admin, 200 con admin', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    await app.request('/api/users', jsonReq(auth, 'POST', '/api/users', { username: 'pepe', password: 'pepe1234567' }))
    const pepe = await loginUser(app, 'pepe', 'pepe1234567')
    const denied = await app.request('/api/admin/audit', { headers: { cookie: pepe.cookie } })
    expect(denied.status).toBe(403)
    const ok = await app.request('/api/admin/audit', { headers: { cookie: auth.cookie } })
    expect(ok.status).toBe(200)
  })

  it('crear usuario registra user_created en el audit log', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    await app.request('/api/users', jsonReq(auth, 'POST', '/api/users', { username: 'maria', password: 'maria1234567' }))
    const res = await app.request('/api/admin/audit', { headers: { cookie: auth.cookie } })
    const body = await res.json()
    const entry = body.items.find((i) => i.action === 'user_created')
    expect(entry).toBeTruthy()
    expect(entry.data.username).toBe('maria')
    expect(entry.actor_username).toBe('admin')
  })

  it('borrar usuario registra user_deleted', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const created = await app.request('/api/users', jsonReq(auth, 'POST', '/api/users', { username: 'temp', password: 'temp1234567' }))
    const userId = (await created.json()).user.id
    await app.request(`/api/users/${userId}`, jsonReq(auth, 'DELETE', ''))
    const res = await app.request('/api/admin/audit', { headers: { cookie: auth.cookie } })
    const body = await res.json()
    const entry = body.items.find((i) => i.action === 'user_deleted')
    expect(entry).toBeTruthy()
    expect(entry.data.username).toBe('temp')
  })

  it('cambiar rol registra user_role_changed con from/to', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const created = await app.request('/api/users', jsonReq(auth, 'POST', '/api/users', { username: 'role-test', password: 'role1234567' }))
    const userId = (await created.json()).user.id
    await app.request(`/api/users/${userId}/role`, jsonReq(auth, 'PUT', `/api/users/${userId}/role`, { role: 'admin' }))
    const res = await app.request('/api/admin/audit', { headers: { cookie: auth.cookie } })
    const body = await res.json()
    const entry = body.items.find((i) => i.action === 'user_role_changed')
    expect(entry).toBeTruthy()
    expect(entry.data.from).toBe('user')
    expect(entry.data.to).toBe('admin')
  })

  it('reset password registra user_password_reset', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const created = await app.request('/api/users', jsonReq(auth, 'POST', '/api/users', { username: 'resetpw', password: 'old1234567' }))
    const userId = (await created.json()).user.id
    await app.request(`/api/users/${userId}/password`, jsonReq(auth, 'PUT', `/api/users/${userId}/password`, { password: 'new4567890' }))
    const res = await app.request('/api/admin/audit', { headers: { cookie: auth.cookie } })
    const body = await res.json()
    const entry = body.items.find((i) => i.action === 'user_password_reset')
    expect(entry).toBeTruthy()
    expect(entry.target_id).toBe(userId)
  })

  it('cambiar ajustes del servidor registra server_settings_changed', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    await app.request('/api/settings/server', jsonReq(auth, 'PUT', '/api/settings/server', {
      backup_enabled: false,
      backup_retention_days: 14,
      max_attachments_per_task: 10,
      plugin_expenses_enabled: false,
    }))
    const res = await app.request('/api/admin/audit', { headers: { cookie: auth.cookie } })
    const body = await res.json()
    const entry = body.items.find((i) => i.action === 'server_settings_changed')
    expect(entry).toBeTruthy()
    expect(entry.data.backup_retention_days).toBe(14)
  })

  it('audit log paginado con cursor keyset', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    for (let i = 0; i < 5; i++) {
      await app.request('/api/users', jsonReq(auth, 'POST', '/api/users', { username: `u${i}`, password: 'pass1234567' }))
    }
    const page1 = await (await app.request('/api/admin/audit?limit=2', { headers: { cookie: auth.cookie } })).json()
    expect(page1.items).toHaveLength(2)
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).toBeTruthy()
    const page2 = await (await app.request(`/api/admin/audit?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`, { headers: { cookie: auth.cookie } })).json()
    expect(page2.items).toHaveLength(2)
    const ids1 = page1.items.map((i) => i.id)
    const ids2 = page2.items.map((i) => i.id)
    expect(new Set([...ids1, ...ids2]).size).toBe(4)
  })
})
