// decision-gamification.test.js - puntos por decisiones (issue #280): +8 al
// autor de la solución elegida (reversión/reactivación), +1 por votar una vez
// por decisión, resumen y la migración de gam_points_ledger (decision_id
// nullable, task_id deja de ser NOT NULL sin perder filas).
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, loginUser, jsonReq } from './helpers.js'
import { migrateSchema, SCHEMA } from '../src/db.js'

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

async function makeInstanceWithProject() {
  const inst = await makeInstance({ seedDemoData: false })
  const admin = await loginAdmin(inst.app)
  const proj = await inst.app.request(
    '/api/projects',
    jsonReq(admin, 'POST', '/api/projects', { name: 'Casa', emoji: 'house', color: 'sky' })
  )
  expect(proj.status).toBe(201)
  const project = (await proj.json()).project
  return { ...inst, admin, project }
}

async function addMembers(app, admin, projectId, sessions) {
  const ids = []
  for (const session of sessions) ids.push(await userId(app, session))
  const res = await app.request(
    `/api/projects/${projectId}/members`,
    jsonReq(admin, 'PUT', `/api/projects/${projectId}/members`, { member_ids: ids })
  )
  expect(res.status).toBe(200)
  return ids
}

// PUT /members REEMPLAZA la lista: con un solo miembro es equivalente.
async function addMember(app, admin, projectId, session) {
  return (await addMembers(app, admin, projectId, [session]))[0]
}

async function createDecision(app, session, projectId, title = '¿Qué comemos?') {
  const res = await app.request(
    '/api/decisions',
    jsonReq(session, 'POST', '/api/decisions', { project_id: projectId, title })
  )
  expect(res.status).toBe(201)
  return (await res.json()).decision
}

async function createSolution(app, session, decisionId, title = 'Pizza') {
  const res = await app.request(
    `/api/decisions/${decisionId}/solutions`,
    jsonReq(session, 'POST', `/api/decisions/${decisionId}/solutions`, { title })
  )
  expect(res.status).toBe(201)
  return (await res.json()).solution
}

async function choose(app, session, decisionId, solutionId) {
  return app.request(
    `/api/decisions/${decisionId}/choose`,
    jsonReq(session, 'POST', `/api/decisions/${decisionId}/choose`, { solution_id: solutionId })
  )
}

async function vote(app, session, decisionId, solutionId) {
  return app.request(
    `/api/decisions/${decisionId}/vote`,
    jsonReq(session, 'PUT', `/api/decisions/${decisionId}/vote`, { solution_id: solutionId })
  )
}

async function unvote(app, session, decisionId) {
  return app.request(`/api/decisions/${decisionId}/vote`, jsonReq(session, 'DELETE', `/api/decisions/${decisionId}/vote`))
}

async function summary(app, session) {
  const res = await app.request('/api/gamification/summary', { headers: { cookie: session.cookie } })
  expect(res.status).toBe(200)
  return res.json()
}

function balanceOf(s, username) {
  const u = s.users.find((x) => x.username === username)
  expect(u).toBeDefined()
  return u
}

async function createTask(app, session, projectId, title) {
  const res = await app.request(
    '/api/tasks',
    jsonReq(session, 'POST', '/api/tasks', { project_id: projectId, title })
  )
  expect(res.status).toBe(201)
  return (await res.json()).task
}

async function moveTask(app, session, id, column, position = 0) {
  const res = await app.request(
    `/api/tasks/${id}/move`,
    jsonReq(session, 'POST', `/api/tasks/${id}/move`, { column, position })
  )
  expect(res.status).toBe(200)
}

