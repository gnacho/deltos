// index.js — entrypoint: valida .env (zod, falla rápido), abre las BD
// (producción + demo separadas), bootstrap admin, seed demo, arranca Hono,
// checkpoint WAL horario y graceful shutdown.
import path from 'node:path'
import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { loadConfig } from './config.js'
import { openDb, hourlyMaintenance, kvSet, kvGet, archiveStaleDoneTasks } from './db.js'
import * as auth from './auth.js'
import { createHub } from './sse.js'
import { seedDemo } from './demo.js'
import { createApp } from './app.js'
import { configurePush, flushNotificationQueue } from './push.js'
import { scheduleDigestVencimiento } from './digest.js'
import { logger } from './logger.js'

const log = logger.child({ component: 'server' })

// Config validada con zod: si es inválida, no arranca la app rota
let config
try {
  config = loadConfig()
} catch (err) {
  log.error('config_invalid', {
    issues: (err.issues || []).map((i) => ({ path: i.path.join('.'), message: i.message })),
  })
  process.exit(1)
}

fs.mkdirSync(config.DATA_DIR, { recursive: true })
const uploadsDir = path.join(config.DATA_DIR, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })

// Dos BD separadas: los datos demo NUNCA se mezclan con producción
const prod = openDb(path.join(config.DATA_DIR, 'app.db'))
const demo = openDb(path.join(config.DATA_DIR, 'app_demo.db'))

// demo_enabled=1 por defecto. Ya NO es un "modo demo" global: solo controla
// si el botón "Entrar como demo" se muestra en el login. La BD demo es de
// solo lectura (ver middleware DEMO_READ_ONLY en app.js), así que este flag
// nunca puede dejar los datos del usuario "ocupados" por la demo.
if (kvGet(prod, 'demo_enabled') === null) kvSet(prod, 'demo_enabled', '1')

const secret = auth.getSecret(prod, config.SESSION_SECRET)
await auth.ensureBootstrapAdmin(prod, config.AUTH_USER, config.AUTH_PASS)
seedDemo(demo, uploadsDir) // idempotente: solo si la BD demo está vacía

// Auto-archivo de tareas hechas con más de 3 días (al arrancar; luego horario)
for (const [db, label] of [[prod, 'prod'], [demo, 'demo']]) {
  try {
    archiveStaleDoneTasks(db)
  } catch (err) {
    log.error('auto_archive_failed', { db: label, error: err })
  }
}

const hub = createHub(config.MAX_SSE_CLIENTS)

// Web Push: activo solo si están las 3 variables VAPID (sin ellas la app
// arranca igual y el push queda dormido — ver push.js).
configurePush({
  publicKey: config.VAPID_PUBLIC_KEY,
  privateKey: config.VAPID_PRIVATE_KEY,
  subject: config.VAPID_SUBJECT,
})

const app = createApp({
  prod,
  demo,
  secret,
  hub,
  uploadsDir,
  dataDir: config.DATA_DIR,
  config: {
    cookieSecure: config.COOKIE_SECURE,
    maxSseClients: config.MAX_SSE_CLIENTS,
    maxUploadBytes: config.MAX_UPLOAD_MB * 1024 * 1024,
    staticDir: config.STATIC_DIR,
  },
})

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  log.info('server_listening', {
    port: info.port,
    data_dir: config.DATA_DIR,
    static_dir: config.STATIC_DIR,
    node: process.version,
  })
})

// Checkpoint WAL TRUNCATE cada hora (sin esto el WAL crece indefinidamente)
// + entrega consolidada de las notificaciones pospuestas por quiet hours.
const maintenance = setInterval(() => {
  try {
    hourlyMaintenance(prod, 'prod')
    hourlyMaintenance(demo, 'demo')
    // Auto-archivo horario: si archiva algo, avisa a los clientes SSE abiertos.
    if (archiveStaleDoneTasks(prod) + archiveStaleDoneTasks(demo) > 0) {
      hub.broadcast('tasks')
    }
    flushNotificationQueue(prod).catch((err) =>
      log.error('push_queue_flush_failed', { error: err })
    )
  } catch (err) {
    log.error('hourly_maintenance_failed', { error: err })
  }
}, 60 * 60 * 1000)
maintenance.unref()

// Digest diario de vencimiento (09:00 local): un resumen por usuario con sus
// tareas asignadas que vencen pronto/hoy o están vencidas (no completadas).
const digestTimer = scheduleDigestVencimiento(prod, false)

// Graceful shutdown: notifica a clientes SSE, cierra server y BD
function shutdown(signal) {
  log.info('server_shutdown', { signal })
  clearInterval(maintenance)
  clearTimeout(digestTimer)
  hub.shutdown()
  server.close(() => {
    prod.close()
    demo.close()
    process.exit(0)
  })
  // Red de seguridad: si algo no cierra en 5 s, salir igualmente
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
