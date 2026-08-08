// push.js — Web Push (VAPID): configuración, motor de envío con i18n
// server-side, preferencias por usuario, quiet hours con cola consolidada y
// borrado de suscripciones muertas (404/410). Patrón: skill web-push-alerts.
//
// Decisiones propias de Deltos:
// - SIN fail-fast sin claves VAPID: en LAN HTTP el push está dormido por
//   secure context; la app debe arrancar igual y la UI muestra "Requiere HTTPS".
// - Dos BD (prod/demo): los statements se cachean por BD con un WeakMap y
//   notifyUsers recibe la BD de la petición. En demo NUNCA se envía push real.
// - Tiempos en epoch ms (convención del resto del esquema).
import crypto from 'node:crypto'
import webpush from 'web-push'
import { logger, hashUserId } from './logger.js'

const log = logger.child({ component: 'push' })

let vapidOk = false
let sendFn = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts)

// Configura VAPID una vez al arrancar. Devuelve true si el push queda activo.
export function configurePush({ publicKey, privateKey, subject } = {}) {
  if (!publicKey || !privateKey || !subject) {
    vapidOk = false
    log.warn('push_disabled', { reason: 'vapid_missing' })
    return false
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidOk = true
  log.info('push_enabled')
  return true
}

export function isPushConfigured() {
  return vapidOk
}

export function pushPublicKey() {
  return vapidOk ? process.env.VAPID_PUBLIC_KEY : null
}

// --- Tests: inyectar un sender falso y resetear estado ----------------------
export function _setSendFn(fn) {
  sendFn = fn || ((sub, payload, opts) => webpush.sendNotification(sub, payload, opts))
}
export function _resetForTests() {
  vapidOk = false
  _setSendFn(null)
  stmtCache = new WeakMap()
}

// --- Catálogo i18n (texto FINAL compuesto en servidor; el SW no traduce) ----
const COLUMNAS = {
  es: { nuevo: 'Nuevo', encurso: 'En curso', hecho: 'Hecho' },
  en: { nuevo: 'To do', encurso: 'In progress', hecho: 'Done' },
}

const CATALOGO = {
  es: {
    tarea_creada: { titulo: 'Nueva tarea', cuerpo: (d) => `${d.usuario} creó «${d.titulo}»` },
    tarea_movida: { titulo: 'Tarea movida', cuerpo: (d) => `${d.usuario} movió «${d.titulo}» a ${COLUMNAS.es[d.columna] || d.columna}` },
    comentario: { titulo: 'Nuevo comentario', cuerpo: (d) => `${d.usuario} comentó en «${d.titulo}»` },
    asignacion: { titulo: 'Tarea asignada', cuerpo: (d) => `${d.usuario} te asignó «${d.titulo}»` },
    mencion: { titulo: 'Te mencionaron', cuerpo: (d) => `${d.usuario} te mencionó en «${d.titulo}»` },
    vencimiento: {
      titulo: 'Resumen de tareas',
      cuerpo: (d) => {
        const p = []
        if (d.vencidas) p.push(`${d.vencidas} vencida${d.vencidas > 1 ? 's' : ''}`)
        if (d.hoy) p.push(`${d.hoy} vence hoy`)
        if (d.pronto) p.push(`${d.pronto} en breve`)
        return p.length ? p.join(' · ') : 'Sin tareas pendientes'
      },
    },
    resumen: { titulo: 'Actividad en Deltos', cuerpo: (d) => `${d.total} cambios mientras estabas en horas de silencio` },
  },
  en: {
    tarea_creada: { titulo: 'New task', cuerpo: (d) => `${d.usuario} created “${d.titulo}”` },
    tarea_movida: { titulo: 'Task moved', cuerpo: (d) => `${d.usuario} moved “${d.titulo}” to ${COLUMNAS.en[d.columna] || d.columna}` },
    comentario: { titulo: 'New comment', cuerpo: (d) => `${d.usuario} commented on “${d.titulo}”` },
    asignacion: { titulo: 'Task assigned', cuerpo: (d) => `${d.usuario} assigned you “${d.titulo}”` },
    mencion: { titulo: 'You were mentioned', cuerpo: (d) => `${d.usuario} mentioned you in “${d.titulo}”` },
    vencimiento: {
      titulo: 'Task summary',
      cuerpo: (d) => {
        const p = []
        if (d.vencidas) p.push(`${d.vencidas} overdue`)
        if (d.hoy) p.push(`${d.hoy} due today`)
        if (d.pronto) p.push(`${d.pronto} soon`)
        return p.length ? p.join(' · ') : 'No pending tasks'
      },
    },
    resumen: { titulo: 'Deltos activity', cuerpo: (d) => `${d.total} changes during your quiet hours` },
  },
}

const SEVERIDADES = ['normal', 'high', 'critical']

// --- Statements cacheados por BD (WeakMap: prod y demo comparten código) ----
let stmtCache = new WeakMap()
function stmts(db) {
  let s = stmtCache.get(db)
  if (!s) {
    s = {
      subsPorUsuario: db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'),
      idioma: db.prepare('SELECT language FROM users WHERE id = ?'),
      pref: db.prepare('SELECT enabled, min_severity FROM notification_preferences WHERE user_id = ? AND tipo = ?'),
      quiet: db.prepare('SELECT quiet_start, quiet_end, tz FROM notification_quiet_hours WHERE user_id = ?'),
      borrarPorEndpoint: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
      encolar: db.prepare('INSERT INTO notification_queue (id, user_id, tipo, severity, datos_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
      colaAgrupada: db.prepare(
        `SELECT user_id, tipo, severity, COUNT(*) AS total, MIN(datos_json) AS datos_json
         FROM notification_queue GROUP BY user_id, tipo, severity`
      ),
      borrarCola: db.prepare('DELETE FROM notification_queue'),
    }
    stmtCache.set(db, s)
  }
  return s
}

function idiomaDe(db, userId) {
  const lang = stmts(db).idioma.get(userId)?.language
  return lang === 'en' ? 'en' : 'es' // 'auto' y desconocidos → es (defecto de la casa)
}

// Quiet hours en la zona horaria del usuario (Intl, sin dependencias).
function enQuietHours(db, userId) {
  const q = stmts(db).quiet.get(userId)
  if (!q || q.quiet_start === null || q.quiet_end === null) return false
  const hora = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: q.tz }).format(new Date())
  )
  if (q.quiet_start <= q.quiet_end) return hora >= q.quiet_start && hora < q.quiet_end
  return hora >= q.quiet_start || hora < q.quiet_end // cruza medianoche
}

