// nlp.test.js — parser de lenguaje natural para tareas (ES/EN).
import { describe, it, expect } from 'vitest'
import { parseTaskText } from '../src/nlp.js'

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
