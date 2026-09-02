// nlp.js — parser de lenguaje natural para tareas (ES/EN). Extrae una fecha de
// vencimiento y/o una recurrencia de un texto en prosa, y devuelve el título
// limpio (sin la parte temporal). Lógica pura y determinista, sin LLM.
//
// Devuelve null si no se detecta nada. La detección es de mínimo sorpresa: solo
// se extrae cuando el patrón es inequívoco; el resto del texto queda intacto.

// Días de la semana: index 0=domingo ... 6=sábado (mismo convenio que el front).
const DAYS = {
  es: {
    domingo: 0, domingos: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3,
    jueves: 4, viernes: 5, sábado: 6, sabado: 6, sábados: 6, sabados: 6,
  },
  en: {
    sunday: 0, sundays: 0, monday: 1, mondays: 1, tuesday: 2, tuesdays: 2,
    wednesday: 3, wednesdays: 3, thursday: 4, thursdays: 4,
    friday: 5, fridays: 5, saturday: 6, saturdays: 6,
  },
}

// Unidades de recurrencia por idioma → frecuencia.
const FREQ = {
  es: { día: 'daily', dias: 'daily', semana: 'weekly', semanas: 'weekly', mes: 'monthly', meses: 'monthly', año: 'monthly', años: 'monthly' },
  en: { day: 'daily', days: 'daily', week: 'weekly', weeks: 'weekly', month: 'monthly', months: 'monthly', year: 'monthly', years: 'monthly' },
}

// Número de meses al que equivale una unidad de recurrencia (años → monthly 12).
const MONTHS = {
  es: { año: 12, años: 12 },
  en: { year: 12, years: 12 },
}