function componerPayload(lang, tipo, datos, url) {
  const entrada = CATALOGO[lang][tipo] || CATALOGO[lang].resumen
  const title = entrada.titulo
  const body = entrada.cuerpo(datos)
  return JSON.stringify({
    // Campos planos → handler push del SW (Chrome/Firefox/Safari)
    title,
    body,
    url,
    tag: tipo, // coalescing: mismo tag reemplaza la notificación anterior
    // Declarative Web Push (Safari/iOS 18.4+, sin ejecutar el SW)
    web_push: 8030,
    notification: { title, body, navigate: url },
  })
}

// Envío a UNA suscripción: 404/410 = muerta (borrar); 429/5xx = reintentar
// con backoff + jitter (máx 3); otros status = bug nuestro (log sin endpoint).
async function enviarAUna(db, sub, json, opciones) {
  const destino = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }
  for (let intento = 1; intento <= 3; intento++) {
    try {
      await sendFn(destino, json, { ...opciones, contentEncoding: 'aes128gcm' })
      return 'ok'
    } catch (err) {
      const status = err?.statusCode
      if (status === 404 || status === 410) {
        stmts(db).borrarPorEndpoint.run(sub.endpoint)
        return 'borrada'
      }
      if (status === 429 || (status !== undefined && status >= 500)) {
        if (intento < 3) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** intento + Math.floor(Math.random() * 250)))
          continue
        }
        return 'fallido'
      }
      // Nunca loguear el endpoint (capability URL secreta) ni las keys.
      log.error('push_send_failed', { status, sub_id: sub.id, error: err })
      return 'fallido'
    }
  }
  return 'fallido'
}

