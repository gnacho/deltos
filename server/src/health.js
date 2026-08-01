// health.js — GET /health: estado de la BD, uptime y memoria.
export function registerHealth(app, { prod, demo }) {
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
