// ha.test.js — integración Home Assistant: token (generar/revocar) y endpoints
// públicos /api/ha/tasks (listar, crear, completar) con Bearer token.
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

async function genToken(app, auth, username) {
  const res = await app.request(
    '/api/ha/token',
    jsonReq(auth, 'POST', '', username ? { username } : {})
  )
  expect(res.status).toBe(200)
  return (await res.json()).token
}

describe('ha — token', () => {
  it('genera token admin, status lo ve, revoca', async () => {
    const { app, auth } = await setup()
    const token = await genToken(app, auth, 'admin')

    const status = await (await app.request('/api/ha/status', { headers: { cookie: auth.cookie } })).json()
    expect(status.enabled).toBe(true)
    expect(status.username).toBe('admin')

    // el token en claro NO se guarda: status no lo expone
    expect(status.token).toBeUndefined()

    const del = await app.request('/api/ha/token', jsonReq(auth, 'DELETE', ''))
    expect(del.status).toBe(204)
    const status2 = await (await app.request('/api/ha/status', { headers: { cookie: auth.cookie } })).json()
    expect(status2.enabled).toBe(false)
  })

  it('usuario sin rol admin no puede generar token', async () => {
    const { app, auth } = await setup()
    const res = await app.request('/api/ha/token', jsonReq(auth, 'POST', '', {}))
    // 'admin' ES admin; creamos un usuario normal para el negativo
    const reg = await app.request('/api/users', jsonReq(auth, 'POST', '/api/users', {
      username: 'pepe',
      password: 'pepe1234567',
      role: 'user',
    }))
    expect(reg.status).toBe(201)
    const pepe = await (await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pepe', password: 'pepe1234567' }),
    })).json()
    const pepeAuth = { cookie: (await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pepe', password: 'pepe1234567' }),
    })).headers.get('set-cookie').split(';')[0], csrfToken: pepe.csrfToken }
    const res2 = await app.request('/api/ha/token', jsonReq(pepeAuth, 'POST', '', {}))
    expect(res2.status).toBe(403)
  })
})

describe('ha — tareas públicas', () => {
  it('GET /api/ha/tasks sin token → 401', async () => {
    const { app } = await setup()
    const res = await app.request('/api/ha/tasks')
    expect(res.status).toBe(401)
  })

  it('crear, listar y completar con Bearer token', async () => {
    const { app, auth, project } = await setup()
    const token = await genToken(app, auth, 'admin')

    const list1 = await (await app.request('/api/ha/tasks', { headers: { authorization: `Bearer ${token}` } })).json()
    expect(list1.tasks).toHaveLength(0)
    expect(list1.count).toBe(0)

    // crear
    const created = await app.request('/api/ha/tasks', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Comprar leche', project_id: project.id, due_date: '2026-08-30' }),
    })
    expect(created.status).toBe(201)
    const task = (await created.json()).task
    expect(task.status).toBe('needs_action')

    // listar
    const list2 = await (await app.request('/api/ha/tasks', { headers: { authorization: `Bearer ${token}` } })).json()
    expect(list2.count).toBe(1)
    expect(list2.tasks[0].summary).toBe('Comprar leche')
    expect(list2.tasks[0].due_date).toBe('2026-08-30')
    expect(list2.tasks[0].status).toBe('needs_action')

    // completar
    const done = await app.request(`/api/ha/tasks/${task.id}/complete`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(done.status).toBe(200)
    expect((await done.json()).task.status).toBe('completed')

    const list3 = await (await app.request('/api/ha/tasks', { headers: { authorization: `Bearer ${token}` } })).json()
    expect(list3.count).toBe(0)
  })

  it('completar una tarea recurrente crea la siguiente instancia', async () => {
    const { app, auth, project } = await setup()
    const token = await genToken(app, auth, 'admin')
    const t = (await (await app.request('/api/tasks', jsonReq(auth, 'POST', '/api/tasks', {
      project_id: project.id,
      title: 'Piscina',
      recurrence: { freq: 'weekly', interval: 1, mode: 'due' },
      due_date: '2026-08-21',
    }))).json()).task

    await app.request(`/api/ha/tasks/${t.id}/complete`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
    })

    const list = await (await app.request('/api/ha/tasks', { headers: { authorization: `Bearer ${token}` } })).json()
    expect(list.count).toBe(1)
    expect(list.tasks[0].title).toBe('Piscina')
    // la nueva instancia debe tener recurrencia
    const boot = await (await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })).json()
    const next = boot.tasks.find((x) => x.recurrence_group_id === t.id && x.column === 'nuevo')
    expect(next).toBeTruthy()
  })

  it('token incorrecto → 401', async () => {
    const { app } = await setup()
    const res = await app.request('/api/ha/tasks', { headers: { authorization: 'Bearer incorrecto' } })
    expect(res.status).toBe(401)
  })

  it('el token solo actúa en proyectos del usuario configurado (membresía #170)', async () => {
    const { app, auth, project } = await setup()
    // proyecto ajeno (admin lo crea, nadie más es miembro) + usuario pepe
    const other = (await (await app.request('/api/projects', jsonReq(auth, 'POST', '/api/projects', { name: 'Ajeno' }))).json()).project
    await app.request('/api/users', jsonReq(auth, 'POST', '/api/users', { username: 'pepe', password: 'pepe1234567', role: 'user' }))
    const t = (await (await app.request('/api/tasks', jsonReq(auth, 'POST', '/api/tasks', { project_id: other.id, title: 'Secreta' }))).json()).task
    const token = await genToken(app, auth, 'pepe')

    // pepe no es miembro de 'Ajeno': no puede crear ni completar ahí
    const created = await app.request('/api/ha/tasks', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Intrusa', project_id: other.id }),
    })
    expect(created.status).toBe(403)

    const done = await app.request(`/api/ha/tasks/${t.id}/complete`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(done.status).toBe(404)

    // el admin (miembro del proyecto propio) sí puede en su proyecto
    const tokenAdmin = await genToken(app, auth, 'admin')
    const created2 = await app.request('/api/ha/tasks', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Propia', project_id: project.id }),
    })
    expect(created2.status).toBe(201)
  })
})