describe('gamificación de decisiones - solución elegida', () => {
  it('elegir una solución concede +8 a su autor (no al creador) y aparece en el historial', async () => {
    const { app, prod, admin, project } = await makeInstanceWithProject()
    const ana = await createUser(app, admin, 'ana')
    await addMember(app, admin, project.id, ana)
    const d = await createDecision(app, admin, project.id)
    const sol = await createSolution(app, ana, d.id)

    const res = await choose(app, admin, d.id, sol.id)
    expect(res.status).toBe(200)

    const s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(8)
    expect(balanceOf(s, 'admin').balance).toBe(0)
    expect(s.recent).toHaveLength(1)
    expect(s.recent[0].reason).toBe('decision_chosen')
    expect(s.recent[0].decision_title).toBe('¿Qué comemos?')
    expect(s.recent[0].decision_id).toBe(d.id)
    expect(s.recent[0].task_title).toBeNull()

    // Una sola fila en el ledger, con task_id NULL.
    const row = prod
      .prepare("SELECT task_id, decision_id, points FROM gam_points_ledger WHERE reason = 'decision_chosen'")
      .get()
    expect(row.task_id).toBeNull()
    expect(row.decision_id).toBe(d.id)
    expect(row.points).toBe(8)
  })

  it('re-elegir la misma solución no duplica (reactiva la entrada)', async () => {
    const { app, prod, admin, project } = await makeInstanceWithProject()
    const ana = await createUser(app, admin, 'ana')
    await addMember(app, admin, project.id, ana)
    const d = await createDecision(app, admin, project.id)
    const sol = await createSolution(app, ana, d.id)
    await choose(app, admin, d.id, sol.id)
    await choose(app, admin, d.id, sol.id) // re-elegir sin reabrir

    const s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(8)
    const n = prod
      .prepare("SELECT COUNT(*) AS n FROM gam_points_ledger WHERE reason = 'decision_chosen' AND decision_id = ?")
      .get(d.id).n
    expect(n).toBe(1)
  })

  it('elegir otra solución revierte los puntos de la anterior', async () => {
    const { app, admin, project } = await makeInstanceWithProject()
    const ana = await createUser(app, admin, 'ana')
    const berto = await createUser(app, admin, 'berto')
    await addMembers(app, admin, project.id, [ana, berto])
    const d = await createDecision(app, admin, project.id)
    const solAna = await createSolution(app, ana, d.id, 'Pizza')
    const solBerto = await createSolution(app, berto, d.id, 'Tortilla')

    await choose(app, admin, d.id, solAna.id)
    let s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(8)
    expect(balanceOf(s, 'berto').balance).toBe(0)

    await choose(app, admin, d.id, solBerto.id)
    s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(0)
    expect(balanceOf(s, 'berto').balance).toBe(8)
  })

  it('reabrir revierte los puntos del elegido; reelegir los re-concede reactivando la fila', async () => {
    const { app, prod, admin, project } = await makeInstanceWithProject()
    const ana = await createUser(app, admin, 'ana')
    await addMember(app, admin, project.id, ana)
    const d = await createDecision(app, admin, project.id)
    const sol = await createSolution(app, ana, d.id)

    await choose(app, admin, d.id, sol.id)
    const reopen = await app.request(
      `/api/decisions/${d.id}/reopen`,
      jsonReq(admin, 'POST', `/api/decisions/${d.id}/reopen`, {})
    )
    expect(reopen.status).toBe(200)
    let s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(0)

    await choose(app, admin, d.id, sol.id)
    s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(8)
    const n = prod
      .prepare("SELECT COUNT(*) AS n FROM gam_points_ledger WHERE reason = 'decision_chosen' AND decision_id = ?")
      .get(d.id).n
    expect(n).toBe(1) // reactivada, no duplicada
  })

  it('elegir cerrar sin solución (choose null) revierte los puntos', async () => {
    const { app, admin, project } = await makeInstanceWithProject()
    const ana = await createUser(app, admin, 'ana')
    await addMember(app, admin, project.id, ana)
    const d = await createDecision(app, admin, project.id)
    const sol = await createSolution(app, ana, d.id)
    await choose(app, admin, d.id, sol.id)

    await choose(app, admin, d.id, null)
    const s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(0)
  })

  it('borrar la solución elegida reabre la decisión y revierte sus puntos', async () => {
    const { app, admin, project } = await makeInstanceWithProject()
    const ana = await createUser(app, admin, 'ana')
    await addMember(app, admin, project.id, ana)
    const d = await createDecision(app, admin, project.id)
    const sol = await createSolution(app, ana, d.id)
    await choose(app, admin, d.id, sol.id)

    const del = await app.request(
      `/api/decisions/${d.id}/solutions/${sol.id}`,
      jsonReq(ana, 'DELETE', `/api/decisions/${d.id}/solutions/${sol.id}`)
    )
    expect(del.status).toBe(204)
    const s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(0)
  })

  it('proponer soluciones y cerrar no dan puntos', async () => {
    const { app, admin, project } = await makeInstanceWithProject()
    const ana = await createUser(app, admin, 'ana')
    await addMember(app, admin, project.id, ana)
    const d = await createDecision(app, admin, project.id)
    await createSolution(app, ana, d.id)
    await choose(app, admin, d.id, null) // cerrar sin elegir

    const s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(0)
    expect(balanceOf(s, 'admin').balance).toBe(0)
  })
})

