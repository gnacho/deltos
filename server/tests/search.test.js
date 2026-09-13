// search.test.js — búsqueda global de tareas (issue #223).
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq, loginUser } from './helpers.js'

async function setup() {
  const { app } = await makeInstance()
  const auth = await loginAdmin(app)
  const projRes = await app.request(
    '/api/projects',
    jsonReq(auth, 'POST', '/api/projects', { name: 'Reforma', emoji: '', color: 'sky' }),
  )
  const project = (await projRes.json()).project
  const labelRes = await app.request(
    '/api/labels',
    jsonReq(auth, 'POST', '/api/labels', { name: 'Urgente', color: 'rose' }),
  )
  const label = (await labelRes.json()).label
  await app.request(
    '/api/tasks',
    jsonReq(auth, 'POST', '/api/tasks', {
      project_id: project.id,
      title: 'Pintar salón',
      description: 'comprar pintura blanca',
      labels: [label.id],
    }),
  )
  return { app, auth, project, label }
}

async function search(app, auth, q) {
  const res = await app.request(`/api/search?q=${encodeURIComponent(q)}`, {
    headers: { cookie: auth.cookie },
  })
  expect(res.status).toBe(200)
  return (await res.json()).tasks
}

describe('búsqueda global', () => {
  it('encuentra por título y por descripción', async () => {
    const { app, auth } = await setup()
    expect((await search(app, auth, 'Pintar')).length).toBe(1)
    expect((await search(app, auth, 'pintura')).length).toBe(1)
  })

  it('encuentra por nombre de proyecto y de etiqueta', async () => {
    const { app, auth } = await setup()
    expect((await search(app, auth, 'Reforma')).length).toBe(1)
    expect((await search(app, auth, 'Urgente')).length).toBe(1)
  })

  it('ignora consultas de menos de 2 caracteres', async () => {
    const { app, auth } = await setup()
    expect(await search(app, auth, 'x')).toEqual([])
  })

  it('no devuelve tareas borradas', async () => {
    const { app, auth } = await setup()
    const tasks = await search(app, auth, 'Pintar')
    await app.request(`/api/tasks/${tasks[0].id}`, jsonReq(auth, 'DELETE', `/api/tasks/${tasks[0].id}`))
    expect(await search(app, auth, 'Pintar')).toEqual([])
  })

  it('no filtra tareas de proyectos de los que no es miembro', async () => {
    const { app, auth } = await setup()
    await app.request('/api/users', jsonReq(auth, 'POST', '/api/users', { username: 'pepe', password: 'pepe1234567' }))
    const pepe = await loginUser(app, 'pepe', 'pepe1234567')
    expect(await search(app, pepe, 'Pintar')).toEqual([])
  })
})
