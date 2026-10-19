// trash.test.js — papelera: soft-delete, restore, borrado permanente, purge.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'

describe('papelera', () => {
  it('borrar tarea la mueve a la papelera (no la elimina)', async () => {
    const { app, prod } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    const project = (await (await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'P' }))).json()).project
    const task = (await (await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'T' }))).json()).task
    const del = await app.request(`/api/tasks/${task.id}`, jsonReq(auth, 'DELETE', ''))
    expect(del.status).toBe(204)
    const row = prod.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get(task.id)
    expect(row.deleted_at).toBeTruthy()
    const trash = await (await app.request('/api/trash', { headers: { cookie: auth.cookie } })).json()
    expect(trash.tasks).toHaveLength(1)
    expect(trash.tasks[0].id).toBe(task.id)
  })

  it('la tarea borrada no aparece en bootstrap ni en activity', async () => {
    const { app } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    const project = (await (await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'P' }))).json()).project
    const task = (await (await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'T' }))).json()).task
    await app.request(`/api/tasks/${task.id}`, jsonReq(auth, 'DELETE', ''))
    const boot = await (await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })).json()
    expect(boot.tasks).toHaveLength(0)
    const activity = await (await app.request('/api/activity', { headers: { cookie: auth.cookie } })).json()
    expect(activity.items).toHaveLength(0)
  })

  it('restaurar tarea la devuelve al tablero', async () => {
    const { app } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    const project = (await (await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'P' }))).json()).project
    const task = (await (await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'T' }))).json()).task
    await app.request(`/api/tasks/${task.id}`, jsonReq(auth, 'DELETE', ''))
    const restore = await app.request(`/api/trash/${task.id}/restore`, jsonReq(auth, 'POST', ''))
    expect(restore.status).toBe(200)
    const boot = await (await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })).json()
    expect(boot.tasks).toHaveLength(1)
    const trash = await (await app.request('/api/trash', { headers: { cookie: auth.cookie } })).json()
    expect(trash.tasks).toHaveLength(0)
  })

  it('borrado permanente desde papelera elimina la tarea y sus adjuntos', async () => {
    const { app, prod } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    const project = (await (await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'P' }))).json()).project
    const task = (await (await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'T' }))).json()).task
    await app.request(`/api/tasks/${task.id}`, jsonReq(auth, 'DELETE', ''))
    const perm = await app.request(`/api/trash/${task.id}`, jsonReq(auth, 'DELETE', ''))
    expect(perm.status).toBe(204)
    const row = prod.prepare('SELECT id FROM tasks WHERE id = ?').get(task.id)
    expect(row).toBeUndefined()
  })

  it('vaciar papelera elimina todas las tareas borradas', async () => {
    const { app, prod } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    const project = (await (await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'P' }))).json()).project
    const t1 = (await (await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'T1' }))).json()).task
    const t2 = (await (await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'T2' }))).json()).task
    await app.request(`/api/tasks/${t1.id}`, jsonReq(auth, 'DELETE', ''))
    await app.request(`/api/tasks/${t2.id}`, jsonReq(auth, 'DELETE', ''))
    const empty = await app.request('/api/trash', jsonReq(auth, 'DELETE', ''))
    expect(empty.status).toBe(204)
    const all = prod.prepare('SELECT COUNT(*) AS n FROM tasks').get().n
    expect(all).toBe(0)
  })

  it('GET /api/export devuelve todos los datos del usuario', async () => {
    const { app } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    const project = (await (await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'Export' }))).json()).project
    await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'Tarea export' }))
    const res = await app.request('/api/export', { headers: { cookie: auth.cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.projects).toHaveLength(1)
    expect(body.tasks).toHaveLength(1)
    expect(body.exported_at).toBeTruthy()
    expect(body.user.username).toBe('admin')
  })
})
