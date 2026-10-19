// nlp.test.js — parser de lenguaje natural para tareas y gastos (ES/EN).
import { describe, it, expect } from 'vitest'
import { parseTaskText, parseExpenseText } from '../src/nlp.js'

const TODAY = '2026-08-22' // sábado

describe('nlp — recurrencia', () => {
  it('EN: every 6 months → monthly interval 6, limpia el título', () => {
    const r = parseTaskText('change the water filter every 6 months', 'en', TODAY)
    expect(r).toEqual({
      due_date: null,
      recurrence: { freq: 'monthly', interval: 6, weekdays: null, mode: 'due' },
      cleanedTitle: 'change the water filter',
    })
  })

  it('ES: cada 6 meses → monthly interval 6', () => {
    const r = parseTaskText('cambiar el filtro del agua cada 6 meses', 'es', TODAY)
    expect(r.recurrence).toEqual({ freq: 'monthly', interval: 6, weekdays: null, mode: 'due' })
    expect(r.cleanedTitle).toBe('cambiar el filtro del agua')
  })

  it('EN: every Monday and Tuesday → weekly [1,2]', () => {
    const r = parseTaskText('take the trash out every Monday and Tuesday at 6:15 pm', 'en', TODAY)
    expect(r.recurrence).toEqual({ freq: 'weekly', interval: 1, weekdays: [1, 2], mode: 'due' })
    expect(r.cleanedTitle).toBe('take the trash out at 6:15 pm')
  })

  it('ES: los lunes y jueves → weekly [1,4]', () => {
    const r = parseTaskText('sacar la basura los lunes y jueves', 'es', TODAY)
    expect(r.recurrence).toEqual({ freq: 'weekly', interval: 1, weekdays: [1, 4], mode: 'due' })
    expect(r.cleanedTitle).toBe('sacar la basura')
  })

  it('ES: todos los días → daily', () => {
    const r = parseTaskText('regar las plantas todos los días', 'es', TODAY)
    expect(r.recurrence).toEqual({ freq: 'daily', interval: 1, weekdays: null, mode: 'due' })
  })

  it('ES: semanal → weekly', () => {
    const r = parseTaskText('pasar la aspiradora semanal', 'es', TODAY)
    expect(r.recurrence.freq).toBe('weekly')
  })

  it('EN: every day → daily', () => {
    const r = parseTaskText('feed the cat every day', 'en', TODAY)
    expect(r.recurrence).toEqual({ freq: 'daily', interval: 1, weekdays: null, mode: 'due' })
  })
})

describe('nlp — fechas', () => {
  it('ES: mañana → due_date +1', () => {
    const r = parseTaskText('revisar el coche mañana', 'es', TODAY)
    expect(r.due_date).toBe('2026-08-23')
    expect(r.recurrence).toBeNull()
    expect(r.cleanedTitle).toBe('revisar el coche')
  })

  it('EN: tomorrow → due_date +1', () => {
    const r = parseTaskText('call the bank tomorrow', 'en', TODAY)
    expect(r.due_date).toBe('2026-08-23')
  })

  it('ES: en 3 días → due_date +3', () => {
    const r = parseTaskText('pagar la factura en 3 días', 'es', TODAY)
    expect(r.due_date).toBe('2026-08-25')
  })

  it('ISO date explícita', () => {
    const r = parseTaskText('entregar el informe 2026-09-01', 'es', TODAY)
    expect(r.due_date).toBe('2026-09-01')
  })

  it('ES: el viernes (hoy sábado) → próximo viernes', () => {
    const r = parseTaskText('comprar entradas el viernes', 'es', TODAY)
    expect(r.due_date).toBe('2026-08-28')
  })

  it('EN: next monday → próximo lunes', () => {
    const r = parseTaskText('schedule dentist appointment next monday', 'en', TODAY)
    expect(r.due_date).toBe('2026-08-24')
  })

  it('ES: hoy → hoy', () => {
    const r = parseTaskText('limpiar la cocina hoy', 'es', TODAY)
    expect(r.due_date).toBe(TODAY)
  })
})

