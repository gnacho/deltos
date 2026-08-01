/**
 * Cliente HTTP centralizado (base común). UN solo punto de salida HTTP.
 * Nada de fetch() disperso por componentes.
 *
 * - Auth por cookie HttpOnly (credentials: 'same-origin').
 * - 401 → despacha `deltos-unauthorized` UNA vez (anti-cascada). AuthGate reacciona
 *   y muestra Login. NUNCA location.assign('/login').
 * - Login/check inicial/logout pasan `noAuthEvent` para no auto-disparar el evento.
 * - Errores tipados del backend ({error} → ApiError con .status/.body).
 */

const APP_SLUG = 'deltos';

export class ApiError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
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
  throw new ApiError('Sesión expirada', 401);
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

  if (res.status === 401) {
    if (noAuthEvent) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(body?.error ?? 'No autorizado', 401, body);
    }
    handleUnauthorized();
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    // P. ej. un proxy devolviendo HTML de error: no parsear a ciegas.
    throw new ApiError(`Respuesta no JSON (${res.status})`, res.status);
  }

  const body = (await res.json()) as unknown;

  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Error HTTP ${res.status}`;
    throw new ApiError(message, res.status, body);
  }

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
