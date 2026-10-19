// projects-membership.test.js — visibilidad y autorización por proyecto.
// Cubre: owner/miembros al crear, proyectos personales vs compartidos,
// gestión de miembros (PUT), autorización de owner, aislamiento entre
// usuarios, backfill de proyectos legados y restricción de asignado a miembros.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, loginUser, jsonReq } from './helpers.js'
import { openDb } from '../src/db.js'

const PASS = 'passwd1234567'

// Crea un usuario (admin) y devuelve su sesión.
async function createUser(app, admin, username) {
  const res = await app.request(
    '/api/users',
    jsonReq(admin, 'POST', '/api/users', { username, password: PASS, color: 'slate', role: 'user' })
  )
  expect(res.status).toBe(201)
  return loginUser(app, username, PASS)
}

async function bootstrapIds(app, session) {
  const res = await app.request('/api/bootstrap', { headers: { cookie: session.cookie } })
  const boot = await res.json()
  return {
    projectIds: boot.projects.map((p) => p.id),
    projects: boot.projects,
    tasks: boot.tasks,
  }
}

describe('project membership — visibilidad', () => {
  it('crear un proyecto deja al creador como owner y único miembro (personal)', async () => {
    const inst = await makeInstance({ seedDemoData: false })
    const admin = await loginAdmin(inst.app)
    const res = await inst.app.request(
      '/api/projects',
      jsonReq(admin, 'POST', '/api/projects', { name: 'Personal', emoji: 'home', color: 'sky' })
    )
    expect(res.status).toBe(201)
    const project = (await res.json()).project
    expect(project.owner_id).toBeTypeOf('string')
    expect(project.members).toHaveLength(1)
    expect(project.members[0].role).toBe('owner')
  })

  it('un proyecto personal NO lo ve otro usuario (bootstrap lo filtra)', async () => {
    const inst = await makeInstance({ seedDemoData: false })
    const admin = await loginAdmin(inst.app)
    await inst.app.request(
      '/api/projects',
      jsonReq(admin, 'POST', '/api/projects', { name: 'Solo mío', emoji: 'home', color: 'sky' })
    )
    const other = await createUser(inst.app, admin, 'ana')
    const { projectIds } = await bootstrapIds(inst.app, other)
    expect(projectIds).toHaveLength(0)
  })

  it('un proyecto compartido lo ven todos sus miembros', async () => {
    const inst = await makeInstance({ seedDemoData: false })
    const admin = await loginAdmin(inst.app)
    const other = await createUser(inst.app, admin, 'ana')
    const otherMe = (await (await inst.app.request('/api/auth/me', { headers: { cookie: other.cookie } })).json()).user
    const res = await inst.app.request(
      '/api/projects',
      jsonReq(admin, 'POST', '/api/projects', {
        name: 'Compartido',
        emoji: 'users',
        color: 'violet',
        member_ids: [otherMe.id],
      })
    )
    expect(res.status).toBe(201)
    const { projectIds, projects } = await bootstrapIds(inst.app, other)
    expect(projectIds).toHaveLength(1)
    expect(projects[0].members.map((m) => m.username).sort()).toEqual(['admin', 'ana'])
  })
})

