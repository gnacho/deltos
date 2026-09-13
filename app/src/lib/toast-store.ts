import { useSyncExternalStore } from 'react';

/**
 * Avisos efímeros (toasts) con acción opcional, p. ej. deshacer un borrado.
 * Aislado de React para que cualquier capa (DataProvider, páginas) pueda
 * publicar sin depender del árbol de providers.
 */
export interface ToastAction {
  label: string;
  onAction: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
  /** ms hasta auto-cerrarse; 0 = no se cierra solo. */
  duration: number;
}

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

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
  return toasts;
}

/** Publica un aviso. Devuelve su id. */
export function showToast(input: { message: string; action?: ToastAction; duration?: number }): number {
  const id = nextId++;
  const toast: Toast = {
    id,
    message: input.message,
    action: input.action,
    duration: input.duration ?? 6000,
  };
  toasts = [...toasts, toast];
  emit();
  if (toast.duration > 0) {
    timers.set(id, setTimeout(() => dismissToast(id), toast.duration));
  }
  return id;
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = toasts.filter((toast) => toast.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}
