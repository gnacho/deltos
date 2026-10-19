// decision-attachments.test.js - adjuntos de decisiones (issue #279): subida a
// decisión y a soluciones, allowlist MIME estricta, límite por decisión,
// permisos de descarga/borrado y migración del CHECK de decision_activity_events.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, loginUser, jsonReq } from './helpers.js'
import { migrateSchema } from '../src/db.js'

const PASS = 'passwd1234567'

async function createUser(app, admin, username) {
  const res = await app.request(
    '/api/users',
    jsonReq(admin, 'POST', '/api/users', { username, password: PASS, color: 'slate', role: 'user' })
  )
  expect(res.status).toBe(201)
  return loginUser(app, username, PASS)
}

async function userIdOf(app, session) {
  return (await (await app.request('/api/auth/me', { headers: { cookie: session.cookie } })).json()).user.id
}

async function makeAttachmentsInstance() {
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

async function createDecision(app, session, projectId, extra = {}) {
  const res = await app.request(
    '/api/decisions',
    jsonReq(session, 'POST', '/api/decisions', { project_id: projectId, title: '¿Qué comemos?', ...extra })
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

function multipart(session, filename, type, content, solutionId) {
  const form = new FormData()
  form.append('file', new File([content], filename, { type }))
  if (solutionId) form.append('solution_id', solutionId)
  return {
    method: 'POST',
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrfToken },
    body: form,
  }
}

describe('decisiones - adjuntos', () => {
  it('subida a la decisión: 201, evento attachment, hydrate con la fila y fichero en disco', async () => {
    const { app, admin, projectId, prod, uploadsDir } = await makeAttachmentsInstance()
    const d = await createDecision(app, admin, projectId)

    const up = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(admin, 'notas.txt', 'text/plain', 'contenido de prueba')
    )
    expect(up.status).toBe(201)
    const { attachment } = await up.json()
    expect(attachment.filename).toBe('notas.txt')
    expect(attachment.size).toBe(19)
    expect(attachment.solution_id).toBeNull()
    expect(attachment.uploaded_by_username).toBe('admin')

    // Evento de actividad (INSERT con type='attachment' no revienta por el CHECK)
    const evs = prod
      .prepare('SELECT type, data FROM decision_activity_events WHERE decision_id = ?')
      .all(d.id)
    expect(evs.some((e) => e.type === 'attachment' && JSON.parse(e.data).filename === 'notas.txt')).toBe(true)

    // Detalle hidratado con attachments en array plano
    const detail = await (await app.request(`/api/decisions/${d.id}`, { headers: { cookie: admin.cookie } })).json()
    expect(detail.attachments).toHaveLength(1)
    expect(detail.attachments[0]).toMatchObject({ id: attachment.id, solution_id: null, mime: 'text/plain' })
    expect(detail.attachments[0].uploaded_by_username).toBe('admin')

    const fs = await import('node:fs')
    expect(fs.readdirSync(uploadsDir)).toHaveLength(1)
  })

  it('subida a una solución: 201 con solution_id y aparece agrupada en el detalle', async () => {
    const { app, admin, projectId } = await makeAttachmentsInstance()
    const d = await createDecision(app, admin, projectId)
    const s = await createSolution(app, admin, d.id)

    const up = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(admin, 'plano.pdf', 'application/pdf', '%PDF-1.4 prueba', s.id)
    )
    expect(up.status).toBe(201)
    expect((await up.json()).attachment.solution_id).toBe(s.id)

    const detail = await (await app.request(`/api/decisions/${d.id}`, { headers: { cookie: admin.cookie } })).json()
    expect(detail.attachments).toHaveLength(1)
    expect(detail.attachments[0].solution_id).toBe(s.id)
  })

  it('MIME no permitido (application/zip) -> 415', async () => {
    const { app, admin, projectId } = await makeAttachmentsInstance()
    const d = await createDecision(app, admin, projectId)
    const res = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(admin, 'paquete.zip', 'application/zip', 'PK')
    )
    expect(res.status).toBe(415)
    expect((await res.json()).error.code).toBe('UPLOAD_INVALID_MIME')
  })

  it('solution_id de otra decisión -> 404 SOLUTION_NOT_FOUND', async () => {
    const { app, admin, projectId } = await makeAttachmentsInstance()
    const d1 = await createDecision(app, admin, projectId)
    const d2 = await createDecision(app, admin, projectId)
    const s2 = await createSolution(app, admin, d2.id)
    const res = await app.request(
      `/api/decisions/${d1.id}/attachments`,
      multipart(admin, 'a.txt', 'text/plain', 'x', s2.id)
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('SOLUTION_NOT_FOUND')
  })

  it('no-miembro no puede subir ni descargar (403 upload, 404 download)', async () => {
    const { app, admin, projectId } = await makeAttachmentsInstance()
    const outsider = await createUser(app, admin, 'outsider')
    const d = await createDecision(app, admin, projectId)
    const up = await app.request(`/api/decisions/${d.id}/attachments`, multipart(admin, 'a.txt', 'text/plain', 'x'))
    expect(up.status).toBe(201)
    const attId = (await up.json()).attachment.id

    const upOut = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(outsider, 'b.txt', 'text/plain', 'y')
    )
    expect(upOut.status).toBe(403)

    const down = await app.request(`/api/decisions/attachments/${attId}`, { headers: { cookie: outsider.cookie } })
    expect(down.status).toBe(404)
  })

  it('adjuntar a solución ajena -> 403 para un miembro normal; admin sí puede', async () => {
    const { app, admin, projectId } = await makeAttachmentsInstance()
    const ana = await createUser(app, admin, 'ana')
    await app.request(
      `/api/projects/${projectId}/members`,
      jsonReq(admin, 'PUT', `/api/projects/${projectId}/members`, { member_ids: [await userIdOf(app, ana)] })
    )
    const d = await createDecision(app, admin, projectId)
    const sAdmin = await createSolution(app, admin, d.id, 'Solución del admin')

    const denied = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(ana, 'ajena.txt', 'text/plain', 'x', sAdmin.id)
    )
    expect(denied.status).toBe(403)

    // Ana sí puede adjuntar a su propia solución y a la decisión
    const sAna = await createSolution(app, ana, d.id, 'Solución de ana')
    const own = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(ana, 'propia.txt', 'text/plain', 'x', sAna.id)
    )
    expect(own.status).toBe(201)
    const decisionLevel = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(ana, 'de-ana.txt', 'text/plain', 'x')
    )
    expect(decisionLevel.status).toBe(201)

    const asAdmin = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(admin, 'por-admin.txt', 'text/plain', 'x', sAna.id)
    )
    expect(asAdmin.status).toBe(201)
  })

  it('descarga por miembro: 200 con Content-Disposition y contenido exacto', async () => {
    const { app, admin, projectId } = await makeAttachmentsInstance()
    const d = await createDecision(app, admin, projectId)
    const up = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(admin, 'informe.pdf', 'application/pdf', '%PDF-1.4 contenido')
    )
    const attId = (await up.json()).attachment.id
    const down = await app.request(`/api/decisions/attachments/${attId}`, { headers: { cookie: admin.cookie } })
    expect(down.status).toBe(200)
    expect(down.headers.get('content-type')).toContain('application/pdf')
    expect(down.headers.get('content-disposition')).toContain('informe.pdf')
    expect(await down.text()).toBe('%PDF-1.4 contenido')
  })

  it('borrado: otro miembro 403, uploader 204, admin 204; la lista deja de incluirlo', async () => {
    const { app, admin, projectId } = await makeAttachmentsInstance()
    const ana = await createUser(app, admin, 'ana')
    await app.request(
      `/api/projects/${projectId}/members`,
      jsonReq(admin, 'PUT', `/api/projects/${projectId}/members`, { member_ids: [await userIdOf(app, ana)] })
    )
    const d = await createDecision(app, admin, projectId)

    // Ana sube uno y lo borra ella misma (uploader): 204
    const upAna = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(ana, 'de-ana.txt', 'text/plain', 'x')
    )
    const attAna = (await upAna.json()).attachment.id
    const delByOther = await app.request(
      `/api/decisions/attachments/${attAna}`,
      jsonReq(admin, 'DELETE', `/api/decisions/attachments/${attAna}`)
    )
    // admin puede borrar el de ana
    expect(delByOther.status).toBe(204)

    // Otro miembro no puede borrar el de ana
    const upAna2 = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(ana, 'de-ana-2.txt', 'text/plain', 'x')
    )
    const attAna2 = (await upAna2.json()).attachment.id
    const delByAna = await app.request(
      `/api/decisions/attachments/${attAna2}`,
      jsonReq(ana, 'DELETE', `/api/decisions/attachments/${attAna2}`)
    )
    expect(delByAna.status).toBe(204)

    // El admin sube; ana (miembro no uploader) recibe 403
    const upAdmin = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(admin, 'del-admin.txt', 'text/plain', 'x')
    )
    const attAdmin = (await upAdmin.json()).attachment.id
    const delByAnaForbidden = await app.request(
      `/api/decisions/attachments/${attAdmin}`,
      jsonReq(ana, 'DELETE', `/api/decisions/attachments/${attAdmin}`)
    )
    expect(delByAnaForbidden.status).toBe(403)

    // Tras el último borrado, el detalle no incluye nada
    const delByAdmin = await app.request(
      `/api/decisions/attachments/${attAdmin}`,
      jsonReq(admin, 'DELETE', `/api/decisions/attachments/${attAdmin}`)
    )
    expect(delByAdmin.status).toBe(204)
    const detail = await (await app.request(`/api/decisions/${d.id}`, { headers: { cookie: admin.cookie } })).json()
    expect(detail.attachments).toHaveLength(0)

    // El borrado dejó evento removed
    const evs = await (
      await app.request(`/api/decisions/${d.id}`, { headers: { cookie: admin.cookie } })
    ).json()
    const removed = evs.activity.filter((e) => e.type === 'attachment' && e.data.removed === true)
    expect(removed.length).toBeGreaterThanOrEqual(1)
  })

  it('límite por decisión (50) -> 409', async () => {
    const { app, admin, projectId, prod } = await makeAttachmentsInstance()
    const d = await createDecision(app, admin, projectId)
    const now = Date.now()
    const insert = prod.prepare(
      `INSERT INTO decision_attachments (id, decision_id, solution_id, filename, stored_name, size, mime, uploaded_by, created_at)
       VALUES (?, ?, NULL, 'f.txt', 'f.txt', 1, 'text/plain', ?, ?)`
    )
    const adminId = prod.prepare("SELECT id FROM users WHERE username = 'admin'").get().id
    const tx = prod.transaction(() => {
      for (let i = 0; i < 50; i += 1) insert.run(`att-${i}`, d.id, adminId, now + i)
    })
    tx()
    const res = await app.request(
      `/api/decisions/${d.id}/attachments`,
      multipart(admin, 'extra.txt', 'text/plain', 'x')
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('ATTACHMENTS_LIMIT_EXCEEDED')
  })
})

