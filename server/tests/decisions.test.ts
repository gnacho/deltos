// decisions.test.js - módulo "Decisiones": CRUD, permisos, voto, choose/reopen,
// soft-delete/cascade y SSE `decision.changed`.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, loginUser, jsonReq } from './helpers.js'

const PASS = 'passwd1234567'

async function createUser(app, admin, username) {
  const res = await app.request(
    '/api/users',
    jsonReq(admin, 'POST', '/api/users', { username, password: PASS, color: 'slate', role: 'user' })
  )
  expect(res.status).toBe(201)
  return loginUser(app, username, PASS)
}

async function userId(app, session) {
  return (await (await app.request('/api/auth/me', { headers: { cookie: session.cookie } })).json()).user.id
}

async function makeDecisionsInstance() {
  const inst = await makeInstance({ seedDemoData: false })
  const admin = await loginAdmin(inst.app)
  const projectRes = await inst.app.request(
    '/api/projects',
    jsonReq(admin, 'POST', '/api/projects', { name: 'Casa', emoji: 'house', color: 'sky' })
  )
  expect(projectRes.status).toBe(201)
  const projectId = (await projectRes.json()).project.id
  return { ...inst, admin, projectId }
}

async function createDecision(app, session, extra = {}) {
  const res = await app.request(
    '/api/decisions',
    jsonReq(session, 'POST', '/api/decisions', { project_id: extra.project_id, title: '¿Qué comemos?', ...extra })
  )
  expect(res.status).toBe(201)
  return (await res.json()).decision
}

async function createSolution(app, session, decisionId, extra = {}) {
  const res = await app.request(
    `/api/decisions/${decisionId}/solutions`,
    jsonReq(session, 'POST', `/api/decisions/${decisionId}/solutions`, { title: 'Pizza', ...extra })
  )
  expect(res.status).toBe(201)
  return (await res.json()).solution
}

describe('decisiones - CRUD básico y permisos', () => {
  it('crear, listar y detalle con soluciones/votos/comentarios', async () => {
    const { app, admin, projectId } = await makeDecisionsInstance()
    const d = await createDecision(app, admin, { project_id: projectId, description: 'idea' })
    expect(d.status).toBe('open')
    expect(d.title).toBe('¿Qué comemos?')

    const list = await (await app.request('/api/decisions', { headers: { cookie: admin.cookie } })).json()
    expect(list.decisions.map((x) => x.id)).toContain(d.id)
    const row = list.decisions.find((x) => x.id === d.id)
    expect(row.created_by_username).toBe('admin')
    expect(row.counts.solutions).toBe(0)

    const detail = await (await app.request(`/api/decisions/${d.id}`, { headers: { cookie: admin.cookie } })).json()
    expect(detail.decision.id).toBe(d.id)
    expect(detail.solutions).toEqual([])
    expect(detail.comments).toEqual([])
  })

  it('no-miembro del proyecto -> 403 en todas las rutas', async () => {
    const { app, admin, projectId } = await makeDecisionsInstance()
    const d = await createDecision(app, admin, { project_id: projectId })
    const extra = await createUser(app, admin, 'extra')

    const getList = await app.request('/api/decisions', { headers: { cookie: extra.cookie } })
    expect(getList.status).toBe(200)
    expect((await getList.json()).decisions).toEqual([])

    const gets = [
      ['GET', `/api/decisions/${d.id}`, undefined],
      ['GET', `/api/decisions/${d.id}/comments`, undefined],
      ['PATCH', `/api/decisions/${d.id}`, { title: 'x' }],
      ['DELETE', `/api/decisions/${d.id}`, undefined],
      ['POST', `/api/decisions/${d.id}/solutions`, { title: 'x' }],
      ['PUT', `/api/decisions/${d.id}/vote`, { solution_id: 'whatever' }],
      ['DELETE', `/api/decisions/${d.id}/vote`, undefined],
      ['POST', `/api/decisions/${d.id}/choose`, { solution_id: null }],
      ['POST', `/api/decisions/${d.id}/reopen`, undefined],
      ['POST', `/api/decisions/${d.id}/comments`, { body: 'x' }],
    ]
    for (const [method, url, body] of gets) {
      const res = await app.request(url, jsonReq(extra, method, url, body))
      expect(res.status).toBe(403)
    }
  })

  it('editar título y descripción actualiza y registra actividad', async () => {
    const { app, admin, projectId, prod } = await makeDecisionsInstance()
    const d = await createDecision(app, admin, { project_id: projectId })
    const res = await app.request(
      `/api/decisions/${d.id}`,
      jsonReq(admin, 'PATCH', `/api/decisions/${d.id}`, { title: 'Nuevo título', description: 'matizada' })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).decision.title).toBe('Nuevo título')
    const evs = prod
      .prepare('SELECT type FROM decision_activity_events WHERE decision_id = ? ORDER BY created_at')
      .all(d.id)
      .map((e) => e.type)
    expect(evs).toContain('title')
    expect(evs).toContain('description')
  })
})

