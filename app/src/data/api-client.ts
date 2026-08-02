/**
 * Cliente HTTP centralizado (base común). UN solo punto de salida HTTP.
 * Nada de fetch() disperso por componentes.
 *
 * Contrato del backend (CONVENTIONS.md):
 * - TODO 4xx/5xx llega como envelope {error:{code,message,details?}}.
 *   `code` es estable y machine-readable: la UI traduce por código
 *   (ver lib/errors.ts y el namespace `errors` de los locales); `message`
 *   (español) es solo fallback.
 * - Validación zod → 422 VALIDATION_FAILED con details.issues crudos.
 * - DELETE → 204 SIN cuerpo (no se intenta parsear JSON).
 * - POST que crea → 201.
 * - Auth por cookie HttpOnly (credentials: 'same-origin').
 * - 401 → despacha `deltos-unauthorized` UNA vez (anti-cascada). AuthGate
 *   reacciona y muestra Login. NUNCA location.assign('/login').
 * - Login/check inicial/logout pasan `noAuthEvent` para no auto-disparar.
 */

const APP_SLUG = 'deltos';

/** Envelope de error del backend (todo 4xx/5xx). */
export interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

/** Issue crudo de zod tal y como llega en details.issues de un 422. */
export interface ValidationIssue {
  path?: (string | number)[];
  code?: string;
  message?: string;
}

export class ApiError extends Error {
  readonly status: number;
  /** Código estable del catálogo (p. ej. 'TASK_NOT_FOUND'); null si no vino. */
  readonly code: string | null;
  /** details del envelope (en 422: {issues: ValidationIssue[]}). */
  readonly details?: unknown;
  readonly body?: unknown;

  constructor(
    message: string,
    status: number,
    opts?: { code?: string | null; details?: unknown; body?: unknown },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = opts?.code ?? null;
    this.details = opts?.details;
    this.body = opts?.body;
  }

  /** Issues de zod si el error es un 422 VALIDATION_FAILED. */
  validationIssues(): ValidationIssue[] {
    if (this.code !== 'VALIDATION_FAILED') return [];
    const issues = (this.details as { issues?: unknown } | undefined)?.issues;
    return Array.isArray(issues) ? (issues as ValidationIssue[]) : [];
  }
}

/** Evita cascadas cuando N peticiones reciben 401 a la vez. */
let handling401 = false;

/** Resetea el flag tras un login exitoso (llamar desde el flujo de login). */
export function resetAuthGuard(): void {
  handling401 = false;
}

/** Despacha el evento de sesión "no autorizado" (contrato base común). */
export function dispatchUnauthorized(): void {
  if (!handling401) {
    handling401 = true;
    window.dispatchEvent(new Event(`${APP_SLUG}-unauthorized`));
  }
}

/** Despacha el evento de sesión "autenticado". */
export function dispatchAuthed(): void {
  resetAuthGuard();
  window.dispatchEvent(new Event(`${APP_SLUG}-authed`));
}

function handleUnauthorized(): never {
  dispatchUnauthorized();
  throw new ApiError('Sesión expirada', 401, { code: 'AUTH_REQUIRED' });
}

/** Desenvuelve el envelope {error:{code,message,details}} → ApiError. */
function toApiError(body: unknown, status: number): ApiError {
  const env = (body as ApiErrorEnvelope | null)?.error;
  return new ApiError(env?.message ?? `Error HTTP ${status}`, status, {
    code: env?.code ?? null,
    details: env?.details,
    body,
  });
}

export interface ApiOptions extends RequestInit {
  /** No despachar `deltos-unauthorized` ante un 401 (login, me inicial, logout). */
  noAuthEvent?: boolean;
}

export async function apiFetch<T>(path: string, init?: ApiOptions): Promise<T> {
  const { noAuthEvent, ...rest } = init ?? {};
  const res = await fetch(path, {
    credentials: 'same-origin', // cookie HttpOnly de sesión
    ...rest,
    headers: { Accept: 'application/json', ...rest.headers },
  });

  // 204 No Content (DELETE y cía.): jamás intentar parsear cuerpo.
  if (res.status === 204) return undefined as T;

  if (res.status === 401) {
    if (noAuthEvent) {
      const body = (await res.json().catch(() => null)) as unknown;
      throw toApiError(body, 401);
    }
    handleUnauthorized();
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) throw new ApiError(`Error HTTP ${res.status}`, res.status);
    // P. ej. un proxy devolviendo HTML: no parsear a ciegas.
    throw new ApiError(`Respuesta no JSON (${res.status})`, res.status);
  }

  const body = (await res.json()) as unknown;

  if (!res.ok) throw toApiError(body, res.status);

  return body as T;
}

/** Conveniencia para POST JSON. */
export function apiPost<T>(path: string, data?: unknown, init?: ApiOptions): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

/** Conveniencia para PUT JSON. */
export function apiPut<T>(path: string, data: unknown, init?: ApiOptions): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PUT',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    body: JSON.stringify(data),
  });
}

/** Conveniencia para PATCH JSON. */
export function apiPatch<T>(path: string, data: unknown, init?: ApiOptions): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PATCH',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    body: JSON.stringify(data),
  });
}

/** Conveniencia para DELETE. */
export function apiDelete<T>(path: string, init?: ApiOptions): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE', ...init });
}

/** Conveniencia para subida multipart (adjuntos). */
export function apiUpload<T>(path: string, form: FormData, init?: ApiOptions): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', ...init, body: form });
}
