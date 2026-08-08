// push.test.js — endpoints de suscripción Web Push y motor de envío
// (preferencias, quiet hours, borrado 404/410, demo, cola consolidada).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeInstance, loginAdmin, loginDemo, jsonReq } from './helpers.js'
import { configurePush, notifyUsers, flushNotificationQueue, _setSendFn, _resetForTests } from '../src/push.js'
import webpush from 'web-push'

// Par VAPID real (setVapidDetails valida formato; claves fake no pasan).
const KEYS = webpush.generateVAPIDKeys()
function configura() {
  process.env.VAPID_PUBLIC_KEY = KEYS.publicKey
  configurePush({ publicKey: KEYS.publicKey, privateKey: KEYS.privateKey, subject: 'mailto:test@example.com' })
}

const SUB = {
  endpoint: 'https://push.example.com/sub/abc123',
  keys: { p256dh: 'BP256dhFakeKeyParaTests', auth: 'authSecretFake' },
}

function insertUser(prod, username, language = 'es') {
  const id = crypto.randomUUID()
  prod.prepare(
    "INSERT INTO users (id, username, password_hash, language, role, created_at) VALUES (?, ?, 'x', ?, 'user', ?)"
  ).run(id, username, language, Date.now())
  return id
}

function insertSub(prod, userId, endpoint = SUB.endpoint) {
  const now = Date.now()
  prod.prepare(
    'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, endpoint, 'p', 'a', now, now)
}

let inst
beforeEach(async () => {
  _resetForTests()
  inst = await makeInstance()
})
afterEach(() => _resetForTests())

describe('endpoints /api/push', () => {
  it('vapid-public-key sin configurar devuelve 503', async () => {
    const auth = await loginAdmin(inst.app)
    const res = await inst.app.request('/api/push/vapid-public-key', jsonReq(auth, 'GET'))
    expect(res.status).toBe(503)
  })

  it('vapid-public-key configurado devuelve la clave pública', async () => {
    configura()
    const auth = await loginAdmin(inst.app)
    const res = await inst.app.request('/api/push/vapid-public-key', jsonReq(auth, 'GET'))
    expect(res.status).toBe(200)
    expect((await res.json()).publicKey).toBe(KEYS.publicKey)
  })

  it('subscribe exige sesión (401 sin cookie)', async () => {
    const res = await inst.app.request('/api/push/subscribe', jsonReq(null, 'POST', SUB))
    expect(res.status).toBe(401)
  })

  it('subscribe hace upsert por endpoint y unsubscribe borra solo lo propio', async () => {
    configura()
    const auth = await loginAdmin(inst.app)
    const adminId = inst.prod.prepare('SELECT id FROM users WHERE username = ?').get('admin').id

    let res = await inst.app.request('/api/push/subscribe', jsonReq(auth, 'POST', '/api/push/subscribe', SUB))
    expect(res.status).toBe(201)
    // Re-suscripción con el mismo endpoint: UPDATE, no duplicado
    res = await inst.app.request('/api/push/subscribe', jsonReq(auth, 'POST', '/api/push/subscribe', SUB))
    expect(res.status).toBe(201)
    const filas = inst.prod.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').all(SUB.endpoint)
    expect(filas).toHaveLength(1)
    expect(filas[0].user_id).toBe(adminId)

    res = await inst.app.request('/api/push/unsubscribe', jsonReq(auth, 'DELETE', '/api/push/unsubscribe', { endpoint: SUB.endpoint }))
    expect(res.status).toBe(204)
    expect(inst.prod.prepare('SELECT * FROM push_subscriptions').all()).toHaveLength(0)
  })

  it('subscribe valida el payload (422 sin keys)', async () => {
    configura()
    const auth = await loginAdmin(inst.app)
    const res = await inst.app.request('/api/push/subscribe', jsonReq(auth, 'POST', '/api/push/subscribe', { endpoint: SUB.endpoint }))
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
  })

  it('en modo demo: clave devuelve {demo:true} y subscribe se rechaza (solo lectura)', async () => {
    const auth = await loginDemo(inst.app)
    const res = await inst.app.request('/api/push/vapid-public-key', jsonReq(auth, 'GET'))
    expect((await res.json()).demo).toBe(true)
    const res2 = await inst.app.request('/api/push/subscribe', jsonReq(auth, 'POST', '/api/push/subscribe', SUB))
    expect(res2.status).toBe(403)
    expect((await res2.json()).error.code).toBe('DEMO_READ_ONLY')
    expect(inst.demo.prepare('SELECT * FROM push_subscriptions').all()).toHaveLength(0)
  })
})

describe('motor notifyUsers', () => {
  it('envía con el idioma del usuario y borra suscripciones muertas (410)', async () => {
    const u1 = insertUser(inst.prod, 'mar', 'es')
    const u2 = insertUser(inst.prod, 'jordi', 'en')
    insertSub(inst.prod, u1, 'https://push.example.com/mar')
    insertSub(inst.prod, u2, 'https://push.example.com/jordi')

    const enviados = []
    _setSendFn(async (sub, payload) => {
      if (sub.endpoint.includes('jordi')) {
        const err = new Error('Gone')
        err.statusCode = 410
        throw err
      }
      enviados.push({ sub, payload: JSON.parse(payload) })
    })
    // VAPID "configurado" para que el motor no omita (el sender está inyectado)
    configura()

    const res = await notifyUsers(inst.prod, [u1, u2], 'tarea_creada', { usuario: 'nacho', titulo: 'Comprar pan' })
    expect(res.enviados).toBe(1)
    expect(res.borrados).toBe(1)
    expect(enviados[0].payload.title).toBe('Nueva tarea')
    expect(enviados[0].payload.body).toContain('«Comprar pan»')
    // La suscripción de jordi (410) ha sido borrada; la de mar sigue
    const restantes = inst.prod.prepare('SELECT endpoint FROM push_subscriptions').all()
    expect(restantes).toHaveLength(1)
    expect(restantes[0].endpoint).toContain('mar')
  })

  it('respeta preferencias: tipo desactivado = omitido', async () => {
    const u1 = insertUser(inst.prod, 'mar')
    insertSub(inst.prod, u1)
    inst.prod.prepare(
      'INSERT INTO notification_preferences (user_id, tipo, enabled, min_severity, updated_at) VALUES (?, ?, 0, ?, ?)'
    ).run(u1, 'comentario', 'normal', Date.now())
    configura()
    _setSendFn(async () => {
      throw new Error('no debería enviarse')
    })
    const res = await notifyUsers(inst.prod, [u1], 'comentario', { usuario: 'x', titulo: 'y' })
    expect(res.omitidos).toBe(1)
    expect(res.enviados).toBe(0)
  })

  it('quiet hours: pospone (encola) y el flush consolida al salir de la ventana', async () => {
    const u1 = insertUser(inst.prod, 'mar')
    insertSub(inst.prod, u1)
    // Ventana que SIEMPRE cubre la hora actual (incluso a las 23 h): empieza
    // ahora y cruza medianoche (start > end = ventana válida que cruza).
    const hora = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }).format(new Date())
    )
    inst.prod.prepare(
      'INSERT INTO notification_quiet_hours (user_id, quiet_start, quiet_end, tz, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(u1, hora, (hora + 2) % 24, 'Europe/Madrid', Date.now())
    configura()

    const res = await notifyUsers(inst.prod, [u1], 'tarea_movida', { usuario: 'x', titulo: 'y', columna: 'hecho' })
    expect(res.pospuestos).toBe(1)
    expect(inst.prod.prepare('SELECT * FROM notification_queue').all()).toHaveLength(1)

    // Con la ventana activa, el flush NO entrega (sigue en cola)
    await flushNotificationQueue(inst.prod)
    expect(inst.prod.prepare('SELECT * FROM notification_queue').all()).toHaveLength(1)

    // Cerramos la ventana y el flush consolida en UN resumen
    inst.prod.prepare('DELETE FROM notification_quiet_hours').run()
    const enviados = []
    _setSendFn(async (sub, payload) => {
      enviados.push(JSON.parse(payload))
    })
    await flushNotificationQueue(inst.prod)
    expect(inst.prod.prepare('SELECT * FROM notification_queue').all()).toHaveLength(0)
    expect(enviados).toHaveLength(1)
    expect(enviados[0].title).toBe('Actividad en Deltos')
    expect(enviados[0].body).toContain('1 cambios')
  })

  it('en demo no envía aunque haya suscripción', async () => {
    const u1 = insertUser(inst.prod, 'mar')
    insertSub(inst.prod, u1)
    configura()
    _setSendFn(async () => {
      throw new Error('no debería enviarse en demo')
    })
    const res = await notifyUsers(inst.prod, [u1], 'tarea_creada', { usuario: 'x', titulo: 'y' }, { demo: true })
    expect(res.enviados).toBe(0)
    expect(res.omitidos).toBe(1)
  })

  it('sin VAPID configurado omite el envío real', async () => {
    const u1 = insertUser(inst.prod, 'mar')
    insertSub(inst.prod, u1)
    const res = await notifyUsers(inst.prod, [u1], 'tarea_creada', { usuario: 'x', titulo: 'y' })
    expect(res.enviados).toBe(0)
    expect(res.omitidos).toBe(1)
  })
})
