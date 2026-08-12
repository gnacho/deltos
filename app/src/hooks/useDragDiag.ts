import { useEffect } from 'react';

/**
 * [DRAG-DIAG] — instrumentación TEMPORAL para localizar el clon flotante (#137)
 * en el dispositivo real. Incondicional: escucha en window CAPTURE y muestra en
 * pantalla (overlay #drag-diag) cada evento del drag de tarjetas + un recuento
 * en vivo de .mm-clone / .mm-ghost / .mm-dim / body.mm-dragging.
 */
export function useDragDiag() {
  useEffect(() => {
    let last = 0;
    const line = (msg: string) => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      let el = document.getElementById('drag-diag');
      if (!el) {
        el = document.createElement('div');
        el.id = 'drag-diag';
        el.style.cssText =
          'position:fixed;bottom:168px;left:8px;right:8px;z-index:2147483647;' +
          'background:rgba(0,0,0,.9);color:#fbbf24;font:10px/1.5 monospace;' +
          'padding:6px 10px;border-radius:8px;pointer-events:none;white-space:pre-wrap';
        document.body.appendChild(el);
      }
      el.textContent = `${el.textContent}\n${msg} +${Math.round(dt)}ms`.split('\n').slice(-9).join('\n');
    };

    const snap = () =>
      `C=${document.querySelectorAll('.mm-clone').length} G=${document.querySelectorAll('.mm-ghost').length} ` +
      `D=${document.querySelectorAll('.mm-dim').length} drag=${document.body.classList.contains('mm-dragging')}`;

    const on = (type: string, e: Event) => {
      const t = e as TouchEvent;
      const touch = t.touches[0] || t.changedTouches[0];
      line(
        `${type} x=${touch ? Math.round(touch.clientX) : '?'} ` +
          `closest=${(e.target as Element)?.closest('[data-mobile-stage],[data-seg],main')?.tagName ?? 'none'} | ${snap()}`,
      );
    };

    window.addEventListener('touchstart', (e) => on('start', e), { capture: true, passive: true });
    window.addEventListener('touchmove', (e) => on('move', e), { capture: true, passive: true });
    window.addEventListener('touchend', (e) => on('end', e), { capture: true, passive: true });
    window.addEventListener('touchcancel', (e) => on('cancel', e), { capture: true, passive: true });
    const iv = window.setInterval(() => {
      const el = document.getElementById('drag-diag');
      if (el) el.textContent = `${el.textContent}\n[diag] ${snap()}`.split('\n').slice(-9).join('\n');
    }, 1500);
    return () => {
      window.clearInterval(iv);
    };
  }, []);
}
