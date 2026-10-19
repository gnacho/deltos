// sse.ts — hub de Server-Sent Events (contrato de eventos, skill api-stack).
// El front solo lee: SSE en vez de WebSocket (reconexión gratis con EventSource).
//
// Contrato:
//   - Eventos NOMBRADOS `<dominio>.<verbo>`: task.changed, project.changed…
//     (el cliente hace addEventListener('task.changed', …); 'sync.resync' =
//     refetch completo tras una reconexión con eventos perdidos).
//   - `id:` monótono estrictamente creciente por evento (secuencia en memoria;
//     los eventos son notificaciones de cambio SIN datos, no canal de datos:
//     el resync no reenvía histórico, manda UN 'sync.resync' y el cliente
//     refetchea vía REST — ver CONVENTIONS.md).
//   - `Last-Event-ID`: si el último id visto es anterior a la secuencia
//     actual, hubo eventos perdidos → se emite 'sync.resync' al conectar.
//   - Heartbeat `: ping` (comentario SSE) cada 20 s desde la ruta (crítico
//     tras Nginx Proxy Manager: proxies cierran conexiones idle ~60 s).
//   - `data` mantiene {type:'changed', entity} por compatibilidad con el
//     frontend actual hasta la fase 2.
import type { SSEStreamingApi } from 'hono/streaming'

export type SseEntity =
  | 'users'
  | 'projects'
  | 'tasks'
  | 'labels'
  | 'comments'
  | 'attachments'
  | 'settings'
  | 'decisions'
  | 'expenses'
  | 'gamification'

// Dominio singular para el nombre del evento (entity plural del dominio).
const DOMAIN: Partial<Record<SseEntity, string>> = {
  users: 'user',
  projects: 'project',
  tasks: 'task',
  labels: 'label',
  comments: 'comment',
  attachments: 'attachment',
  settings: 'settings',
  decisions: 'decision',
  expenses: 'expense',
}

export function eventName(entity: SseEntity): string {
  return `${DOMAIN[entity] ?? entity}.changed`
}

export interface Hub {
  maxClients: number
  size(): number
  seq(): number
  add(stream: SSEStreamingApi): void
  remove(stream: SSEStreamingApi): void
  hello(stream: SSEStreamingApi): Promise<void>
  resync(stream: SSEStreamingApi, lastEventId: string | undefined): Promise<void> | undefined
  broadcast(entity: SseEntity): void
  shutdown(): void
}

export function createHub(maxClients = 20): Hub {
  const clients = new Set<SSEStreamingApi>()
  let seq = 0 // id monótono de eventos SSE (en memoria; ver contrato arriba)

  // Escribe un evento con id monótono asignado por el hub.
  function send(stream: SSEStreamingApi, event: string, data: unknown): Promise<void> {
    seq += 1
    return stream.writeSSE({ id: String(seq), event, data: JSON.stringify(data) })
  }

  return {
    maxClients,
    size: () => clients.size,
    // Secuencia actual (para tests y para decidir resync).
    seq: () => seq,
    add(stream) {
      clients.add(stream)
    },
    remove(stream) {
      clients.delete(stream)
    },
    // Saludo inicial de la conexión (también lleva id).
    hello(stream) {
      return send(stream, 'hello', { ok: true }).catch(() => {})
    },
    // Resync tras reconexión: lastEventId = header Last-Event-ID del navegador.
    // Si se perdieron eventos, UN 'sync.resync' basta: los eventos no llevan
    // datos, el cliente refetchea todo vía REST.
    resync(stream, lastEventId) {
      const last = parseInt(lastEventId || '', 10)
      if (Number.isFinite(last) && last < seq) {
        return send(stream, 'sync.resync', { type: 'changed', entity: '*' }).catch(() => {})
      }
      return undefined
    },
    // Notifica a todos los clientes que una entidad cambió:
    // event: '<dominio>.changed', data: {"type":"changed","entity":"tasks"|…}
    broadcast(entity: SseEntity) {
      const event = eventName(entity)
      const data = JSON.stringify({ type: 'changed', entity })
      seq += 1
      const id = String(seq)
      for (const stream of clients) {
        stream.writeSSE({ id, event, data }).catch(() => clients.delete(stream))
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
