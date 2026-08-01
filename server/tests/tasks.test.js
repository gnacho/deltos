// tasks.test.js — CRUD de tareas, mover con reorden de posiciones en
// transacción, registro de activity_events y detalle paginado.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'

async function setup() {
  const inst = await makeInstance({ seedDemoData: false })
  const cookie = await loginAdmin(inst.app)
  const proj = await inst.app.request(
    '/api/projects',
    jsonReq(cookie, 'POST', '/api/projects', { name: 'Casa', emoji: '🏠', color: 'sky' })
  )
  const project = (await proj.json()).project
  return { ...inst, cookie, project }
}

async function createTask(app, cookie, project_id, title) {
  const res = await app.request('/api/tasks', jsonReq(cookie, 'POST', '/api/tasks', { project_id, title }))
  expect(res.status).toBe(201)
  return (await res.json()).task
}

async function positions(app, cookie, column) {
  const res = await app.request('/api/bootstrap', { headers: { cookie } })
  const boot = await res.json()
  return boot.tasks
    .filter((t) => t.column === column)
    .sort((a, b) => a.position - b.position)
    .map((t) => ({ title: t.title, position: t.position }))
}

describe('tasks', () => {
  it('crear tarea la pone al final de la columna y registra evento created', async () => {
    const { app, cookie, project } = await setup()
    const t1 = await createTask(app, cookie, project.id, 'Primera')
    const t2 = await createTask(app, cookie, project.id, 'Segunda')
    expect(t1.column).toBe('nuevo')
    expect(t1.position).toBe(0)
    expect(t2.position).toBe(1)

    const detail = await (await app.request(`/api/tasks/${t1.id}`, { headers: { cookie } })).json()
    expect(detail.activity).toHaveLength(1)
    expect(detail.activity[0].type).toBe('created')
  })

  it('move dentro de la misma columna reordena posiciones contiguas', async () => {
    const { app, cookie, project } = await setup()
    const a = await createTask(app, cookie, project.id, 'A')
    await createTask(app, cookie, project.id, 'B')
    await createTask(app, cookie, project.id, 'C')

    // A (pos 0) → pos 2: B y C suben
    const res = await app.request(
      `/api/tasks/${a.id}/move`,
      jsonReq(cookie, 'POST', '', { column: 'nuevo', position: 2 })
    )
    expect(res.status).toBe(200)
    expect(await positions(app, cookie, 'nuevo')).toEqual([
      { title: 'B', position: 0 },
      { title: 'C', position: 1 },
      { title: 'A', position: 2 },
    ])
  })

  it('move a otra columna compacta origen y abre hueco en destino', async () => {
    const { app, cookie, project } = await setup()
    const a = await createTask(app, cookie, project.id, 'A')
    const b = await createTask(app, cookie, project.id, 'B')
    const c1 = await createTask(app, cookie, project.id, 'C')
    const d = await createTask(app, cookie, project.id, 'D')

    // B (nuevo pos 1) → encurso pos 0
    const res = await app.request(
      `/api/tasks/${b.id}/move`,
      jsonReq(cookie, 'POST', '', { column: 'encurso', position: 0 })
    )
    expect(res.status).toBe(200)
    const moved = (await res.json()).task
    expect(moved.column).toBe('encurso')
    expect(moved.position).toBe(0)

    expect(await positions(app, cookie, 'nuevo')).toEqual([
      { title: 'A', position: 0 },
      { title: 'C', position: 1 },
      { title: 'D', position: 2 },
    ])
    expect(await positions(app, cookie, 'encurso')).toEqual([{ title: 'B', position: 0 }])

    // evento moved con {from, to}
    const detail = await (await app.request(`/api/tasks/${b.id}`, { headers: { cookie } })).json()
    const movedEv = detail.activity.find((e) => e.type === 'moved')
    expect(movedEv.data).toEqual({ from: 'nuevo', to: 'encurso' })
    void a
    void c1
    void d
  })

  it('move clampea posiciones fuera de rango al final', async () => {
    const { app, cookie, project } = await setup()
    const a = await createTask(app, cookie, project.id, 'A')
    await createTask(app, cookie, project.id, 'B')
    const res = await app.request(
      `/api/tasks/${a.id}/move`,
      jsonReq(cookie, 'POST', '', { column: 'nuevo', position: 99 })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).task.position).toBe(1)
  })

  it('PATCH registra un activity_event por cada campo cambiado', async () => {
    const { app, cookie, project } = await setup()
    const t = await createTask(app, cookie, project.id, 'Original')
    const res = await app.request(
      `/api/tasks/${t.id}`,
      jsonReq(cookie, 'PATCH', '', {
        title: 'Renombrada',
        priority: 'alta',
        due_date: '2026-12-31',
        description: 'Con detalle',
      })
    )
    expect(res.status).toBe(200)

    const detail = await (await app.request(`/api/tasks/${t.id}`, { headers: { cookie } })).json()
    const types = detail.activity.map((e) => e.type).sort()
    expect(types).toEqual(['created', 'description', 'due', 'priority', 'title'])
    const pr = detail.activity.find((e) => e.type === 'priority')
    expect(pr.data).toEqual({ from: null, to: 'alta' })
  })

  it('PATCH de asignación y etiquetas (assignee existe, labels se reemplazan)', async () => {
    const { app, cookie, project } = await setup()
    const me = await (await app.request('/api/auth/me', { headers: { cookie } })).json()
    const label = (
      await (
        await app.request('/api/labels', jsonReq(cookie, 'POST', '/api/labels', { name: 'Urgente', color: 'rose' }))
      ).json()
    ).label
    const t = await createTask(app, cookie, project.id, 'Con etiquetas')
    const res = await app.request(
      `/api/tasks/${t.id}`,
      jsonReq(cookie, 'PATCH', '', { assignee_id: me.user.id, labels: [label.id] })
    )
    expect(res.status).toBe(200)
    const task = (await res.json()).task
    expect(task.assignee.username).toBe('admin')
    expect(task.labels).toHaveLength(1)
    expect(task.labels[0].name).toBe('Urgente')

    // asignar a usuario inexistente → 404
    const bad = await app.request(
      `/api/tasks/${t.id}`,
      jsonReq(cookie, 'PATCH', '', { assignee_id: 'no-existe' })
    )
    expect(bad.status).toBe(404)
  })

  it('DELETE elimina la tarea y compacta la columna', async () => {
    const { app, cookie, project } = await setup()
    const a = await createTask(app, cookie, project.id, 'A')
    await createTask(app, cookie, project.id, 'B')
    const res = await app.request(`/api/tasks/${a.id}`, jsonReq(cookie, 'DELETE', ''))
    expect(res.status).toBe(200)
    expect(await positions(app, cookie, 'nuevo')).toEqual([{ title: 'B', position: 0 }])
    const gone = await app.request(`/api/tasks/${a.id}`, { headers: { cookie } })
    expect(gone.status).toBe(404)
  })

  it('comentarios: crear y listar en el detalle', async () => {
    const { app, cookie, project } = await setup()
    const t = await createTask(app, cookie, project.id, 'Comentable')
    const res = await app.request(
      `/api/tasks/${t.id}/comments`,
      jsonReq(cookie, 'POST', '', { body: 'Primer comentario' })
    )
    expect(res.status).toBe(201)
    const detail = await (await app.request(`/api/tasks/${t.id}`, { headers: { cookie } })).json()
    expect(detail.comments).toHaveLength(1)
    expect(detail.comments[0].body).toBe('Primer comentario')
    expect(detail.comments[0].username).toBe('admin')
    // los comentarios NO generan activity_events
    expect(detail.activity.filter((e) => e.type !== 'created')).toHaveLength(0)
  })

  it('bootstrap devuelve contadores por columna y counts por tarea', async () => {
    const { app, cookie, project } = await setup()
    const t = await createTask(app, cookie, project.id, 'Contada')
    await app.request(`/api/tasks/${t.id}/comments`, jsonReq(cookie, 'POST', '', { body: 'hola' }))
    const res = await app.request('/api/bootstrap', { headers: { cookie } })
    const boot = await res.json()
    expect(boot.projects[0].counts).toEqual({ nuevo: 1, encurso: 0, hecho: 0 })
    expect(boot.tasks[0].counts.comments).toBe(1)
    expect(boot.tasks[0].counts.attachments).toBe(0)
  })

  it('feed global /api/activity pagina y enriquece con tarea/proyecto/usuario', async () => {
    const { app, cookie, project } = await setup()
    const t = await createTask(app, cookie, project.id, 'Feed')
    await app.request(
      `/api/tasks/${t.id}/move`,
      jsonReq(cookie, 'POST', '', { column: 'hecho', position: 0 })
    )
    const res = await app.request('/api/activity?page=1&limit=1', { headers: { cookie } })
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].type).toBe('moved')
    expect(body.items[0].task_title).toBe('Feed')
    expect(body.items[0].project_name).toBe('Casa')
    expect(body.items[0].username).toBe('admin')

    const page2 = await (await app.request('/api/activity?page=2&limit=1', { headers: { cookie } })).json()
    expect(page2.items[0].type).toBe('created')
  })

  it('validación: título vacío y fecha mal formada → 400', async () => {
    const { app, cookie, project } = await setup()
    const bad1 = await app.request('/api/tasks', jsonReq(cookie, 'POST', '/api/tasks', { project_id: project.id, title: '' }))
    expect(bad1.status).toBe(400)
    const t = await createTask(app, cookie, project.id, 'Fecha')
    const bad2 = await app.request(`/api/tasks/${t.id}`, jsonReq(cookie, 'PATCH', '', { due_date: '31-12-2026' }))
    expect(bad2.status).toBe(400)
  })
})
