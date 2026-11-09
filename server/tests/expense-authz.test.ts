// expense-authz.test.ts — toda mutación (y el listado) de invitaciones, el move
// y el borrado de adjuntos exigen ser creador o pagador del gasto. Caso origen:
// advisory GHSA-57q8-w8c6-96xh (un miembro cualquiera podía tocar gastos ajenos).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { makeInstance, loginAdmin, loginUser, jsonReq } from './helpers.js'
import { kvSet } from '../src/db.js'

const PASS = 'passwd1234567'

async function createUser(app, admin, username) {
  const res = await app.request(
    '/api/users',
    jsonReq(admin, 'POST', '/api/users', { username, password: PASS, color: 'slate', role: 'user' })
  )
  expect(res.status).toBe(201)
  const session = await loginUser(app, username, PASS)
  expect(session).not.toBeNull()
  return session
}

async function setup() {
  const inst = await makeInstance({ seedDemoData: false })
  kvSet(inst.prod, 'plugin_expenses_enabled', '1')
  const admin = await loginAdmin(inst.app)
  const owner = await createUser(inst.app, admin, 'owner')
  const outsider = await createUser(inst.app, admin, 'outsider')

  const expRes = await inst.app.request(
    '/api/expenses',
    jsonReq(owner, 'POST', '/api/expenses', { title: 'Cena', amount_cents: 6000 })
  )
  expect(expRes.status).toBe(201)
  const expense = (await expRes.json()).expense

  const invRes = await inst.app.request(
    '/api/invite/create',
    jsonReq(owner, 'POST', '/api/invite/create', {
      invite_name: 'Ana',
      share_cents: 3000,
      expense_id: expense.id,
    })
  )
  expect(invRes.status).toBe(201)
  const invite = (await invRes.json()).invite

  return { ...inst, admin, owner, outsider, expense, invite }
}

function stepOf(prod, expenseId) {
  return prod.prepare('SELECT step, done_at FROM expenses WHERE id = ?').get(expenseId)
}

describe('gastos — autorización de invitaciones y mutaciones', () => {
  it('un miembro ajeno no puede listar las invitaciones de un gasto', async () => {
    const { app, owner, outsider, expense } = await setup()

    const mine = await app.request(`/api/expenses/${expense.id}/invites`, {
      headers: { cookie: owner.cookie },
    })
    expect(mine.status).toBe(200)
    expect((await mine.json()).invites).toHaveLength(1)

    const foreign = await app.request(`/api/expenses/${expense.id}/invites`, {
      headers: { cookie: outsider.cookie },
    })
    expect(foreign.status).toBe(403)
    expect((await foreign.json()).error.code).toBe('PROJECT_NOT_MEMBER')
  })

  it('un miembro ajeno no puede crear invitaciones en un gasto ajeno', async () => {
    const { app, prod, outsider, expense } = await setup()

    const res = await app.request(
      '/api/invite/create',
      jsonReq(outsider, 'POST', '/api/invite/create', {
        invite_name: 'Intruso',
        share_cents: 9999,
        expense_id: expense.id,
      })
    )
    expect(res.status).toBe(403)
    const count = prod.prepare('SELECT COUNT(*) AS n FROM expense_invites WHERE expense_id = ?').get(expense.id)
    expect(count.n).toBe(1)
    expect(stepOf(prod, expense.id).step).toBe('en-curso')
  })

  it('un miembro ajeno no puede revocar una invitación ajena', async () => {
    const { app, prod, owner, outsider, invite } = await setup()

    const res = await app.request(`/api/invite/${invite.id}`, jsonReq(outsider, 'DELETE', ''))
    expect(res.status).toBe(403)
    const count = prod.prepare('SELECT COUNT(*) AS n FROM expense_invites WHERE id = ?').get(invite.id)
    expect(count.n).toBe(1)

    const own = await app.request(`/api/invite/${invite.id}`, jsonReq(owner, 'DELETE', ''))
    expect(own.status).toBe(200)
  })

  it('un miembro ajeno no puede mover un gasto ajeno (pago falso)', async () => {
    const { app, prod, outsider, owner, expense } = await setup()

    const before = stepOf(prod, expense.id)
    expect(before.step).toBe('en-curso')

    const res = await app.request(
      `/api/expenses/${expense.id}/move`,
      jsonReq(outsider, 'PUT', '', { step: 'hecho', position: 0 })
    )
    expect(res.status).toBe(403)
    const after = stepOf(prod, expense.id)
    expect(after.step).toBe('en-curso')
    expect(after.done_at).toBeNull()

    const own = await app.request(
      `/api/expenses/${expense.id}/move`,
      jsonReq(owner, 'PUT', '', { step: 'hecho', position: 0 })
    )
    expect(own.status).toBe(200)
    expect(stepOf(prod, expense.id).step).toBe('hecho')
  })

  it('un miembro ajeno no puede borrar el adjunto de un gasto ajeno', async () => {
    const { app, prod, uploadsDir, owner, outsider, expense } = await setup()

    const form = new FormData()
    form.append('file', new File(['recibo'], 'recibo.txt', { type: 'text/plain' }))
    const up = await app.request(`/api/expenses/${expense.id}/attachments`, {
      method: 'POST',
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrfToken },
      body: form,
    })
    expect(up.status).toBe(201)
    const attachment = await up.json()

    const res = await app.request(
      `/api/expenses/${expense.id}/attachments/${attachment.id}`,
      jsonReq(outsider, 'DELETE', '')
    )
    expect(res.status).toBe(403)
    const row = prod.prepare('SELECT COUNT(*) AS n FROM expense_attachments WHERE id = ?').get(attachment.id)
    expect(row.n).toBe(1)
    expect(fs.readdirSync(uploadsDir)).toHaveLength(1)

    const own = await app.request(
      `/api/expenses/${expense.id}/attachments/${attachment.id}`,
      jsonReq(owner, 'DELETE', '')
    )
    expect(own.status).toBe(204)
    expect(fs.readdirSync(uploadsDir)).toHaveLength(0)
  })

  it('el pagador (sin ser creador) conserva el control de la invitación y del move', async () => {
    const { app, prod, owner, outsider, expense } = await setup()

    const outsiderId = prod.prepare('SELECT id FROM users WHERE username = ?').get('outsider').id
    const upd = await app.request(
      `/api/expenses/${expense.id}`,
      jsonReq(owner, 'PUT', '', { payer_id: outsiderId })
    )
    expect(upd.status).toBe(200)

    const list = await app.request(`/api/expenses/${expense.id}/invites`, {
      headers: { cookie: outsider.cookie },
    })
    expect(list.status).toBe(200)
  })
})
