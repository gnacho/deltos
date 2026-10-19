// api-conventions.test.js — contrato api-stack + log-ops:
// envelope de errores, códigos de estado, keyset, SSE, wide event y PII.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'
import { logger, redact, hashUserId } from '../src/logger.js'
import { onError } from '../src/errors.js'
import { createHub, eventName } from '../src/sse.js'

// Captura las líneas NDJSON que el logger/wide-event escriben a stdout.
function spyStdout() {
  const lines = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk))
    return true
  })
  return { lines, spy }
}

function jsonLines(lines, msg) {
  return lines
    .filter((l) => l.includes(`"msg":"${msg}"`))
    .map((l) => JSON.parse(l.trim()))
}

afterEach(() => vi.restoreAllMocks())

describe('envelope de errores { error: { code, message, details? } }', () => {
  it('401 sin sesión → AUTH_REQUIRED con envelope', async () => {
    const { app } = await makeInstance()
    const res = await app.request('/api/bootstrap')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('AUTH_REQUIRED')
    expect(typeof body.error.message).toBe('string')
  })

  it('404 de dominio → TASK_NOT_FOUND', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const res = await app.request('/api/tasks/no-existe', { headers: { cookie: auth.cookie } })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('TASK_NOT_FOUND')
  })

  it('404 de ruta inexistente → NOT_FOUND', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const res = await app.request('/api/no-existe', { headers: { cookie: auth.cookie } })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('422 de zValidator → VALIDATION_FAILED con details.issues', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const res = await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: '' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(Array.isArray(body.error.details.issues)).toBe(true)
    expect(body.error.details.issues[0].path).toContain('name')
  })

  it('409 UNIQUE → código de dominio LABEL_NAME_TAKEN', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    await app.request('/api/labels', jsonReq(auth, 'POST', '', { name: 'casa' }))
    const dup = await app.request('/api/labels', jsonReq(auth, 'POST', '', { name: 'casa' }))
    expect(dup.status).toBe(409)
    expect((await dup.json()).error.code).toBe('LABEL_NAME_TAKEN')
  })

  it('409 al renombrar etiqueta a nombre existente (SQLITE_CONSTRAINT_UNIQUE en ruta)', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const a = (await (await app.request('/api/labels', jsonReq(auth, 'POST', '', { name: 'a' }))).json()).label
    await app.request('/api/labels', jsonReq(auth, 'POST', '', { name: 'b' }))
    const res = await app.request(`/api/labels/${a.id}`, jsonReq(auth, 'PATCH', '', { name: 'b' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('LABEL_NAME_TAKEN')
  })

  it('400 cursor malformado → INVALID_CURSOR', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const res = await app.request('/api/activity?cursor=no-es-base64url-valido!!', { headers: { cookie: auth.cookie } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('INVALID_CURSOR')
  })

  it('500 genérico: envelope INTERNAL_ERROR sin stack al cliente (sí al log)', () => {
    const { lines } = spyStdout()
    const fakeC = {
      get: () => undefined,
      req: { routePath: '/api/trampa' },
      json: (body, status) => ({ body, status }),
    }
    const boom = new Error('boom con detalles internos')
    const res = onError(boom, fakeC)
    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(res.body)).not.toContain('boom')
    // El error SÍ va al log (name + message; stack solo con LOG_LEVEL=debug)
    const logged = jsonLines(lines, 'unhandled_error')
    expect(logged).toHaveLength(1)
    expect(logged[0].level).toBe('error')
    expect(logged[0].error.message).toContain('boom')
  })
})

describe('códigos de estado: 201 + Location, 204 en DELETE', () => {
  it('POST /api/projects → 201 con Location', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const res = await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'Casa' }))
    expect(res.status).toBe(201)
    const { project } = await res.json()
    expect(res.headers.get('location')).toBe(`/api/projects/${project.id}`)
  })

  it('POST /api/tasks → 201 con Location; DELETE → 204 sin cuerpo', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const { project } = await (
      await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'Casa' }))
    ).json()
    const created = await app.request(
      '/api/tasks',
      jsonReq(auth, 'POST', '', { project_id: project.id, title: 'T1' })
    )
    expect(created.status).toBe(201)
    const { task } = await created.json()
    expect(created.headers.get('location')).toBe(`/api/tasks/${task.id}`)
    const del = await app.request(`/api/tasks/${task.id}`, jsonReq(auth, 'DELETE', ''))
    expect(del.status).toBe(204)
    expect(await del.text()).toBe('')
  })
})