describe('decisiones - voto', () => {
  it('un voto por usuario: PUT mueve el voto, DELETE lo retira', async () => {
    const { app, admin, projectId } = await makeDecisionsInstance()
    const d = await createDecision(app, admin, { project_id: projectId })
    const s1 = await createSolution(app, admin, d.id, { title: 'Pizza' })
    const s2 = await createSolution(app, admin, d.id, { title: 'Sushi' })

    const vote = await app.request(
      `/api/decisions/${d.id}/vote`,
      jsonReq(admin, 'PUT', `/api/decisions/${d.id}/vote`, { solution_id: s1.id })
    )
    expect(vote.status).toBe(200)

    let detail = await (await app.request(`/api/decisions/${d.id}`, { headers: { cookie: admin.cookie } })).json()
    expect(detail.solutions.find((s) => s.id === s1.id).votes).toBe(1)
    expect(detail.solutions.find((s) => s.id === s1.id).my_vote).toBe(true)

    // mover el voto a otra solución
    await app.request(
      `/api/decisions/${d.id}/vote`,
      jsonReq(admin, 'PUT', `/api/decisions/${d.id}/vote`, { solution_id: s2.id })
    )
    detail = await (await app.request(`/api/decisions/${d.id}`, { headers: { cookie: admin.cookie } })).json()
    expect(detail.solutions.find((s) => s.id === s1.id).votes).toBe(0)
    expect(detail.solutions.find((s) => s.id === s2.id).votes).toBe(1)
    expect(detail.solutions.find((s) => s.id === s2.id).my_vote).toBe(true)

    // retirar el voto
    await app.request(`/api/decisions/${d.id}/vote`, jsonReq(admin, 'DELETE', `/api/decisions/${d.id}/vote`))
    detail = await (await app.request(`/api/decisions/${d.id}`, { headers: { cookie: admin.cookie } })).json()
    expect(detail.solutions.every((s) => s.votes === 0)).toBe(true)
    expect(detail.solutions.every((s) => s.my_vote === false)).toBe(true)
  })

  it('votar en decisión decidida -> 409', async () => {
    const { app, admin, projectId } = await makeDecisionsInstance()
    const d = await createDecision(app, admin, { project_id: projectId })
    const s1 = await createSolution(app, admin, d.id)
    await app.request(
      `/api/decisions/${d.id}/choose`,
      jsonReq(admin, 'POST', `/api/decisions/${d.id}/choose`, { solution_id: s1.id })
    )
    const vote = await app.request(
      `/api/decisions/${d.id}/vote`,
      jsonReq(admin, 'PUT', `/api/decisions/${d.id}/vote`, { solution_id: s1.id })
    )
    expect(vote.status).toBe(409)
    expect((await vote.json()).error.code).toBe('DECISION_NOT_OPEN')
  })
})

describe('decisiones - choose / reopen', () => {
  it('solo creador o admin elige; elegir solución de otra decisión -> 404', async () => {
    const { app, admin, projectId } = await makeDecisionsInstance()
    const ana = await createUser(app, admin, 'ana')
    // ana es miembro: la añadimos al proyecto
    const anaId = await userId(app, ana)
    await app.request(
      `/api/projects/${projectId}/members`,
      jsonReq(admin, 'PUT', `/api/projects/${projectId}/members`, { member_ids: [anaId] })
    )
    const d = await createDecision(app, admin, { project_id: projectId })
    const s1 = await createSolution(app, admin, d.id)

    const asAna = await app.request(
      `/api/decisions/${d.id}/choose`,
      jsonReq(ana, 'POST', `/api/decisions/${d.id}/choose`, { solution_id: s1.id })
    )
    expect(asAna.status).toBe(403)

    // solución de otra decisión
    const other = await createDecision(app, admin, { project_id: projectId })
    const otherSol = await createSolution(app, admin, other.id)
    const bad = await app.request(
      `/api/decisions/${d.id}/choose`,
      jsonReq(admin, 'POST', `/api/decisions/${d.id}/choose`, { solution_id: otherSol.id })
    )
    expect(bad.status).toBe(404)
    expect((await bad.json()).error.code).toBe('SOLUTION_NOT_FOUND')

    const ok = await app.request(
      `/api/decisions/${d.id}/choose`,
      jsonReq(admin, 'POST', `/api/decisions/${d.id}/choose`, { solution_id: s1.id })
    )
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.decision.status).toBe('decided')
    expect(body.decision.chosen_solution_id).toBe(s1.id)
  })

  it('cerrar sin solución -> decided con chosen_solution_id null; reopen restaura', async () => {
    const { app, admin, projectId } = await makeDecisionsInstance()
    const d = await createDecision(app, admin, { project_id: projectId })
    const close = await app.request(
      `/api/decisions/${d.id}/choose`,
      jsonReq(admin, 'POST', `/api/decisions/${d.id}/choose`, {})
    )
    expect(close.status).toBe(200)
    let body = await close.json()
    expect(body.decision.status).toBe('decided')
    expect(body.decision.chosen_solution_id).toBeNull()

    const reopen = await app.request(
      `/api/decisions/${d.id}/reopen`,
      jsonReq(admin, 'POST', `/api/decisions/${d.id}/reopen`, {})
    )
    expect(reopen.status).toBe(200)
    body = await reopen.json()
    expect(body.decision.status).toBe('open')
    expect(body.decision.decided_at).toBeNull()
  })

  it('borrar la solución elegida reabre la decisión', async () => {
    const { app, admin, projectId } = await makeDecisionsInstance()
    const d = await createDecision(app, admin, { project_id: projectId })
    const s1 = await createSolution(app, admin, d.id)
    await app.request(
      `/api/decisions/${d.id}/choose`,
      jsonReq(admin, 'POST', `/api/decisions/${d.id}/choose`, { solution_id: s1.id })
    )
    const del = await app.request(
      `/api/decisions/${d.id}/solutions/${s1.id}`,
      jsonReq(admin, 'DELETE', `/api/decisions/${d.id}/solutions/${s1.id}`)
    )
    expect(del.status).toBe(204)
    const detail = await (await app.request(`/api/decisions/${d.id}`, { headers: { cookie: admin.cookie } })).json()
    expect(detail.decision.status).toBe('open')
    expect(detail.decision.chosen_solution_id).toBeNull()
  })
})

