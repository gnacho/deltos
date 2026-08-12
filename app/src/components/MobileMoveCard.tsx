import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

const HOLD_MS = 350;
const SCROLL_SLOP = 12; /* px de movimiento antes del hold → es un scroll */
const FLICK_VY = -0.55; /* px/ms hacia arriba para contar como lanzamiento */
const FLICK_DY = -48;
const CLEANUP_GUARD_MS = 500; /* red de seguridad: nada queda pegado */
const EDGE = 48; /* px del borde: cruzar = snap a la etapa vecina */
const PEEK_ZONE = 72; /* px del borde donde el track empieza a acompañar al dedo */
const PEEK_MAX = 0.12; /* fracción del ancho que se desplaza el track antes del snap */
const EDGE_STEP_MS = 420; /* repetición mientras el dedo se mantiene en el borde */
const SNAP_MS = 300; /* duración del slide entre etapas */
const DRAG_WATCHDOG_MS = 3000; /* red: si no hay actividad del gesto, cleanup */

const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

/* Diagnóstico en pantalla: localStorage.setItem('dnd_debug','1') y recargar. */
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
  /** Track horizontal que contiene TODAS las etapas (una por cada w-full). El
   * drag lo desplaza con transform (efecto "cambiar de escritorio"): al llegar
   * al borde el track acompaña al dedo (peek) y hace snap a la etapa vecina;
   * si el dedo se mantiene en el borde, sigue avanzando. */
  trackRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

/**
 * Movimiento móvil de tarjetas: mantener pulsado crea un CLON fijo a nivel de
 * body que sigue al dedo por encima del velo y de la barra de etapas. Mientras
 * se arrastra, el track de etapas se desplaza siguiendo al dedo cerca del
 * borde (peek) y hace snap con transición al cruzar el borde — efecto de
 * "cambiar de escritorio". Mantener el dedo en el borde avanza etapa a etapa
 * (EDGE_STEP_MS), saltando varias de un tirón. Al soltar, el clon vuela a la
 * etapa destino y se hace onMove; sin destino, vuelve elástico y el track
 * regresa a la etapa original.
 */