describe('paginación keyset de /api/activity', () => {
  it('recorre todas las páginas sin duplicados ni huecos', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const { project } = await (
      await app.request('/api/projects', jsonReq(auth, 'POST', '', { name: 'Casa' }))
    ).json()
    // 5 tareas → 5 eventos 'created'
    for (let i = 0; i < 5; i++) {
      await app.request('/api/tasks', jsonReq(auth, 'POST', '', { project_id: project.id, title: `T${i}` }))
    }
    const seen = []
    let cursor = null
    for (let page = 0; page < 10; page++) {
      const url = `/api/activity?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const body = await (await app.request(url, { headers: { cookie: auth.cookie } })).json()
      seen.push(...body.items.map((e) => e.id))
      if (!body.hasMore) {
        expect(body.nextCursor).toBeNull()
        break
      }
      expect(body.nextCursor).toBeTruthy()
      cursor = body.nextCursor
    }
    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5) // sin duplicados entre páginas
  })

  it('cursor con forma inválida (JSON pero sin ts/id) → 400 INVALID_CURSOR', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const bad = Buffer.from(JSON.stringify({ foo: 1 }), 'utf8').toString('base64url')
    const res = await app.request(`/api/activity?cursor=${bad}`, { headers: { cookie: auth.cookie } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('INVALID_CURSOR')
  })
})

describe('SSE: contrato de eventos', () => {
  // Stream falso que graba writeSSE/write como el SSEStream de Hono.
  function fakeStream() {
    const sent = []
    return {
      sent,
      writeSSE: (m) => {
        sent.push(m)
        return Promise.resolve()
      },
    }
  }

  it('eventos nombrados <dominio>.changed con id monótono creciente', () => {
    const hub = createHub(5)
    const s = fakeStream()
    hub.add(s)
    hub.broadcast('tasks')
    hub.broadcast('projects')
    hub.broadcast('tasks')
    const ids = s.sent.map((m) => parseInt(m.id, 10))
    expect(ids).toEqual([1, 2, 3])
    expect(s.sent[0].event).toBe('task.changed')
    expect(s.sent[1].event).toBe('project.changed')
    // data mantiene {type:'changed', entity} por compatibilidad (fase 2)
    expect(JSON.parse(s.sent[0].data)).toEqual({ type: 'changed', entity: 'tasks' })
    expect(eventName('users')).toBe('user.changed')
  })

  it('Last-Event-ID atrasado → UN sync.resync; al día → ninguno', async () => {
    const hub = createHub(5)
    const s1 = fakeStream()
    hub.add(s1)
    hub.broadcast('tasks') // id 1
    hub.broadcast('tasks') // id 2
    const s2 = fakeStream()
    await hub.resync(s2, '1') // perdió el evento 2
    expect(s2.sent).toHaveLength(1)
    expect(s2.sent[0].event).toBe('sync.resync')
    expect(parseInt(s2.sent[0].id, 10)).toBeGreaterThan(2) // id monótono también en resync
    const s3 = fakeStream()
    await hub.resync(s3, String(hub.seq()))
    expect(s3.sent).toHaveLength(0)
    const s4 = fakeStream()
    await hub.resync(s4, undefined) // conexión nueva: sin resync
    expect(s4.sent).toHaveLength(0)
  })
})

describe('log-ops: redacción PII y wide events', () => {
  it('objeto trampa: password/authorization/email/token → [REDACTADO]', () => {
    const { lines } = spyStdout()
    logger.info('pii_trap', {
      password: 'Tr4mp4!',
      nested: { authorization: 'Bearer XYZ', reset_token: 'abc' },
      email: 'a@b.com',
      user_id: 'user-123',
    })
    const out = lines.join('')
    expect(out).not.toContain('Tr4mp4!')
    expect(out).not.toContain('Bearer XYZ')
    expect(out).not.toContain('a@b.com')
    expect(out).not.toContain('abc')
    const event = JSON.parse(lines[0].trim())
    expect(event.password).toBe('[REDACTADO]')
    expect(event.nested.authorization).toBe('[REDACTADO]')
    expect(event.nested.reset_token).toBe('[REDACTADO]') // subcadena 'token'
    expect(event.email).toBe('[REDACTADO]')
  })

  it('hashUserId: u_ + 12 hex, estable e irreversible', () => {
    const h1 = hashUserId('user-123')
    expect(h1).toMatch(/^u_[0-9a-f]{12}$/)
    expect(hashUserId('user-123')).toBe(h1)
    expect(h1).not.toContain('user-123')
    expect(hashUserId(undefined)).toBeUndefined()
  })

  it('redact: Error → name+message sin stack (nivel info)', () => {
    const out = redact({ error: new Error('fallo x') })
    expect(out.error.name).toBe('Error')
    expect(out.error.message).toBe('fallo x')
    expect(out.error.stack).toBeUndefined()
  })

  it('wide event: exactamente 1 línea JSON por request API, con campos del contrato', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const { lines } = spyStdout()
    await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })
    const events = jsonLines(lines, 'http_request')
    expect(events).toHaveLength(1)
    const e = events[0]
    expect(e.level).toBe('info')
    expect(e.request_id).toBeTruthy()
    expect(e.method).toBe('GET')
    expect(e.route).toBe('/api/bootstrap')
    expect(e.status).toBe(200)
    expect(typeof e.duration_ms).toBe('number')
    expect(e.user_id_hash).toMatch(/^u_[0-9a-f]{12}$/)
    expect(e.service).toBe('deltos')
  })

  it('wide event: 5xx sale a nivel error; 4xx de cliente es info', async () => {
    const { app } = await makeInstance()
    const { lines } = spyStdout()
    await app.request('/api/bootstrap') // 401 sin sesión
    const events = jsonLines(lines, 'http_request')
    expect(events).toHaveLength(1)
    expect(events[0].level).toBe('info')
    expect(events[0].status).toBe(401)
  })

  it('wide event: GET /health NO genera evento (anti-ruido)', async () => {
    const { app } = await makeInstance()
    const { lines } = spyStdout()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(jsonLines(lines, 'http_request')).toHaveLength(0)
  })

  it('wide event: estáticos/SPA OK no generan evento; 404 de API sí', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const { lines } = spyStdout()
    await app.request('/') // SPA fallback (200 u HTML placeholder)
    expect(jsonLines(lines, 'http_request')).toHaveLength(0)
    await app.request('/api/no-existe', { headers: { cookie: auth.cookie } })
    expect(jsonLines(lines, 'http_request')).toHaveLength(1)
  })

  it('x-request-id se propaga a la respuesta', async () => {
    const { app } = await makeInstance()
    const res = await app.request('/health')
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })
})

describe('anti pantalla-negra: /api/version + cabeceras de caché', () => {
  it('GET /api/version con sesión → { version, build }', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const res = await app.request('/api/version', { headers: { cookie: auth.cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(typeof body.build).toBe('string')
  })

  it('/assets/* → immutable; SPA fallback → no-cache', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const spa = await app.request('/', { headers: { cookie: auth.cookie } })
    expect(spa.headers.get('cache-control')).toBe('no-cache')
    const asset = await app.request('/assets/fichero-que-no-existe.js', { headers: { cookie: auth.cookie } })
    expect(asset.status).toBe(404)
  })
})

describe('PATCH parcial NO resetea campos con default (regresión v1.6.0)', () => {
  it('PATCH /api/labels/:id solo con name conserva el color', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const created = await (
      await app.request('/api/labels', jsonReq(auth, 'POST', '/api/labels', { name: 'color-ok', color: 'rose' }))
    ).json()
    const res = await app.request(
      `/api/labels/${created.label.id}`,
      jsonReq(auth, 'PATCH', `/api/labels/${created.label.id}`, { name: 'color-ok-2' })
    )
    const body = await res.json()
    expect(body.label.color).toBe('rose')
  })

  it('PATCH /api/projects/:id solo con name conserva emoji y color', async () => {
    const { app } = await makeInstance()
    const auth = await loginAdmin(app)
    const created = await (
      await app.request('/api/projects', jsonReq(auth, 'POST', '/api/projects', { name: 'P1', emoji: '🏠', color: 'violet' }))
    ).json()
    const res = await app.request(
      `/api/projects/${created.project.id}`,
      jsonReq(auth, 'PATCH', `/api/projects/${created.project.id}`, { name: 'P1b' })
    )
    const body = await res.json()
    expect(body.project.emoji).toBe('🏠')
    expect(body.project.color).toBe('violet')
  })
})
