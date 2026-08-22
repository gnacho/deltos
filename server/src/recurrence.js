// recurrence.js — recurrencia de tareas: parseo de la config JSON y cálculo de
// la próxima fecha de vencimiento. Lógica pura (testable sin BD) + helpers que
// leen el historial de completados de la serie para el modo adaptativo.
//
// Config (columna tasks.recurrence, JSON TEXT o NULL):
//   { freq: 'daily'|'weekly'|'monthly', interval: N, weekdays?: [0-6], mode: 'due'|'completion' }
//   - mode 'due'        → la próxima fecha se calcula desde el vencimiento previo
//                         (cadencia constante, p.ej. siempre cada lunes).
//   - mode 'completion' → se calcula desde la fecha de completado real usando la
//                         MEDIANA de los intervalos reales entre completados de
//                         la serie (adaptativo); fallback al intervalo si no hay
//                         historia suficiente.
// weekdays solo aplica a weekly: días concretos de la semana (0=domingo...6=sábado).
const DAY = 24 * 60 * 60 * 1000

export const FREQUENCIES = ['daily', 'weekly', 'monthly']

// Normaliza la config cruda (del JSON de BD o del body) a un objeto válido.
// Devuelve null si no es una recurrencia usable.
export function normalizeRecurrence(rec) {
  if (!rec || typeof rec !== 'object') return null
  const freq = FREQUENCIES.includes(rec.freq) ? rec.freq : null
  if (!freq) return null
  const interval = Number.isInteger(rec.interval) && rec.interval >= 1 ? rec.interval : 1
  let weekdays = null
  if (freq === 'weekly' && Array.isArray(rec.weekdays) && rec.weekdays.length > 0) {
    weekdays = [...new Set(rec.weekdays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
    if (weekdays.length === 0) weekdays = null
  }
  const mode = rec.mode === 'completion' ? 'completion' : 'due'
  return { freq, interval, weekdays, mode }
}

export function serializeRecurrence(rec) {
  return JSON.stringify(rec)
}

// --- utilidades de fecha (YYYY-MM-DD, sin zona horaria) ----------------------

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fmtISO(d) {
  return d.toISOString().slice(0, 10)
}

function addDays(s, n) {
  return fmtISO(new Date(parseISO(s).getTime() + n * DAY))
}

function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return fmtISO(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay))))
}

function weekdayOf(s) {
  return parseISO(s).getUTCDay()
}

// Siguiente ocurrencia ESTRICTAMENTE después de `from` según la config.
export function nextOccurrence(from, rec) {
  if (rec.freq === 'daily') return addDays(from, rec.interval)
  if (rec.freq === 'monthly') return addMonths(from, rec.interval)
  if (rec.freq === 'weekly') {
    if (rec.weekdays && rec.weekdays.length > 0) {
      let d = addDays(from, 1)
      for (let i = 0; i < 14; i++) {
        if (rec.weekdays.includes(weekdayOf(d))) return d
        d = addDays(d, 1)
      }
      return d // no debería pasar; cobertura
    }
    return addDays(from, 7 * rec.interval)
  }
  return null
}

export function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// --- adaptativo --------------------------------------------------------------

// Fechas de completado (epoch ms) de la serie: eventos moved→hecho de las
// tareas del grupo (la instancia que se completa ya está incluida cuando se
// llama desde el move handler, porque el evento se registra antes).
export function completionDates(db, groupId) {
  return db
    .prepare(
      `SELECT ae.created_at
       FROM activity_events ae
       JOIN tasks t ON t.id = ae.task_id
       WHERE t.recurrence_group_id = ? AND ae.type = 'moved'
         AND json_extract(ae.data, '$.to') = 'hecho'
       ORDER BY ae.created_at`
    )
    .all(groupId)
    .map((r) => r.created_at)
}

export function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Intervalo efectivo en días para el modo adaptativo: mediana de los gaps entre
// completados consecutivos de la serie; si no hay >= 2 completados, el intervalo
// configurado. Nunca por debajo de 1 día.
export function adaptiveInterval(completionsMs, configured) {
  if (completionsMs.length < 2) return configured
  const gaps = []
  for (let i = 1; i < completionsMs.length; i++) {
    gaps.push(Math.round((completionsMs[i] - completionsMs[i - 1]) / DAY))
  }
  return Math.max(1, Math.round(median(gaps)))
}

// Próxima fecha de vencimiento de una tarea recurrente que se acaba de completar.
//   task   → la fila de la tarea (con recurrence JSON string + recurrence_group_id)
//   today  → 'YYYY-MM-DD' (fecha actual, inyectable en tests)
// Devuelve 'YYYY-MM-DD' o null si la tarea no es recurrente.
export function computeNextDue(db, task, today = todayLocal()) {
  let rec
  try {
    rec = normalizeRecurrence(typeof task.recurrence === 'string' ? JSON.parse(task.recurrence) : task.recurrence)
  } catch {
    return null
  }
  if (!rec) return null
  const groupId = task.recurrence_group_id || task.id

  if (rec.mode === 'completion') {
    const completions = completionDates(db, groupId)
    const eff = adaptiveInterval(completions, rec.interval)
    // Base = fecha de completado real de ESTA instancia. Si la fila no tiene el
    // evento aún (primer completado sin historia), base = today.
    const last = completions.length > 0 ? new Date(completions[completions.length - 1]).toISOString().slice(0, 10) : today
    return addDays(last, eff)
  }

  // mode 'due': desde el vencimiento previo, cadencia constante; si quedó en el
  // pasado (tarea vencida que se completa tarde), avanza hasta superar hoy.
  const base = task.due_date || today
  let next = nextOccurrence(base, rec)
  while (next <= today) next = nextOccurrence(next, rec)
  return next
}