describe('gamificación de decisiones - voto', () => {
  it('votar concede +1 una vez; mover el voto no duplica', async () => {
    const { app, prod, admin, project } = await makeInstanceWithProject()
    const ana = await createUser(app, admin, 'ana')
    await addMember(app, admin, project.id, ana)
    const d = await createDecision(app, admin, project.id)
    const sol1 = await createSolution(app, admin, d.id, 'Pizza')
    const sol2 = await createSolution(app, admin, d.id, 'Tortilla')

    await vote(app, ana, d.id, sol1.id)
    let s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(1)

    // Mover el voto a otra solución: sin puntos extra y una sola fila.
    await vote(app, ana, d.id, sol2.id)
    s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(1)
    const n = prod
      .prepare("SELECT COUNT(*) AS n FROM gam_points_ledger WHERE reason = 'decision_vote' AND decision_id = ?")
      .get(d.id).n
    expect(n).toBe(1)
  })

  it('retirar el voto revierte; volver a votar reactiva', async () => {
    const { app, prod, admin, project } = await makeInstanceWithProject()
    const ana = await createUser(app, admin, 'ana')
    await addMember(app, admin, project.id, ana)
    const d = await createDecision(app, admin, project.id)
    const sol = await createSolution(app, admin, d.id)

    await vote(app, ana, d.id, sol.id)
    await unvote(app, ana, d.id)
    let s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(0)

    await vote(app, ana, d.id, sol.id)
    s = await summary(app, admin)
    expect(balanceOf(s, 'ana').balance).toBe(1)
    const n = prod
      .prepare("SELECT COUNT(*) AS n FROM gam_points_ledger WHERE reason = 'decision_vote' AND decision_id = ?")
      .get(d.id).n
    expect(n).toBe(1)
  })

  it('reabrir NO toca los puntos de voto', async () => {
    const { app, admin, project } = await makeInstanceWithProject()
    const ana = await createUser(app, admin, 'ana')
    await addMember(app, admin, project.id, ana)
    const d = await createDecision(app, admin, project.id)
    const sol = await createSolution(app, ana, d.id)
    await vote(app, ana, d.id, sol.id)
    await choose(app, admin, d.id, sol.id)

    await app.request(`/api/decisions/${d.id}/reopen`, jsonReq(admin, 'POST', `/api/decisions/${d.id}/reopen`, {}))
    const s = await summary(app, admin)
    // ana pierde los +8 de la solución elegida pero conserva el +1 del voto.
    expect(balanceOf(s, 'ana').balance).toBe(1)
  })
})

describe('gamificación de decisiones - resumen', () => {
  it('el saldo y la semana suman decisiones; tasks_done_total cuenta solo tareas', async () => {
    const { app, admin, project } = await makeInstanceWithProject()
    const ana = await createUser(app, admin, 'ana')
    await addMember(app, admin, project.id, ana)
    const d = await createDecision(app, admin, project.id)
    const sol = await createSolution(app, ana, d.id)
    await vote(app, ana, d.id, sol.id)
    await choose(app, admin, d.id, sol.id)

    const task = await createTask(app, ana, project.id, 'Tarea')
    await moveTask(app, ana, task.id, 'hecho') // +5

    const s = await summary(app, ana)
    const me = balanceOf(s, 'ana')
    expect(me.balance).toBe(8 + 1 + 5)
    expect(me.week_points).toBe(8 + 1 + 5)
    expect(me.tasks_done_total).toBe(1) // solo la tarea
  })
})

