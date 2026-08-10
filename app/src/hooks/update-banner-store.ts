import { useSyncExternalStore } from 'react';

/**
 * Puente entre el check de actualizaciones (AdminBar, por usuario) y el ribbon
 * global (Layout): el resultado del check de GitHub se publica aquí y el
 * banner lo lee. Aislado de React para que no dependa del árbol de providers.
 */
export interface UpdateBannerState {
  /** Hay una release nueva en GitHub (check manual hecho desde Ajustes). */
  available: boolean;
  version: string | null;
  url: string | null;
  /** El servidor ya está redeployado y el SW nuevo espera activación. */
  swWaiting: boolean;
  applySw: (() => void) | null;
  /** Aplica la release nueva en el servidor (deltos-update.sh, solo admin). */
  applyRelease: (() => Promise<void>) | null;
  /** Descarta el ribbon para esta versión (vuelve a salir con otra más nueva). */
  dismissVersion: (() => void) | null;
}

const EMPTY: UpdateBannerState = {
  available: false,
  version: null,
  url: null,
  swWaiting: false,
  applySw: null,
  applyRelease: null,
  dismissVersion: null,
};

let state: UpdateBannerState = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return state;
}

export function setUpdateBanner(next: Partial<UpdateBannerState>) {
  state = { ...state, ...next };
  emit();
}

export function resetUpdateBanner() {
  state = EMPTY;
  emit();
}

/** Lee el estado compartido del ribbon de actualización. */
export function useUpdateBanner(): UpdateBannerState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
