// health.ts — GET /health: estado de la BD, uptime y memoria.
import type { Hono } from 'hono'
import type { AppEnv } from './types.js'
import type Database from 'better-sqlite3'

export function registerHealth(app: Hono<AppEnv>, { prod, demo }: { prod: Database.Database; demo?: Database.Database | null }) {
  app.get('/health', (c) => {
    let dbOk = true
    try {
      prod.prepare('SELECT 1').get()
      demo?.prepare('SELECT 1').get()
    } catch {
      dbOk = false
    }
    const mem = process.memoryUsage()
    return c.json({
      status: dbOk ? 'ok' : 'degraded',
      uptime: process.uptime(),
      memory: { rss: mem.rss, heap: mem.heapUsed },
      db: dbOk ? 'connected' : 'error',
    })
  })
}
