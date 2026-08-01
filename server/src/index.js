// index.js — entrypoint: valida .env (zod, falla rápido), abre las BD
// (producción + demo separadas), bootstrap admin, seed demo, arranca Hono,
// checkpoint WAL horario y graceful shutdown.
import path from 'node:path'
import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { loadConfig } from './config.js'
import { openDb, hourlyMaintenance, kvSet, kvGet } from './db.js'
import * as auth from './auth.js'
import { createHub } from './sse.js'
import { seedDemo } from './demo.js'
import { createApp } from './app.js'
import { configurePush, flushNotificationQueue } from './push.js'

// Config validada con zod: si es inválida, no arranca la app rota
let config
try {
  config = loadConfig()
} catch (err) {
  console.error('[config] variables de entorno inválidas:')
  for (const issue of err.issues || []) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

fs.mkdirSync(config.DATA_DIR, { recursive: true })
const uploadsDir = path.join(config.DATA_DIR, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })

// Dos BD separadas: los datos demo NUNCA se mezclan con producción
const prod = openDb(path.join(config.DATA_DIR, 'app.db'))
const demo = openDb(path.join(config.DATA_DIR, 'app_demo.db'))

// demo_enabled=1 por defecto (toggle de Ajustes, solo admin)
if (kvGet(prod, 'demo_enabled') === null) kvSet(prod, 'demo_enabled', '1')

const secret = auth.getSecret(prod, config.SESSION_SECRET)
await auth.ensureBootstrapAdmin(prod, config.AUTH_USER, config.AUTH_PASS)
seedDemo(demo, uploadsDir) // idempotente: solo si la BD demo está vacía

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
  config: {
    cookieSecure: config.COOKIE_SECURE,
    maxSseClients: config.MAX_SSE_CLIENTS,
    maxUploadBytes: config.MAX_UPLOAD_MB * 1024 * 1024,
    staticDir: config.STATIC_DIR,
  },
})

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`[deltos] escuchando en http://localhost:${info.port}`)
  console.log(`[deltos] datos en ${config.DATA_DIR} · estáticos en ${config.STATIC_DIR}`)
})

// Checkpoint WAL TRUNCATE cada hora (sin esto el WAL crece indefinidamente)
// + entrega consolidada de las notificaciones pospuestas por quiet hours.
const maintenance = setInterval(() => {
  try {
    hourlyMaintenance(prod, 'prod')
    hourlyMaintenance(demo, 'demo')
    flushNotificationQueue(prod).catch((err) => console.error('[push] error en flush de cola:', err))
  } catch (err) {
    console.error('[db] error en mantenimiento horario:', err)
  }
}, 60 * 60 * 1000)
maintenance.unref()

// Graceful shutdown: notifica a clientes SSE, cierra server y BD
function shutdown(signal) {
  console.log(`[deltos] ${signal} recibido, cerrando...`)
  clearInterval(maintenance)
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
