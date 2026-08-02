// ============================================================================
// wide-event.js — middleware Hono: UN wide event JSON por request → stdout.
//
// Patrón wide event (skill log-ops, Boris Tane): se acumula contexto durante
// el request y se emite UNA línea JSON rica al final (en `finally`), con el
// nivel decidido por el resultado:
//   - error → status >= 500 o excepción lanzada
//   - info  → todo lo demás (los 4xx de cliente son info: no son fallos del
//             servidor; se vigilan consultando por status)
//
// Anti-ruido (decisión 5 de log-ops: healthchecks/polling son el 80-95 % del
// volumen): NO se emite wide event para:
//   - GET/HEAD /health        (healthcheck del proxy/orquestador)
//   - GET /api/events         (SSE: conexión larga, no un request de trabajo)
//   - GET/HEAD de estáticos/SPA que responden 2xx/304 (assets del frontend)
//
// Reglas: nunca bodies de request/response; `route` es la plantilla de Hono
// (/api/tasks/:id), no la path cruda (sin query ni ids: cardinalidad baja y
// sin PII); user_id siempre hasheado; redacción por clave como red final.
// ============================================================================
import { randomUUID } from 'node:crypto'
import { logger, hashUserId, redact } from './logger.js'

// ¿Este request queda excluido del wide event? (ruido operativo, no señal)
function isExcluded(c) {
  const method = c.req.method
  const path = c.req.path
  if (path === '/health') return true
  if (path === '/api/events') return true // SSE: stream abierto, no 1 unidad de trabajo
  // Estáticos y SPA: solo GET/HEAD fuera de /api; un fallo (>=400) SÍ se loguea.
  if ((method === 'GET' || method === 'HEAD') && !path.startsWith('/api/')) {
    const status = c.res.status
    if (status > 0 && status < 400) return true
  }
  return false
}

function errorCode(err) {
  if (err && typeof err === 'object') {
    // HTTPException con cause { code } (convención api-stack) o error con .code
    const cause = err.cause
    if (cause && typeof cause === 'object' && typeof cause.code === 'string') return cause.code
    if (typeof err.code === 'string') return err.code
  }
  return undefined
}

function errorMessage(err) {
  if (err instanceof Error) return err.message
  return String(err)
}

export function wideEvent() {
  return async (c, next) => {
    const requestId = randomUUID()
    const start = performance.now()

    // Propagar el request_id al cliente para soporte ("dame el id de tu error").
    c.header('x-request-id', requestId)
    c.set('requestId', requestId)

    let thrown
    try {
      await next()
    } catch (err) {
      thrown = err
      throw err // re-lanzar: el onError de app.js decide la respuesta
    } finally {
      if (!isExcluded(c)) {
        const durationMs = Math.round((performance.now() - start) * 10) / 10
        const status = thrown ? 500 : c.res.status
        const level = thrown || status >= 500 ? 'error' : 'info'

        const event = {
          msg: 'http_request',
          request_id: requestId,
          method: c.req.method,
          route: c.req.routePath, // plantilla (/api/tasks/:id), no la path cruda
          status,
          duration_ms: durationMs,
        }

        const userIdHash = hashUserId(c.get('user')?.id)
        if (userIdHash) event.user_id_hash = userIdHash

        if (thrown) {
          const code = errorCode(thrown)
          event.error = {
            ...(code ? { code } : {}),
            message: errorMessage(thrown),
            // Sin stack en producción: LOG_LEVEL=debug temporal si hace falta.
          }
        }

        // Una única línea NDJSON a stdout → journald. Redacción por clave como
        // defensa en profundidad aunque el evento se construye a mano.
        if (level === 'error') logger.error(event.msg, redact(event))
        else logger.info(event.msg, redact(event))
      }
    }
  }
}