describe('project membership — gestión de miembros', () => {
  it('PUT /members reemplaza miembros: el nuevo ve el proyecto, el quitado no', async () => {
    const inst = await makeInstance({ seedDemoData: false })
    const admin = await loginAdmin(inst.app)
    const ana = await createUser(inst.app, admin, 'ana')
    const anaMe = (await (await inst.app.request('/api/auth/me', { headers: { cookie: ana.cookie } })).json()).user
    const berto = await createUser(inst.app, admin, 'berto')
    const bertoMe = (await (await inst.app.request('/api/auth/me', { headers: { cookie: berto.cookie } })).json()).user

    const proj = (
      await (
        await inst.app.request(
          '/api/projects',
          jsonReq(admin, 'POST', '/api/projects', {
            name: 'Equipo',
            emoji: 'users',
            color: 'blue',
            member_ids: [anaMe.id],
          })
        )
      ).json()
    ).project

    // ana lo ve, berto no
    expect((await bootstrapIds(inst.app, ana)).projectIds).toContain(proj.id)
    expect((await bootstrapIds(inst.app, berto)).projectIds).not.toContain(proj.id)

    // Reemplazar: quitar a ana, añadir a berto
    const res = await inst.app.request(
      `/api/projects/${proj.id}/members`,
      jsonReq(admin, 'PUT', '', { member_ids: [bertoMe.id] })
    )
    expect(res.status).toBe(200)
    const members = (await res.json()).members.map((m) => m.username).sort()
    expect(members).toEqual(['admin', 'berto'])

    expect((await bootstrapIds(inst.app, ana)).projectIds).not.toContain(proj.id)
    expect((await bootstrapIds(inst.app, berto)).projectIds).toContain(proj.id)
  })

  it('un miembro (no owner) NO puede gestionar miembros, editar ni borrar el proyecto', async () => {
    const inst = await makeInstance({ seedDemoData: false })
    const admin = await loginAdmin(inst.app)
    const ana = await createUser(inst.app, admin, 'ana')
    const anaMe = (await (await inst.app.request('/api/auth/me', { headers: { cookie: ana.cookie } })).json()).user

    const proj = (
      await (
        await inst.app.request(
          '/api/projects',
          jsonReq(admin, 'POST', '/api/projects', {
            name: 'De Ana',
            emoji: 'home',
            color: 'sky',
            member_ids: [anaMe.id],
          })
        )
      ).json()
    ).project

    const members = await inst.app.request(
      `/api/projects/${proj.id}/members`,
      jsonReq(ana, 'PUT', '', { member_ids: [] })
    )
    expect(members.status).toBe(403)
    expect((await members.json()).error.code).toBe('PROJECT_NOT_OWNER')

    const patch = await inst.app.request(
      `/api/projects/${proj.id}`,
      jsonReq(ana, 'PATCH', '', { name: 'Hackeado' })
    )
    expect(patch.status).toBe(403)

    const del = await inst.app.request(`/api/projects/${proj.id}`, jsonReq(ana, 'DELETE', ''))
    expect(del.status).toBe(403)
  })

  it('quien gestiona nunca se bloquea fuera: el owner se retiene al vaciar miembros', async () => {
    const inst = await makeInstance({ seedDemoData: false })
    const admin = await loginAdmin(inst.app)
    const proj = (
      await (await inst.app.request('/api/projects', jsonReq(admin, 'POST', '/api/projects', { name: 'X', emoji: 'home', color: 'sky' }))).json()
    ).project
    const res = await inst.app.request(
      `/api/projects/${proj.id}/members`,
      jsonReq(admin, 'PUT', '', { member_ids: [] })
    )
    expect(res.status).toBe(200)
    // el admin sigue viéndolo
    expect((await bootstrapIds(inst.app, admin)).projectIds).toContain(proj.id)
  })
})