const fmtISO = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const addDays = (s, n) => {
  const d = new Date(s + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return fmtISO(d)
}

function nextWeekday(fromISO, weekday) {
  const base = new Date(fromISO + 'T12:00:00')
  const today = base.getDay()
  let diff = (weekday - today + 7) % 7
  if (diff === 0) diff = 7 // "el viernes" cuando hoy es viernes → el siguiente
  const d = new Date(fromISO + 'T12:00:00')
  d.setDate(d.getDate() + diff)
  return fmtISO(d)
}

// "el viernes" de un GASTO: el más reciente (hoy cuenta). Los gastos se
// cuentan hacia atrás, a diferencia de los vencimientos.
function lastWeekday(fromISO, weekday) {
  const base = new Date(fromISO + 'T12:00:00')
  const diff = (base.getDay() - weekday + 7) % 7
  const d = new Date(fromISO + 'T12:00:00')
  d.setDate(d.getDate() - diff)
  return fmtISO(d)
}

function todayLocal() {
  const d = new Date()
  return fmtISO(d)
}

// Quita de un texto una lista de substrings detectados (la parte temporal).
function stripParts(text, parts) {
  let out = text
  for (const p of parts.sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ')
  }
  return out.replace(/\s+/g, ' ').trim().replace(/[,\s]+$/g, '')
}

/**
 * Extrae due_date y/o recurrence de un texto.
 * @param {string} text
 * @param {'es'|'en'} lang
 * @param {string} [today] fecha base 'YYYY-MM-DD' (inyectable en tests)
 * @returns {{due_date: string|null, recurrence: object|null, cleanedTitle: string}|null}
 */
export function parseTaskText(text, lang, today = todayLocal()) {
  if (!text || typeof text !== 'string') return null
  const low = text.toLowerCase()
  const dict = lang === 'en' ? DAYS.en : DAYS.es
  const found = { due_date: null, recurrence: null, parts: [] }

  // --- Fecha explícita ISO ---
  const iso = low.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) {
    found.due_date = iso[0]
    found.parts.push(iso[0])
  }

  // --- hoy / mañana / pasado mañana ---
  const rel = lang === 'en'
    ? { 'today': 0, 'tomorrow': 1, 'day after tomorrow': 2 }
    : { 'hoy': 0, 'mañana': 1, 'pasado mañana': 2, 'pasado manana': 2 }
  for (const [word, n] of Object.entries(rel)) {
    if (!found.due_date && new RegExp(`\\b${word}\\b`, 'i').test(text)) {
      found.due_date = addDays(today, n)
      found.parts.push(word)
      break
    }
  }

  // --- en N días/semanas/meses --- (due_date relativa)
  const inDays = low.match(new RegExp(
    lang === 'en'
      ? /\bin\s+(\d+)\s+days?\b/.source
      : /\ben\s+(\d+)\s+(d[ií]as?|días?)\b/.source
  ))
  if (!found.due_date && inDays) {
    found.due_date = addDays(today, parseInt(inDays[1], 10))
    found.parts.push(inDays[0])
  }

  // --- "el/on/this/next <día>" → próximo día de la semana ---
  for (const [day, idx] of Object.entries(dict)) {
    if (!found.due_date && new RegExp(`\\b${day}\\b`, 'i').test(text)) {
      found.due_date = nextWeekday(today, idx)
      found.parts.push(day)
      break
    }
  }

  // --- Recurrencia: "cada/every N <unidad>" ---
  const everyN = low.match(new RegExp(
    lang === 'en'
      ? /\bevery\s+(\d+)\s+(days?|weeks?|months?|years?)\b/.source
      : /\bcada\s+(\d+)\s+(d[ií]as?|semanas?|mes(es)?|años?|anos?)\b/.source
  ))
  if (everyN) {
    const unit = everyN[2].toLowerCase()
    const interval = parseInt(everyN[1], 10)
    let freq = FREQ[lang][unit]
    let months = interval
    if (MONTHS[lang][unit]) months = interval * MONTHS[lang][unit]
    found.recurrence = { freq, interval, weekdays: null, mode: 'due' }
    found.parts.push(everyN[0])
    if (freq === 'monthly' && MONTHS[lang][unit]) found.recurrence.interval = months
  }

  // --- Recurrencia: "cada/every <día> [y <día>...]" → weekly con weekdays ---
  const everyDays = low.match(
    lang === 'en'
      ? /\bevery\s+((?:monday|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)(?:\s+and\s+(?:monday|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?))*)\b/
      : /\b(todos los|los|cada)\s+((?:lunes|martes|miércoles|miercoles|jueves|viernes|sábados|sabados|domingos|sábado|sabado|domingo)(?:\s*y\s*(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábados|sabados|domingos|sábado|sabado|domingo))*)\b/
  )
  if (everyDays) {
    const prefix = lang === 'en' ? 'every' : everyDays[1]
    const daysList = lang === 'en' ? everyDays[1] : everyDays[2]
    const weekdays = []
    for (const [day, idx] of Object.entries(dict)) {
      if (new RegExp(`\\b${day}\\b`, 'i').test(daysList)) weekdays.push(idx)
    }
    if (weekdays.length > 0) {
      found.recurrence = { freq: 'weekly', interval: 1, weekdays: [...new Set(weekdays)].sort(), mode: 'due' }
      found.parts.push(prefix)
      found.parts.push(...(daysList.match(/[a-záéíóúñ]+/gi) || []))
    }
  }

  // --- Recurrencia: "a diario/cada día/todos los días/daily/every day" ---
  const everyDay = low.match(
    lang === 'en' ? /\bevery day\b|\bdaily\b/ : /\ba diario\b|\btodos los días\b|\bcada día\b|\btodos los dias\b|\bcada dia\b/
  )
  if (!found.recurrence && everyDay) {
    found.recurrence = { freq: 'daily', interval: 1, weekdays: null, mode: 'due' }
    found.parts.push(everyDay[0])
  }

  // --- Recurrencia: "semanal/cada semana/weekly/every week" ---
  const everyWeek = low.match(
    lang === 'en' ? /\bweekly\b|\bevery week\b/ : /\bsemanal\b|\bcada semana\b/
  )
  if (!found.recurrence && everyWeek) {
    found.recurrence = { freq: 'weekly', interval: 1, weekdays: null, mode: 'due' }
    found.parts.push(everyWeek[0])
  }

  // --- Recurrencia: "mensual/cada mes/monthly/every month" ---
  const everyMonth = low.match(
    lang === 'en' ? /\bmonthly\b|\bevery month\b/ : /\bmensual\b|\bcada mes\b/
  )
  if (!found.recurrence && everyMonth) {
    found.recurrence = { freq: 'monthly', interval: 1, weekdays: null, mode: 'due' }
    found.parts.push(everyMonth[0])
  }

  if (!found.due_date && !found.recurrence) return null

  const cleanedTitle = stripParts(text, found.parts)
  if (!cleanedTitle) return null

  return {
    due_date: found.due_date,
    recurrence: found.recurrence,
    cleanedTitle,
  }
}

