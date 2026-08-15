// expenses.test.js — plugin de gastos, modelo v2 (payer + expense_shares):
// gate, CRUD con partes, permisos, mi-parte, transición derivada, saldar, papelera.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, loginUser, jsonReq } from './helpers.js'
import { kvSet } from '../src/db.js'

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

async function makeExpenseInstance() {
  const inst = await makeInstance({ seedDemoData: false })
  kvSet(inst.prod, 'plugin_expenses_enabled', '1')
  const admin = await loginAdmin(inst.app)
  return { ...inst, admin }
}

async function createExpense(app, session, extra = {}) {
  const res = await app.request(
    '/api/expenses',
    jsonReq(session, 'POST', '/api/expenses', { title: 'Cena', amount_cents: 6000, ...extra })
  )
  expect(res.status).toBe(201)
  return (await res.json()).expense
}

describe('expenses v2 — gate y básicos', () => {
  it('plugin OFF → 404; ON → listado vacío', async () => {
    const inst = await makeInstance({ seedDemoData: false })
    const admin = await loginAdmin(inst.app)
    expect((await inst.app.request('/api/expenses', { headers: { cookie: admin.cookie } })).status).toBe(404)
    kvSet(inst.prod, 'plugin_expenses_enabled', '1')
    const on = await inst.app.request('/api/expenses', { headers: { cookie: admin.cookie } })
    expect(on.status).toBe(200)
    expect((await on.json()).expenses).toEqual([])
  })

  it('crear sin partes: pagador = creador por defecto, spent_at presente', async () => {
    const { app, admin } = await makeExpenseInstance()
    const me = await userId(app, admin)
    const exp = await createExpense(app, admin)
    expect(exp.payer_id).toBe(me)
    expect(exp.payer_username).toBe('admin')
    expect(exp.shares).toEqual([])
    expect(exp.spent_at).toBeGreaterThan(0)
    expect(exp.step).toBe('nuevo') // sin reparto declarado se queda donde nace
  })

  it('spent_at y project_id se guardan; project inexistente → 422', async () => {
    const { app, admin } = await makeExpenseInstance()
    const pr = await app.request(
      '/api/projects',
      jsonReq(admin, 'POST', '/api/projects', { name: 'Viaje', emoji: 'plane', color: 'sky' })
    )
    const projectId = (await pr.json()).project.id
    const when = Date.parse('2026-07-15')
    const exp = await createExpense(app, admin, { spent_at: when, project_id: projectId })
    expect(exp.spent_at).toBe(when)
    expect(exp.project_id).toBe(projectId)
    expect(exp.project_name).toBe('Viaje')
    const bad = await app.request(
      '/api/expenses',
      jsonReq(admin, 'POST', '/api/expenses', { title: 'x', amount_cents: 100, project_id: 'no-existe' })
    )
    expect(bad.status).toBe(422)
  })
})

describe('expenses v2 — partes', () => {
  it('las partes no admiten usuarios repetidos (422); la suma puede no cuadrar', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const anaId = await userId(app, ana)
    const meId = await userId(app, admin)
    const mismatch = await app.request(
      '/api/expenses',
      jsonReq(admin, 'POST', '/api/expenses', {
        title: 'x', amount_cents: 6000,
        shares: [{ user_id: meId, share_cents: 3000 }, { user_id: anaId, share_cents: 2000 }],
      })
    )
    expect(mismatch.status).toBe(201)
    const dup = await app.request(
      '/api/expenses',
      jsonReq(admin, 'POST', '/api/expenses', {
        title: 'x', amount_cents: 6000,
        shares: [{ user_id: anaId, share_cents: 3000 }, { user_id: anaId, share_cents: 3000 }],
      })
    )
    expect(dup.status).toBe(422)
  })

  it('reparto a 3 con partes desiguales: la del pagador nace pagada', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const beto = await createUser(app, admin, 'beto')
    const [meId, anaId, betoId] = [await userId(app, admin), await userId(app, ana), await userId(app, beto)]
    const exp = await createExpense(app, admin, {
      shares: [
        { user_id: meId, share_cents: 2000 },
        { user_id: anaId, share_cents: 3000 },
        { user_id: betoId, share_cents: 1000 },
      ],
    })
    expect(exp.step).toBe('en-curso') // hay deudores → nunca se queda en nuevo si lo resuelve
    const mine = exp.shares.find((s) => s.user_id === meId)
    expect(mine.paid).toBe(true) // el pagador puso el dinero
    expect(exp.shares.filter((s) => !s.paid)).toHaveLength(2)
  })

  it('el pagador puede ser otro (patrón secretario) y su parte nace pagada', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const anaId = await userId(app, ana)
    const meId = await userId(app, admin)
    const exp = await createExpense(app, admin, {
      payer_id: anaId,
      shares: [{ user_id: anaId, share_cents: 3000 }, { user_id: meId, share_cents: 3000 }],
    })
    expect(exp.payer_id).toBe(anaId)
    expect(exp.shares.find((s) => s.user_id === anaId).paid).toBe(true)
    expect(exp.shares.find((s) => s.user_id === meId).paid).toBe(false)
  })
})

