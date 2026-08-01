// attachments.test.js — subida multipart (límite 10 MB), descarga con
// content-type y evento 'attachment'.
import { describe, it, expect } from 'vitest'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'

describe('adjuntos', () => {
  it('sube, registra evento y descarga con content-type', async () => {
    const { app, uploadsDir } = await makeInstance({ seedDemoData: false })
    const cookie = await loginAdmin(app)
    const project = (
      await (await app.request('/api/projects', jsonReq(cookie, 'POST', '', { name: 'Casa' }))).json()
    ).project
    const task = (
      await (
        await app.request('/api/tasks', jsonReq(cookie, 'POST', '', { project_id: project.id, title: 'Con adjunto' }))
      ).json()
    ).task

    const form = new FormData()
    form.append('file', new File(['contenido de prueba'], 'nota.txt', { type: 'text/plain' }))
    const up = await app.request(`/api/tasks/${task.id}/attachments`, {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
    expect(up.status).toBe(201)
    const { attachment } = await up.json()
    expect(attachment.filename).toBe('nota.txt')
    expect(attachment.size).toBe(19)

    // evento 'attachment' en el detalle
    const detail = await (await app.request(`/api/tasks/${task.id}`, { headers: { cookie } })).json()
    expect(detail.attachments).toHaveLength(1)
    expect(detail.activity.some((e) => e.type === 'attachment' && e.data.filename === 'nota.txt')).toBe(true)

    // descarga
    const down = await app.request(`/api/attachments/${attachment.id}`, { headers: { cookie } })
    expect(down.status).toBe(200)
    expect(down.headers.get('content-type')).toContain('text/plain')
    expect(down.headers.get('content-disposition')).toContain('nota.txt')
    expect(await down.text()).toBe('contenido de prueba')

    // el fichero existe en disco con nombre aleatorio
    const fs = await import('node:fs')
    expect(fs.readdirSync(uploadsDir)).toHaveLength(1)

    // borrar la tarea elimina el fichero de disco
    await app.request(`/api/tasks/${task.id}`, jsonReq(cookie, 'DELETE', ''))
    expect(fs.readdirSync(uploadsDir)).toHaveLength(0)
  })

  it('rechaza multipart sin fichero', async () => {
    const { app } = await makeInstance({ seedDemoData: false })
    const cookie = await loginAdmin(app)
    const project = (
      await (await app.request('/api/projects', jsonReq(cookie, 'POST', '', { name: 'Casa' }))).json()
    ).project
    const task = (
      await (
        await app.request('/api/tasks', jsonReq(cookie, 'POST', '', { project_id: project.id, title: 'T' }))
      ).json()
    ).task
    const form = new FormData()
    form.append('nada', 'x')
    const res = await app.request(`/api/tasks/${task.id}/attachments`, {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
    expect(res.status).toBe(400)
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
