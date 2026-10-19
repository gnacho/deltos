// short-id.test.js — id corto legible por tarea (issue #226).
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'
import { migrateSchema } from '../src/db.js'

async function createProject(app, auth, name) {
  const res = await app.request(
    '/api/projects',
    jsonReq(auth, 'POST', '/api/projects', { name, emoji: '', color: 'sky' }),
  )
  return (await res.json()).project
}

async function createTask(app, auth, projectId, title) {
  const res = await app.request(
    '/api/tasks',
    jsonReq(auth, 'POST', '/api/tasks', { project_id: projectId, title }),
  )
  expect(res.status).toBe(201)
  return (await res.json()).task
}

describe('id corto de tarea', () => {
  it('numera por proyecto de forma secuencial e independiente', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const casa = await createProject(app, auth, 'Casa')
    const viaje = await createProject(app, auth, 'Viaje')

    expect((await createTask(app, auth, casa.id, 'A')).short_id).toBe('CASA-1')
    expect((await createTask(app, auth, casa.id, 'B')).short_id).toBe('CASA-2')
    expect((await createTask(app, auth, viaje.id, 'C')).short_id).toBe('VIAJ-1')
  })

  it('el id es estable tras editar, mover y archivar', async () => {
    const { app, prod } = await makeInstance()
    const auth = await loginAdmin(app)
    const casa = await createProject(app, auth, 'Casa')
    const task = await createTask(app, auth, casa.id, 'A')

    await app.request(`/api/tasks/${task.id}`, jsonReq(auth, 'PATCH', `/api/tasks/${task.id}`, { title: 'A2' }))
    await app.request(`/api/tasks/${task.id}/move`, jsonReq(auth, 'POST', `/api/tasks/${task.id}/move`, { column: 'encurso', position: 0 }))
    await app.request(`/api/tasks/${task.id}/archive`, jsonReq(auth, 'POST', `/api/tasks/${task.id}/archive`, {}))

    const row = prod.prepare('SELECT short_id FROM tasks WHERE id = ?').get(task.id)
    expect(row.short_id).toBe('CASA-1')
  })

  it('las tareas de la demo tienen id corto', async () => {
    const { demo } = await makeInstance()
    const missing = demo.prepare('SELECT COUNT(*) AS n FROM tasks WHERE short_id IS NULL').get().n
    expect(missing).toBe(0)
  })

  it('rellena los ids que faltan de forma determinista', async () => {
    const { prod } = await makeInstance()
    const now = Date.now()
    prod.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)').run('p1', 'Casa', now)
    prod.prepare('INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('t1', 'p1', 'A', now, now)
    prod.prepare('INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('t2', 'p1', 'B', now + 1, now + 1)

    // Simula una BD anterior a la migración: sin columna y con el contador a 0.
    prod.exec('ALTER TABLE tasks DROP COLUMN short_id')
    prod.exec('UPDATE projects SET task_seq = 0')
    migrateSchema(prod)

    const rows = prod.prepare('SELECT short_id FROM tasks ORDER BY created_at').all()
    expect(rows.map((r) => r.short_id)).toEqual(['CASA-1', 'CASA-2'])
  })
})