describe('expenses v2 — mi parte y transición', () => {
  it('cada uno marca SOLO su parte; al pagar la última el gasto pasa a hecho', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const anaId = await userId(app, ana)
    const meId = await userId(app, admin)
    const exp = await createExpense(app, admin, {
      shares: [{ user_id: meId, share_cents: 3000 }, { user_id: anaId, share_cents: 3000 }],
    })
    // un tercero sin parte no puede
    const beto = await createUser(app, admin, 'beto')
    const forbidden = await app.request(
      `/api/expenses/${exp.id}/my-share`,
      jsonReq(beto, 'PUT', `/api/expenses/${exp.id}/my-share`, { paid: true })
    )
    expect(forbidden.status).toBe(403)
    // ana paga la suya → todo pagado → hecho
    const res = await app.request(
      `/api/expenses/${exp.id}/my-share`,
      jsonReq(ana, 'PUT', `/api/expenses/${exp.id}/my-share`, { paid: true })
    )
    expect(res.status).toBe(200)
    const upd = (await res.json()).expense
    expect(upd.shares.find((s) => s.user_id === anaId).paid).toBe(true)
    expect(upd.step).toBe('hecho')
    // desmarcar la devuelve a en-curso
    const undo = await app.request(
      `/api/expenses/${exp.id}/my-share`,
      jsonReq(ana, 'PUT', `/api/expenses/${exp.id}/my-share`, { paid: false })
    )
    expect((await undo.json()).expense.step).toBe('en-curso')
  })

  it('editar: solo creador o pagador; cambiar importe con partes sin re-declararlas → 422', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const anaId = await userId(app, ana)
    const meId = await userId(app, admin)
    const exp = await createExpense(app, admin, {
      shares: [{ user_id: meId, share_cents: 3000 }, { user_id: anaId, share_cents: 3000 }],
    })
    const beto = await createUser(app, admin, 'beto')
    const forbidden = await app.request(
      `/api/expenses/${exp.id}`,
      jsonReq(beto, 'PUT', `/api/expenses/${exp.id}`, { title: 'hackeada' })
    )
    expect(forbidden.status).toBe(403)
    const badAmount = await app.request(
      `/api/expenses/${exp.id}`,
      jsonReq(admin, 'PUT', `/api/expenses/${exp.id}`, { amount_cents: 9000 })
    )
    expect(badAmount.status).toBe(422)
    const ok = await app.request(
      `/api/expenses/${exp.id}`,
      jsonReq(admin, 'PUT', `/api/expenses/${exp.id}`, {
        amount_cents: 9000,
        shares: [{ user_id: meId, share_cents: 4500 }, { user_id: anaId, share_cents: 4500 }],
      })
    )
    expect(ok.status).toBe(200)
    expect((await ok.json()).expense.amount_cents).toBe(9000)
  })
})

describe('expenses v2 — saldar cuentas', () => {
  it('salda en ambos sentidos, transiciona y deja el evento global del reembolso', async () => {
    const { app, admin, prod } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const anaId = await userId(app, ana)
    const meId = await userId(app, admin)
    // admin pagó 60, ana debe 30 · ana pagó 40, admin debe 20 → neto ana→admin 10
    await createExpense(app, admin, {
      title: 'A', shares: [{ user_id: meId, share_cents: 3000 }, { user_id: anaId, share_cents: 3000 }],
    })
    await createExpense(app, admin, {
      title: 'B', amount_cents: 4000, payer_id: anaId,
      shares: [{ user_id: anaId, share_cents: 2000 }, { user_id: meId, share_cents: 2000 }],
    })
    const res = await app.request(
      '/api/expenses/settle',
      jsonReq(ana, 'POST', '/api/expenses/settle', { other_user_id: meId })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.settled).toBe(2)
    expect(body.total_cents).toBe(5000)
    const list = (await (await app.request('/api/expenses', { headers: { cookie: admin.cookie } })).json()).expenses
    for (const e of list) {
      expect(e.step).toBe('hecho')
      for (const sh of e.shares) expect(sh.paid).toBe(true)
    }
    // evento global de reembolso (expense_id NULL) como artefacto auditable
    const ev = prod
      .prepare("SELECT * FROM expense_activity_events WHERE type = 'settled' AND expense_id IS NULL")
      .get()
    expect(ev).toBeTruthy()
    const data = JSON.parse(ev.data)
    expect(data.count).toBe(2)
    expect(data.total_cents).toBe(5000)
  })
})

describe('expenses v2 — papelera y export', () => {
  it('borrar (solo creador) → papelera; export incluye gastos y shares viajan en el listado', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const exp = await createExpense(app, admin)
    const asAna = await app.request(`/api/expenses/${exp.id}`, jsonReq(ana, 'DELETE', `/api/expenses/${exp.id}`))
    expect(asAna.status).toBe(403)
    const asAdmin = await app.request(`/api/expenses/${exp.id}`, jsonReq(admin, 'DELETE', `/api/expenses/${exp.id}`))
    expect(asAdmin.status).toBe(204)
    const trash = await (await app.request('/api/trash', { headers: { cookie: admin.cookie } })).json()
    expect(trash.expenses.map((e) => e.id)).toContain(exp.id)
    const dump = await (await app.request('/api/export', { headers: { cookie: admin.cookie } })).json()
    expect(dump).toHaveProperty('expenses')
  })
})

