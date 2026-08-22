// subtasks.test.js — subtareas de tareas: CRUD, anidamiento y reset automático
// al crear la instancia recurrente siguiente.
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
  const taskRes = await inst.app.request(
    '/api/tasks',
    jsonReq(auth, 'POST', '/api/tasks', { project_id: project.id, title: 'Reforma' })
  )
  const task = (await taskRes.json()).task
  return { ...inst, auth, project, task }
}

describe('subtasks', () => {
  it('crear subtarea, marcarla hecha y borrarla', async () => {
    const { app, auth, task } = await setup()
    const created = await app.request(
      `/api/tasks/${task.id}/subtasks`,
      jsonReq(auth, 'POST', '', { title: 'Quitar papel' })
    )
    expect(created.status).toBe(201)
    const sub = (await created.json()).subtask
    expect(sub.done).toBe(0)

    const patched = await app.request(`/api/subtasks/${sub.id}`, jsonReq(auth, 'PATCH', '', { done: true }))
    expect(patched.status).toBe(200)
    expect((await patched.json()).subtask.done).toBe(1)

    const detail = await (await app.request(`/api/tasks/${task.id}`, { headers: { cookie: auth.cookie } })).json()
    expect(detail.subtasks).toHaveLength(1)
    expect(detail.subtasks[0].done).toBe(1)

    const del = await app.request(`/api/subtasks/${sub.id}`, jsonReq(auth, 'DELETE', ''))
    expect(del.status).toBe(204)
    const detail2 = await (await app.request(`/api/tasks/${task.id}`, { headers: { cookie: auth.cookie } })).json()
    expect(detail2.subtasks).toHaveLength(0)
  })

  it('anidamiento: subtarea hija con parent_id', async () => {
    const { app, auth, task } = await setup()
    const p1 = (await (await app.request(`/api/tasks/${task.id}/subtasks`, jsonReq(auth, 'POST', '', { title: 'Paso 1' }))).json()).subtask
    const p2 = (await (await app.request(`/api/tasks/${task.id}/subtasks`, jsonReq(auth, 'POST', '', { title: 'Paso 2', parent_id: p1.id }))).json()).subtask
    expect(p2.parent_id).toBe(p1.id)
  })

  it('subtasks no existente → 404 y parent de otra tarea → 404', async () => {
    const { app, auth, task } = await setup()
    const res = await app.request('/api/subtasks/inexistente', jsonReq(auth, 'PATCH', '', { done: true }))
    expect(res.status).toBe(404)
    const badParent = await app.request(
      `/api/tasks/${task.id}/subtasks`,
      jsonReq(auth, 'POST', '', { title: 'X', parent_id: 'otra-tarea-sub' })
    )
    expect(badParent.status).toBe(404)
  })

  it('reset automático: instancia recurrente copia subtareas con done=0', async () => {
    const { app, auth, project } = await setup()
    // creamos tarea recurrente con subtareas hechas
    const t = (await (await app.request('/api/tasks', jsonReq(auth, 'POST', '/api/tasks', {
      project_id: project.id,
      title: 'Piscina',
      recurrence: { freq: 'weekly', interval: 1, mode: 'due' },
    }))).json()).task
    const s1 = (await (await app.request(`/api/tasks/${t.id}/subtasks`, jsonReq(auth, 'POST', '', { title: 'Cloro' }))).json()).subtask
    const s2 = (await (await app.request(`/api/tasks/${t.id}/subtasks`, jsonReq(auth, 'POST', '', { title: 'Filtro', parent_id: s1.id }))).json()).subtask
    await app.request(`/api/subtasks/${s1.id}`, jsonReq(auth, 'PATCH', '', { done: true }))
    await app.request(`/api/subtasks/${s2.id}`, jsonReq(auth, 'PATCH', '', { done: true }))

    // completar → se crea la siguiente instancia
    await app.request(`/api/tasks/${t.id}/move`, jsonReq(auth, 'POST', '', { column: 'hecho', position: 0 }))

    const boot = await (await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })).json()
    const next = boot.tasks.find((x) => x.recurrence_group_id === t.id && x.column === 'nuevo')
    expect(next).toBeTruthy()
    const detail = await (await app.request(`/api/tasks/${next.id}`, { headers: { cookie: auth.cookie } })).json()
    expect(detail.subtasks).toHaveLength(2)
    expect(detail.subtasks.every((s) => s.done === 0)).toBe(true)
    // el anidamiento se preserva
    const parent = detail.subtasks.find((s) => s.parent_id !== null)
    const child = detail.subtasks.find((s) => s.id === parent?.parent_id)
    expect(child).toBeTruthy()
  })
})
