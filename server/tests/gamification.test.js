// gamification.test.js — concesión de puntos al completar tareas (base +
// bonus por prioridad, anti-farming 23 h, reversión al salir de hecho),
// recompensas y canjes, y el resumen (saldo, semana, racha).
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'

async function setup() {
  const inst = await makeInstance({ seedDemoData: false })
  const auth = await loginAdmin(inst.app)
  const proj = await inst.app.request(
    '/api/projects',
    jsonReq(auth, 'POST', '/api/projects', { name: 'Casa', emoji: '🏠', color: 'sky' })
  )
  const project = (await proj.json()).project
  return { ...inst, auth, project }
}

async function createTask(app, auth, project_id, title, extra = {}) {
  const res = await app.request(
    '/api/tasks',
    jsonReq(auth, 'POST', '/api/tasks', { project_id, title, ...extra })
  )
  expect(res.status).toBe(201)
  return (await res.json()).task
}

async function moveTask(app, auth, id, column, position = 0) {
  const res = await app.request(
    `/api/tasks/${id}/move`,
    jsonReq(auth, 'POST', `/api/tasks/${id}/move`, { column, position })
  )
  expect(res.status).toBe(200)
  return res
}

async function summary(app, auth) {
  const res = await app.request('/api/gamification/summary', { headers: { cookie: auth.cookie } })
  expect(res.status).toBe(200)
  return res.json()
}

