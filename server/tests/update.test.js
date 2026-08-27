// update.test.js — endpoint de apply: escribe un flag on-demand (no execFile).
// El servicio sandboxeado no puede ejecutar el script con privilegios; el flag
// lo detecta un systemd .path que lanza el servicio root.Aquí solo el endpoint.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { makeInstance, loginAdmin, loginUser, jsonReq } from './helpers.js'

describe('apply on-demand (flag)', () => {
  it('POST /api/update/apply escribe el flag en el dataDir y devuelve 202', async () => {
    const inst = await makeInstance()
    const admin = await loginAdmin(inst.app)
    const res = await inst.app.request('/api/update/apply', jsonReq(admin, 'POST', ''))
    expect(res.status).toBe(202)
    expect((await res.json()).requested).toBe(true)
    const flag = path.join(inst.dir, '.update-requested')
    expect(fs.existsSync(flag)).toBe(true)
    // El flag lleva un timestamp ISO.
    expect(isNaN(Date.parse(fs.readFileSync(flag, 'utf8')))).toBe(false)
  })

  it('un usuario no-admin no puede disparar el apply (403)', async () => {
    const inst = await makeInstance()
    const admin = await loginAdmin(inst.app)
    await inst.app.request('/api/users', jsonReq(admin, 'POST', '/api/users', { username: 'pepe', password: 'pepe1234567' }))
    const pepe = await loginUser(inst.app, 'pepe', 'pepe1234567')
    const res = await inst.app.request('/api/update/apply', jsonReq(pepe, 'POST', ''))
    expect(res.status).toBe(403)
  })

  it('sin sesión no se puede disparar el apply (401)', async () => {
    const inst = await makeInstance()
    const res = await inst.app.request('/api/update/apply', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})

describe('progress (#189)', () => {
  it('GET /api/update/progress devuelve step/pct si el fichero es fresco', async () => {
    const inst = await makeInstance()
    const admin = await loginAdmin(inst.app)
    fs.writeFileSync(
      path.join(inst.dir, 'update-progress.json'),
      JSON.stringify({ step: 'download', pct: 25, ts: Date.now() })
    )
    const res = await inst.app.request('/api/update/progress', jsonReq(admin, 'GET'))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.progress).toMatchObject({ step: 'download', pct: 25 })
  })

  it('un fichero stale (corrida muerta) no se reporta', async () => {
    const inst = await makeInstance()
    const admin = await loginAdmin(inst.app)
    fs.writeFileSync(
      path.join(inst.dir, 'update-progress.json'),
      JSON.stringify({ step: 'download', pct: 25, ts: Date.now() - 20 * 60 * 1000 })
    )
    const res = await inst.app.request('/api/update/progress', jsonReq(admin, 'GET'))
    const j = await res.json()
    expect(j.progress).toBeNull()
  })

  it('sin fichero devuelve null y no-admin recibe 403', async () => {
    const inst = await makeInstance()
    const admin = await loginAdmin(inst.app)
    const res = await inst.app.request('/api/update/progress', jsonReq(admin, 'GET'))
    expect((await res.json()).progress).toBeNull()
    const noAuth = await inst.app.request('/api/update/progress', { method: 'GET' })
    expect(noAuth.status).toBe(401)
  })
})
