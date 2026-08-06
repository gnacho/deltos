// demo.test.js — modo demo: BD separada, seed determinista, toggle 403,
// sesión demo marcada con {demo:true}.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, loginDemo, loginUser, jsonReq } from './helpers.js'

describe('modo demo', () => {
  it('POST /api/auth/demo crea sesión demo y /me la marca con demo:true', async () => {
    const { app } = await makeInstance()
    const auth = await loginDemo(app)
    const me = await (await app.request('/api/auth/me', { headers: { cookie: auth.cookie } })).json()
    expect(me.demo).toBe(true)
    expect(me.user.username).toBe('demo')
  })

  it('el dataset demo está sembrado (mockup) y separado de producción', async () => {
    const { app } = await makeInstance()
    const demo = await loginDemo(app)
    const boot = await (await app.request('/api/bootstrap', { headers: { cookie: demo.cookie } })).json()

    expect(boot.users.map((u) => u.username).sort()).toEqual(['demo', 'jordi', 'mar'])
    expect(boot.projects.map((p) => p.name)).toEqual(['Casa', 'Trabajo', 'Viaje a Lisboa', 'Huerto'])
    expect(boot.labels.map((l) => l.name).sort()).toEqual(
      ['Admin', 'Compras', 'Dev', 'Diseño', 'Familia', 'Urgente'].sort()
    )
    expect(boot.tasks).toHaveLength(15)

    const cols = new Set(boot.tasks.map((t) => t.column))
    expect(cols).toEqual(new Set(['nuevo', 'encurso', 'hecho']))
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const dues = boot.tasks.map((t) => t.due_date)
    expect(dues).toContain(null)
    expect(dues).toContain(todayStr)
    expect(dues.some((d) => d && d < todayStr)).toBe(true)
    expect(dues.some((d) => d && d > todayStr)).toBe(true)

    const t2 = boot.tasks.find((t) => t.title === 'Revisar presupuesto reforma baño')
    expect(t2.counts.comments).toBeGreaterThanOrEqual(3)
    expect(t2.counts.attachments).toBe(2)
    expect(t2.labels.map((l) => l.name).sort()).toEqual(['Admin', 'Urgente'])
    const detail = await (
      await app.request(`/api/tasks/${t2.id}`, { headers: { cookie: demo.cookie } })
    ).json()
    expect(detail.task.description.length).toBeGreaterThan(50)
    expect(detail.activity.length).toBeGreaterThanOrEqual(5)
    expect(detail.activity.some((e) => e.type === 'moved' && e.data.from === 'nuevo')).toBe(true)

    const admin = await loginAdmin(app)
    const prodBoot = await (await app.request('/api/bootstrap', { headers: { cookie: admin.cookie } })).json()
    expect(prodBoot.tasks).toHaveLength(0)
    expect(prodBoot.projects).toHaveLength(0)
    expect(prodBoot.users).toHaveLength(1)
  })

  it('seed determinista: dos instancias frescas siembran el mismo dataset', async () => {
    const i1 = await makeInstance()
    const i2 = await makeInstance()
    const snap = (db) => ({
      tasks: db
        .prepare('SELECT id, project_id, title, "column", position, priority, due_date, assignee_id FROM tasks ORDER BY id')
        .all(),
      labels: db.prepare('SELECT id, name, color FROM labels ORDER BY id').all(),
      projects: db.prepare('SELECT id, name, emoji, color, position FROM projects ORDER BY id').all(),
      comments: db.prepare('SELECT task_id, user_id, body FROM comments ORDER BY id').all(),
      events: db.prepare('SELECT task_id, user_id, type, data FROM activity_events ORDER BY id').all(),
    })
    expect(snap(i1.demo)).toEqual(snap(i2.demo))
  })

  it('PUT /api/settings/demo lo desactiva y POST /api/auth/demo devuelve 403', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)

    const pub = await (await app.request('/api/settings/demo')).json()
    expect(pub.demo_enabled).toBe(true)

    const off = await app.request('/api/settings/demo', jsonReq(admin, 'PUT', '', { enabled: false }))
    expect(off.status).toBe(200)
    expect((await off.json()).demo_enabled).toBe(false)

    const denied = await app.request('/api/auth/demo', { method: 'POST' })
    expect(denied.status).toBe(403)
    expect((await denied.json()).error.code).toBe('AUTH_DEMO_DISABLED')

    const pub2 = await (await app.request('/api/settings/demo')).json()
    expect(pub2.demo_enabled).toBe(false)

    const on = await app.request('/api/settings/demo', jsonReq(admin, 'PUT', '', { enabled: true }))
    expect(on.status).toBe(200)
    const again = await app.request('/api/auth/demo', { method: 'POST' })
    expect(again.status).toBe(200)
  })

  it('un usuario no-admin no puede conmutar el modo demo', async () => {
    const { app } = await makeInstance()
    const admin = await loginAdmin(app)
    await app.request('/api/users', jsonReq(admin, 'POST', '/api/users', { username: 'pepe', password: 'pepe1234567' }))
    const pepe = await loginUser(app, 'pepe', 'pepe1234567')
    const res = await app.request('/api/settings/demo', jsonReq(pepe, 'PUT', '', { enabled: false }))
    expect(res.status).toBe(403)
  })

  it('las mutaciones en demo no tocan producción', async () => {
    const { app } = await makeInstance()
    const demo = await loginDemo(app)
    const boot = await (await app.request('/api/bootstrap', { headers: { cookie: demo.cookie } })).json()
    const created = await app.request(
      '/api/tasks',
      jsonReq(demo, 'POST', '/api/tasks', { project_id: boot.projects[0].id, title: 'Solo en demo' })
    )
    expect(created.status).toBe(201)

    const admin = await loginAdmin(app)
    const prodBoot = await (await app.request('/api/bootstrap', { headers: { cookie: admin.cookie } })).json()
    expect(prodBoot.tasks).toHaveLength(0)
  })
})
