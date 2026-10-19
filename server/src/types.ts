// ============================================================================
// types.ts — tipos compartidos del dominio del servidor.
//
// Solo los tipos que cruzan módulos (filas de BD, config resuelta, contexto de
// request). Los detalles de cada ruta viven junto a su handler.
// ============================================================================
import type Database from 'better-sqlite3'

/** Configuración ya validada por zod (ver config.ts). */
export type { Config } from './config.js'

/** Usuario tal como viaja en el Context (sin password_hash). */
export interface SessionUser {
  id: string
  username: string
  display_name: string | null
  email: string | null
  phone: string | null
  color: string | null
  language: string | null
  role: string
  expenses_enabled: number
  anti_slip_threshold: number
  created_at: number
  [key: string]: unknown
}

/** Variables que los middlewares dejan en el Context de Hono. */
export interface AppEnv {
  Variables: {
    requestId: string
    sessionId: string | null
    /** Contexto que inyecta app.use: BD activa (prod o demo), usuario y flag demo. */
    db: Database.Database
    user: SessionUser | null
    demo: boolean
    maxUploadBytes: number
  }
}

/** Contexto de Hono con las variables de AppEnv (alias corto). */
export type AppContext = import('hono').Context<AppEnv>
