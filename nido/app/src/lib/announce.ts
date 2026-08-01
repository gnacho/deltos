/** Avisador discreto para lector de pantalla (movimientos de tarjetas). */
export function announce(msg: string): void {
  const el = document.getElementById('a11y-announce');
  if (!el) return;
  el.textContent = '';
  window.setTimeout(() => {
    el.textContent = msg;
  }, 30);
}