describe('decisiones - migración CHECK attachment', () => {
  it('migrateSchema reconstruye decision_activity_events con attachment y conserva datos', async () => {
    const { prod } = await makeAttachmentsInstance()
    // Simula una BD instalada antes de #279: CHECK sin 'attachment'.
    prod.exec('DROP TABLE decision_activity_events')
    prod.exec(`
      CREATE TABLE decision_activity_events (
        id TEXT PRIMARY KEY,
        decision_id TEXT REFERENCES decisions(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id),
        type TEXT NOT NULL CHECK (type IN
          ('created','title','description','solution_added','solution_edited','solution_removed',
           'voted','unchosen','chosen','comment','reopened','deleted')),
        data TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL
      )
    `)
    prod
      .prepare(
        "INSERT INTO decision_activity_events (id, decision_id, user_id, type, data, created_at) VALUES ('e1', NULL, NULL, 'created', '{}', 0)"
      )
      .run()

    // Sin migrar, el INSERT con 'attachment' revienta por el CHECK.
    let refused = false
    try {
      prod
        .prepare(
          "INSERT INTO decision_activity_events (id, decision_id, user_id, type, data, created_at) VALUES ('e2', NULL, NULL, 'attachment', '{}', 1)"
        )
        .run()
    } catch {
      refused = true
    }
    expect(refused).toBe(true)

    migrateSchema(prod)

    // Tras migrar, 'attachment' se inserta y los datos previos sobreviven.
    prod
      .prepare(
        "INSERT INTO decision_activity_events (id, decision_id, user_id, type, data, created_at) VALUES ('e3', NULL, NULL, 'attachment', '{}', 2)"
      )
      .run()
    const types = prod.prepare('SELECT type FROM decision_activity_events ORDER BY created_at').all().map((r) => r.type)
    expect(types).toEqual(['created', 'attachment'])
    // El índice sobrevive a la reconstrucción.
    const idx = prod
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='decision_activity_events'")
      .all()
      .map((r) => r.name)
    expect(idx).toContain('idx_decision_activity_decision')
  })
})
