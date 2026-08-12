import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const SWIPE_X = 60; /* px de desplazamiento horizontal para contar como swipe */
const SWIPE_RATIO = 1.5; /* |dx| debe superar |dy| × ratio para ser horizontal */
const SWIPE_MAX_MS = 400; /* un hold-drag (mover tarjeta) dura más → no es swipe */

/**
 * Swipe horizontal sobre una lista móvil para cambiar de etapa (izquierda →
 * siguiente, derecha → anterior). Adjunta listeners NATIVOS de touch al
 * contenedor (ref) — más fiables que los synthetic events de React en móvil.
 * El hold-drag de MobileMoveCard dura > SWIPE_MAX_MS, así un swipe rápido
 * (tap + deslizar < 400ms) no colisiona con mover tarjetas.
 */
export function useStepSwipe<T extends string>(
  ref: RefObject<HTMLElement | null>,
  steps: readonly T[],
  seg: T,
  onStep: (s: T) => void,
) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, t: performance.now() };
    };

    const onMove = (e: TouchEvent) => {
      if (!start.current || e.touches.length === 0) return;
      const t = e.touches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      /* Gesto claramente vertical (scroll): cancela el posible swipe */
      if (Math.abs(dy) > Math.abs(dx) * SWIPE_RATIO) start.current = null;
    };

    const onEnd = (e: TouchEvent) => {
      if (!start.current) return;
      const { x, y, t } = start.current;
      start.current = null;
      if (e.changedTouches.length === 0) return;
      const ct = e.changedTouches[0];
      const dx = ct.clientX - x;
      const dy = ct.clientY - y;
      if (performance.now() - t > SWIPE_MAX_MS) return; /* fue un hold-drag */
      if (Math.abs(dx) < SWIPE_X || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
      const i = steps.indexOf(seg);
      if (i === -1) return;
      const next = dx < 0 ? steps[i + 1] : steps[i - 1];
      if (next) onStep(next);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, steps.join(','), seg]);
}
