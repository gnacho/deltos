/**
 * Confetti propio en un <canvas> fijo a pantalla completa (sin dependencias).
 * Ráfaga corta (~1.3 s) con la paleta emerald/teal/amber de la app.
 * Respeta prefers-reduced-motion (CONVENTIONS §5): en ese caso no hace nada.
 */

const COLORS = ['#10b981', '#14b8a6', '#f59e0b', '#34d399', '#2dd4bf', '#fbbf24'];
const DURATION_MS = 1300;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vr: number;
  circle: boolean;
}

export interface ConfettiOptions {
  /** Nº de partículas (por defecto 110). */
  particleCount?: number;
  /** Origen horizontal de la ráfaga, 0..1 del ancho (defecto 0.5). */
  originX?: number;
  /** Origen vertical de la ráfaga, 0..1 del alto (defecto 0.35). */
  originY?: number;
}

/** Lanza una ráfaga de confetti desde el punto indicado. */
export function fireConfetti(opts?: ConfettiOptions): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '100',
  });
  document.body.appendChild(canvas);

  const count = opts?.particleCount ?? 110;
  const ox = (opts?.originX ?? 0.5) * canvas.width;
  const oy = (opts?.originY ?? 0.35) * canvas.height;
  const parts: Particle[] = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = (4 + Math.random() * 9) * dpr;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6 * dpr,
      size: (3 + Math.random() * 5) * dpr,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      circle: Math.random() < 0.35,
    };
  });

  const gravity = 0.22 * dpr;
  const start = performance.now();
  let last = start;

  const tick = (now: number) => {
    const dt = Math.min((now - last) / 16.7, 3); // en "frames" de 60 fps
    last = now;
    const elapsed = now - start;
    const fade = Math.max(0, 1 - elapsed / DURATION_MS);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += gravity * dt;
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.vr * dt;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      if (p.circle) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
    if (elapsed < DURATION_MS) {
      requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  };
  requestAnimationFrame(tick);
}
