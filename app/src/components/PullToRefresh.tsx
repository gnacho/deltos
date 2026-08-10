import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

const THRESHOLD = 70;
const INTENT_SLOP = 10; /* px antes de decidir que el gesto es un pull vertical */

/** ¿PWA instalada? En pestaña de navegador el pull-to-refresh nativo ya existe. */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** ¿El gesto empieza donde no debemos interceptarlo? (modal abierto o scroll interno). */
function shouldIgnore(target: EventTarget | null): boolean {
  if (document.body.style.overflow === 'hidden') return true; /* hay un modal abierto */
  if (!(target instanceof Element)) return false;
  if (target.closest('[role="dialog"]')) return true;
  const scroller = target.closest<HTMLElement>('.nice-scroll, [data-list]');
  if (scroller && scroller.scrollTop > 0) return true;
  return false;
}

/**
 * Pull-to-refresh móvil (issue #54): tirar hacia abajo desde el top recarga la
 * página, para coger un deploy nuevo sin cerrar y reabrir la app instalada.
 * Junto con el Cache-Control: no-cache del index.html, la recarga trae el
 * build fresco. Solo actúa en modo standalone.
 */
export default function PullToRefresh({ children }: { children: ReactNode }) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const engaged = useRef(false);
  const pullRef = useRef(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!isStandalone()) return;

    const reset = () => {
      startX.current = null;
      startY.current = null;
      engaged.current = false;
      pullRef.current = 0;
      setPull(0);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (document.body.classList.contains('mm-dragging')) {
        reset();
        return;
      }
      if (window.scrollY <= 0 && e.touches.length === 1 && !shouldIgnore(e.target)) {
        startX.current = e.touches[0].clientX;
        startY.current = e.touches[0].clientY;
        engaged.current = false;
      } else {
        reset();
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (document.body.classList.contains('mm-dragging')) {
        reset();
        return;
      }
      if (startY.current === null || startX.current === null) return;
      const dx = e.touches[0].clientX - startX.current;
      const dy = e.touches[0].clientY - startY.current;
      /* Decidir la intención una sola vez: pull vertical hacia abajo, no swipe */
      if (!engaged.current) {
        if (Math.abs(dy) < INTENT_SLOP) return;
        if (dy < 0 || Math.abs(dx) > Math.abs(dy)) {
          reset();
          return;
        }
        engaged.current = true;
      }
      if (dy > 0) {
        const v = Math.min(dy * 0.5, 120);
        pullRef.current = v;
        setPull(v);
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    };

    const onTouchEnd = () => {
      if (startY.current === null) return;
      const fired = engaged.current && pullRef.current >= THRESHOLD;
      reset();
      if (fired) {
        setRefreshing(true);
        window.location.reload();
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center justify-center overflow-hidden"
        style={{
          height: Math.max(pull, refreshing ? 28 : 0),
          transition: refreshing ? 'height 0.2s' : 'none',
        }}
        aria-hidden="true"
      >
        <RefreshCw
          className={`w-5 h-5 text-muted ${pull > 0 || refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
        />
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: pull > 0 ? 'none' : 'transform 0.2s',
        }}
      >
        {children}
      </div>
    </div>
  );
}
