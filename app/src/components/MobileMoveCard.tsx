import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const HOLD_MS = 350;
const SCROLL_SLOP = 12; /* px de movimiento antes del hold → es un scroll */
const FLICK_VY = -0.55; /* px/ms hacia arriba para contar como lanzamiento */
const FLICK_DY = -48;
const CLEANUP_GUARD_MS = 500; /* red de seguridad: nada queda pegado */
const EDGE = 48; /* px del borde lateral para cambiar de etapa durante el arrastre */
const EDGE_STEP_MS = 420; /* repetición mientras el dedo se mantiene en el borde */

const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

/* Diagnóstico en pantalla: localStorage.setItem('dnd_debug','1') y recargar.
   Muestra cada paso del gesto para localizar dónde se rompe en dispositivo real. */
const DBG = (() => {
  try {
    return localStorage.getItem('dnd_debug') === '1';
  } catch {
    return false;
  }
})();
function dbg(msg: string) {
  if (!DBG) return;
  let el = document.getElementById('dnd-debug');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dnd-debug';
    el.style.cssText =
      'position:fixed;bottom:96px;left:8px;right:8px;z-index:200;background:rgba(0,0,0,.82);' +
      'color:#4ade80;font:11px/1.5 monospace;padding:8px;border-radius:10px;' +
      'pointer-events:none;white-space:pre-wrap';
    document.body.appendChild(el);
  }
  el.textContent = `${el.textContent}\n${msg}`.split('\n').slice(-9).join('\n');
}

interface Props {
  id: string;
  current: string;
  /** Etapas en orden; el flick hacia arriba avanza a la siguiente. */
  steps: string[];
  onMove: (id: string, step: string) => void;
  /** Cambia la vista de etapa EN VIVO durante el arrastre (la etapa entera
   * hace swipe mientras la tarjeta sigue al dedo). Si no se pasa, la etapa
   * destino solo se ilumina en la barra (mm-target). */
  onPreviewStep?: (step: string) => void;
  children: ReactNode;
}

/**
 * Movimiento móvil de tarjetas: mantener pulsado crea un CLON fijo a nivel de
 * body que sigue al dedo por encima del velo y de la barra de etapas. Mientras
 * se arrastra, llegar al borde lateral cambia la etapa de destino EN VIVO
 * (onPreviewStep → la vista hace swipe) y, si el dedo se mantiene en el borde,
 * sigue avanzando cada EDGE_STEP_MS — así se pueden saltar varias etapas de un
 * tirón. Al soltar, el clon vuela hasta la pestaña de la etapa destino y la
 * tarjeta se mueve (onMove); soltar sin destino lo devuelve elástico.
 *
 * El teardown del efecto es NO destructivo si el drag está activo: al cambiar
 * la etapa en vivo la tarjeta original se desmonta (la vista re-renderiza),
 * pero el clon y los listeners de `document` sobreviven y se limpian en el
 * touchend final — así el gesto no muere al hacer swipe de la etapa.
 */
