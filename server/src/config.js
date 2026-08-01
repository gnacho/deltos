// config.js — configuración por variables de entorno, validada con zod.
// Falla rápido al arrancar si la configuración es inválida (ver index.js).
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import fs from 'node:fs'

// Carga el .env del directorio del servidor si existe (Node 22+, sin dependencias)
const envPath = new URL('../.env', import.meta.url)
if (fs.existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath)
  } catch {
    // .env mal formado: las variables que falten se validan abajo
  }
}

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().min(1).default(new URL('../data', import.meta.url).pathname),
  STATIC_DIR: z.string().min(1).default(fileURLToPath(new URL('../../app/dist', import.meta.url))),
  // Secret HMAC de sesión (≥32 chars). Si falta, se autogenera y persiste en kv.
  SESSION_SECRET: z.string().min(32).optional(),
  // Bootstrap del primer admin (solo primer arranque, idempotente)
  AUTH_USER: z.string().min(1).max(50).default('admin'),
  AUTH_PASS: z.string().min(6).optional(),
  // 'true' solo detrás de HTTPS (reverse proxy). En dev (http://localhost) debe ser false.
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  MAX_SSE_CLIENTS: z.coerce.number().int().min(1).max(200).default(20),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),
  // Web Push (VAPID): las tres o ninguna. Sin ellas el push queda DESACTIVADO
  // (la app arranca igual: en LAN HTTP el push está dormido por secure context;
  // generar con `npx web-push generate-vapid-keys --json`). Subject SIEMPRE
  // mailto: (un https://localhost rompe Safari con BadJwtToken).
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).optional(),
})

export function loadConfig(env = process.env) {
  return envSchema.parse(env)
}