describe('expenses v2 — fases con invitaciones (#113)', () => {
  async function createInvite(app, session, expenseId, shareCents) {
    const res = await app.request(
      '/api/invite/create',
      jsonReq(session, 'POST', '/api/invite/create', {
        invite_name: 'Ana ext',
        share_cents: shareCents,
        expense_id: expenseId,
        notes: '',
      })
    )
    expect(res.status).toBe(201)
    return (await res.json()).invite
  }

  it('crear invite en un gasto sin reparto → auto-transición a en-curso (Repartido)', async () => {
    const { app, admin, prod } = await makeExpenseInstance()
    const meId = await userId(app, admin)
    const exp = await createExpense(app, admin) // step nuevo
    await createInvite(app, admin, exp.id, 3000)
    const upd = prod.prepare('SELECT step FROM expenses WHERE id = ?').get(exp.id)
    expect(upd.step).toBe('en-curso')
    const ana = await createUser(app, admin, 'ana')
    await createExpense(app, admin, {
      title: 'Con parte',
      shares: [{ user_id: meId, share_cents: 3000 }, { user_id: (await userId(app, ana)), share_cents: 3000 }],
    })
  })

  it('pagar la última parte con invites pendientes → NO pasa a hecho (sigue Repartido)', async () => {
    const { app, admin, prod } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const meId = await userId(app, admin)
    const anaId = await userId(app, ana)
    const exp = await createExpense(app, admin, {
      shares: [{ user_id: meId, share_cents: 3000 }, { user_id: anaId, share_cents: 3000 }],
    })
    await createInvite(app, admin, exp.id, 2000)
    // ana paga su parte; queda el invite pendiente → no puede pasar a hecho
    await app.request(
      `/api/expenses/${exp.id}/my-share`,
      jsonReq(ana, 'PUT', `/api/expenses/${exp.id}/my-share`, { paid: true })
    )
    expect(prod.prepare('SELECT step FROM expenses WHERE id = ?').get(exp.id).step).toBe('en-curso')
  })

  it('pagar el invite cuando todo lo demás está pagado → hecho (Pagado)', async () => {
    const { app, admin, prod } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const meId = await userId(app, admin)
    const anaId = await userId(app, ana)
    const exp = await createExpense(app, admin, {
      shares: [{ user_id: meId, share_cents: 3000 }, { user_id: anaId, share_cents: 3000 }],
    })
    const inv = await createInvite(app, admin, exp.id, 2000)
    await app.request(
      `/api/expenses/${exp.id}/my-share`,
      jsonReq(ana, 'PUT', `/api/expenses/${exp.id}/my-share`, { paid: true })
    )
    // el pagador ya nace pagado; al pagar el invite → todo pagado → hecho
    const pay = await app.request(
      `/api/invite/${inv.token}/pay`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
    )
    expect(pay.status).toBe(200)
    expect(prod.prepare('SELECT step FROM expenses WHERE id = ?').get(exp.id).step).toBe('hecho')
  })

  it('revocar el último invite sin shares → vuelve a nuevo; con shares se mantiene Repartido', async () => {
    const { app, admin, prod } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const meId = await userId(app, admin)
    const anaId = await userId(app, ana)
    // caso 1: solo invite → revocar → nuevo
    const solo = await createExpense(app, admin)
    const inv1 = await createInvite(app, admin, solo.id, 3000)
    const rev1 = await app.request(`/api/invite/${inv1.id}`, jsonReq(admin, 'DELETE', `/api/invite/${inv1.id}`))
    expect(rev1.status).toBe(200)
    expect(prod.prepare('SELECT step FROM expenses WHERE id = ?').get(solo.id).step).toBe('nuevo')
    // caso 2: share pendiente + invite → revocar invite → sigue en-curso
    const conShare = await createExpense(app, admin, {
      shares: [{ user_id: meId, share_cents: 3000 }, { user_id: anaId, share_cents: 3000 }],
    })
    const inv2 = await createInvite(app, admin, conShare.id, 2000)
    await app.request(`/api/invite/${inv2.id}`, jsonReq(admin, 'DELETE', `/api/invite/${inv2.id}`))
    expect(prod.prepare('SELECT step FROM expenses WHERE id = ?').get(conShare.id).step).toBe('en-curso')
  })

  it('crear invite sin auth → 401; revocar invite inexistente → 404', async () => {
    const { app, admin } = await makeExpenseInstance()
    const exp = await createExpense(app, admin)
    const anon = await app.request(
      '/api/invite/create',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite_name: 'x', share_cents: 100, expense_id: exp.id, notes: '' }) }
    )
    expect(anon.status).toBe(401)
    const bad = await app.request(`/api/invite/no-existe`, jsonReq(admin, 'DELETE', `/api/invite/no-existe`))
    expect(bad.status).toBe(404)
  })
})
