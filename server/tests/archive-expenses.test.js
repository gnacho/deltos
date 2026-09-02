// archive-expenses.test.js — archivado de gastos: manual (solo 'hecho'/Pagado),
// unarchive con ventana fresca, auto-archivo a los 3 días, done_at en
// create/move/settle y reactivación al mover.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'
import { kvSet } from '../src/db.js'
import { archiveStaleDoneExpenses } from '../src/db.js'

const DAY = 24 * 60 * 60 * 1000

async function setup() {
  const inst = await makeInstance({ seedDemoData: false })
  kvSet(inst.prod, 'plugin_expenses_enabled', '1')
  const auth = await loginAdmin(inst.app)
  return { ...inst, auth }
}

async function createExpense(app, auth, title, extra = {}) {
  const res = await app.request(
    '/api/expenses',
    jsonReq(auth, 'POST', '/api/expenses', { title, amount_cents: 1000, ...extra })
  )
  expect(res.status).toBe(201)
  return (await res.json()).expense
}

async function rawExpense(db, id) {
  return db.prepare('SELECT * FROM expenses WHERE id = ?').get(id)
}

describe('expense archive', () => {
  it('archiva un gasto pagado y la lista lo sigue devolviendo con archived_at', async () => {
    const { app, auth, prod } = await setup()
    const paid = await createExpense(app, auth, 'Pagado', { step: 'hecho' })

    const res = await app.request(`/api/expenses/${paid.id}/archive`, jsonReq(auth, 'POST', '', {}))
    expect(res.status).toBe(200)
    const expense = (await res.json()).expense
    expect(expense.archived_at).not.toBeNull()

    const list = await (await app.request('/api/expenses', { headers: { cookie: auth.cookie } })).json()
    const inList = list.expenses.find((e) => e.id === paid.id)
    expect(inList.archived_at).not.toBeNull()
    void prod
  })

  it('rechaza archivar un gasto no pagado (422 EXPENSE_NOT_DONE)', async () => {
    const { app, auth } = await setup()
    const open = await createExpense(app, auth, 'Abierto', { step: 'nuevo' })
    const res = await app.request(`/api/expenses/${open.id}/archive`, jsonReq(auth, 'POST', '', {}))
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('EXPENSE_NOT_DONE')
  })

  it('desarchivar devuelve el gasto al final de hecho con done_at fresco', async () => {
    const { app, auth, prod } = await setup()
    const a = await createExpense(app, auth, 'A', { step: 'hecho' })
    const b = await createExpense(app, auth, 'B', { step: 'hecho' })

    await app.request(`/api/expenses/${a.id}/archive`, jsonReq(auth, 'POST', '', {}))
    expect((await rawExpense(prod, b.id)).position).toBe(0)

    const res = await app.request(`/api/expenses/${a.id}/unarchive`, jsonReq(auth, 'POST', '', {}))
    expect(res.status).toBe(200)
    const row = await rawExpense(prod, a.id)
    expect(row.archived_at).toBeNull()
    expect(row.step).toBe('hecho')
    expect(row.position).toBe(1)
    expect(row.done_at).not.toBeNull()
  })

  it('crear en hecho marca done_at; mover fuera lo limpia y reactiva', async () => {
    const { app, auth, prod } = await setup()
    const e = await createExpense(app, auth, 'Directo', { step: 'hecho' })
    expect((await rawExpense(prod, e.id)).done_at).not.toBeNull()

    await app.request(`/api/expenses/${e.id}/archive`, jsonReq(auth, 'POST', '', {}))
    expect((await rawExpense(prod, e.id)).archived_at).not.toBeNull()

    const res = await app.request(
      `/api/expenses/${e.id}/move`,
      jsonReq(auth, 'PUT', '', { step: 'nuevo', position: 0 })
    )
    expect(res.status).toBe(200)
    const row = await rawExpense(prod, e.id)
    expect(row.archived_at).toBeNull()
    expect(row.step).toBe('nuevo')
    expect(row.done_at).toBeNull()
    // La secuencia de 'hecho' sigue contigua entre activos
    await createExpense(app, auth, 'X', { step: 'hecho' })
    await createExpense(app, auth, 'Y', { step: 'hecho' })
    const pos = prod
      .prepare("SELECT position FROM expenses WHERE step = 'hecho' AND archived_at IS NULL ORDER BY position")
      .all()
      .map((r) => r.position)
    expect(pos).toEqual([0, 1])
  })

  it('auto-archivo: archiva los pagados hace +3 días y deja los recientes', async () => {
    const { app, auth, prod } = await setup()
    const viejo = await createExpense(app, auth, 'Viejo', { step: 'hecho' })
    const reciente = await createExpense(app, auth, 'Reciente', { step: 'hecho' })
    const abierto = await createExpense(app, auth, 'Abierto', { step: 'nuevo' })

    prod.prepare('UPDATE expenses SET done_at = ? WHERE id = ?').run(Date.now() - 4 * DAY, viejo.id)
    expect(archiveStaleDoneExpenses(prod)).toBe(1)
    expect((await rawExpense(prod, viejo.id)).archived_at).not.toBeNull()
    expect((await rawExpense(prod, reciente.id)).archived_at).toBeNull()
    expect((await rawExpense(prod, abierto.id)).archived_at).toBeNull()
  })

  it('auto-archivo auto-cura done_at NULL con updated_at (semillas pre-migración)', async () => {
    const { app, auth, prod } = await setup()
    const e = await createExpense(app, auth, 'Sin marca', { step: 'hecho' })
    prod.prepare('UPDATE expenses SET done_at = NULL, updated_at = ? WHERE id = ?').run(Date.now() - 5 * DAY, e.id)
    expect(archiveStaleDoneExpenses(prod)).toBe(1)
    expect((await rawExpense(prod, e.id)).archived_at).not.toBeNull()
  })
})
