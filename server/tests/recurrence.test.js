// recurrence.test.js — recurrencia de tareas: lógica pura (nextOccurrence,
// adaptativo) e integración (crear tarea recurrente → mover a hecho → se crea
// la siguiente instancia con la fecha correcta).
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { makeInstance, loginAdmin, jsonReq } from './helpers.js'
import {
  normalizeRecurrence,
  nextOccurrence,
  adaptiveInterval,
  median,
  computeNextDue,
  completionDates,
} from '../src/recurrence.js'
import { openDb } from '../src/db.js'

async function setup() {
  const inst = await makeInstance({ seedDemoData: false })
  const auth = await loginAdmin(inst.app)
  const proj = await inst.app.request(
    '/api/projects',
    jsonReq(auth, 'POST', '/api/projects', { name: 'Casa', emoji: '🏠', color: 'sky' })
  )
  const project = (await proj.json()).project
  return { ...inst, auth, project }
}

async function createTask(app, auth, project_id, body) {
  const res = await app.request('/api/tasks', jsonReq(auth, 'POST', '/api/tasks', { project_id, title: 'Riega', ...body }))
  expect(res.status).toBe(201)
  return (await res.json()).task
}

async function moveTask(app, auth, taskId, column) {
  const res = await app.request(`/api/tasks/${taskId}/move`, jsonReq(auth, 'POST', '', { column, position: 0 }))
  expect(res.status).toBe(200)
  return res.json()
}

describe('recurrence — lógica pura', () => {
  it('nextOccurrence daily suma el intervalo', () => {
    const rec = normalizeRecurrence({ freq: 'daily', interval: 2 })
    expect(nextOccurrence('2026-08-22', rec)).toBe('2026-08-24')
  })

  it('nextOccurrence weekly sin weekdays suma 7*interval', () => {
    const rec = normalizeRecurrence({ freq: 'weekly', interval: 1 })
    expect(nextOccurrence('2026-08-22', rec)).toBe('2026-08-29')
  })

  it('nextOccurrence weekly con weekdays va al siguiente día de la lista', () => {
    // 2026-08-22 es sábado (6); lista [1,5] (lunes y viernes) → lunes 24
    const rec = normalizeRecurrence({ freq: 'weekly', interval: 1, weekdays: [1, 5] })
    expect(nextOccurrence('2026-08-22', rec)).toBe('2026-08-24')
    // desde un lunes 24 → siguiente en la lista es viernes 28
    expect(nextOccurrence('2026-08-24', rec)).toBe('2026-08-28')
  })

  it('nextOccurrence monthly suma meses y clampea el final de mes', () => {
    const rec = normalizeRecurrence({ freq: 'monthly', interval: 1 })
    expect(nextOccurrence('2026-01-31', rec)).toBe('2026-02-28')
    expect(nextOccurrence('2026-02-15', rec)).toBe('2026-03-15')
  })

  it('normalizeRecurrence descarta configs inválidas y fija defaults', () => {
    expect(normalizeRecurrence(null)).toBeNull()
    expect(normalizeRecurrence({})).toBeNull()
    expect(normalizeRecurrence({ freq: 'yearly' })).toBeNull()
    const rec = normalizeRecurrence({ freq: 'weekly', weekdays: [9, 1, 1, 5] })
    expect(rec).toEqual({ freq: 'weekly', interval: 1, weekdays: [1, 5], mode: 'due' })
  })

  it('median devuelve la mediana (par e impar)', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
  })

  it('adaptiveInterval usa la mediana de gaps con historia y el configurado sin ella', () => {
    const DAY = 24 * 60 * 60 * 1000
    const t0 = 1700000000000
    expect(adaptiveInterval([], 2)).toBe(2)
    expect(adaptiveInterval([t0], 2)).toBe(2)
    // gaps de 7 y 9 días → mediana 8
    expect(adaptiveInterval([t0, t0 + 7 * DAY, t0 + 16 * DAY], 2)).toBe(8)
    // gaps de 3 y 5 → mediana 4; nunca por debajo de 1
    expect(adaptiveInterval([t0, t0 + 3 * DAY, t0 + 8 * DAY], 2)).toBe(4)
  })
})

