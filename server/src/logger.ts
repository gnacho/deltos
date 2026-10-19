// ============================================================================
// logger.ts — logger NDJSON a stdout SIN dependencias (skill log-ops).
//
// Reglas del stack que cumple:
//   - NDJSON a stdout → journald rota; NADA de ficheros ni rotación in-app.
//   - Niveles debug/info/warn/error, mínimo por env LOG_LEVEL (default info).
//   - Mensajes estáticos (nombre del evento, snake_case) + atributos
//     clave-valor. NUNCA interpolar datos variables en `msg`.
//   - Redacción estructurada por clave (lista canónica de log-ops), aplicada
//     a TODOS los emisores vía redact().
//   - user_id siempre hasheado con hashUserId(); nunca emails ni IPs completas.
//
// Uso:
//   import { logger, hashUserId } from './logger.js'
//   const log = logger.child({ component: 'push' })
//   log.info('push_flush_done', { sent: 3, duration_ms: 120 })
// ============================================================================
import { createHash } from 'node:crypto'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogAttrs = Record<string, unknown>

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function parseLevel(raw: string | undefined): LogLevel {
  const v = (raw ?? 'info').toLowerCase()
  return v === 'debug' || v === 'info' || v === 'warn' || v === 'error' ? v : 'info'
}

// Nivel mínimo: LOG_LEVEL=debug solo vía override temporal de systemd.
const MIN_LEVEL: LogLevel = parseLevel(process.env.LOG_LEVEL)

// --- Lista canónica de claves sensibles (case-insensitive) ------------------
// Mantener sincronizada con docs/logging.md y CONVENTIONS.md.
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'apikey',
  'authorization',
  'auth',
  'cookie',
  'set-cookie',
  'session',
  'session_id',
  'email',
  'credentials',
  'private_key',
  'client_secret',
])
// Regla adicional: cualquier clave que CONTENGA estas subcadenas también se
// censura (cubre reset_token, webhook_secret, old_password... sin lista infinita).
const SENSITIVE_SUBSTRINGS = ['token', 'secret', 'password']
const CENSOR = '[REDACTADO]'

export function isSensitiveKey(key: string): boolean {
  const k = String(key).toLowerCase()
  return SENSITIVE_KEYS.has(k) || SENSITIVE_SUBSTRINGS.some((s) => k.includes(s))
}

// Redacción recursiva por clave (objetos y arrays). Profundidad acotada.
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value
  if (value instanceof Error) {
    // Errores: nombre y mensaje; el stack solo en debug (no toca disco en prod).
    const out: LogAttrs = { name: value.name, message: value.message }
    if (MIN_LEVEL === 'debug' && value.stack) out.stack = value.stack
    return out
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: LogAttrs = {}
    for (const [k, v] of Object.entries(value as LogAttrs)) {
      out[k] = isSensitiveKey(k) ? CENSOR : redact(v, depth + 1)
    }
    return out
  }
  return value
}

// user_id → 'u_' + SHA-256 truncado (estable para correlacionar, irreversible).
export function hashUserId(userId: string | number | null | undefined): string | undefined {
  if (!userId) return undefined
  return 'u_' + createHash('sha256').update(String(userId)).digest('hex').slice(0, 12)
}

export class Logger {
  readonly context: LogAttrs

  constructor(context: LogAttrs) {
    this.context = context
  }

  static root(baseContext: LogAttrs = {}): Logger {
    return new Logger(baseContext)
  }

  /** Logger hijo con contexto heredado (component, request_id...). */
  child(context: LogAttrs): Logger {
    return new Logger({ ...this.context, ...context })
  }

  debug(msg: string, attrs: LogAttrs = {}): void {
    this.emit('debug', msg, attrs)
  }
  info(msg: string, attrs: LogAttrs = {}): void {
    this.emit('info', msg, attrs)
  }
  warn(msg: string, attrs: LogAttrs = {}): void {
    this.emit('warn', msg, attrs)
  }
  error(msg: string, attrs: LogAttrs = {}): void {
    this.emit('error', msg, attrs)
  }

  emit(level: LogLevel, msg: string, attrs: LogAttrs): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return
    const line: LogAttrs = {
      level,
      ts: new Date().toISOString(),
      msg, // nombre del evento, estático: nunca interpolar datos aquí
      ...this.context,
      ...(redact(attrs) as LogAttrs),
    }
    process.stdout.write(JSON.stringify(line) + '\n')
  }
}

// Logger de módulo listo para usar; crea hijos con contexto por componente.
export const logger = Logger.root({ service: 'deltos' })