export function MobileMoveCard({ id, current, steps, onMove, onPreviewStep, children }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const guard = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ y: number; t: number; vy: number }>({ y: 0, t: 0, vy: 0 });
  const lifted = useRef(false);
  const clone = useRef<HTMLElement | null>(null);
  const origin = useRef<DOMRect | null>(null);
  const grab = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const justDragged = useRef(false);
  const raf = useRef<number | null>(null);
  /* Etapa "previsualizada" durante el arrastre: empieza en la actual y avanza
     hacia el borde; al soltar es el destino real del move. */
  const preview = useRef<string | null>(null);
  const edgeDir = useRef<0 | -1 | 1>(0);
  const edgeTimer = useRef<number | null>(null);
  /* Handlers de document, guardados para poder quitarlos desde cleanup aunque
     el componente ya se haya desmontado (cambio de etapa en vivo). */
  const handlers = useRef<{
    move: (e: TouchEvent) => void;
    end: (e: TouchEvent) => void;
  } | null>(null);
  const [dim, setDim] = useState(false);

  const cardEl = () => wrapRef.current?.firstElementChild as HTMLElement | null;

  const clearTarget = () => {
    document
      .querySelectorAll('[data-seg].mm-target')
      .forEach((el) => el.classList.remove('mm-target'));
  };

  const tabUnder = (x: number, y: number): HTMLElement | null => {
    const el = document.elementFromPoint(x, y);
    return el?.closest<HTMLElement>('[data-seg]') ?? null;
  };

  /** Limpieza total e idempotente; guard la fuerza aunque falle un transitionend. */
  const cleanup = () => {
    if (guard.current !== null) {
      window.clearTimeout(guard.current);
      guard.current = null;
    }
    if (edgeTimer.current !== null) {
      window.clearInterval(edgeTimer.current);
      edgeTimer.current = null;
    }
    edgeDir.current = 0;
    preview.current = null;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    clearTarget();
    document.body.classList.remove('mm-dragging');
    setDim(false);
    lifted.current = false;
    start.current = null;
    clone.current?.remove();
    clone.current = null;
    origin.current = null;
    if (handlers.current) {
      document.removeEventListener('touchmove', handlers.current.move, {
        capture: true,
      } as EventListenerOptions);
      document.removeEventListener('touchend', handlers.current.end, {
        capture: true,
      } as EventListenerOptions);
      document.removeEventListener('touchcancel', handlers.current.end, {
        capture: true,
      } as EventListenerOptions);
      handlers.current = null;
    }
    cardEl()?.classList.remove('mm-origin');
  };

  const scheduleCleanup = (ms: number) => {
    if (guard.current !== null) window.clearTimeout(guard.current);
    guard.current = window.setTimeout(cleanup, ms);
  };

  const setCloneTransform = (x: number, y: number, extra = 'rotate(2deg) scale(1.05)') => {
    if (!clone.current) return;
    clone.current.style.transform = `translate(${x}px, ${y}px) ${extra}`;
  };

  /** El clon vuela hasta la pestaña, el contador salta y se ejecuta el move. */
  const flyTo = (tab: HTMLElement, step: string) => {
    const c = clone.current;
    const commit = () => {
      navigator.vibrate?.(8);
      const count = tab.querySelector('.tnum');
      if (count) {
        count.classList.add('mm-pop');
        count.addEventListener('animationend', () => count.classList.remove('mm-pop'), {
          once: true,
        });
      }
      onMove(id, step);
    };
    if (!c || reducedMotionMQ.matches) {
      cleanup();
      commit();
      return;
    }
    clearTarget();
    document.body.classList.remove('mm-dragging');
    setDim(false);
    lifted.current = false;
    const cr = c.getBoundingClientRect();
    const tr = tab.getBoundingClientRect();
    const dx = tr.left + tr.width / 2 - cr.width / 2;
    const dy = tr.top + tr.height / 2 - cr.height / 2;
    c.style.transition = 'transform 0.38s cubic-bezier(0.3, 0.7, 0.3, 1), opacity 0.38s ease';
    setCloneTransform(dx, dy, 'rotate(8deg) scale(0.1)');
    c.style.opacity = '0.15';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      commit();
    };
    c.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, CLEANUP_GUARD_MS); /* red: si transitionend no llega */
  };

  /** Vuelta elástica del clon al hueco de origen. */
  const springBack = () => {
    const c = clone.current;
    const o = origin.current;
    clearTarget();
    document.body.classList.remove('mm-dragging');
    setDim(false);
    lifted.current = false;
    if (!c || !o || reducedMotionMQ.matches) {
      cleanup();
      return;
    }
    c.style.transition = 'transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)';
    setCloneTransform(o.left, o.top, 'rotate(0deg) scale(1)');
    c.addEventListener('transitionend', cleanup, { once: true });
    scheduleCleanup(CLEANUP_GUARD_MS);
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const cancelHold = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };

    /* Avanza la etapa previsualizada una posición hacia el borde en el que
       está el dedo; si no hay etapa en esa dirección, deja de repetir. */
    const stepEdge = () => {
      if (edgeDir.current === 0 || !preview.current) return;
      const i = steps.indexOf(preview.current);
      if (i === -1) return;
      const next = edgeDir.current > 0 ? steps[i + 1] : steps[i - 1];
      if (!next) {
        if (edgeTimer.current !== null) {
          window.clearInterval(edgeTimer.current);
          edgeTimer.current = null;
        }
        return;
      }
      preview.current = next;
      dbg(`edge → ${next}`);
      onPreviewStep?.(next);
      clearTarget();
      const tab = document.querySelector<HTMLElement>(`[data-seg="${next}"]`);
      if (tab) tab.classList.add('mm-target');
    };

    const stopEdge = () => {
      edgeDir.current = 0;
      if (edgeTimer.current !== null) {
        window.clearInterval(edgeTimer.current);
        edgeTimer.current = null;
      }
    };

    const lift = () => {
      const card = cardEl();
      if (!card) return;
      lifted.current = true;
      justDragged.current = true;
      preview.current = current;
      dbg('LIFT: clon creado, scroll bloqueado a partir de ahora');
      navigator.vibrate?.(12);
      const rect = card.getBoundingClientRect();
      origin.current = rect;
      grab.current = start.current
        ? { x: start.current.x - rect.left, y: start.current.y - rect.top }
        : { x: rect.width / 2, y: rect.height / 2 };
      const c = card.cloneNode(true) as HTMLElement;
      c.classList.remove('card');
      c.classList.add('mm-clone');
      c.style.transition = 'none'; /* mata transiciones heredadas por cloneNode */
      c.style.animation = 'none';
      c.style.width = `${rect.width}px`;
      c.style.transform = `translate(${rect.left}px, ${rect.top}px) rotate(0deg) scale(1)`;
      document.body.appendChild(c);
      clone.current = c;
      /* Pop de levantamiento con overshoot; después el clon sigue al dedo sin transición */
      requestAnimationFrame(() => {
        if (!clone.current) return;
        c.style.transition = 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)';
        setCloneTransform(rect.left, rect.top);
        window.setTimeout(() => {
          if (clone.current) clone.current.style.transition = '';
        }, 190);
      });
      card.classList.add('mm-origin');
      document.body.classList.add('mm-dragging');
      setDim(true);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (clone.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
      last.current = { y: t.clientY, t: performance.now(), vy: 0 };
      justDragged.current = false;
      dbg(`start (${Math.round(t.clientX)},${Math.round(t.clientY)}) scrollY=${window.scrollY}`);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        lift();
      }, HOLD_MS);
    };

    /* Se adjunta a `document` (no al wrap) para que sobreviva al re-render que
       provoca onPreviewStep (la tarjeta original se desmonta, el clon y el
       gesto siguen vivos). */
    const onTouchMove = (e: TouchEvent) => {
      if (!start.current) return;
      const t = e.touches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      if (!lifted.current) {
        if (Math.hypot(dx, dy) > SCROLL_SLOP) {
          dbg(
            `hold cancelado por movimiento (${Math.round(dx)},${Math.round(dy)}) → scroll normal`,
          );
          cancelHold(); /* es un scroll normal */
          start.current = null;
        }
        return;
      }
      e.preventDefault(); /* levantada: la página no scrollea */
      dbg(
        `move (${Math.round(dx)},${Math.round(dy)}) cancelable=${e.cancelable} prevented=${e.defaultPrevented}`,
      );
      const now = performance.now();
      const dt = now - last.current.t || 1;
      last.current = { y: t.clientY, t: now, vy: (t.clientY - last.current.y) / dt };
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        if (!origin.current) return;
        setCloneTransform(t.clientX - grab.current.x, t.clientY - grab.current.y);

        /* Borde lateral → etapa en vivo, repetible mientras se mantiene ahí. */
        const inRight = t.clientX >= window.innerWidth - EDGE;
        const inLeft = t.clientX <= EDGE;
        const dir: 0 | -1 | 1 = inRight ? 1 : inLeft ? -1 : 0;
        if (dir !== 0 && dir !== edgeDir.current) {
          edgeDir.current = dir;
          stepEdge();
          if (edgeTimer.current !== null) window.clearInterval(edgeTimer.current);
          edgeTimer.current = window.setInterval(stepEdge, EDGE_STEP_MS);
        } else if (dir === 0) {
          stopEdge();
          clearTarget();
          const tab = tabUnder(t.clientX, t.clientY);
          if (tab && tab.dataset.seg !== current) tab.classList.add('mm-target');
        } else {
          const tab = document.querySelector<HTMLElement>(
            `[data-seg="${preview.current ?? current}"]`,
          );
          if (tab) tab.classList.add('mm-target');
        }
      });
    };

    const onTouchEnd = (e: TouchEvent) => {
      dbg(`end type=${e.type} lifted=${lifted.current} preview=${preview.current}`);
      cancelHold();
      stopEdge();
      if (!lifted.current || !start.current) {
        start.current = null;
        return;
      }
      const t = e.changedTouches[0];
      const dy = t.clientY - start.current.y;
      const tab = tabUnder(t.clientX, t.clientY);

      /* Etapa previsualizada por el borde (cambió en vivo) → destino real. */
      if (preview.current && preview.current !== current) {
        const targetTab = document.querySelector<HTMLElement>(`[data-seg="${preview.current}"]`);
        if (targetTab) {
          dbg(`drop tras preview ${current}→${preview.current}`);
          flyTo(targetTab, preview.current);
          return;
        }
      }
      if (tab && tab.dataset.seg && tab.dataset.seg !== current) {
        dbg(`drop en etapa ${tab.dataset.seg} → vuelo`);
        flyTo(tab, tab.dataset.seg);
        return;
      }
      /* Soltar junto al borde lateral → etapa vecina (izquierda: anterior, derecha: siguiente) */
      const idx = steps.indexOf(current);
      let side: string | null = null;
      if (t.clientX <= EDGE && idx > 0) side = steps[idx - 1];
      else if (t.clientX >= window.innerWidth - EDGE && idx < steps.length - 1)
        side = steps[idx + 1];
      if (side) {
        const sideTab = document.querySelector<HTMLElement>(`[data-seg="${side}"]`);
        if (sideTab) {
          dbg(`drop en lateral ${t.clientX >= window.innerWidth - EDGE ? 'derecha' : 'izquierda'} → ${side}`);
          flyTo(sideTab, side);
          return;
        }
      }
      /* Flick hacia arriba → siguiente etapa (las etapas viven arriba) */
      if (last.current.vy < FLICK_VY && dy < FLICK_DY) {
        const next = steps[steps.indexOf(current) + 1];
        const nextTab = next ? document.querySelector<HTMLElement>(`[data-seg="${next}"]`) : null;
        if (next && nextTab) {
          flyTo(nextTab, next);
          return;
        }
      }
      springBack();
    };

    wrap.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });
    handlers.current = { move: onTouchMove, end: onTouchEnd };

    return () => {
      cancelHold();
      /* Si el drag está activo (el componente se desmonta por el swipe de etapa
         en vivo), NO hacemos limpieza: el clon y los listeners de document
         sobreviven y el touchend final ejecutará cleanup(). Solo el listener de
         touchstart del wrap (que ya no existe) se descarta con el desmontaje. */
      if (!lifted.current) cleanup();
      wrap.removeEventListener('touchstart', onTouchStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, current, steps.join(',')]);

  return (
    <>
      {dim && <div className="mm-dim" aria-hidden="true" />}
      <div
        ref={wrapRef}
        className="select-none [-webkit-touch-callout:none]"
        onContextMenu={(e) => {
          /* El menú contextual nativo (~500ms) interrumpiría el arrastre */
          if (lifted.current || justDragged.current) e.preventDefault();
        }}
        onClickCapture={(e) => {
          if (justDragged.current) {
            e.preventDefault();
            e.stopPropagation();
            justDragged.current = false;
          }
        }}
      >
        {children}
      </div>
    </>
  );
}
