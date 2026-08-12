import { useEffect, useRef } from 'react';

const SWIPE_SLOP = 10; /* px antes de "reclamar" el gesto como swipe horizontal */
const SWIPE_X = 40; /* px de desplazamiento horizontal mínimo para contar como swipe */
const SWIPE_MAX_MS = 450; /* un hold-drag (mover tarjeta, 350ms) dura más → no es swipe */

/* Zonas en las que NO se roba el gesto: el swipe solo cambia etapa cuando el
   dedo empieza en la zona "de contenido" (tarjetas, huecos, la página en
   general) y nunca sobre controles interactivos. Antes el hook exigía
   `listRef.contains(target)`, lo que dejaba fuera el hueco vacío del board
   (target=BODY) — por eso el swipe no funcionaba al deslizar en espacios
   libres. */
const EXCLUDED =
  'nav, [data-segbar], [data-col], [role="dialog"], button, a, input, select, textarea';

/**
 * Swipe horizontal sobre una lista móvil para cambiar de etapa (derecha →
 * siguiente, izquierda → anterior): la etapa activa es la de la izquierda del
 * flujo, así que deslizar hacia la derecha avanza (como empujar el contenido
 * hacia la siguiente etapa).
 *
 * Escucha en `window` en fase CAPTURE con `passive:false`. En cuanto el gesto
 * que empieza fuera de las zonas interactivas es claramente horizontal, llama
 * `preventDefault()` para "reclamar" el gesto y evitar que el navegador lo
 * convierta en scroll. El contenedor del board lleva `touch-action: pan-y`
 * (móvil), así el navegador reserva el scroll vertical para sí y entrega los
 * movimientos horizontales a JS.
 */
export function useStepSwipe<T extends string>(
  steps: readonly T[],
  seg: T,
  onStep: (s: T) => void,
  active = true,
) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    if (!active) return;

    const excluded = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest(EXCLUDED);

    const onStart = (e: TouchEvent) => {
      if (excluded(e.target)) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, t: performance.now() };
    };

    const onMove = (e: TouchEvent) => {
      if (!start.current || e.touches.length === 0) return;
      if (document.body.classList.contains('mm-dragging')) {
        start.current = null;
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - start.current.x;
      /* Nunca cancela por "vertical": la página debe poder scrollear. Solo
         reclama el gesto (preventDefault) cuando hay componente horizontal. */
      if (Math.abs(dx) > SWIPE_SLOP) e.preventDefault();
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
      if (ms > SWIPE_MAX_MS) return;
      /* La trayectoria TOTAL decide: dx dominante → swipe */
      if (Math.abs(dx) < SWIPE_X || Math.abs(dx) < Math.abs(dy)) return;
      const i = steps.indexOf(seg);
      if (i === -1) return;
      /* El contenido acompaña al dedo: deslizar a la izquierda avanza a la
         siguiente etapa (el track se mueve a la izquierda), a la derecha
         retrocede. */
      const next = dx < 0 ? steps[i + 1] : steps[i - 1];
      if (next) onStep(next);
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
  }, [steps.join(','), seg, active]);
}