describe('recurrence — computeNextDue', () => {
  function dbWithTasks() {
    const db = openDb(path.join(os.tmpdir(), `deltos-rec-test-${Math.random().toString(36).slice(2)}.db`))
    db.pragma('foreign_keys = OFF')
    return db
  }

  it('mode due: desde el vencimiento previo, cadencia constante', () => {
    const db = dbWithTasks()
    const task = {
      id: 'a1',
      recurrence: JSON.stringify({ freq: 'weekly', interval: 1, mode: 'due' }),
      recurrence_group_id: 'a1',
      due_date: '2026-08-21',
    }
    expect(computeNextDue(db, task, '2026-08-22')).toBe('2026-08-28')
    db.close()
  })

  it('mode due avanzado hasta superar hoy si quedó en el pasado', () => {
    const db = dbWithTasks()
    const task = {
      id: 'a2',
      recurrence: JSON.stringify({ freq: 'weekly', interval: 1, mode: 'due' }),
      recurrence_group_id: 'a2',
      due_date: '2026-08-01',
    }
    // desde 2026-08-01 semanal: 8, 15, 22, 29; hoy 22 → siguiente 29
    expect(computeNextDue(db, task, '2026-08-22')).toBe('2026-08-29')
    db.close()
  })

  it('mode completion: primer completado sin historia usa el intervalo configurado', () => {
    const db = dbWithTasks()
    // Timestamp FIJO (no Date.now()): las expectativas afirman contra un today
    // fijo y el cálculo ancla en la fecha de completado (#182, time-bomb).
    const T0 = Date.UTC(2026, 7, 22, 12)
    db.prepare(
      `INSERT INTO tasks (id, project_id, title, "column", position, created_at, updated_at, recurrence, recurrence_group_id)
       VALUES ('a3', 'p1', 'Riega', 'hecho', 0, ?, ?, ?, 'a3')`
    ).run(T0, T0, JSON.stringify({ freq: 'daily', interval: 2, mode: 'completion' }))
    db.prepare(
      `INSERT INTO activity_events (id, task_id, user_id, type, data, created_at)
       VALUES ('e1', 'a3', 'u1', 'moved', '{"from":"encurso","to":"hecho"}', ?)`
    ).run(T0 - 1000)
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get('a3')
    const today = '2026-08-22'
    expect(computeNextDue(db, task, today)).toBe('2026-08-24')
    db.close()
  })

  it('mode completion: con historia de la serie usa la mediana de intervalos reales', () => {
    const db = dbWithTasks()
    const DAY = 24 * 60 * 60 * 1000
    // Ancla FIJA en el today del test (2026-08-22): con Date.now() las
    // expectativas caducan al pasar la fecha (#182, time-bomb).
    const now = Date.UTC(2026, 7, 22, 12)
    // dos instancias completadas separadas 7 días + esta a 9 días → mediana 8
    for (const [tid, off] of [
      ['s1', -16 * DAY],
      ['s2', -9 * DAY],
      ['s3', 0],
    ]) {
      db.prepare(
        `INSERT INTO tasks (id, project_id, title, "column", position, created_at, updated_at, recurrence, recurrence_group_id)
         VALUES (?, 'p1', 'Riega', 'hecho', 0, ?, ?, ?, 'series-1')`
      ).run(tid, now, now, JSON.stringify({ freq: 'weekly', interval: 1, mode: 'completion' }))
      db.prepare(
        `INSERT INTO activity_events (id, task_id, user_id, type, data, created_at)
         VALUES (?, ?, 'u1', 'moved', '{"from":"encurso","to":"hecho"}', ?)`
      ).run('e' + tid, tid, now + off)
    }
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get('s3')
    const completions = completionDates(db, 'series-1')
    expect(completions.length).toBe(3)
    expect(adaptiveInterval(completions, 1)).toBe(8)
    // base = última fecha de completado (s3, hoy) + 8 días
    expect(computeNextDue(db, task, '2026-08-22')).toBe('2026-08-30')
    db.close()
  })
})