/**
 * Notifica por push a usuarios (app CERRADA; con la app abierta ya se enteran
 * por SSE). Respeta preferencias y quiet hours; en demo solo registra.
 * db = la BD de la petición (prod o demo). Devuelve contadores.
 */
export async function notifyUsers(db, userIds, tipo, datos = {}, opciones = {}) {
  const { demo = false, severity = 'normal', url = '/', ttl = severity === 'critical' ? 3600 : 21600 } = opciones
  const res = { enviados: 0, borrados: 0, fallidos: 0, pospuestos: 0, omitidos: 0 }
  const s = stmts(db)

  for (const userId of [...new Set(userIds)]) {
    const pref = s.pref.get(userId, tipo)
    if (pref) {
      if (!pref.enabled || SEVERIDADES.indexOf(severity) < SEVERIDADES.indexOf(pref.min_severity)) {
        res.omitidos++
        continue
      }
    }
    if (severity !== 'critical' && enQuietHours(db, userId)) {
      s.encolar.run(crypto.randomUUID(), userId, tipo, severity, JSON.stringify(datos), Date.now())
      res.pospuestos++
      continue
    }
    const lang = idiomaDe(db, userId)
    const json = componerPayload(lang, tipo, datos, url)
    if (demo) {
      log.debug('push_demo_skipped', { user_id_hash: hashUserId(userId), tipo })
      res.omitidos++
      continue
    }
    if (!vapidOk) {
      res.omitidos++
      continue
    }
    const subs = s.subsPorUsuario.all(userId)
    if (subs.length === 0) {
      res.omitidos++
      continue
    }
    const urgency = severity === 'critical' ? 'high' : severity === 'high' ? 'normal' : 'low'
    const resultados = await Promise.allSettled(subs.map((sub) => enviarAUna(db, sub, json, { TTL: ttl, urgency, topic: tipo })))
    for (const r of resultados) {
      if (r.status === 'fulfilled' && r.value === 'ok') res.enviados++
      else if (r.status === 'fulfilled' && r.value === 'borrada') res.borrados++
      else res.fallidos++
    }
  }
  return res
}

// Atajo para el dominio Deltos: avisa a todos los usuarios menos al actor.
// Fire-and-forget desde las rutas (nunca bloquea la respuesta HTTP).
export function notifyAllExcept(db, demo, actorId, tipo, datos, opciones = {}) {
  const ids = db.prepare('SELECT id FROM users WHERE id != ?').all(actorId).map((r) => r.id)
  if (ids.length === 0) return
  notifyUsers(db, ids, tipo, datos, { ...opciones, demo }).catch((err) =>
    log.error('push_notify_failed', { tipo, error: err })
  )
}

// Avisa a las PARTES INTERESADAS en una tarea (asignado + creador) menos al
// actor. Reemplaza notifyAllExcept para comentario/movida: menos ruido, solo a
// quien le concierne la tarea. `task` debe traer assignee_id y created_by.
export function notifyInterested(db, demo, task, actorId, tipo, datos, opciones = {}) {
  const ids = [task.assignee_id, task.created_by].filter((id) => id && id !== actorId)
  const unique = [...new Set(ids)]
  if (unique.length === 0) return
  notifyUsers(db, unique, tipo, datos, { ...opciones, demo }).catch((err) =>
    log.error('push_notify_failed', { tipo, error: err })
  )
}

// Mantenimiento horario: consolida la cola de quiet hours en UN resumen por
// usuario+tipo y vacía la cola. Llamado desde el intervalo de index.js.
export async function flushNotificationQueue(db, demo = false) {
  const s = stmts(db)
  const grupos = s.colaAgrupada.all()
  if (grupos.length === 0) return
  for (const g of grupos) {
    // Fuera de quiet hours ya: se entrega el resumen. Si sigue en ventana, se
    // queda en cola para el próximo tick.
    if (enQuietHours(db, g.user_id)) continue
    await notifyUsers(db, [g.user_id], 'resumen', { total: g.total }, { demo, severity: g.severity })
    db.prepare('DELETE FROM notification_queue WHERE user_id = ? AND tipo = ?').run(g.user_id, g.tipo)
  }
}
