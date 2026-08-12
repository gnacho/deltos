import { useEffect } from 'react';

/**
 * [SWIPE-DIAG] — instrumentación TEMPORAL para diagnosticar #137 en el
 * dispositivo real. NO es parte de la feature: se elimina al cerrar el issue.
 *
 * Escucha en `window` en fase CAPTURE (incondicional, sin depender de
 * ref.current) y registra cada touchstart/touchmove/touchend en consola Y en
 * un overlay en pantalla (#swipe-diag). Distingue las 4 causas posibles:
 *  (a) no llega touchstart  → el browser/PWA nunca dispara el evento
 *  (c) llega touchmove pero no touchend → el browser cancela el stream
 *  (b/d) llegan todos pero el hook no reacciona → umbral/ratio/listeners
 */
export function useSwipeDiag() {
  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)').matches
      ? 'standalone'
      : 'browser';
    const log = (label: string, e: TouchEvent) => {
      const t = e.touches[0] || e.changedTouches[0];
      const target = e.target as Element | null;
      const line =
        `[SWIPE-DIAG] ${label} target=${target?.tagName ?? '?'} ` +
        `closest=${target?.closest('[data-segbar],[data-col],nav,main')?.tagName ?? 'none'} ` +
        `x=${t ? Math.round(t.clientX) : '?'} y=${t ? Math.round(t.clientY) : '?'} ` +
        `w=${window.innerWidth} m=${displayMode} t=${Math.round(e.timeStamp)}`;
      console.log(line, {
        target: target?.tagName,
        closest: target?.closest('[data-segbar],[data-col],nav,main')?.tagName ?? null,
        class: target?.className,
        touches: e.touches.length,
        changedTouches: e.changedTouches.length,
        x: t?.clientX,
        y: t?.clientY,
        timeStamp: e.timeStamp,
      });
      let el = document.getElementById('swipe-diag');
      if (!el) {
        el = document.createElement('div');
        el.id = 'swipe-diag';
        el.style.cssText =
          'position:fixed;top:56px;left:8px;right:8px;z-index:2147483647;' +
          'background:rgba(0,0,0,.88);color:#4ade80;font:10px/1.5 monospace;' +
          'padding:6px 10px;border-radius:8px;pointer-events:none;white-space:pre-wrap';
        document.body.appendChild(el);
      }
      el.textContent = `${el.textContent}\n${line}`.split('\n').slice(-8).join('\n');
    };

    const onStart = (e: TouchEvent) => log('touchstart', e);
    const onMove = (e: TouchEvent) => log('touchmove', e);
    const onEnd = (e: TouchEvent) => log('touchend', e);
    const onCancel = (e: TouchEvent) => log('touchcancel', e);

    window.addEventListener('touchstart', onStart, { capture: true, passive: true });
    window.addEventListener('touchmove', onMove, { capture: true, passive: false });
    window.addEventListener('touchend', onEnd, { capture: true, passive: true });
    window.addEventListener('touchcancel', onCancel, { capture: true, passive: true });

    return () => {
      window.removeEventListener('touchstart', onStart, true);
      window.removeEventListener('touchmove', onMove, true);
      window.removeEventListener('touchend', onEnd, true);
      window.removeEventListener('touchcancel', onCancel, true);
    };
  }, []);
}
