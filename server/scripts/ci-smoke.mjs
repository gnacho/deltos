// ci-smoke.mjs — smoke de CI: arranca el servidor, comprueba health y versión,
// crea datos, hace un backup con el CLI del timer y verifica que se puede
// restaurar. No necesita systemd ni root.
//
// Uso (desde server/): node scripts/ci-smoke.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3210
const BASE = `http://127.0.0.1:${PORT}`
const AUTH = { username: 'smoke', password: 'smoke-secret' }

let failed = false
const fail = (m) => {
  console.error(`FAIL: ${m}`)
  failed = true
}
const ok = (m) => console.log(`ok: ${m}`)

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltos-smoke-'))
const staticDir = path.join(dataDir, 'dist')
fs.mkdirSync(staticDir, { recursive: true })
fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>smoke</title>')

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: serverDir,
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: dataDir,
    STATIC_DIR: staticDir,
    AUTH_USER: AUTH.username,
    AUTH_PASS: AUTH.password,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
})

async function waitHealth(timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.status === 200) return true
    } catch {
      /* aún no levanta */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

async function api(pathname, { method = 'GET', cookie, csrf, body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* respuesta no JSON */
  }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') }
}

function stopServer() {
  return new Promise((resolve) => {
    server.once('exit', resolve)
    server.kill('SIGTERM')
    setTimeout(() => {
      server.kill('SIGKILL')
      resolve()
    }, 5000)
  })
}

// --- 1. Arranque, health y versión ---
if (!(await waitHealth())) {
  fail('el servidor no respondió a /health')
  await stopServer()
  fs.rmSync(dataDir, { recursive: true, force: true })
  process.exit(1)
}
ok('health 200')

const pkg = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'))
const login = await api('/api/auth/login', { method: 'POST', body: AUTH })
if (login.status !== 200) {
  fail(`login devolvió ${login.status}`)
} else {
  const cookie = login.setCookie.split(';')[0]
  const csrf = login.json.csrfToken

  const version = await api('/api/version', { cookie })
  if (version.json?.version !== pkg.version) fail(`versión ${version.json?.version} != ${pkg.version}`)
  else ok(`versión ${pkg.version}`)

  const proj = await api('/api/projects', {
    method: 'POST',
    cookie,
    csrf,
    body: { name: 'Smoke', emoji: '', color: 'sky' },
  })
  if (proj.status !== 201) fail(`crear proyecto devolvió ${proj.status}`)
  const task = await api('/api/tasks', {
    method: 'POST',
    cookie,
    csrf,
    body: { project_id: proj.json?.project?.id, title: 'Smoke task' },
  })
  if (task.status !== 201) fail(`crear tarea devolvió ${task.status}`)
  else ok('datos creados')
}

await stopServer()

// --- 2. Backup por el CLI (la ruta del timer) ---
const backup = spawn(process.execPath, ['src/backup-cli.js', dataDir], {
  cwd: serverDir,
  stdio: 'inherit',
})
const backupCode = await new Promise((r) => backup.on('exit', r))
if (backupCode !== 0) fail(`backup-cli salió con ${backupCode}`)

const backupsDir = path.join(dataDir, 'backups')
const backups = fs.existsSync(backupsDir)
  ? fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db'))
  : []
if (backups.length !== 1) fail(`se esperaba 1 backup, hay ${backups.length}`)
else ok('backup creado')

// --- 3. Restore sobre una BD vacía ---
if (backups.length === 1) {
  const dbPath = path.join(dataDir, 'app.db')
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
  fs.copyFileSync(path.join(backupsDir, backups[0]), dbPath)

  const db = new Database(dbPath, { readonly: true })
  const integrity = db.pragma('integrity_check', { simple: true })
  const tasks = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n
  db.close()

  if (integrity !== 'ok') fail(`integrity_check: ${integrity}`)
  else ok('integrity_check ok')
  if (tasks !== 1) fail(`tareas tras restaurar: ${tasks} (se esperaba 1)`)
  else ok('el restore conserva las tareas')
}

fs.rmSync(dataDir, { recursive: true, force: true })
if (failed) {
  console.error('SMOKE FALLÓ')
  process.exit(1)
}
console.log('SMOKE OK')
