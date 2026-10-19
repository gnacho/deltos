// update.ts — estado y aplicación de actualizaciones (patrón Keynest,
// skill app-auto-update): detecta la última release ESTABLE del repo
// (releases/latest, tag v*) y, si hay versión nueva, la aplica ejecutando
// deltos-update.sh (deploy/, versionado en el repo: releases + checksums +
// marker semver). El server NO se auto-aplica en runtime: el script hace el
// deploy y, con SKIP_RESTART=1, el server sale y systemd (Restart=on-failure)
// relanza con el código nuevo.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { kvGet, kvSet } from './db.js'

const REPO = process.env.GITHUB_REPO || 'gnacho/deltos'
const MARKER = process.env.RELEASE_MARKER || '/opt/deltos/.release-id'
const CACHE_KEY = 'gh_latest_release'
const CACHE_TTL = 5 * 60 * 1000

export interface ReleaseInfo {
  id: string
  body: string
}

export interface UpdateStatus {
  current: string
  latest: string | null
  available: boolean
  notes: string
  checkFailed: boolean
}

export interface UpdateProgress {
  step: string
  pct: number
  ts: number
}

// Versión semver instalada (marker lo escribe deltos-update.sh tras cada deploy).
export function currentId(): string {
  try {
    return readFileSync(MARKER, 'utf8').trim()
  } catch {
    return ''
  }
}

// Última release ESTABLE (releases/latest, tag v*), no la prerelease "latest" de
// main. Caché en kv con TTL 5 min para no pegar a la API de GitHub en cada
// llamada (rate-limit 60/h por IP sin token). Devuelve {id, body} para que la
// UI muestre el changelog del release (#189).
async function latestInfo(prodDb: Database.Database): Promise<ReleaseInfo | null> {
  const cached = kvGet(prodDb, CACHE_KEY)
  if (cached) {
    try {
      const c = JSON.parse(cached) as { at: number; id: string; body?: string }
      if (Date.now() - c.at < CACHE_TTL) return { id: c.id, body: c.body ?? '' }
    } catch { /* noop */ }
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'deltos-updater', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { tag_name?: unknown; body?: unknown }
  const id = String(data.tag_name ?? '').replace(/^v/, '')
  const body = typeof data.body === 'string' ? data.body : ''
  kvSet(prodDb, CACHE_KEY, JSON.stringify({ at: Date.now(), id, body }))
  return { id, body }
}

// Comparación semver numérica: '1.10.0' > '1.9.0'; prefijos 'v' ignorados.
function compareSemver(a: string, b: string): number {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

export async function updateStatus(prodDb: Database.Database): Promise<UpdateStatus> {
  const current = currentId()
  const latest = await latestInfo(prodDb).catch(() => null)
  const available = Boolean(latest && current && compareSemver(latest.id, current) > 0)
  // checkFailed (#181): el fetch a GitHub falló (p. ej. 403 rate-limit 60/h por
  // IP). Sin esto, "sin novedades" y "no se pudo comprobar" son indistinguibles.
  return {
    current,
    latest: latest?.id ?? null,
    available,
    notes: latest?.body ?? '',
    checkFailed: latest === null,
  }
}

// Progreso del apply (#189): deltos-update.sh escribe update-progress.json
// {step,pct,ts} en el data dir en cada STEP. Solo se considera vivo si el ts
// es reciente (15 min); un fichero viejo de una corrida muerta no se reporta.
const PROGRESS_TTL = 15 * 60 * 1000
const PROGRESS_FILE = 'update-progress.json'

export function updateProgress(dataDir: string): UpdateProgress | null {
  try {
    const raw = readFileSync(join(dataDir, PROGRESS_FILE), 'utf8')
    const p = JSON.parse(raw) as { step?: unknown; pct?: unknown; ts?: number }
    if (!p.ts || Date.now() - p.ts > PROGRESS_TTL) return null
    return { step: String(p.step ?? ''), pct: Number(p.pct) || 0, ts: p.ts }
  } catch {
    return null
  }
}
