// notifications.test.js — menciones @user y digest de vencimiento.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeInstance } from './helpers.js'
import { extraerMenciones } from '../src/routes-domain.js'
import { enviarDigestVencimiento, PRONTO_DIAS } from '../src/digest.js'

let inst
beforeEach(async () => {
  inst = await makeInstance()
})
afterEach(() => inst?.close?.())

function insertUser(db, username) {
  const id = crypto.randomUUID()
  db.prepare(
    "INSERT INTO users (id, username, password_hash, language, role, created_at) VALUES (?, ?, 'x', 'es', 'user', ?)"
  ).run(id, username, Date.now())
  return id
}

function insertProject(db) {
  const id = crypto.randomUUID()
  db.prepare("INSERT INTO projects (id, name, position, created_at) VALUES (?, 'P', 0, ?)").run(id, Date.now())
  return id
}

function dateStr(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function insertTask(db, project, assignee, col, dueOffset) {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO tasks (id, project_id, title, "column", position, due_date, assignee_id, created_by, created_at, updated_at)
     VALUES (?, ?, 'T', ?, 0, ?, ?, ?, ?, ?)`
  ).run(id, project, col, dueOffset !== null ? dateStr(dueOffset) : null, assignee, assignee, Date.now(), Date.now())
  return id
}

describe('extraerMenciones', () => {
  it('resuelve @username existentes (case-insensitive), ignora inexistentes y al actor', () => {
    const ana = insertUser(inst.prod, 'ana')
    const bob = insertUser(inst.prod, 'bob')
    const actor = insertUser(inst.prod, 'carlos')
    const ids = extraerMenciones(inst.prod, 'hola @ANA y @bob, ¿vemos @inventado? (yo @carlos)', actor)
    expect(ids.sort()).toEqual([ana, bob].sort())
  })

  it('sin menciones devuelve []', () => {
    insertUser(inst.prod, 'ana')
    expect(extraerMenciones(inst.prod, 'texto sin arrobas', 'noexiste')).toEqual([])
  })

  it('deduplica menciones repetidas', () => {
    const ana = insertUser(inst.prod, 'ana')
    const ids = extraerMenciones(inst.prod, '@ana @ana @ana', 'otro')
    expect(ids).toEqual([ana])
  })
})

describe('enviarDigestVencimiento', () => {
  it('clasifica vencidas/hoy/pronto y marca kv (idempotente: 2ª vez no repite)', async () => {
    const u = insertUser(inst.prod, 'usuario')
    const proj = insertProject(inst.prod)
    insertTask(inst.prod, proj, u, 'nuevo', -1) // vencida (ayer)
    insertTask(inst.prod, proj, u, 'encurso', 0) // hoy
    insertTask(inst.prod, proj, u, 'nuevo', 1) // pronto (mañana)
    insertTask(inst.prod, proj, u, 'hecho', -5) // completada: NO cuenta
    insertTask(inst.prod, proj, u, 'nuevo', null) // sin fecha: NO cuenta

    const hoy = dateStr(0)
    const key = `vencimiento_${u}_${hoy}`
    expect(inst.prod.prepare('SELECT 1 FROM kv WHERE key = ?').get(key)).toBeUndefined()
    await enviarDigestVencimiento(inst.prod, false)
    expect(inst.prod.prepare('SELECT 1 FROM kv WHERE key = ?').get(key)).toBeDefined()
    // 2ª vez: idempotente (el marker ya existe, no lanza)
    await expect(enviarDigestVencimiento(inst.prod, false)).resolves.toBeUndefined()
  })

  it('usuario sin tareas con fecha no recibe marker', async () => {
    const u = insertUser(inst.prod, 'usuario')
    insertProject(inst.prod)
    await enviarDigestVencimiento(inst.prod, false)
    const rows = inst.prod.prepare("SELECT key FROM kv WHERE key LIKE 'vencimiento_%'").all()
    expect(rows.length).toBe(0)
  })
})