export function MobileMoveCard({ id, current, steps, onMove, trackRef, children }: Props) {
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
  const preview = useRef<string | null>(null);
  const edgeDir = useRef<0 | -1 | 1>(0);
  const edgeTimer = useRef<number | null>(null);
  const handlers = useRef<{
    move: (e: TouchEvent) => void;
    end: (e: TouchEvent) => void;
  } | null>(null);
  /* True cuando el gesto ya se resolvió (flyTo/springBack en marcha): el clon
     se limpia solo; la red de seguridad de onTouchEnd no debe pisarlo. */
  const resolved = useRef(false);
  /* Tarjeta fantasma translúcida en la columna destino: muestra dónde caerá la
     tarjeta mientras se arrastra; el clon se deposita en ella al soltar. */
  const ghost = useRef<HTMLElement | null>(null);
  /* Watchdog de duración: si el gesto queda colgado (sin touchend/touchcancel,
     p.ej. el sistema lo roba en un plegable) fuerza el cleanup. */
  const watchdog = useRef<number | null>(null);
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

  /** Posición base del track (en %) para una etapa dada. */
  const trackBase = (step: string) => {
    const i = steps.indexOf(step);
    return `${Math.max(0, i) * 100}%`;
  };

  const trackEl = () => trackRef?.current ?? null;

  /** Desplaza el track sin transición (sigue al dedo). */
  const trackFollow = (px: number) => {
    const t = trackEl();
    if (!t) return;
    t.style.transition = 'none';
    t.style.transform = `translate3d(calc(-${trackBase(preview.current ?? current)} + ${px}px), 0, 0)`;
  };

  /** Snap del track a una etapa con transición (slide). */
  const trackSnap = (step: string) => {
    const t = trackEl();
    if (!t) return;
    t.style.transition = reducedMotionMQ.matches
      ? 'none'
      : `transform ${SNAP_MS}ms cubic-bezier(0.3, 0.7, 0.3, 1)`;
    t.style.transform = `translate3d(-${trackBase(step)}, 0, 0)`;
  };

  /** Dibuja/actualiza la tarjeta fantasma translúcida al final de la columna de
   * la etapa destino (el hueco donde caerá la tarjeta al soltar). */
  const ensureGhost = (step: string) => {
    const card = cardEl();
    const col = document.querySelector<HTMLElement>(`[data-mobile-stage="${step}"]`);
    if (!card || !col) return;
    if (ghost.current && ghost.current.parentElement === col) return;
    removeGhost();
    const g = card.cloneNode(true) as HTMLElement;
    g.classList.remove('card');
    g.classList.add('mm-ghost');
    g.removeAttribute('style');
    g.setAttribute('aria-hidden', 'true');
    col.appendChild(g);
    ghost.current = g;
  };

  const removeGhost = () => {
    ghost.current?.remove();
    ghost.current = null;
  };

  /** Rearma el watchdog: si el gesto queda sin actividad este tiempo, cleanup. */
  const armWatchdog = () => {
    if (watchdog.current !== null) window.clearTimeout(watchdog.current);
    watchdog.current = window.setTimeout(() => {
      if (lifted.current && !resolved.current) {
        dbg('WATCHDOG: gesto colgado → cleanup');
        cleanup();
      }
    }, DRAG_WATCHDOG_MS);
  };

  /** Limpieza total e idempotente; guard la fuerza aunque falle un transitionend. */
  const cleanup = () => {
    if (guard.current !== null) {
      window.clearTimeout(guard.current);
      guard.current = null;
    }
    if (watchdog.current !== null) {
      window.clearTimeout(watchdog.current);
      watchdog.current = null;
    }
    if (edgeTimer.current !== null) {
      window.clearInterval(edgeTimer.current);
      edgeTimer.current = null;
    }
    edgeDir.current = 0;
    preview.current = null;
    resolved.current = false;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    clearTarget();
    removeGhost();
    document.body.classList.remove('mm-dragging');
    setDim(false);
    lifted.current = false;
    resolved.current = false;
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

  /** El clon vuela hasta el punto de inserción real de la tarjeta en la
   * columna de la etapa destino (tras la última tarjeta de esa columna, que es
   * donde la inserta onMove) y se ejecuta el move; el contador de la pestaña
   * salta como feedback. */
  const flyTo = (step: string) => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    const c = clone.current;
    const col = document.querySelector<HTMLElement>(`[data-mobile-stage="${step}"]`);
    const tab = document.querySelector<HTMLElement>(`[data-seg="${step}"]`);
    const commit = () => {
      navigator.vibrate?.(8);
      if (tab) {
        const count = tab.querySelector('.tnum');
        if (count) {
          count.classList.add('mm-pop');
          count.addEventListener('animationend', () => count.classList.remove('mm-pop'), {
            once: true,
          });
        }
      }
      onMove(id, step);
    };
    if (!c || reducedMotionMQ.matches || !col) {
      cleanup();
      commit();
      return;
    }
    resolved.current = true;
    trackSnap(step);
    clearTarget();
    document.body.classList.remove('mm-dragging');
    setDim(false);
    lifted.current = false;
    /* El clon se deposita sobre la tarjeta fantasma (mm-ghost) de la columna
       destino, que marca exactamente el hueco donde caerá la tarjeta. */
    ensureGhost(step);
    const cr = c.getBoundingClientRect();
    const target = ghost.current ?? col;
    const gr = target.getBoundingClientRect();
    const dx = gr.left + gr.width / 2 - cr.width / 2;
    const dy = gr.top; /* el borde superior del clon cae en el borde del ghost */
    c.style.transition = 'transform 0.38s cubic-bezier(0.3, 0.7, 0.3, 1), opacity 0.38s ease';
    setCloneTransform(dx, dy, 'rotate(8deg) scale(0.1)');
    c.style.opacity = '0.15';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      removeGhost();
      cleanup();
      commit();
    };
    c.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, CLEANUP_GUARD_MS);
  };

  /** Vuelta elástica del clon al hueco de origen; el track regresa a la etapa. */
  const springBack = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    const c = clone.current;
    const o = origin.current;
    clearTarget();
    removeGhost();
    document.body.classList.remove('mm-dragging');
    setDim(false);
    lifted.current = false;
    if (trackEl()) trackSnap(current);
    if (!c || !o || reducedMotionMQ.matches) {
      cleanup();
      return;
    }
    resolved.current = true;
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

    /* Snap a la etapa vecina en la dirección del borde y, si el dedo sigue en
       el borde, repite cada EDGE_STEP_MS (saltar varias etapas). */
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
      trackSnap(next);
      clearTarget();
      ensureGhost(next);
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
      c.style.transition = 'none';
      c.style.animation = 'none';
      c.style.width = `${rect.width}px`;
      c.style.transform = `translate(${rect.left}px, ${rect.top}px) rotate(0deg) scale(1)`;
      document.body.appendChild(c);
      clone.current = c;
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
      armWatchdog();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (clone.current) {
        /* Red de seguridad: un clon huérfano de un gesto anterior no debe
           bloquear esta tarjeta; se limpia antes de empezar. */
        dbg('SAFETY: clon huérfano previo → cleanup');
        cleanup();
      }
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

    const onTouchMove = (e: TouchEvent) => {
      if (!start.current) return;
      const t = e.touches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      if (!lifted.current) {
        if (Math.hypot(dx, dy) > SCROLL_SLOP) {
          dbg(`hold cancelado por movimiento (${Math.round(dx)},${Math.round(dy)}) → scroll`);
          cancelHold();
          start.current = null;
        }
        return;
      }
      e.preventDefault();
      armWatchdog();
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

        const w = trackEl()?.clientWidth ?? 0;
        const inRight = t.clientX >= window.innerWidth - EDGE;
        const inLeft = t.clientX <= EDGE;
        const dir: 0 | -1 | 1 = inRight ? 1 : inLeft ? -1 : 0;

        if (dir !== 0 && dir !== edgeDir.current) {
          /* Cruza el borde → snap a la etapa vecina y repetir mientras esté ahí. */
          edgeDir.current = dir;
          stepEdge();
          if (edgeTimer.current !== null) window.clearInterval(edgeTimer.current);
          edgeTimer.current = window.setInterval(stepEdge, EDGE_STEP_MS);
        } else if (dir === 0) {
          stopEdge();
          clearTarget();
          /* Zona de acercamiento: el track acompaña al dedo (peek) antes del snap. */
          if (w) {
            const distRight = window.innerWidth - t.clientX;
            const distLeft = t.clientX;
            let peekPx = 0;
            if (distRight < PEEK_ZONE) peekPx = -((PEEK_ZONE - distRight) / PEEK_ZONE) * w * PEEK_MAX;
            else if (distLeft < PEEK_ZONE)
              peekPx = ((PEEK_ZONE - distLeft) / PEEK_ZONE) * w * PEEK_MAX;
            trackFollow(peekPx);
          }
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
      try {
        if (!lifted.current || !start.current) {
          start.current = null;
          return;
        }
        const t = e.changedTouches[0];
        const dy = t ? t.clientY - start.current.y : 0;
        const tab = t ? tabUnder(t.clientX, t.clientY) : null;

        /* Etapa previsualizada por el borde (cambió en vivo) → destino real. */
        if (preview.current && preview.current !== current) {
          dbg(`drop tras preview ${current}→${preview.current}`);
          flyTo(preview.current);
          return;
        }
        if (tab && tab.dataset.seg && tab.dataset.seg !== current) {
          dbg(`drop en etapa ${tab.dataset.seg} → vuelo`);
          flyTo(tab.dataset.seg);
          return;
        }
        if (t) {
          const idx = steps.indexOf(current);
          let side: string | null = null;
          if (t.clientX <= EDGE && idx > 0) side = steps[idx - 1];
          else if (t.clientX >= window.innerWidth - EDGE && idx < steps.length - 1)
            side = steps[idx + 1];
          if (side) {
            dbg(`drop en lateral ${t.clientX >= window.innerWidth - EDGE ? 'derecha' : 'izquierda'} → ${side}`);
            flyTo(side);
            return;
          }
        }
        if (last.current.vy < FLICK_VY && dy < FLICK_DY) {
          const next = steps[steps.indexOf(current) + 1];
          if (next) {
            flyTo(next);
            return;
          }
        }
        springBack();
      } finally {
        /* RED DE SEGURIDAD ABSOLUTA: si por cualquier excepción (p.ej. un
           touchcancel sin changedTouches en WKWebView) no se resolvió el gesto
           ni se limpió, forzamos la limpieza aquí. Así el clon NUNCA puede
           quedar pegado en la pantalla ni los listeners de document huérfanos. */
        if (lifted.current && !resolved.current) {
          dbg('SAFETY: gesto sin resolver → cleanup forzado');
          cleanup();
        }
      }
    };

    wrap.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });
    handlers.current = { move: onTouchMove, end: onTouchEnd };

    return () => {
      cancelHold();
      cleanup();
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
