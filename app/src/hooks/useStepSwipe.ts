import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const SWIPE_SLOP = 10; /* px antes de "reclamar" el gesto como swipe horizontal */
const SWIPE_X = 40; /* px de desplazamiento horizontal mínimo para contar como swipe */
const SWIPE_MAX_MS = 450; /* un hold-drag (mover tarjeta, 350ms) dura más → no es swipe */

/** Overlay de depuración temporal: muestra en pantalla qué ve el hook. */
function debug(msg: string) {
  let el = document.getElementById('swipe-debug');
  if (!el) {
    el = document.createElement('div');
    el.id = 'swipe-debug';
    el.style.cssText =
      'position:fixed;top:56px;left:8px;right:8px;z-index:9999;background:rgba(0,0,0,.85);' +
      'color:#4ade80;font:11px/1.5 monospace;padding:6px 10px;border-radius:8px;' +
      'pointer-events:none;white-space:pre-wrap';
    document.body.appendChild(el);
  }
  el.textContent = msg;
}

/**
 * Swipe horizontal sobre una lista móvil para cambiar de etapa (izquierda →
 * siguiente, derecha → anterior).
 *
 * Escucha en `window` en fase CAPTURE con `passive:false`. En cuanto el gesto
 * que empieza dentro de la lista es claramente horizontal, llama
 * `preventDefault()` para "reclamar" el gesto y evitar que el navegador lo
 * convierta en scroll (la lista NO lleva `touch-action` restrictivo, así
 * preventDefault en touchmove sí tiene efecto).
 */
export function useStepSwipe<T extends string>(
  ref: RefObject<HTMLElement | null>,
  steps: readonly T[],
  seg: T,
  onStep: (s: T) => void,
  active = true,
) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) {
      /* La lista aún no está montada (ref.current null): reintenta en el
         siguiente frame en lugar de desistir. */
      const raf = requestAnimationFrame(() => {
        const retry = ref.current;
        if (retry) attachAndCleanup(retry);
        else debug('HOOK v5: lista NO montada');
      });
      return () => cancelAnimationFrame(raf);
    }
    return attachAndCleanup(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, steps.join(','), seg, active]);

  function attachAndCleanup(el: HTMLElement) {
    debug('HOOK v5 ACTIVO (listeners adjuntos)');
    const inList = (target: EventTarget | null) =>
      target instanceof Element && el.contains(target);

    const onStart = (e: TouchEvent) => {
      const inL = inList(e.target);
      debug('touchstart target=' + (e.target && e.target.tagName) + ' inList=' + inL + ' n=' + e.touches.length);
      if (!inL) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, t: performance.now() };
      debug('START (' + Math.round(t.clientX) + ',' + Math.round(t.clientY) + ')');
    };

    const onMove = (e: TouchEvent) => {
      if (!start.current || e.touches.length === 0) return;
      if (document.body.classList.contains('mm-dragging')) {
        start.current = null;
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      /* Nunca cancela por "vertical": la página debe poder scrollear. Solo
         reclama el gesto (preventDefault) cuando hay componente horizontal. */
      if (Math.abs(dx) > SWIPE_SLOP) {
        e.preventDefault();
        debug('MOVE dx=' + Math.round(dx) + ' dy=' + Math.round(dy));
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (!start.current) return;
      const { x, y, t } = start.current;
      start.current = null;
      if (e.changedTouches.length === 0) return;
      const ct = e.changedTouches[0];
      const dx = ct.clientX - x;
      const dy = ct.clientY - y;
      const ms = performance.now() - t;
      if (ms > SWIPE_MAX_MS) {
        debug('END lento ms=' + Math.round(ms));
        return;
      }
      /* La trayectoria TOTAL decide: dx dominante → swipe */
      if (Math.abs(dx) < SWIPE_X || Math.abs(dx) < Math.abs(dy)) {
        debug('END corto dx=' + Math.round(dx) + ' dy=' + Math.round(dy));
        return;
      }
      const i = steps.indexOf(seg);
      if (i === -1) return;
      const next = dx < 0 ? steps[i + 1] : steps[i - 1];
      if (next) {
        debug('SWIPE→' + String(next));
        onStep(next);
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true, capture: true });
    window.addEventListener('touchmove', onMove, { passive: false, capture: true });
    window.addEventListener('touchend', onEnd, { passive: true, capture: true });
    window.addEventListener('touchcancel', onEnd, { passive: true, capture: true });
    return () => {
      window.removeEventListener('touchstart', onStart, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchmove', onMove, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchend', onEnd, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchcancel', onEnd, { capture: true } as EventListenerOptions);
    };
  }
}
