// ============================================================================
// errors.js — manejo global de errores (skill api-stack).
// TODO 4xx/5xx sale con el envelope único:
//     { error: { code, message, details? } }
// Las rutas NO construyen respuestas de error a mano: lanzan httpError()
// (HTTPException con cause { code, details? }) y app.onError mapea:
//   HTTPException            → status + cause.code (o código por defecto)
//   ZodError                 → 422 VALIDATION_FAILED + details.issues
//   SQLITE_CONSTRAINT_UNIQUE → 409 UNIQUE_VIOLATION (red de seguridad; en las
//                              rutas se captura para código de dominio preciso)
//   resto (bug del server)   → 500 INTERNAL_ERROR, stack al log, NO al cliente
// ============================================================================
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { SqliteError } from 'better-sqlite3'
import { ERROR_CODES, ERROR_MESSAGES_ES } from './error-codes.js'
import { logger } from './logger.js'

// Lanza un error de dominio: la ruta dice QUÉ falló (code), onError decide
// el mensaje. details es opcional (p. ej. issues de zod).
export function httpError(status, code, details) {
  throw new HTTPException(status, { cause: { code, ...(details !== undefined ? { details } : {}) } })
}

// Código por defecto cuando una HTTPException no trae cause.code de dominio.
function defaultCodeFor(status) {
  switch (status) {
    case 400: return ERROR_CODES.BAD_REQUEST
    case 401: return ERROR_CODES.AUTH_REQUIRED
    case 403: return ERROR_CODES.AUTH_FORBIDDEN
    case 404: return ERROR_CODES.NOT_FOUND
    case 409: return ERROR_CODES.UNIQUE_VIOLATION
    case 413: return ERROR_CODES.PAYLOAD_TOO_LARGE
    case 429: return ERROR_CODES.RATE_LIMITED
    default: return ERROR_CODES.INTERNAL_ERROR
  }
}

function messageFor(code) {
  return ERROR_MESSAGES_ES[code] ?? ERROR_MESSAGES_ES[ERROR_CODES.INTERNAL_ERROR]
}

function envelope(code, details) {
  return details === undefined
    ? { error: { code, message: messageFor(code) } }
    : { error: { code, message: messageFor(code), details } }
}

// Hook para zValidator: en vez del 400 por defecto, lanzar el ZodError para
// que onError responda 422 con el envelope y los issues crudos (path + code)
// en details, para que el frontend re-traduzca campo a campo.
export function validationHook(result) {
  if (!result.success) throw result.error
}

// onError: el ÚNICO lugar que construye respuestas de error.
export function onError(err, c) {
  // 1) Errores de dominio lanzados por las rutas con httpError().
  if (err instanceof HTTPException) {
    const cause = err.cause
    const code = cause && typeof cause === 'object' && typeof cause.code === 'string'
      ? cause.code
      : defaultCodeFor(err.status)
    const details = cause && typeof cause === 'object' ? cause.details : undefined
    return c.json(envelope(code, details), err.status)
  }

  // 2) Errores de validación de zValidator (validationHook lanza el ZodError).
  if (err instanceof ZodError) {
    return c.json(envelope(ERROR_CODES.VALIDATION_FAILED, { issues: err.issues }), 422)
  }

  // 3) Violación UNIQUE de SQLite no capturada en la ruta (red de seguridad).
  if (err instanceof SqliteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return c.json(envelope(ERROR_CODES.UNIQUE_VIOLATION), 409)
  }

  // 4) Bug del server: stack completo AL LOG (error), mensaje genérico al
  //    cliente. El 500 NUNCA filtra stack ni internals.
  logger.error('unhandled_error', {
    request_id: c.get('requestId'),
    route: c.req.routePath,
    error: err, // el logger serializa name+message (stack solo con LOG_LEVEL=debug)
  })
  return c.json(envelope(ERROR_CODES.INTERNAL_ERROR), 500)
}
