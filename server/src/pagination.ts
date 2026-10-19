// ============================================================================
// pagination.js — paginación keyset (seek) sobre better-sqlite3 (api-stack).
// Cursor opaco base64url { ts, id }: ts = created_at (epoch ms) de la última
// fila entregada, id = desempate para timestamps iguales.
// ============================================================================
import { httpError } from './errors.js'
import { ERROR_CODES } from './error-codes.js'

export function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

// Cursor malformado → 400 INVALID_CURSOR (nunca ignorarlo: devolvería la
// página 1 en silencio y la UI vería duplicados).
export function decodeCursor(raw) {
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))
    if (
      typeof parsed !== 'object' || parsed === null ||
      typeof parsed.ts !== 'number' || !Number.isFinite(parsed.ts) ||
      typeof parsed.id !== 'string' || parsed.id.length === 0
    ) {
      throw new Error('forma inválida')
    }
    return { ts: parsed.ts, id: parsed.id }
  } catch {
    httpError(400, ERROR_CODES.INVALID_CURSOR)
  }
}

// Ejecuta la consulta con LIMIT n+1 y recorta. `rows` debe venir ordenada por
// (created_at DESC, id DESC) y filtrada por el keyset si hay cursor.
// Devuelve { items, nextCursor, hasMore }.
export function keysetPage(rows, limit) {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ ts: last.created_at, id: last.id }) : null,
  }
}
