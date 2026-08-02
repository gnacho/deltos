/**
 * Traducción de errores de la API por `code` (contrato CONVENTIONS.md).
 * La fuente de verdad es el namespace `errors` de los locales (es/en);
 * el `message` en español del server es solo fallback si falta la clave.
 */
import i18n from '@/i18n';
import { ApiError } from '@/data/api-client';

/**
 * Texto de error para mostrar en UI:
 * 1. Si hay `code` y existe `errors.<code>` en el diccionario → traducción.
 * 2. Si no, el `message` del server.
 * 3. Si no es un ApiError, el fallback genérico de la vista.
 */
export function apiErrorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code) {
      const key = `errors.${err.code}`;
      if (i18n.exists(key)) return i18n.t(key);
    }
    if (err.message) return err.message;
  }
  return fallback;
}

/**
 * Errores por campo a partir de un 422 VALIDATION_FAILED (details.issues de
 * zod). Devuelve {campo: mensaje traducido} usando el primer issue de cada
 * path de primer nivel. Vacío si el error no es de validación.
 */
export function fieldErrors(err: unknown, message: string): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const issue of err.validationIssues()) {
    const field = issue.path?.[0];
    if (typeof field === 'string' && field !== '' && !(field in out)) out[field] = message;
  }
  return out;
}
