// expenses.test.js — plugin de gastos: gate por KV, CRUD, permisos,
// auto-transición a 'hecho', move con reindexado, papelera y export.
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

async function makeExpenseInstance() {
  const inst = await makeInstance({ seedDemoData: false })
  kvSet(inst.prod, 'plugin_expenses_enabled', '1')
  const admin = await loginAdmin(inst.app)
  return { ...inst, admin }
}

async function createExpense(app, session, extra = {}) {
  const res = await app.request(
    '/api/expenses',
    jsonReq(session, 'POST', '/api/expenses', { title: 'Cena', amount_cents: 4550, ...extra })
  )
  expect(res.status).toBe(201)
  return (await res.json()).expense
}

describe('expenses — gate del plugin', () => {
  it('con el plugin OFF todas las rutas devuelven 404', async () => {
    const inst = await makeInstance({ seedDemoData: false })
    const admin = await loginAdmin(inst.app)
    const list = await inst.app.request('/api/expenses', { headers: { cookie: admin.cookie } })
    expect(list.status).toBe(404)
    const post = await inst.app.request(
      '/api/expenses',
      jsonReq(admin, 'POST', '/api/expenses', { title: 'x', amount_cents: 100 })
    )
    expect(post.status).toBe(404)
  })

  it('con el plugin ON el listado responde vacío', async () => {
    const { app, admin } = await makeExpenseInstance()
    const res = await app.request('/api/expenses', { headers: { cookie: admin.cookie } })
    expect(res.status).toBe(200)
    expect((await res.json()).expenses).toEqual([])
  })
})

describe('expenses — CRUD', () => {
  it('crear devuelve el gasto hidratado y aparece en el listado', async () => {
    const { app, admin } = await makeExpenseInstance()
    const exp = await createExpense(app, admin)
    expect(exp.title).toBe('Cena')
    expect(exp.amount_cents).toBe(4550)
    expect(exp.step).toBe('nuevo')
    expect(exp.created_by_username).toBe('admin')
    const list = await (await app.request('/api/expenses', { headers: { cookie: admin.cookie } })).json()
    expect(list.expenses.map((e) => e.id)).toContain(exp.id)
  })

  it('PUT actualiza campos y registra actividad', async () => {
    const { app, admin } = await makeExpenseInstance()
    const exp = await createExpense(app, admin)
    const res = await app.request(
      `/api/expenses/${exp.id}`,
      jsonReq(admin, 'PUT', `/api/expenses/${exp.id}`, { title: 'Cena editada', amount_cents: 5000 })
    )
    expect(res.status).toBe(200)
    const upd = (await res.json()).expense
    expect(upd.title).toBe('Cena editada')
    expect(upd.amount_cents).toBe(5000)
    const detail = await (
      await app.request(`/api/expenses/${exp.id}/detail`, { headers: { cookie: admin.cookie } })
    ).json()
    const types = detail.activity.map((e) => e.type)
    expect(types).toContain('created')
    expect(types).toContain('title')
    expect(types).toContain('amount')
  })

  it('crear con requested_user_id exige split_type (422 sin él)', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const anaId = (await (await app.request('/api/auth/me', { headers: { cookie: ana.cookie } })).json()).user.id
    const bad = await app.request(
      '/api/expenses',
      jsonReq(admin, 'POST', '/api/expenses', { title: 'x', amount_cents: 100, requested_user_id: anaId })
    )
    expect(bad.status).toBe(422)
    const ok = await app.request(
      '/api/expenses',
      jsonReq(admin, 'POST', '/api/expenses', {
        title: 'x', amount_cents: 100, requested_user_id: anaId, split_type: 'half',
      })
    )
    expect(ok.status).toBe(201)
  })

  it('no se puede pedir pago a uno mismo (422)', async () => {
    const { app, admin } = await makeExpenseInstance()
    const meId = (await (await app.request('/api/auth/me', { headers: { cookie: admin.cookie } })).json()).user.id
    const res = await app.request(
      '/api/expenses',
      jsonReq(admin, 'POST', '/api/expenses', {
        title: 'x', amount_cents: 100, requested_user_id: meId, split_type: 'half',
      })
    )
    expect(res.status).toBe(422)
  })
})