describe('decisiones - soft delete y cascade', () => {
  it('soft delete no aparece en listas; cascade borra interiores al hard-delete', async () => {
    const { app, admin, projectId, prod } = await makeDecisionsInstance()
    const d = await createDecision(app, admin, { project_id: projectId })
    const s1 = await createSolution(app, admin, d.id)
    await app.request(
      `/api/decisions/${d.id}/vote`,
      jsonReq(admin, 'PUT', `/api/decisions/${d.id}/vote`, { solution_id: s1.id })
    )
    await app.request(
      `/api/decisions/${d.id}/comments`,
      jsonReq(admin, 'POST', `/api/decisions/${d.id}/comments`, { body: 'matizo' })
    )

    const del = await app.request(`/api/decisions/${d.id}`, jsonReq(admin, 'DELETE', `/api/decisions/${d.id}`))
    expect(del.status).toBe(204)

    // no aparece en la lista
    const list = await (await app.request('/api/decisions', { headers: { cookie: admin.cookie } })).json()
    expect(list.decisions.map((x) => x.id)).not.toContain(d.id)
    // la fila sigue en BD (soft delete)
    expect(prod.prepare('SELECT id FROM decisions WHERE id = ?').get(d.id)).toBeTruthy()

    // hard delete manual -> cascada a soluciones/votos/comentarios
    prod.prepare('DELETE FROM decisions WHERE id = ?').run(d.id)
    expect(prod.prepare('SELECT COUNT(*) AS n FROM decision_solutions WHERE decision_id = ?').get(d.id).n).toBe(0)
    expect(prod.prepare('SELECT COUNT(*) AS n FROM decision_votes WHERE decision_id = ?').get(d.id).n).toBe(0)
    expect(prod.prepare('SELECT COUNT(*) AS n FROM decision_comments WHERE decision_id = ?').get(d.id).n).toBe(0)
  })
})

describe('decisiones - SSE', () => {
  function fakeStream() {
    const sent = []
    return { sent, writeSSE: (m) => { sent.push(m); return Promise.resolve() } }
  }

  it('POST/PATCH/DELETE emiten decision.changed', async () => {
    const { app, admin, projectId, hub } = await makeDecisionsInstance()
    const s = fakeStream()
    hub.add(s)

    await createDecision(app, admin, { project_id: projectId })
    expect(s.sent.length).toBe(1)
    expect(s.sent[0].event).toBe('decision.changed')

    const d = (await (await app.request('/api/decisions', { headers: { cookie: admin.cookie } })).json()).decisions[0]
    const before = s.sent.length

    await app.request(`/api/decisions/${d.id}`, jsonReq(admin, 'PATCH', `/api/decisions/${d.id}`, { title: 'cambiado' }))
    expect(s.sent.length).toBe(before + 1)
    expect(s.sent[s.sent.length - 1].event).toBe('decision.changed')

    await app.request(`/api/decisions/${d.id}`, jsonReq(admin, 'DELETE', `/api/decisions/${d.id}`))
    expect(s.sent[s.sent.length - 1].event).toBe('decision.changed')
  })
})
