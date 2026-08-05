// server-settings.test.js — ajustes del servidor: backup y límite de adjuntos.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { makeInstance, loginAdmin, jsonReq, loginUser } from './helpers.js'

describe('ajustes del servidor', () => {
  it('GET /api/settings/server devuelve la configuración por defecto (admin)', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const res = await app.request('/api/settings/server', { headers: { cookie: auth.cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.backup_enabled).toBe(true)
    expect(body.backup_retention_days).toBe(7)
    expect(body.max_attachments_per_task).toBe(50)
    expect(body.backup_last_run).toBeNull()
    expect(typeof body.backup_timer_active).toBe('boolean')
  })

  it('GET /api/settings/server → 403 para usuario no-admin', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    await app.request('/api/users', jsonReq(auth, 'POST', '/api/users', { username: 'pepe', password: 'pepe123' }))
    const pepe = await loginUser(app, 'pepe', 'pepe123')
    const res = await app.request('/api/settings/server', { headers: { cookie: pepe.cookie } })
    expect(res.status).toBe(403)
  })

  it('PUT /api/settings/server actualiza backup y adjuntos', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const res = await app.request('/api/settings/server', jsonReq(auth, 'PUT', '/api/settings/server', {
      backup_enabled: false,
      backup_retention_days: 30,
      max_attachments_per_task: 20,
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.backup_enabled).toBe(false)
    expect(body.backup_retention_days).toBe(30)
    expect(body.max_attachments_per_task).toBe(20)
  })

  it('PUT /api/settings/server valida límites', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const bad1 = await app.request('/api/settings/server', jsonReq(auth, 'PUT', '/api/settings/server', {
      backup_enabled: true,
      backup_retention_days: 0,
      max_attachments_per_task: 50,
    }))
    expect(bad1.status).toBe(422)

    const bad2 = await app.request('/api/settings/server', jsonReq(auth, 'PUT', '/api/settings/server', {
      backup_enabled: true,
      backup_retention_days: 7,
      max_attachments_per_task: 999,
    }))
    expect(bad2.status).toBe(422)
  })

  it('POST /api/settings/backup/run ejecuta un backup manual', async () => {
    const { app, dir } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    const res = await app.request('/api/settings/backup/run', jsonReq(auth, 'POST', '/api/settings/backup/run'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.path).toContain('deltos-')
    expect(body.size).toBeGreaterThan(0)
    expect(fs.existsSync(body.path)).toBe(true)
    const backupsDir = path.join(dir, 'backups')
    expect(fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db')).length).toBeGreaterThanOrEqual(1)
  })

  it('límite de adjuntos por tarea: rechaza cuando se supera el máximo', async () => {
    const { app } = await makeInstance({ seedDemoData: false })
    const auth = await loginAdmin(app)
    await app.request('/api/settings/server', jsonReq(auth, 'PUT', '/api/settings/server', {
      backup_enabled: true,
      backup_retention_days: 7,
      max_attachments_per_task: 5,
    }))
    const project = (
      await (await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'Casa' }))).json()
    ).project
    const task = (
      await (
        await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: 'T' }))
      ).json()
    ).task
    for (let i = 0; i < 5; i++) {
      const form = new FormData()
      form.append('file', new File(['contenido'], `f${i}.txt`, { type: 'text/plain' }))
      const up = await app.request(`/api/tasks/${task.id}/attachments`, {
        method: 'POST',
        headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrfToken },
        body: form,
      })
      expect(up.status).toBe(201)
    }
    const form = new FormData()
    form.append('file', new File(['extra'], 'extra.txt', { type: 'text/plain' }))
    const overflow = await app.request(`/api/tasks/${task.id}/attachments`, {
      method: 'POST',
      headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrfToken },
      body: form,
    })
    expect(overflow.status).toBe(409)
    expect((await overflow.json()).error.code).toBe('ATTACHMENTS_LIMIT_EXCEEDED')
  })
})