describe('recurrence — integración API', () => {
  it('mover a hecho crea la siguiente instancia en nuevo con due_date calculada', async () => {
    const { app, auth, project } = await setup()
    // Fechas RELATIVAS al reloj real (#182): con fecha fija el test caduca al
    // cruzar la medianoche (mode 'due' avanza hasta superar HOY).
    const DAY = 24 * 60 * 60 * 1000
    const isoLocal = (ms) => {
      const d = new Date(ms)
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
    const due = isoLocal(Date.now() - DAY) // ayer
    const expected = isoLocal(Date.now() + 6 * DAY) // ayer + 7 = hoy + 6
    const t = await createTask(app, auth, project.id, {
      due_date: due,
      recurrence: { freq: 'weekly', interval: 1, mode: 'due' },
    })
    expect(t.recurrence).toEqual({ freq: 'weekly', interval: 1, weekdays: null, mode: 'due' })
    expect(t.recurrence_group_id).toBe(t.id)

    const { task: moved } = await moveTask(app, auth, t.id, 'hecho')
    expect(moved.column).toBe('hecho')

    // la nueva instancia debe existir en 'nuevo' con la próxima fecha
    const res = await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })
    const boot = await res.json()
    const next = boot.tasks.find((x) => x.title === 'Riega' && x.column === 'nuevo')
    expect(next).toBeTruthy()
    expect(next.recurrence).toEqual({ freq: 'weekly', interval: 1, weekdays: null, mode: 'due' })
    expect(next.recurrence_group_id).toBe(t.id)
    expect(next.due_date).toBe(expected)
  })

  it('crea instancia con la mediana adaptativa en modo completion', async () => {
    const { app, auth, project } = await setup()
    const t = await createTask(app, auth, project.id, {
      recurrence: { freq: 'weekly', interval: 1, mode: 'completion' },
    })
    // 1er completado: sin historia → intervalo configurado (7 días desde hoy)
    await moveTask(app, auth, t.id, 'hecho')
    let boot = await (await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })).json()
    let next = boot.tasks.find((x) => x.recurrence_group_id === t.id && x.column === 'nuevo')
    expect(next).toBeTruthy()
    const due1 = next.due_date

    // forzar las fechas de los eventos para simular historia
    // (crear + mover las siguientes instancias; los events van a Date.now)
    // 2º y 3er completado: los movemos para acumular gaps
    await moveTask(app, auth, next.id, 'hecho')
    boot = await (await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })).json()
    next = boot.tasks.find((x) => x.recurrence_group_id === t.id && x.column === 'nuevo')
    await moveTask(app, auth, next.id, 'hecho')
    expect(next).toBeTruthy()
    // el grupo tiene historia; la instancia creada mantiene el grupo
    const inst = boot.tasks.find((x) => x.recurrence_group_id === t.id && x.column === 'nuevo')
    expect(inst.recurrence_group_id).toBe(t.id)
    expect(typeof due1).toBe('string')
    expect(due1.length).toBe(10)
  })

  it('PATCH recurrence activa serie nueva y null la desactiva', async () => {
    const { app, auth, project } = await setup()
    const t = await createTask(app, auth, project.id, {})
    expect(t.recurrence).toBeNull()

    const res = await app.request(
      `/api/tasks/${t.id}`,
      jsonReq(auth, 'PATCH', '', { recurrence: { freq: 'daily', interval: 1, mode: 'due' } })
    )
    expect(res.status).toBe(200)
    const patched = (await res.json()).task
    expect(patched.recurrence).toEqual({ freq: 'daily', interval: 1, weekdays: null, mode: 'due' })
    expect(patched.recurrence_group_id).toBe(t.id)

    const res2 = await app.request(`/api/tasks/${t.id}`, jsonReq(auth, 'PATCH', '', { recurrence: null }))
    expect(res2.status).toBe(200)
    const task2 = (await res2.json()).task
    expect(task2.recurrence).toBeNull()
    expect(task2.recurrence_group_id).toBeNull()
  })

  it('GET /api/tasks/recurring lista series con instancia activa y próxima fecha', async () => {
    const { app, auth, project } = await setup()
    const t = await createTask(app, auth, project.id, {
      due_date: '2026-09-01',
      recurrence: { freq: 'daily', interval: 1, mode: 'due' },
    })
    const res = await app.request('/api/tasks/recurring', { headers: { cookie: auth.cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.series).toHaveLength(1)
    const s = body.series[0]
    expect(s.group_id).toBe(t.id)
    expect(s.active_task_id).toBe(t.id)
    expect(s.status).toBe('open')
    expect(s.recurrence.freq).toBe('daily')
  })

  it('GET /api/tasks/recurring muestra waiting cuando no hay instancia activa', async () => {
    const { app, auth, project } = await setup()
    const t = await createTask(app, auth, project.id, {
      column: 'hecho',
      due_date: '2026-09-01',
      recurrence: { freq: 'daily', interval: 1, mode: 'due' },
    })
    const res = await app.request('/api/tasks/recurring', { headers: { cookie: auth.cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.series[0].status).toBe('waiting')
    expect(body.series[0].active_task_id).toBeNull()
  })

  it('pausar/reanudar serie actualiza recurrence_paused y evita nueva instancia', async () => {
    const { app, auth, project } = await setup()
    const t = await createTask(app, auth, project.id, {
      due_date: '2026-09-01',
      recurrence: { freq: 'daily', interval: 1, mode: 'due' },
    })
    const pause = await app.request(`/api/tasks/recurring/${t.id}/pause`, jsonReq(auth, 'POST', '', {}))
    expect(pause.status).toBe(204)
    const list = await (await app.request('/api/tasks/recurring', { headers: { cookie: auth.cookie } })).json()
    expect(list.series[0].status).toBe('paused')

    await app.request(`/api/tasks/${t.id}/move`, jsonReq(auth, 'POST', '', { column: 'hecho', position: 0 }))
    const boot = await (await app.request('/api/bootstrap', { headers: { cookie: auth.cookie } })).json()
    const next = boot.tasks.find((x) => x.recurrence_group_id === t.id && x.column === 'nuevo')
    expect(next).toBeUndefined()

    const resume = await app.request(`/api/tasks/recurring/${t.id}/resume`, jsonReq(auth, 'POST', '', {}))
    expect(resume.status).toBe(204)
    const resumed = await (await app.request('/api/tasks/recurring', { headers: { cookie: auth.cookie } })).json()
    expect(resumed.series[0].status).toBe('waiting')
  })
})
