/**
 * Genera los iconos PWA de Nido (PNG) sin dependencias nativas:
 * cuadrado redondeado emerald con un check blanco.
 * - icon-192.png / icon-512.png: fondo transparente, squircle con margen
 * - icon-maskable-512.png: fondo emerald completo (safe zone 80%)
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const EMERALD = [16, 185, 129]; // #10B981
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter none
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Distancia al segmento (para el trazo del check). */
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Distancia con signo a un rectángulo redondeado (negativo dentro). */
function roundedRectSD(px, py, x, y, w, h, r) {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function render(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4);
  // Geometría (en coords normalizadas del viewBox 24 del check del logo)
  const pad = maskable ? size * 0.0 : size * 0.04; // maskable: sangrado completo
  const rect = { x: pad, y: pad, w: size - pad * 2, h: size - pad * 2 };
  const radius = size * (maskable ? 0.0 : 0.22);
  // Check: path "m4.5 12.5 5 5 10-11" escalado al safe zone
  const safe = maskable
    ? { x: size * 0.2, y: size * 0.2, s: size * 0.6 }
    : { x: size * 0.14, y: size * 0.14, s: size * 0.72 };
  const P = (vx, vy) => [safe.x + (vx / 24) * safe.s, safe.y + (vy / 24) * safe.s];
  const [ax, ay] = P(4.5, 12.5);
  const [bx, by] = P(9.5, 17.5);
  const [cx2, cy2] = P(19.5, 6.5);
  const stroke = size * 0.075;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dRect = roundedRectSD(x + 0.5, y + 0.5, rect.x, rect.y, rect.w, rect.h, radius);
      if (dRect > 0.5) continue; // transparente fuera
      const alphaRect = dRect < -0.5 ? 255 : Math.round(((-dRect + 0.5) / 1) * 255);
      let r = EMERALD[0];
      let g = EMERALD[1];
      let b = EMERALD[2];
      let a = alphaRect;
      // check blanco (AA por distancia al trazo)
      const dStroke =
        Math.min(
          segDist(x + 0.5, y + 0.5, ax, ay, bx, by),
          segDist(x + 0.5, y + 0.5, bx, by, cx2, cy2),
        ) -
        stroke / 2;
      if (dStroke < 0.5) {
        const alphaStroke = dStroke < -0.5 ? 1 : -dStroke + 0.5;
        const mixA = alphaStroke * (alphaRect / 255);
        r = Math.round(WHITE[0] * mixA + r * (1 - mixA));
        g = Math.round(WHITE[1] * mixA + g * (1 - mixA));
        b = Math.round(WHITE[2] * mixA + b * (1 - mixA));
        a = 255;
      }
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = a;
    }
  }
  return encodePNG(size, px);
}

mkdirSync(new URL('../public/icons', import.meta.url).pathname, { recursive: true });
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname;
writeFileSync(out('icon-192.png'), render(192, { maskable: false }));
writeFileSync(out('icon-512.png'), render(512, { maskable: false }));
writeFileSync(out('icon-maskable-512.png'), render(512, { maskable: true }));
console.log('iconos generados: icon-192.png, icon-512.png, icon-maskable-512.png');
