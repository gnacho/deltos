// sse.js — hub de Server-Sent Events: heartbeat y broadcast tras mutaciones.
// El front solo lee: SSE en vez de WebSocket (reconexión gratis con EventSource).

export function createHub(maxClients = 20) {
  const clients = new Set()
  return {
    maxClients,
    size: () => clients.size,
    add(stream) {
      clients.add(stream)
    },
    remove(stream) {
      clients.delete(stream)
    },
    // Notifica a todos los clientes que una entidad cambió:
    // data: {"type":"changed","entity":"tasks"|"comments"|...}
    broadcast(entity) {
      const data = JSON.stringify({ type: 'changed', entity })
      for (const stream of clients) {
        stream.writeSSE({ data }).catch(() => clients.delete(stream))
      }
    },
    // Aviso de cierre para graceful shutdown
    shutdown() {
      for (const stream of clients) {
        stream.writeSSE({ event: 'shutdown', data: '{}' }).catch(() => {})
      }
      clients.clear()
    },
  }
}
