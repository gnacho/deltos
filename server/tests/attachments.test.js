// attachments.test.js — subida multipart (límite 10 MB), descarga con
// content-type y evento 'attachment'.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, loginUser, jsonReq } from './helpers.js'

describe('adjuntos', () => {
  it('sube, registra evento y descarga con content-type', async () => {
    const { app, uploadsDir } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    const project = (
      await (await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'Casa' }))).json()
    ).project
    const task = (
      await (
        await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'Con adjunto' }))
      ).json()
    ).task

    const form = new FormData()
    form.append('file', new File(['contenido de prueba'], 'nota.txt', { type: 'text/plain' }))
    const up = await app.request(`/api/tasks/${task.id}/attachments`, {
      method: 'POST',
      headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrfToken },
      body: form,
    })
    expect(up.status).toBe(201)
    const { attachment } = await up.json()
    expect(attachment.filename).toBe('nota.txt')
    expect(attachment.size).toBe(19)

    const detail = await (await app.request(`/api/tasks/${task.id}`, { headers: { cookie: auth.cookie } })).json()
    expect(detail.attachments).toHaveLength(1)
    expect(detail.activity.some((e) => e.type === 'attachment' && e.data.filename === 'nota.txt')).toBe(true)

    const down = await app.request(`/api/attachments/${attachment.id}`, { headers: { cookie: auth.cookie } })
    expect(down.status).toBe(200)
    expect(down.headers.get('content-type')).toContain('text/plain')
    expect(down.headers.get('content-disposition')).toContain('nota.txt')
    expect(await down.text()).toBe('contenido de prueba')

    const fs = await import('node:fs')
    expect(fs.readdirSync(uploadsDir)).toHaveLength(1)

    await app.request(`/api/tasks/${task.id}`, jsonReq(auth, 'DELETE', ''))
    expect(fs.readdirSync(uploadsDir)).toHaveLength(1)
    const perm = await app.request(`/api/trash/${task.id}`, jsonReq(auth, 'DELETE', ''))
    expect(perm.status).toBe(204)
    expect(fs.readdirSync(uploadsDir)).toHaveLength(0)
  })

  it('rechaza multipart sin fichero', async () => {
    const { app } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    const project = (
      await (await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'Casa' }))).json()
    ).project
    const task = (
      await (
        await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'T' }))
      ).json()
    ).task
    const form = new FormData()
    form.append('nada', 'x')
    const res = await app.request(`/api/tasks/${task.id}/attachments`, {
      method: 'POST',
      headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrfToken },
      body: form,
    })
    expect(res.status).toBe(400)
  })

  it('rechaza ficheros con MIME no permitido', async () => {
    const { app } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    const project = (
      await (await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'Casa' }))).json()
    ).project
    const task = (
      await (
        await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'T' }))
      ).json()
    ).task
    const form = new FormData()
    form.append('file', new File(['<script>alert(1)</script>'], 'malware.exe', { type: 'application/x-msdownload' }))
    const res = await app.request(`/api/tasks/${task.id}/attachments`, {
      method: 'POST',
      headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrfToken },
      body: form,
    })
    expect(res.status).toBe(415)
    expect((await res.json()).error.code).toBe('UPLOAD_INVALID_MIME')
  })

  it('un usuario no miembro del proyecto no puede descargar el adjunto (IDOR #169)', async () => {
    const { app } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    // segundo usuario (no miembro de ningún proyecto del admin)
    await app.request(
      '/api/auth/register',
      jsonReq(auth, 'POST', '', { username: 'jordi', password: 'jordi1234567' })
    )
    const jordi = await loginUser(app, 'jordi', 'jordi1234567')

    const project = (
      await (await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'Casa' }))).json()
    ).project
    const task = (
      await (
        await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'Con adjunto' }))
      ).json()
    ).task
    const form = new FormData()
    form.append('file', new File(['contenido de prueba'], 'nota.txt', { type: 'text/plain' }))
    const up = await app.request(`/api/tasks/${task.id}/attachments`, {
      method: 'POST',
      headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrfToken },
      body: form,
    })
    expect(up.status).toBe(201)
    const { attachment } = await up.json()

    // el miembro (admin) sí descarga
    const ok = await app.request(`/api/attachments/${attachment.id}`, { headers: { cookie: auth.cookie } })
    expect(ok.status).toBe(200)
    // el no-miembro (jordi) recibe 404, no el fichero
    const denied = await app.request(`/api/attachments/${attachment.id}`, { headers: { cookie: jordi.cookie } })
    expect(denied.status).toBe(404)
  })

  it('los adjuntos sembrados en demo se descargan', async () => {
    const { app } = await makeInstance()
    const demoRes = await app.request('/api/auth/demo', { method: 'POST' })
    const cookie = demoRes.headers.get('set-cookie').split(';')[0]
    const boot = await (await app.request('/api/bootstrap', { headers: { cookie } })).json()
    const t2 = boot.tasks.find((t) => t.counts.attachments === 2)
    const detail = await (await app.request(`/api/tasks/${t2.id}`, { headers: { cookie } })).json()
    const down = await app.request(`/api/attachments/${detail.attachments[0].id}`, { headers: { cookie } })
    expect(down.status).toBe(200)
    expect(down.headers.get('content-type')).toContain('pdf')
  })
})