/**
 * Extrae fecha (spent_at) y/o importe de un concepto de gasto en prosa.
 * Mínima sorpresa: la fecha solo sale de expresiones pasadas (ayer, hace N
 * días, el viernes, last friday, ISO); el importe exige marca de divisa
 * (€ / euro(s) / eur). Devuelve null si no hay nada inequívoco.
 * @returns {{spent_at: string|null, amount_cents: number|null, cleanedTitle: string}|null}
 */
export function parseExpenseText(text, lang, today = todayLocal()) {
  if (!text || typeof text !== 'string') return null
  const low = text.toLowerCase()
  const dict = lang === 'en' ? DAYS.en : DAYS.es
  const found = { spent_at: null, amount_cents: null, parts: [] }

  // --- Fecha explícita ISO ---
  const iso = low.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) {
    found.spent_at = iso[0]
    found.parts.push(iso[0])
  }

  // --- hoy / ayer / anteayer (pasado) ---
  const rel = lang === 'en'
    ? { 'day before yesterday': -2, 'yesterday': -1, 'today': 0 }
    : { 'anteayer': -2, 'ayer': -1, 'hoy': 0 }
  for (const [word, n] of Object.entries(rel)) {
    if (!found.spent_at && new RegExp(`\\b${word}\\b`, 'i').test(text)) {
      found.spent_at = addDays(today, n)
      found.parts.push(word)
      break
    }
  }

  // --- hace N días/semanas / N days/weeks ago ---
  const ago = low.match(
    lang === 'en'
      ? /\b(\d+)\s+(days?|weeks?)\s+ago\b/
      : /\bhace\s+(\d+)\s+(d[ií]as?|semanas?)\b/
  )
  if (!found.spent_at && ago) {
    const n = parseInt(ago[1], 10)
    const days = ago[2].startsWith('sem') || ago[2].startsWith('week') ? n * 7 : n
    found.spent_at = addDays(today, -days)
    found.parts.push(ago[0])
  }

  // --- "el <día> (pasado)" / "last|on <weekday>" → el más reciente ---
  for (const [day, idx] of Object.entries(dict)) {
    if (found.spent_at) break
    const re = lang === 'en'
      ? new RegExp(`\\b(?:last|on)\\s+${day}\\b`, 'i')
      : new RegExp(`\\bel\\s+${day}(?:\\s+pasado)?\\b`, 'i')
    const m = text.match(re)
    if (m) {
      found.spent_at = lastWeekday(today, idx)
      found.parts.push(m[0])
      break
    }
  }

  // --- Importe con marca de divisa: "45,50 €", "45€", "20 euros", "€30.5" ---
  // Ambigüedad de miles: si los decimales tienen 3 dígitos ("1.250 €") NO se
  // extrae el importe (podría ser 1,25 € o 1.250 €).
  const amount = low.match(
    /(?:€\s*(\d{1,6})(?:[.,](\d{1,3}))?)|(?:\b(\d{1,6})(?:[.,](\d{1,3}))?\s*(?:€|euros?\b|eur\b))/
  )
  if (amount) {
    const whole = amount[1] ?? amount[3]
    const frac = amount[2] ?? amount[4]
    if (!frac || frac.length <= 2) {
      found.amount_cents = parseInt(whole, 10) * 100 + (frac ? parseInt(frac.padEnd(2, '0'), 10) : 0)
      found.parts.push(amount[0])
    }
  }

  if (!found.spent_at && !found.amount_cents) return null

  // Limpieza propia: stripParts usa \b en los extremos y las partes con divisa
  // ("45,50 €") acaban en no-palabra (€), donde \b no existe.
  let cleaned = text
  for (const p of found.parts.sort((a, b) => b.length - a.length)) {
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pre = /^\w/.test(p) ? '\\b' : ''
    const post = /\w$/.test(p) ? '\\b' : ''
    cleaned = cleaned.replace(new RegExp(pre + esc + post, 'gi'), ' ')
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim().replace(/[,\s]+$/g, '')
  if (!cleaned) return null

  return {
    spent_at: found.spent_at,
    amount_cents: found.amount_cents,
    cleanedTitle: cleaned,
  }
}