describe('project membership — autorización de tareas', () => {
  async function setup() {
    const inst = await makeInstance({ seedDemoData: false })
    const admin = await loginAdmin(inst.app)
    const ana = await createUser(inst.app, admin, 'ana')
    const anaMe = (await (await inst.app.request('/api/auth/me', { headers: { cookie: ana.cookie } })).json()).user
    const proj = (
      await (
        await inst.app.request(
          '/api/projects',
          jsonReq(admin, 'POST', '/api/projects', {
            name: 'Compartido',
            emoji: 'users',
            color: 'violet',
            member_ids: [anaMe.id],
          })
        )
      ).json()
    ).project
    return { inst, admin, ana, anaMe, proj }
  }

  it('un no-miembro no puede crear tareas en el proyecto (403 PROJECT_NOT_MEMBER)', async () => {
    const { inst, admin, proj } = await setup()
    const berto = await createUser(inst.app, admin, 'berto')
    const res = await inst.app.request(
      '/api/tasks',
      jsonReq(berto, 'POST', '/api/tasks', { project_id: proj.id, title: 'Intruso' })
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('PROJECT_NOT_MEMBER')
  })

  it('asignar a un no-miembro → 422 ASSIGNEE_NOT_MEMBER', async () => {
    const { inst, admin, proj } = await setup()
    const berto = await createUser(inst.app, admin, 'berto')
    const bertoMe = (await (await inst.app.request('/api/auth/me', { headers: { cookie: berto.cookie } })).json()).user
    const res = await inst.app.request(
      '/api/tasks',
      jsonReq(admin, 'POST', '/api/tasks', { project_id: proj.id, title: 'T', assignee_id: bertoMe.id })
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('ASSIGNEE_NOT_MEMBER')
  })

  it('un no-miembro no puede mover, comentar, editar ni ver el detalle de una tarea', async () => {
    const { inst, admin, proj } = await setup()
    const create = await inst.app.request(
      '/api/tasks',
      jsonReq(admin, 'POST', '/api/tasks', { project_id: proj.id, title: 'Tarea' })
    )
    const task = (await create.json()).task
    const berto = await createUser(inst.app, admin, 'berto')

    const move = await inst.app.request(
      `/api/tasks/${task.id}/move`,
      jsonReq(berto, 'POST', '', { column: 'encurso', position: 0 })
    )
    expect(move.status).toBe(403)

    const comment = await inst.app.request(
      `/api/tasks/${task.id}/comments`,
      jsonReq(berto, 'POST', '', { body: 'hola' })
    )
    expect(comment.status).toBe(403)

    const patch = await inst.app.request(
      `/api/tasks/${task.id}`,
      jsonReq(berto, 'PATCH', '', { title: 'Hack' })
    )
    expect(patch.status).toBe(403)

    // El detalle de una tarea ajena no filtra existencia: 404.
    const detail = await inst.app.request(`/api/tasks/${task.id}`, { headers: { cookie: berto.cookie } })
    expect(detail.status).toBe(404)
  })

  it('un miembro sí puede crear, comentar y ver el detalle', async () => {
    const { inst, ana, proj } = await setup()
    const create = await inst.app.request(
      '/api/tasks',
      jsonReq(ana, 'POST', '/api/tasks', { project_id: proj.id, title: 'De Ana' })
    )
    expect(create.status).toBe(201)
    const task = (await create.json()).task
    const comment = await inst.app.request(
      `/api/tasks/${task.id}/comments`,
      jsonReq(ana, 'POST', '', { body: 'ok' })
    )
    expect(comment.status).toBe(201)
    const detail = await inst.app.request(`/api/tasks/${task.id}`, { headers: { cookie: ana.cookie } })
    expect(detail.status).toBe(200)
  })
})

describe('project membership — backfill de proyectos legados', () => {
  it('al abrir una BD con proyectos y usuarios sin membresía, todos quedan como miembros', async () => {
    const inst = await makeInstance({ seedDemoData: false })
    const admin = await loginAdmin(inst.app)
    // crea un proyecto vía API (tiene membresía propia) y un usuario extra
    await inst.app.request('/api/projects', jsonReq(admin, 'POST', '/api/projects', { name: 'Legado-vía-API', emoji: 'home', color: 'sky' }))
    const ana = await createUser(inst.app, admin, 'ana')

    // Simula un proyecto "legado": se inserta directo en la BD sin membresía.
    inst.prod
      .prepare("INSERT INTO projects (id, name, emoji, color, position, created_at) VALUES (?, 'Legado', 'home', 'sky', 9, ?)")
      .run('p-legado', Date.now())

    // Re-abre la misma BD: el backfill debe sembrar membresía para 'p-legado'.
    openDb(inst.dir + '/app.db')
    const { projectIds } = await bootstrapIds(inst.app, ana)
    expect(projectIds).toContain('p-legado')
  })
})
