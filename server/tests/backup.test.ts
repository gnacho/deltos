// backup.test.js — backup consistente y verificado (issue #228).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { execBackup } from '../src/backup.js'
import { makeInstance } from './helpers.js'

const tmpDirs = []
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltos-backup-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true })
})

describe('backup de la base de datos', () => {
  it('produce un snapshot verificado y actualiza el kv', async () => {
    const { prod, dir } = await makeInstance()
    const admin = prod.prepare('SELECT id FROM users LIMIT 1').get().id
    const now = Date.now()
    prod
      .prepare('INSERT INTO projects (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run('p-1', 'Casa', admin, now)
    prod
      .prepare('INSERT INTO tasks (id, project_id, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('t-1', 'p-1', 'Tarea', admin, now, now)

    const res = await execBackup(prod, { DATA_DIR: dir })

    expect(res.ok).toBe(true)
    expect(fs.existsSync(res.path)).toBe(true)

    const snap = new Database(res.path, { readonly: true })
    expect(snap.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(snap.prepare('SELECT count(*) AS n FROM tasks').get().n).toBe(1)
    expect(snap.prepare('SELECT title FROM tasks WHERE id = ?').get('t-1').title).toBe('Tarea')
    snap.close()

    expect(prod.prepare("SELECT value FROM kv WHERE key = 'backup_last_run'").get().value).toBeTruthy()
  })

  it('funciona sin el CLI sqlite3 en el PATH', async () => {
    const { prod, dir } = await makeInstance()
    const saved = process.env.PATH
    process.env.PATH = ''
    try {
      const res = await execBackup(prod, { DATA_DIR: dir })
      expect(res.ok).toBe(true)
    } finally {
      process.env.PATH = saved
    }
  })

  it('falla y no deja fichero si no hay base de datos', async () => {
    const { prod } = await makeInstance()
    const empty = tmp()

    const res = await execBackup(prod, { DATA_DIR: empty })

    expect(res.ok).toBe(false)
    const backupsDir = path.join(empty, 'backups')
    const files = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir) : []
    expect(files).toEqual([])
  })

  it('ya no copia el fichero a pelo ni invoca el CLI sqlite3', () => {
    const src = fs.readFileSync(new URL('../src/backup.js', import.meta.url), 'utf8')
    expect(src).not.toMatch(/copyFileSync/)
    expect(src).not.toMatch(/['"]sqlite3['"]/)
  })

  it('el CLI de backup (ruta del timer) produce un snapshot verificado', async () => {
    const { dir } = await makeInstance()
    const cli = fileURLToPath(new URL('../src/backup-cli.js', import.meta.url))

    const out = execFileSync(process.execPath, [cli, dir], { encoding: 'utf8' })

    expect(out).toMatch(/backup-cli:/)
    const backups = fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.endsWith('.db'))
    expect(backups.length).toBe(1)
    const snap = new Database(path.join(dir, 'backups', backups[0]), { readonly: true })
    expect(snap.pragma('integrity_check', { simple: true })).toBe('ok')
    snap.close()
  })
})
