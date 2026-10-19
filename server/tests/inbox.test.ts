// inbox.test.js — proyecto "Sin proyecto" (inbox): creación automática,
// visibilidad de miembros, tareas sin proyecto, subtareas al crear y
// protección frente a renombrar/borrar/cambiar miembros.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'
import { ensureInbox } from '../src/db.js'

async function setup() {
  const inst = await makeInstance({ seedDemoData: false })
  const inboxId = ensureInbox(inst.prod)
  const auth = await loginAdmin(inst.app)
  return { ...inst, auth, inboxId }
}

describe('inbox (Sin proyecto)', () => {
  it('el bootstrap expone el inbox marcado y con el admin como miembro', async () => {
    const { app, auth, inboxId } = await setup()
    const boot = await (await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })).json()
    const inbox = boot.projects.find((p) => p.id === inboxId)
    expect(inbox).toBeTruthy()
    expect(inbox.is_inbox).toBe(true)
    expect(inbox.members.some((m) => m.username === 'admin')).toBe(true)
  })

  it('ensureInbox es idempotente (no duplica el proyecto)', async () => {
    const { prod, inboxId } = await setup()
    const again = ensureInbox(prod)
    expect(again).toBe(inboxId)
    expect(prod.prepare('SELECT COUNT(*) AS n FROM projects WHERE is_inbox = 1').get().n).toBe(1)
  })

  it('se puede crear una tarea sin proyecto (en el inbox)', async () => {
    const { app, auth, inboxId } = await setup()
    const res = await app.request(
      '/api/tasks',
      jsonReq(auth, 'POST', '/api/tasks', { project_id: inboxId, title: 'Tarea suelta' })
    )
    expect(res.status).toBe(201)
    expect((await res.json()).task.project_id).toBe(inboxId)
  })

  it('las subtareas enviadas al crear la tarea se persisten', async () => {
    const { app, auth, inboxId } = await setup()
    const res = await app.request(
      '/api/tasks',
      jsonReq(auth, 'POST', '/api/tasks', {
        project_id: inboxId,
        title: 'Con pasos',
        subtasks: ['Paso uno', 'Paso dos'],
      })
    )
    expect(res.status).toBe(201)
    const task = (await res.json()).task
    const detail = await (
      await app.request(`/api/tasks/${task.id}`, { headers: { cookie: auth.cookie } })
    ).json()
    expect(detail.subtasks).toHaveLength(2)
    expect(detail.subtasks.map((s) => s.title)).toEqual(['Paso uno', 'Paso dos'])
    expect(detail.subtasks.every((s) => s.done === 0)).toBe(true)
    expect(detail.subtasks.every((s) => s.parent_id === null)).toBe(true)
  })

  it('el inbox no se puede renombrar, borrar ni cambiar sus miembros', async () => {
    const { app, auth, inboxId } = await setup()
    const patch = await app.request(
      `/api/projects/${inboxId}`,
      jsonReq(auth, 'PATCH', '', { name: 'Otro nombre' })
    )
    expect(patch.status).toBe(403)
    expect((await patch.json()).error.code).toBe('PROJECT_INBOX')

    const del = await app.request(`/api/projects/${inboxId}`, jsonReq(auth, 'DELETE', ''))
    expect(del.status).toBe(403)
    expect((await del.json()).error.code).toBe('PROJECT_INBOX')

    const members = await app.request(
      `/api/projects/${inboxId}/members`,
      jsonReq(auth, 'PUT', '', { member_ids: [] })
    )
    expect(members.status).toBe(403)
    expect((await members.json()).error.code).toBe('PROJECT_INBOX')
  })

  it('un usuario nuevo entra automáticamente en el inbox', async () => {
    const { app, auth, inboxId } = await setup()
    const created = await app.request(
      '/api/users',
      jsonReq(auth, 'POST', '/api/users', {
        username: 'ana',
        password: 'unaClaveLarga1',
        color: 'violet',
        role: 'user',
      })
    )
    expect(created.status).toBe(201)
    const boot = await (await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })).json()
    const inbox = boot.projects.find((p) => p.id === inboxId)
    expect(inbox.members.some((m) => m.username === 'ana')).toBe(true)
  })
})
