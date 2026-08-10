import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const HOLD_MS = 350;
const SCROLL_SLOP = 12; /* px de movimiento antes del hold → es un scroll */
const FLICK_VY = -0.55; /* px/ms hacia arriba para contar como lanzamiento */
const FLICK_DY = -48;

const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

interface Props {
  id: string;
  current: string;
  /** Etapas en orden; el flick hacia arriba avanza a la siguiente. */
  steps: string[];
  onMove: (id: string, step: string) => void;
  children: ReactNode;
}

/**
 * Movimiento móvil de tarjetas: mantener pulsado levanta la tarjeta (vibración
 * + velo), arrastrarla hasta la barra de etapas ([data-segbar]) resalta la
 * etapa bajo el dedo ([data-seg]); al soltar, la tarjeta vuela hasta la
 * pestaña y el contador da un salto. Un flick hacia arriba la manda a la
 * siguiente etapa sin apuntar. Genérico: sirve para gastos y para tareas.
 */
export function MobileMoveCard({ id, current, steps, onMove, children }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ y: number; t: number; vy: number }>({ y: 0, t: 0, vy: 0 });
  const lifted = useRef(false);
  const flying = useRef(false);
  const justDragged = useRef(false);
  const raf = useRef<number | null>(null);
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

  const reset = (spring: boolean) => {
    const card = cardEl();
    clearTarget();
    document.body.classList.remove('mm-dragging');
    setDim(false);
    lifted.current = false;
    start.current = null;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (!card) return;
    if (spring && !reducedMotionMQ.matches) {
      card.style.transition = 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
      card.style.transform = '';
      card.addEventListener(
        'transitionend',
        () => {
          card.classList.remove('mm-lift');
          card.style.transition = '';
        },
        { once: true },
      );
    } else {
      card.classList.remove('mm-lift');
      card.style.transition = '';
      card.style.transform = '';
      card.style.opacity = '';
    }
  };

  /** La tarjeta vuela hasta la pestaña, el contador salta y se ejecuta el move. */
  const flyTo = (tab: HTMLElement, step: string) => {
    const card = cardEl();
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
    clearTarget();
    document.body.classList.remove('mm-dragging');
    setDim(false);
    lifted.current = false;
    if (!card || reducedMotionMQ.matches) {
      reset(false);
      commit();
      return;
    }
    flying.current = true;
    const c = card.getBoundingClientRect();
    const tr = tab.getBoundingClientRect();
    const dx = tr.left + tr.width / 2 - (c.left + c.width / 2);
    const dy = tr.top + tr.height / 2 - (c.top + c.height / 2);
    card.style.transition = 'transform 0.38s cubic-bezier(0.3, 0.7, 0.3, 1), opacity 0.38s ease';
    card.style.transform = `translate(${dx}px, ${dy}px) scale(0.12) rotate(6deg)`;
    card.style.opacity = '0.15';
    card.addEventListener(
      'transitionend',
      () => {
        flying.current = false;
        reset(false);
        commit();
      },
      { once: true },
    );
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

    const onTouchStart = (e: TouchEvent) => {
      if (flying.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
      last.current = { y: t.clientY, t: performance.now(), vy: 0 };
      justDragged.current = false;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        lifted.current = true;
        justDragged.current = true;
        navigator.vibrate?.(12);
        cardEl()?.classList.add('mm-lift');
        document.body.classList.add('mm-dragging');
        setDim(true);
      }, HOLD_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!start.current) return;
      const t = e.touches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      if (!lifted.current) {
        if (Math.hypot(dx, dy) > SCROLL_SLOP) {
          cancelHold(); /* es un scroll normal */
          start.current = null;
        }
        return;
      }
      e.preventDefault(); /* levantada: la página no scrollea */
      const now = performance.now();
      const dt = now - last.current.t || 1;
      last.current = { y: t.clientY, t: now, vy: (t.clientY - last.current.y) / dt };
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        const card = cardEl();
        if (!card) return;
        card.style.transform = `translate(${dx}px, ${dy}px) scale(1.05) rotate(1.2deg)`;
        clearTarget();
        const tab = tabUnder(t.clientX, t.clientY);
        if (tab && tab.dataset.seg !== current) tab.classList.add('mm-target');
      });
    };

    const onTouchEnd = (e: TouchEvent) => {
      cancelHold();
      if (!lifted.current || !start.current) {
        start.current = null;
        return;
      }
      const t = e.changedTouches[0];
      const dy = t.clientY - start.current.y;
      const tab = tabUnder(t.clientX, t.clientY);
      if (tab && tab.dataset.seg && tab.dataset.seg !== current) {
        flyTo(tab, tab.dataset.seg);
        return;
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
      reset(true);
    };

    /* touchmove no pasivo: hay que poder bloquear el scroll al levantar */
    wrap.addEventListener('touchstart', onTouchStart, { passive: true });
    wrap.addEventListener('touchmove', onTouchMove, { passive: false });
    wrap.addEventListener('touchend', onTouchEnd, { passive: true });
    wrap.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      cancelHold();
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      document.body.classList.remove('mm-dragging');
      wrap.removeEventListener('touchstart', onTouchStart);
      wrap.removeEventListener('touchmove', onTouchMove);
      wrap.removeEventListener('touchend', onTouchEnd);
      wrap.removeEventListener('touchcancel', onTouchEnd);
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