describe('gamificación', () => {
  it('completar una tarea concede 5 + bonus por prioridad', async () => {
    const { app, auth, project } = await setup()
    const alta = await createTask(app, auth, project.id, 'Alta', { priority: 'alta' })
    const media = await createTask(app, auth, project.id, 'Media', { priority: 'media' })
    const baja = await createTask(app, auth, project.id, 'Baja', { priority: 'baja' })

    await moveTask(app, auth, alta.id, 'hecho')
    await moveTask(app, auth, media.id, 'hecho')
    await moveTask(app, auth, baja.id, 'hecho')

    const s = await summary(app, auth)
    expect(s.users).toHaveLength(1)
    const me = s.users[0]
    expect(me.balance).toBe(10 + 7 + 5)
    expect(me.week_points).toBe(22)
    expect(me.tasks_done_total).toBe(3)
    expect(me.streak_days).toBe(1)
    expect(s.recent).toHaveLength(3)
    expect(s.recent[0].task_title).toBe('Baja')
  })

  it('no concede puntos al reordenar dentro de hecho', async () => {
    const { app, auth, project } = await setup()
    const t = await createTask(app, auth, project.id, 'Tarea')
    await moveTask(app, auth, t.id, 'hecho')
    await moveTask(app, auth, t.id, 'hecho', 0) // reorden dentro de hecho

    const s = await summary(app, auth)
    expect(s.users[0].balance).toBe(5)
    expect(s.users[0].tasks_done_total).toBe(1)
  })

  it('revierte puntos al salir de hecho y los reactiva al volver', async () => {
    const { app, auth, project } = await setup()
    const t = await createTask(app, auth, project.id, 'Cíclica')

    await moveTask(app, auth, t.id, 'hecho')
    let s = await summary(app, auth)
    expect(s.users[0].balance).toBe(5)
    expect(s.users[0].tasks_done_total).toBe(1)

    await moveTask(app, auth, t.id, 'encurso')
    s = await summary(app, auth)
    expect(s.users[0].balance).toBe(0)
    expect(s.users[0].tasks_done_total).toBe(0)

    await moveTask(app, auth, t.id, 'hecho') // reactiva la entrada revertida
    s = await summary(app, auth)
    expect(s.users[0].balance).toBe(5)
    expect(s.users[0].tasks_done_total).toBe(1)
  })

  it('anti-farming: una tarea no crea una segunda entrada en 23 h', async () => {
    const { app, auth, prod, project } = await setup()
    const t = await createTask(app, auth, project.id, 'Una sola entrada')
    await moveTask(app, auth, t.id, 'hecho')
    await moveTask(app, auth, t.id, 'nuevo')
    await moveTask(app, auth, t.id, 'hecho') // reactiva, no inserta
    await moveTask(app, auth, t.id, 'nuevo')
    await moveTask(app, auth, t.id, 'hecho') // reactiva de nuevo

    const s = await summary(app, auth)
    expect(s.users[0].balance).toBe(5)

    // Solo debe haber una fila en el ledger para esta tarea.
    const rows = prod.prepare('SELECT COUNT(*) AS n FROM gam_points_ledger WHERE task_id = ?').get(t.id)
    expect(rows.n).toBe(1)
  })

  it('done-and-archive desde otra columna también concede puntos', async () => {
    const { app, auth, project } = await setup()
    const t = await createTask(app, auth, project.id, 'Recordatorio', { priority: 'alta' })
    const res = await app.request(
      `/api/tasks/${t.id}/done-and-archive`,
      jsonReq(auth, 'POST', `/api/tasks/${t.id}/done-and-archive`, {})
    )
    expect(res.status).toBe(200)

    const s = await summary(app, auth)
    expect(s.users[0].balance).toBe(10)
  })

  it('recompensas: crear, listar, desactivar y validación', async () => {
    const { app, auth } = await setup()
    const bad = await app.request(
      '/api/rewards',
      jsonReq(auth, 'POST', '/api/rewards', { title: '', cost: 0 })
    )
    expect(bad.status).toBe(422)

    const created = await app.request(
      '/api/rewards',
      jsonReq(auth, 'POST', '/api/rewards', { title: 'Cena a elegir', emoji: '🍕', cost: 30 })
    )
    expect(created.status).toBe(201)
    expect(created.headers.get('location')).toMatch(/^\/api\/rewards\//)
    const reward = (await created.json()).reward
    expect(reward.emoji).toBe('🍕')

    const list = await (await app.request('/api/rewards', { headers: { cookie: auth.cookie } })).json()
    expect(list.rewards).toHaveLength(1)

    const del = await app.request(`/api/rewards/${reward.id}`, jsonReq(auth, 'DELETE', `/api/rewards/${reward.id}`))
    expect(del.status).toBe(204)
    const list2 = await (await app.request('/api/rewards', { headers: { cookie: auth.cookie } })).json()
    expect(list2.rewards).toHaveLength(0)

    const delAgain = await app.request(`/api/rewards/${reward.id}`, jsonReq(auth, 'DELETE', `/api/rewards/${reward.id}`))
    expect(delAgain.status).toBe(404)
  })

  it('canje descuenta saldo y falla con saldo insuficiente', async () => {
    const { app, auth, project } = await setup()
    const t = await createTask(app, auth, project.id, 'Tarea', { priority: 'media' })
    await moveTask(app, auth, t.id, 'hecho') // 7 puntos

    const created = await app.request(
      '/api/rewards',
      jsonReq(auth, 'POST', '/api/rewards', { title: 'Café', cost: 5 })
    )
    const reward = (await created.json()).reward

    const redeem = await app.request(
      `/api/rewards/${reward.id}/redeem`,
      jsonReq(auth, 'POST', `/api/rewards/${reward.id}/redeem`, {})
    )
    expect(redeem.status).toBe(201)
    expect((await redeem.json()).balance).toBe(2)

    const again = await app.request(
      `/api/rewards/${reward.id}/redeem`,
      jsonReq(auth, 'POST', `/api/rewards/${reward.id}/redeem`, {})
    )
    expect(again.status).toBe(400)
    expect((await again.json()).error.code).toBe('INSUFFICIENT_POINTS')

    const s = await summary(app, auth)
    expect(s.users[0].balance).toBe(2)
    expect(s.users[0].week_points).toBe(7) // la semana cuenta lo ganado, no el saldo
    expect(s.redemptions).toHaveLength(1)
    expect(s.redemptions[0].reward_title).toBe('Café')
  })

  it('la racha cuenta días consecutivos terminando hoy/ayer', async () => {
    const { app, auth, prod, project } = await setup()
    const userId = prod.prepare('SELECT id FROM users WHERE username = ?').get('admin').id
    const task = await createTask(app, auth, project.id, 'Racha')
    const day = 24 * 60 * 60 * 1000
    const now = Date.now()
    const ins = prod.prepare(
      `INSERT INTO gam_points_ledger (id, user_id, task_id, points, reason, created_at, reverted_at)
       VALUES (?, ?, ?, 5, 'task_done', ?, NULL)`
    )
    ins.run('g1', userId, task.id, now - 2 * day)
    ins.run('g2', userId, task.id, now - day)
    ins.run('g3', userId, task.id, now)
    ins.run('g4', userId, task.id, now - 4 * day) // hueco: no suma

    const s = await summary(app, auth)
    expect(s.users[0].streak_days).toBe(3)
    expect(s.users[0].tasks_done_total).toBe(4)
  })

  it('no permite canjear puntos revertidos', async () => {
    const { app, auth, project } = await setup()
    const t = await createTask(app, auth, project.id, 'Tarea', { priority: 'alta' })
    await moveTask(app, auth, t.id, 'hecho') // 10 puntos
    await moveTask(app, auth, t.id, 'encurso') // se revierten

    const created = await app.request(
      '/api/rewards',
      jsonReq(auth, 'POST', '/api/rewards', { title: 'Caro', cost: 10 })
    )
    const reward = (await created.json()).reward

    const redeem = await app.request(
      `/api/rewards/${reward.id}/redeem`,
      jsonReq(auth, 'POST', `/api/rewards/${reward.id}/redeem`, {})
    )
    expect(redeem.status).toBe(400)
    expect((await redeem.json()).error.code).toBe('INSUFFICIENT_POINTS')
  })
})