describe('expenses — permisos', () => {
  it('un tercero (ni creador ni requerido) no puede editar (403)', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const exp = await createExpense(app, admin)
    const res = await app.request(
      `/api/expenses/${exp.id}`,
      jsonReq(ana, 'PUT', `/api/expenses/${exp.id}`, { title: 'hackeada' })
    )
    expect(res.status).toBe(403)
  })

  it('solo el usuario requerido puede marcar paid_by_requested', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const anaId = (await (await app.request('/api/auth/me', { headers: { cookie: ana.cookie } })).json()).user.id
    const exp = await createExpense(app, admin, { requested_user_id: anaId, split_type: 'half' })
    // el creador no puede marcarlo en nombre del otro
    const asCreator = await app.request(
      `/api/expenses/${exp.id}`,
      jsonReq(admin, 'PUT', `/api/expenses/${exp.id}`, { paid_by_requested: true })
    )
    expect(asCreator.status).toBe(403)
    // el requerido sí
    const asRequested = await app.request(
      `/api/expenses/${exp.id}`,
      jsonReq(ana, 'PUT', `/api/expenses/${exp.id}`, { paid_by_requested: true })
    )
    expect(asRequested.status).toBe(200)
    expect((await asRequested.json()).expense.paid_by_requested).toBe(true)
  })

  it('solo el creador puede borrar (403 para el resto)', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const exp = await createExpense(app, admin)
    const asAna = await app.request(
      `/api/expenses/${exp.id}`,
      jsonReq(ana, 'DELETE', `/api/expenses/${exp.id}`)
    )
    expect(asAna.status).toBe(403)
    const asAdmin = await app.request(
      `/api/expenses/${exp.id}`,
      jsonReq(admin, 'DELETE', `/api/expenses/${exp.id}`)
    )
    expect(asAdmin.status).toBe(204)
  })
})

describe('expenses — flujo de pago y auto-transición', () => {
  it('sin requerido: pagar el creador lo lleva a hecho', async () => {
    const { app, admin } = await makeExpenseInstance()
    const exp = await createExpense(app, admin)
    const res = await app.request(
      `/api/expenses/${exp.id}`,
      jsonReq(admin, 'PUT', `/api/expenses/${exp.id}`, { paid_by_creator: true })
    )
    expect((await res.json()).expense.step).toBe('hecho')
  })

  it('con requerido: hecho solo cuando pagan ambos', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const anaId = (await (await app.request('/api/auth/me', { headers: { cookie: ana.cookie } })).json()).user.id
    const exp = await createExpense(app, admin, {
      requested_user_id: anaId, split_type: 'half', paid_by_creator: true,
    })
    expect(exp.step).toBe('nuevo') // el creador pagó pero falta ana
    const res = await app.request(
      `/api/expenses/${exp.id}`,
      jsonReq(ana, 'PUT', `/api/expenses/${exp.id}`, { paid_by_requested: true })
    )
    expect((await res.json()).expense.step).toBe('hecho')
  })
})

describe('expenses — move y posiciones', () => {
  it('mover entre columnas reindexa origen y destino', async () => {
    const { app, admin } = await makeExpenseInstance()
    const a = await createExpense(app, admin, { title: 'A' })
    const b = await createExpense(app, admin, { title: 'B' })
    const c = await createExpense(app, admin, { title: 'C' })
    const res = await app.request(
      `/api/expenses/${b.id}/move`,
      jsonReq(admin, 'PUT', `/api/expenses/${b.id}/move`, { step: 'en-curso', position: 0 })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).expense.step).toBe('en-curso')
    const list = (await (await app.request('/api/expenses', { headers: { cookie: admin.cookie } })).json()).expenses
    const nuevo = list.filter((e) => e.step === 'nuevo').sort((x, y) => x.position - y.position)
    expect(nuevo.map((e) => e.title)).toEqual(['A', 'C'])
    expect(nuevo.map((e) => e.position)).toEqual([0, 1])
  })
})

