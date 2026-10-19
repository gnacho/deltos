// anti-slip.test.js — contador de aplazamientos y "la hago hoy" (issue #255).
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq, loginUser } from './helpers.js'

async function setup() {
  const { app } = await makeInstance()
  const auth = await loginAdmin(app)
  const projRes = await app.request(
    '/api/projects',
    jsonReq(auth, 'POST', '/api/projects', { name: 'Anti-slip', emoji: '', color: 'sky' }),
  )
  const project = (await projRes.json()).project
  return { app, auth, project }
}

async function mkTask(app, auth, project, title) {
  const res = await app.request(
    '/api/tasks',
    jsonReq(auth, 'POST', '/api/tasks', { project_id: project.id, title }),
  )
  expect(res.status).toBe(201)
  return (await res.json()).task
}

async function patchDue(app, auth, task, due) {
  const res = await app.request(
    `/api/tasks/${task.id}`,
    jsonReq(auth, 'PATCH', `/api/tasks/${task.id}`, { due_date: due }),
  )
  expect(res.status).toBe(200)
  return (await res.json()).task
}

async function doToday(app, auth, task) {
  const res = await app.request(
    `/api/tasks/${task.id}/do-today`,
    jsonReq(auth, 'POST', `/api/tasks/${task.id}/do-today`, {}),
  )
  expect(res.status).toBe(200)
  return (await res.json()).task
}

async function move(app, auth, task, column) {
  const res = await app.request(
    `/api/tasks/${task.id}/move`,
    jsonReq(auth, 'POST', `/api/tasks/${task.id}/move`, { column, position: 0 }),
  )
  expect(res.status).toBe(200)
  return res
}

async function slipsOf(app, auth, task) {
  const res = await app.request(`/api/tasks/${task.id}`, {
    headers: { cookie: auth.cookie },
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  return body.task.slips
}

describe('contador de aplazamientos', () => {
  it('cuenta cambios de due sin completar y se expone como slips', async () => {
    const { app, auth, project } = await setup()
    const task = await mkTask(app, auth, project, 'Arrastrada')
    expect(await slipsOf(app, auth, task)).toBe(0)
    await patchDue(app, auth, task, '2026-10-01')
    await patchDue(app, auth, task, '2026-10-05')
    await patchDue(app, auth, task, '2026-10-09')
    expect(await slipsOf(app, auth, task)).toBe(3)
  })

  it('no cuenta el valor inicial: el primer due fijado es el desliz 1', async () => {
    const { app, auth, project } = await setup()
    const task = await mkTask(app, auth, project, 'Primera fijación')
    await patchDue(app, auth, task, '2026-10-01')
    expect(await slipsOf(app, auth, task)).toBe(1)
  })

  it('completar la tarea reinicia la línea base', async () => {
    const { app, auth, project } = await setup()
    const task = await mkTask(app, auth, project, 'Reinicio por hecho')
    await patchDue(app, auth, task, '2026-10-01')
    await patchDue(app, auth, task, '2026-10-05')
    expect(await slipsOf(app, auth, task)).toBe(2)
    await move(app, auth, task, 'hecho')
    expect(await slipsOf(app, auth, task)).toBe(0)
    // De vuelta a abierta: un nuevo desliz cuenta desde cero
    await move(app, auth, task, 'nuevo')
    await patchDue(app, auth, task, '2026-10-20')
    expect(await slipsOf(app, auth, task)).toBe(1)
  })

  it('do-today fija due a hoy y reinicia el contador', async () => {
    const { app, auth, project } = await setup()
    const task = await mkTask(app, auth, project, 'La hago hoy')
    await patchDue(app, auth, task, '2026-10-01')
    await patchDue(app, auth, task, '2026-10-05')
    await patchDue(app, auth, task, '2026-10-09')
    expect(await slipsOf(app, auth, task)).toBe(3)
    const updated = await doToday(app, auth, task)
    expect(updated.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(await slipsOf(app, auth, task)).toBe(0)
    // Un aplazamiento posterior cuenta desde el reset
    await patchDue(app, auth, task, '2026-11-01')
    expect(await slipsOf(app, auth, task)).toBe(1)
  })

  it('rechaza do-today en tarea de proyecto sin membresía (403)', async () => {
    const { app, auth, project } = await setup()
    const task = await mkTask(app, auth, project, 'Privada')
    const create = await app.request(
      '/api/users',
      jsonReq(auth, 'POST', '/api/users', { username: 'extrano', password: 'otraclave123', role: 'user' }),
    )
    expect(create.status).toBe(201)
    const stranger = await loginUser(app, 'extrano', 'otraclave123')
    const res = await app.request(
      `/api/tasks/${task.id}/do-today`,
      jsonReq(stranger, 'POST', `/api/tasks/${task.id}/do-today`, {}),
    )
    expect(res.status).toBe(403)
  })
})

describe('umbral anti-procrastination en el perfil', () => {
  it('expone anti_slip_threshold por defecto 3 y admite 0-10', async () => {
    const { app, auth } = await setup()
    const me = await app.request('/api/auth/me', { headers: { cookie: auth.cookie } })
    expect((await me.json()).user.anti_slip_threshold).toBe(3)

    const put = await app.request(
      '/api/auth/profile',
      jsonReq(auth, 'PUT', '/api/auth/profile', { anti_slip_threshold: 5 }),
    )
    expect(put.status).toBe(200)
    expect((await put.json()).user.anti_slip_threshold).toBe(5)

    const bad = await app.request(
      '/api/auth/profile',
      jsonReq(auth, 'PUT', '/api/auth/profile', { anti_slip_threshold: 11 }),
    )
    expect(bad.status).toBe(422)
  })
})
