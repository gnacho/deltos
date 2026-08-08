// digest.js — recordatorios de vencimiento: un digest diario por usuario con
// sus tareas asignadas que vencen pronto/hoy o ya están vencidas (y no están en
// la columna 'hecho'). Envío único por usuario y día (guarda en kv).
import { notifyUsers } from './push.js'
import { logger } from './logger.js'

const log = logger.child({ component: 'digest' })

// "pronto" = vence en los próximos N días (sin contar hoy). 1 = solo mañana.
export const PRONTO_DIAS = 2
const HORA_DIGEST = 9 // 09:00 hora local del servidor

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hoyStr() {
  return dateStr(new Date())
}

function prontoLimiteStr() {
  const d = new Date()
  d.setDate(d.getDate() + PRONTO_DIAS)
  return dateStr(d)
}

/**
 * Recorre las tareas asignadas no completadas, agrupa por usuario y envía un
 * push 'vencimiento' (digest) a cada uno con vencidas/hoy/pronto. Idempotente:
 * un usuario no recibe más de un digest por día (clave kv por fecha).
 */
export async function enviarDigestVencimiento(db, demo = false) {
  const hoy = hoyStr()
  const prontoLimite = prontoLimiteStr()
  const filas = db
    .prepare(
      `SELECT assignee_id AS user_id,
        SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS vencidas,
        SUM(CASE WHEN due_date = ? THEN 1 ELSE 0 END) AS hoy,
        SUM(CASE WHEN due_date > ? AND due_date <= ? THEN 1 ELSE 0 END) AS pronto
       FROM tasks
       WHERE deleted_at IS NULL AND "column" != 'hecho'
         AND due_date IS NOT NULL AND assignee_id IS NOT NULL
       GROUP BY assignee_id`
    )
    .all(hoy, hoy, hoy, prontoLimite)

  const existeKv = db.prepare('SELECT 1 FROM kv WHERE key = ?')
  const setKv = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)')

  for (const f of filas) {
    const total = (f.vencidas || 0) + (f.hoy || 0) + (f.pronto || 0)
    if (total === 0) continue
    const key = `vencimiento_${f.user_id}_${hoy}`
    if (existeKv.get(key)) continue // ya enviado hoy
    setKv.run(key, '1')
    try {
      await notifyUsers(
        db,
        [f.user_id],
        'vencimiento',
        { vencidas: f.vencidas || 0, hoy: f.hoy || 0, pronto: f.pronto || 0, total },
        { demo, severity: f.vencidas > 0 ? 'high' : 'normal', url: '/' }
      )
    } catch (err) {
      log.error('digest_send_failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }
}

/**
 * Scheduler: dispara el digest una vez al día a HORA_DIGEST (local). Re-armado
 * tras cada disparo. `.unref()` para no mantener el proceso vivo.
 */
export function scheduleDigestVencimiento(db, demo = false) {
  const ahora = new Date()
  const next = new Date(ahora)
  next.setHours(HORA_DIGEST, 0, 0, 0)
  if (next.getTime() <= ahora.getTime()) next.setDate(next.getDate() + 1)
  const delay = Math.max(next.getTime() - ahora.getTime(), 60_000)
  const timer = setTimeout(async () => {
    try {
      await enviarDigestVencimiento(db, demo)
      log.info('digest_vencimiento_enviado')
    } catch (err) {
      log.error('digest_vencimiento_error', { error: err instanceof Error ? err.message : String(err) })
    }
    scheduleDigestVencimiento(db, demo)
  }, delay)
  timer.unref()
  return timer
}
