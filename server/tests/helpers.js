// helpers.js — utilidades compartidas de tests: app aislada por test + login.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb, kvSet } from '../src/db.js'
import * as auth from '../src/auth.js'
import { createHub } from '../src/sse.js'
import { seedDemo } from '../src/demo.js'
import { createApp } from '../src/app.js'

// Crea una instancia completa (BD prod + demo en dir temporal) para tests.
export async function makeInstance({ adminPass = 'admin123', seedDemoData = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltos-test-'))
  const uploadsDir = path.join(dir, 'uploads')
  const prod = openDb(path.join(dir, 'app.db'))
  const demo = openDb(path.join(dir, 'app_demo.db'))
  kvSet(prod, 'demo_enabled', '1')
  const secret = auth.getSecret(prod, undefined)
  await auth.ensureBootstrapAdmin(prod, 'admin', adminPass)
  if (seedDemoData) seedDemo(demo, uploadsDir)
  const hub = createHub(20)
  const app = createApp({
    prod,
    demo,
    secret,
    hub,
    uploadsDir,
    dataDir: dir,
    config: {
      cookieSecure: false,
      maxSseClients: 20,
      maxUploadBytes: 10 * 1024 * 1024,
      staticDir: path.join(dir, 'dist'),
    },
  })
  return { app, prod, demo, dir, uploadsDir, hub }
}

// Login como admin de producción; devuelve { cookie, csrfToken }.
export async function loginAdmin(app, password = 'admin123') {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password }),
  })
  if (res.status !== 200) throw new Error(`login admin falló: ${res.status}`)
  const body = await res.json()
  return { cookie: res.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken ?? null }
}

export async function loginDemo(app) {
  const res = await app.request('/api/auth/demo', { method: 'POST' })
  if (res.status !== 200) throw new Error(`login demo falló: ${res.status}`)
  const body = await res.json()
  return { cookie: res.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken ?? null }
}

export async function loginUser(app, username, password) {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (res.status !== 200) return null
  const body = await res.json()
  return { cookie: res.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken ?? null }
}

// session = { cookie, csrfToken } (de loginAdmin/loginUser) o string (solo cookie).
export function jsonReq(session, method, url, body) {
  const isObj = typeof session === 'object' && session !== null
  const cookie = isObj ? session.cookie : session
  const csrfToken = isObj ? session.csrfToken : null
  return {
    method,
    headers: {
      cookie,
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
}
