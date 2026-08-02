import { lazy } from 'react';
import type { ComponentType } from 'react';

const RELOAD_FLAG = 'deltos-chunk-reload';

/** React.lazy tolerante a despliegues: si un chunk viejo da 404, recarga 1 vez/sesión. */
export function lazyRetry<T extends ComponentType<Record<string, never>>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const m = await factory();
      sessionStorage.removeItem(RELOAD_FLAG);
      return m;
    } catch (err) {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1');
        location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
