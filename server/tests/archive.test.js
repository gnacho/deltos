// archive.test.js — archivado de tareas: manual (solo 'hecho'), unarchive con
// ventana fresca, auto-archivo a los 3 días (archiveStaleDoneTasks), done_at
// en create/move y exclusión de archivadas en counts del bootstrap.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'
import { archiveStaleDoneTasks } from '../src/db.js'

const DAY = 24 * 60 * 60 * 1000

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

async function move(app, auth, id, column, position = 0) {
  const res = await app.request(
    `/api/tasks/${id}/move`,
    jsonReq(auth, 'POST', '', { column, position })
  )
  expect(res.status).toBe(200)
  return (await res.json()).task
}

async function rawTask(db, id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
}

describe('task archive', () => {
  it('archiva una tarea hecha y la excluye de los counts del bootstrap', async () => {
    const { app, auth, project, prod } = await setup()
    const done = await createTask(app, auth, project.id, 'Hecha', { column: 'hecho' })
    await createTask(app, auth, project.id, 'Otra hecha', { column: 'hecho' })
    await createTask(app, auth, project.id, 'Abierta')

    const res = await app.request(
      `/api/tasks/${done.id}/archive`,
      jsonReq(auth, 'POST', '', {})
    )
    expect(res.status).toBe(200)
    const task = (await res.json()).task
    expect(task.archived_at).not.toBeNull()

    // bootstrap: la tarea sigue llegando (con archived_at) pero el count de
    // 'hecho' del proyecto la excluye (2 hechas - 1 archivada = 1).
    const boot = await (await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })).json()
    const inList = boot.tasks.find((t) => t.id === done.id)
    expect(inList.archived_at).not.toBeNull()
    const counts = boot.projects.find((p) => p.id === project.id).counts
    expect(counts.hecho).toBe(1)
    expect(counts.nuevo).toBe(1)
    void prod
  })

  it('rechaza archivar una tarea que no está en hecho (422 TASK_NOT_DONE)', async () => {
    const { app, auth, project } = await setup()
    const t = await createTask(app, auth, project.id, 'Abierta')
    const res = await app.request(`/api/tasks/${t.id}/archive`, jsonReq(auth, 'POST', '', {}))
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('TASK_NOT_DONE')
  })

  it('desarchivar devuelve la tarea al final de hecho con done_at fresco', async () => {
    const { app, auth, project, prod } = await setup()
    const a = await createTask(app, auth, project.id, 'A', { column: 'hecho' })
    const b = await createTask(app, auth, project.id, 'B', { column: 'hecho' })
    await move(app, auth, a.id, 'hecho', 0) // A pos 0, B pos 1

    const arch = await app.request(`/api/tasks/${a.id}/archive`, jsonReq(auth, 'POST', '', {}))
    expect(arch.status).toBe(200)
    // archivar compacta: B queda en pos 0
    expect((await rawTask(prod, b.id)).position).toBe(0)

    const res = await app.request(`/api/tasks/${a.id}/unarchive`, jsonReq(auth, 'POST', '', {}))
    expect(res.status).toBe(200)
    const task = await rawTask(prod, a.id)
    expect(task.archived_at).toBeNull()
    expect(task.column).toBe('hecho')
    expect(task.position).toBe(1) // al final, tras B
    expect(task.done_at).not.toBeNull()
  })

  it('crear directamente en hecho marca done_at; mover fuera lo limpia', async () => {
    const { app, auth, project, prod } = await setup()
    const t = await createTask(app, auth, project.id, 'Directa', { column: 'hecho' })
    expect((await rawTask(prod, t.id)).done_at).not.toBeNull()

    await move(app, auth, t.id, 'nuevo', 0)
    expect((await rawTask(prod, t.id)).done_at).toBeNull()

    await move(app, auth, t.id, 'hecho', 0)
    expect((await rawTask(prod, t.id)).done_at).not.toBeNull()
  })

  it('mover una tarea archivada la reactiva sin romper posiciones', async () => {
    const { app, auth, project, prod } = await setup()
    const a = await createTask(app, auth, project.id, 'A', { column: 'hecho' })
    const b = await createTask(app, auth, project.id, 'B', { column: 'hecho' })
    const c = await createTask(app, auth, project.id, 'C', { column: 'hecho' })
    // A(0) B(1) C(2) → archivar B → A(0) C(1)
    await app.request(`/api/tasks/${b.id}/archive`, jsonReq(auth, 'POST', '', {}))

    // Reactivar B moviéndola a 'nuevo'
    const res = await app.request(
      `/api/tasks/${b.id}/move`,
      jsonReq(auth, 'POST', '', { column: 'nuevo', position: 0 })
    )
    expect(res.status).toBe(200)
    const rb = await rawTask(prod, b.id)
    expect(rb.archived_at).toBeNull()
    expect(rb.column).toBe('nuevo')
    expect(rb.done_at).toBeNull()
    // Las hechas activas mantienen la secuencia contigua
    const pos = prod
      .prepare("SELECT position FROM tasks WHERE \"column\" = 'hecho' AND archived_at IS NULL ORDER BY position")
      .all()
      .map((r) => r.position)
    expect(pos).toEqual([0, 1])
    void a
    void c
  })

  it('auto-archivo: archiva las hecha hace +3 días y deja las recientes', async () => {
    const { app, auth, project, prod } = await setup()
    const vieja = await createTask(app, auth, project.id, 'Vieja', { column: 'hecho' })
    const reciente = await createTask(app, auth, project.id, 'Reciente', { column: 'hecho' })
    const abierta = await createTask(app, auth, project.id, 'Abierta')

    prod
      .prepare('UPDATE tasks SET done_at = ? WHERE id = ?')
      .run(Date.now() - 4 * DAY, vieja.id)
    const archived = archiveStaleDoneTasks(prod)
    expect(archived).toBe(1)
    expect((await rawTask(prod, vieja.id)).archived_at).not.toBeNull()
    expect((await rawTask(prod, reciente.id)).archived_at).toBeNull()
    expect((await rawTask(prod, abierta.id)).archived_at).toBeNull()
  })

  it('auto-archivo auto-cura done_at NULL con updated_at (semillas pre-migración)', async () => {
    const { app, auth, project, prod } = await setup()
    const t = await createTask(app, auth, project.id, 'Sin marca', { column: 'hecho' })
    prod.prepare('UPDATE tasks SET done_at = NULL, updated_at = ? WHERE id = ?').run(Date.now() - 5 * DAY, t.id)

    expect(archiveStaleDoneTasks(prod)).toBe(1)
    expect((await rawTask(prod, t.id)).archived_at).not.toBeNull()
  })

  it('un miembro de otro proyecto no puede archivar (403)', async () => {
    const inst = await setup()
    const { app, auth, project } = inst
    const done = await createTask(app, auth, project.id, 'Hecha', { column: 'hecho' })

    const created = await app.request(
      '/api/users',
      jsonReq(auth, 'POST', '/api/users', { username: 'otro', password: 'otro1234567' })
    )
    expect(created.status).toBe(201)
    const login = await app.request(
      '/api/auth/login',
      jsonReq(null, 'POST', '', { username: 'otro', password: 'otro1234567' })
    )
    const body = await login.json()
    const otro = { cookie: login.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken ?? null }

    const res = await app.request(`/api/tasks/${done.id}/archive`, jsonReq(otro, 'POST', '', {}))
    expect(res.status).toBe(403)
  })
})
