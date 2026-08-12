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
  active = true,
) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;

    /* Listener en window CAPTURE: con `touch-action: pan-y` en la lista, el
       navegador se "come" los touchmove del elemento para el scroll vertical
       nativo (no llegan al contenedor). En capture window sí los vemos antes.
       Solo cuenta si el gesto empieza DENTRO de la lista (el ref). */
    const inList = (target: EventTarget | null) =>
      target instanceof Element && el.contains(target);

    const onStart = (e: TouchEvent) => {
      if (!inList(e.target)) return;
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

    window.addEventListener('touchstart', onStart, { passive: true, capture: true });
    window.addEventListener('touchmove', onMove, { passive: true, capture: true });
    window.addEventListener('touchend', onEnd, { passive: true, capture: true });
    window.addEventListener('touchcancel', onEnd, { passive: true, capture: true });
    return () => {
      window.removeEventListener('touchstart', onStart, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchmove', onMove, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchend', onEnd, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchcancel', onEnd, { capture: true } as EventListenerOptions);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, steps.join(','), seg, active]);
}