describe('expenses — comentarios y papelera', () => {
  it('comentar funciona y aparece en el detalle', async () => {
    const { app, admin } = await makeExpenseInstance()
    const exp = await createExpense(app, admin)
    const res = await app.request(
      `/api/expenses/${exp.id}/comments`,
      jsonReq(admin, 'POST', `/api/expenses/${exp.id}/comments`, { body: 'hola' })
    )
    expect(res.status).toBe(201)
    const detail = await (
      await app.request(`/api/expenses/${exp.id}/detail`, { headers: { cookie: admin.cookie } })
    ).json()
    expect(detail.comments).toHaveLength(1)
    expect(detail.comments[0].body).toBe('hola')
  })

  it('borrar → papelera → restore devuelve el gasto al tablero', async () => {
    const { app, admin } = await makeExpenseInstance()
    const exp = await createExpense(app, admin)
    await app.request(`/api/expenses/${exp.id}`, jsonReq(admin, 'DELETE', `/api/expenses/${exp.id}`))
    const afterDelete = (await (await app.request('/api/expenses', { headers: { cookie: admin.cookie } })).json()).expenses
    expect(afterDelete).toHaveLength(0)
    const trash = await (await app.request('/api/trash', { headers: { cookie: admin.cookie } })).json()
    expect(trash.expenses.map((e) => e.id)).toContain(exp.id)
  })

  it('el export incluye los gastos', async () => {
    const { app, admin } = await makeExpenseInstance()
    const exp = await createExpense(app, admin)
    const dump = await (await app.request('/api/export', { headers: { cookie: admin.cookie } })).json()
    expect(dump.expenses.map((e) => e.id)).toContain(exp.id)
    expect(dump).toHaveProperty('expense_trash')
  })
})

describe('expenses — saldar cuentas', () => {
  it('salda todas las deudas pendientes entre dos usuarios y transiciona a hecho', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const anaId = (await (await app.request('/api/auth/me', { headers: { cookie: ana.cookie } })).json()).user.id
    // dos deudas de ana hacia admin (creador ya pagó) y una sin pagar por el creador
    await createExpense(app, admin, { title: 'A', requested_user_id: anaId, split_type: 'half', paid_by_creator: true })
    await createExpense(app, admin, { title: 'B', requested_user_id: anaId, split_type: 'full', paid_by_creator: true })
    const c3 = await createExpense(app, admin, { title: 'C', requested_user_id: anaId, split_type: 'half' })

    const res = await app.request(
      '/api/expenses/settle',
      jsonReq(ana, 'POST', '/api/expenses/settle', { other_user_id: (await (await app.request('/api/auth/me', { headers: { cookie: admin.cookie } })).json()).user.id })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).settled).toBe(3)

    const list = (await (await app.request('/api/expenses', { headers: { cookie: admin.cookie } })).json()).expenses
    for (const e of list) expect(e.paid_by_requested).toBe(true)
    expect(list.find((e) => e.title === 'A').step).toBe('hecho')
    expect(list.find((e) => e.title === 'B').step).toBe('hecho')
    // C: el creador no ha pagado aún → no pasa a hecho
    expect(list.find((e) => e.id === c3.id).step).toBe(c3.step)
  })

  it('sin deudas pendientes devuelve settled 0; saldarse a uno mismo es 422', async () => {
    const { app, admin } = await makeExpenseInstance()
    const ana = await createUser(app, admin, 'ana')
    const anaId = (await (await app.request('/api/auth/me', { headers: { cookie: ana.cookie } })).json()).user.id
    const empty = await app.request(
      '/api/expenses/settle',
      jsonReq(admin, 'POST', '/api/expenses/settle', { other_user_id: anaId })
    )
    expect(empty.status).toBe(200)
    expect((await empty.json()).settled).toBe(0)
    const meId = (await (await app.request('/api/auth/me', { headers: { cookie: admin.cookie } })).json()).user.id
    const self = await app.request(
      '/api/expenses/settle',
      jsonReq(admin, 'POST', '/api/expenses/settle', { other_user_id: meId })
    )
    expect(self.status).toBe(422)
  })
})