describe('nlp — combinado y sin match', () => {
  it('combina recurrencia y fecha en el mismo texto', () => {
    const r = parseTaskText('regar las plantas cada lunes y miércoles mañana', 'es', TODAY)
    expect(r.due_date).toBe('2026-08-23')
    expect(r.recurrence).toEqual({ freq: 'weekly', interval: 1, weekdays: [1, 3], mode: 'due' })
  })

  it('sin fecha ni recurrencia → null', () => {
    expect(parseTaskText('comprar leche', 'es', TODAY)).toBeNull()
    expect(parseTaskText('', 'es', TODAY)).toBeNull()
  })

  it('texto que es solo la parte temporal → null (no queda título)', () => {
    expect(parseTaskText('mañana', 'es', TODAY)).toBeNull()
  })
})

describe('nlp gastos — fechas pasadas', () => {
  it('ayer / anteayer / hoy', () => {
    expect(parseExpenseText('cena ayer', 'es', TODAY).spent_at).toBe('2026-08-21')
    expect(parseExpenseText('compra anteayer', 'es', TODAY).spent_at).toBe('2026-08-20')
    expect(parseExpenseText('café hoy', 'es', TODAY).spent_at).toBe(TODAY)
  })

  it('hace N días / semanas', () => {
    expect(parseExpenseText('cenó hace 3 días', 'es', TODAY).spent_at).toBe('2026-08-19')
    expect(parseExpenseText('hace 2 semanas', 'es', TODAY)).toBeNull() // sin título
    expect(parseExpenseText('gas hace 2 semanas', 'es', TODAY).spent_at).toBe('2026-08-08')
    expect(parseExpenseText('dinner 3 days ago', 'en', TODAY).spent_at).toBe('2026-08-19')
  })

  it('el <día> → el más reciente (no el próximo, a diferencia de tareas)', () => {
    // hoy sábado: "el viernes" → ayer (2026-08-21); "el domingo" → hace 6 días
    expect(parseExpenseText('cena el viernes', 'es', TODAY).spent_at).toBe('2026-08-21')
    expect(parseExpenseText('compra el domingo', 'es', TODAY).spent_at).toBe('2026-08-16')
    expect(parseExpenseText('cena el viernes pasado', 'es', TODAY).spent_at).toBe('2026-08-21')
    expect(parseExpenseText('dinner last friday', 'en', TODAY).spent_at).toBe('2026-08-21')
    // "el viernes" cuando HOY es viernes → hoy (los gastos miran atrás)
    expect(parseExpenseText('cena el viernes', 'es', '2026-08-21').spent_at).toBe('2026-08-21')
  })

  it('ISO explícita gana', () => {
    const r = parseExpenseText('cena 2026-08-01', 'es', TODAY)
    expect(r.spent_at).toBe('2026-08-01')
    expect(r.cleanedTitle).toBe('cena')
  })

  it('sin marca temporal conocida → sin fecha', () => {
    const r = parseExpenseText('cena con los suegros', 'es', TODAY)
    expect(r).toBeNull()
  })
})

describe('nlp gastos — importes', () => {
  it('formas con € y euros', () => {
    expect(parseExpenseText('cena 45,50 €', 'es', TODAY).amount_cents).toBe(4550)
    expect(parseExpenseText('taxi 12€', 'es', TODAY).amount_cents).toBe(1200)
    expect(parseExpenseText('mercado 20 euros', 'es', TODAY).amount_cents).toBe(2000)
    expect(parseExpenseText('€30.5 taxi', 'en', TODAY).amount_cents).toBe(3050)
    expect(parseExpenseText('lunch 30.50 eur', 'en', TODAY).amount_cents).toBe(3050)
  })

  it('número suelto NO es importe (mínima sorpresa)', () => {
    expect(parseExpenseText('cena para 4 personas', 'es', TODAY)).toBeNull()
  })

  it('miles ambiguos (3 decimales) no se extraen', () => {
    // "1.250 €" podría ser 1,25 € o 1.250 €: no hay sugerencia
    expect(parseExpenseText('mando 1.250 €', 'es', TODAY)).toBeNull()
  })

  it('importe + fecha juntos, limpia el título', () => {
    const r = parseExpenseText('cena aniversario ayer 89,90 €', 'es', TODAY)
    expect(r.spent_at).toBe('2026-08-21')
    expect(r.amount_cents).toBe(8990)
    expect(r.cleanedTitle).toBe('cena aniversario')
  })
})