describe('migración gam_points_ledger (decision_id + task_id nullable)', () => {
  it('reconstruye la tabla vieja sin perder filas y permite entradas de decisión', async () => {
    const { app, prod, admin, project } = await makeInstanceWithProject()
    // Tarea completada ANTES de la migración: fila real en el ledger.
    const task1 = await createTask(app, admin, project.id, 'Antes')
    await moveTask(app, admin, task1.id, 'hecho')
    // Decisión real: las entradas de decisión referencian decisions(id).
    const d = await createDecision(app, admin, project.id)

    // Simula una BD instalada antes de #280: task_id NOT NULL, sin decision_id.
    prod.exec(`
      ALTER TABLE gam_points_ledger RENAME TO gam_points_ledger_new;
      CREATE TABLE gam_points_ledger (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        points INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT 'task_done',
        created_at INTEGER NOT NULL,
        reverted_at INTEGER
      );
    `)
    const oldRow = prod.prepare('SELECT id, user_id, task_id, points, reason, created_at FROM gam_points_ledger_new').get()
    prod.prepare(
      `INSERT INTO gam_points_ledger (id, user_id, task_id, points, reason, created_at, reverted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    ).run(oldRow.id, oldRow.user_id, oldRow.task_id, oldRow.points, oldRow.reason, oldRow.created_at)
    prod.exec('DROP TABLE gam_points_ledger_new')

    // Sin migrar, una entrada de decisión es imposible (task_id NOT NULL).
    let refused = false
    try {
      prod
        .prepare(
          `INSERT INTO gam_points_ledger (id, user_id, task_id, decision_id, points, reason, created_at, reverted_at)
           VALUES ('dec1', ?, NULL, ?, 1, 'decision_vote', ?, NULL)`
        )
        .run(oldRow.user_id, d.id, Date.now())
    } catch {
      refused = true
    }
    expect(refused).toBe(true)

    migrateSchema(prod)

    // La fila de tarea sobrevive intacta.
    const preserved = prod.prepare('SELECT * FROM gam_points_ledger WHERE id = ?').get(oldRow.id)
    expect(preserved).toBeDefined()
    expect(preserved.task_id).toBe(oldRow.task_id)
    expect(preserved.points).toBe(oldRow.points)
    expect(preserved.decision_id).toBeNull()

    // Columnas nuevas: decision_id existe y task_id ya no es NOT NULL.
    const cols = prod.prepare('PRAGMA table_info(gam_points_ledger)').all()
    expect(cols.find((c) => c.name === 'decision_id')).toBeDefined()
    expect(cols.find((c) => c.name === 'task_id').notnull).toBe(0)

    // Una entrada de decisión se inserta (task_id NULL).
    prod
      .prepare(
        `INSERT INTO gam_points_ledger (id, user_id, task_id, decision_id, points, reason, created_at, reverted_at)
         VALUES ('dec1', ?, NULL, ?, 1, 'decision_vote', ?, NULL)`
      )
      .run(oldRow.user_id, d.id, Date.now())

    // Los índices sobreviven a la reconstrucción.
    const idx = prod
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='gam_points_ledger'")
      .all()
      .map((r) => r.name)
    expect(idx).toContain('idx_gam_ledger_task')
    expect(idx).toContain('idx_gam_ledger_decision')
    expect(idx).toContain('idx_gam_ledger_reverted')

    // Anti-regresión: una tarea sigue concediendo puntos igual tras migrar.
    const task2 = await createTask(app, admin, project.id, 'Después')
    await moveTask(app, admin, task2.id, 'hecho')
    const s = await summary(app, admin)
    const me = balanceOf(s, 'admin')
    expect(me.balance).toBe(5 + 1 + 5) // task1 + decision_vote + task2
    expect(me.tasks_done_total).toBe(2) // solo las dos tareas
  })

  it('el índice de decisión NO vive en el SCHEMA (en BD viejas el CREATE INDEX revienta antes de migrar, lección #246 / issue #282)', () => {
    expect(SCHEMA.includes('idx_gam_ledger_decision')).toBe(false)
  })
})
