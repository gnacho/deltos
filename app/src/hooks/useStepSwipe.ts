import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const SWIPE_SLOP = 10; /* px antes de "reclamar" el gesto como swipe horizontal */
const SNAP_FRACTION = 0.22; /* fracción del ancho del track para decidir snap */
const EDGE_RESIST = 0.35; /* resistencia elástica al empujar en la primera/última etapa */

/* Zonas en las que NO se roba el gesto: el swipe solo cambia etapa cuando el
   dedo empieza en la zona "de contenido" (tarjetas, huecos, la página en
   general) y nunca sobre controles interactivos. */
const EXCLUDED =
  'nav, [data-segbar], [data-col], [role="dialog"], button, a, input, select, textarea';

/**
 * Swipe horizontal sobre el track de etapas móvil, CONTROLADO por el dedo
 * (efecto carrusel): mientras se desliza, el track acompaña al dedo 1:1; al
 * soltar hace snap a la etapa más cercana si supera el umbral (o queda donde
 * estaba si no). El contenido acompaña al dedo: deslizar a la izquierda avanza
 * a la siguiente etapa, a la derecha retrocede.
 *
 * Escucha en `window` en fase CAPTURE con `passive:false` y reescribe el
 * transform del `trackRef` directamente (sin re-render → sin lag). Si no se
 * pasa `trackRef`, cae al comportamiento simple: solo decide el snap al soltar.
 */
export function useStepSwipe<T extends string>(
  steps: readonly T[],
  seg: T,
  onStep: (s: T) => void,
  trackRef?: RefObject<HTMLDivElement | null>,
  active = true,
) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    const segIdx = steps.indexOf(seg);
    const track = trackRef?.current ?? null;
    const trackWidth = () => track?.clientWidth ?? window.innerWidth;

    const excluded = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest(EXCLUDED);

    const setTrack = (dxPct: number, animate: boolean) => {
      if (!track) return;
      track.style.transition = animate
        ? 'transform 0.32s cubic-bezier(0.3, 0.7, 0.3, 1)'
        : 'none';
      track.style.transform = `translate3d(calc(-${Math.max(0, segIdx) * 100}% + ${dxPct}%), 0, 0)`;
    };

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
      if (Math.abs(dx) <= SWIPE_SLOP) return;
      e.preventDefault();
      if (!track) return;
      /* Desplazamiento del dedo en % del ancho del track (1:1). Resistencia
         elástica si se empuja más allá de la primera/última etapa. */
      let dxPct = (dx / trackWidth()) * 100;
      if ((segIdx === 0 && dx > 0) || (segIdx === steps.length - 1 && dx < 0)) {
        dxPct *= EDGE_RESIST;
      }
      setTrack(dxPct, false);
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
      if (!track) {
        if (ms > 450) return;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
        const i = segIdx;
        const next = dx < 0 ? steps[i + 1] : steps[i - 1];
        if (next) onStep(next);
        return;
      }
      /* Snap: si el desplazamiento supera el umbral, ir a la etapa vecina
         (ignora la duración: arrastrar lento pero lejos también es válido). */
      const fraction = dx / trackWidth();
      let targetIdx = segIdx;
      if (fraction <= -SNAP_FRACTION) targetIdx = segIdx + 1;
      else if (fraction >= SNAP_FRACTION) targetIdx = segIdx - 1;
      targetIdx = Math.max(0, Math.min(steps.length - 1, targetIdx));
      if (targetIdx !== segIdx) {
        onStep(steps[targetIdx]);
      } else {
        setTrack(0, true); /* vuelve elástico a la etapa actual */
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
  }, [steps.join(','), seg, active]);
}
