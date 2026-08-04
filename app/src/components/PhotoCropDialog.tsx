import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, ZoomIn, RotateCcw } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';

// ============================================================================
// CONFIGURACIÓN
// ============================================================================
const DEFAULT_MAX_LONG_SIDE = 1200;
const DEFAULT_QUALITY = 0.85;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.01;
const KEYBOARD_PAN_STEP = 10;
const KEYBOARD_ZOOM_STEP = 0.1;
const SIZE_DEBOUNCE = 150;

// ============================================================================
// EXIF ORIENTATION
// ============================================================================
async function getExifOrientation(file: File): Promise<number> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/jpg') return 0;
  const buf = await file.slice(0, 128 * 1024).arrayBuffer();
  const view = new DataView(buf);
  if (view.getUint16(0) !== 0xffd8) return 0;
  let offset = 2;
  while (offset < view.byteLength - 1) {
    const marker = view.getUint16(offset);
    if (marker === 0xffe1) {
      if (view.getUint32(offset + 4) !== 0x45786966) return 0;
      const tiffOffset = offset + 10;
      const le = view.getUint16(tiffOffset) === 0x4949;
      const ifdStart = tiffOffset + view.getUint32(tiffOffset + 4, le);
      const n = view.getUint16(ifdStart, le);
      for (let i = 0; i < n; i++) {
        const e = ifdStart + 2 + i * 12;
        if (view.getUint16(e, le) === 0x0112) return view.getUint16(e + 8, le);
      }
      return 0;
    }
    if ((marker & 0xff00) !== 0xff00) break;
    offset += 2 + view.getUint16(offset + 2);
  }
  return 0;
}

function applyExifOrientation(
  img: HTMLImageElement,
  orientation: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const swap = orientation >= 5 && orientation <= 8;
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, h, w); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
    default: c.width = w; c.height = h;
  }
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas: c, width: c.width, height: c.height };
}

// ============================================================================
// DOWNSAMPLING MULTI-STEP
// ============================================================================
function downsample(
  src: HTMLCanvasElement | HTMLImageElement,
  tw: number,
  th: number,
): HTMLCanvasElement {
  const sw = src instanceof HTMLCanvasElement ? src.width : src.naturalWidth;
  const sh = src instanceof HTMLCanvasElement ? src.height : src.naturalHeight;
  if (tw >= sw / 2 && th >= sh / 2) {
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    c.getContext('2d')!.drawImage(src, 0, 0, tw, th);
    return c;
  }
  let cur: HTMLCanvasElement | HTMLImageElement = src;
  let cw = sw;
  let ch = sh;
  while (cw / 2 > tw && ch / 2 > th) {
    const hw = Math.round(cw / 2);
    const hh = Math.round(ch / 2);
    const s = document.createElement('canvas');
    s.width = hw;
    s.height = hh;
    const sc = s.getContext('2d')!;
    sc.imageSmoothingEnabled = true;
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(cur, 0, 0, hw, hh);
    cur = s;
    cw = hw;
    ch = hh;
  }
  const f = document.createElement('canvas');
  f.width = tw;
  f.height = th;
  const fc = f.getContext('2d')!;
  fc.imageSmoothingEnabled = true;
  fc.imageSmoothingQuality = 'high';
  fc.drawImage(cur, 0, 0, tw, th);
  return f;
}

// ============================================================================
// EXPORT A BLOB
// ============================================================================
async function cropToBlob(
  img: HTMLImageElement,
  exif: number,
  ox: number,
  oy: number,
  scale: number,
  zoom: number,
  vw: number,
  vh: number,
  ratio: number,
  maxSide: number,
  quality: number,
): Promise<Blob> {
  let outW: number;
  let outH: number;
  if (ratio >= 1) {
    outW = maxSide;
    outH = Math.round(maxSide / ratio);
  } else {
    outH = maxSide;
    outW = Math.round(maxSide * ratio);
  }
  const corrected = applyExifOrientation(img, exif || 1);
  const sx = -ox / (scale * zoom);
  const sy = -oy / (scale * zoom);
  const sw = vw / (scale * zoom);
  const sh = vh / (scale * zoom);
  const crop = document.createElement('canvas');
  crop.width = Math.round(sw);
  crop.height = Math.round(sh);
  crop.getContext('2d')!.drawImage(corrected.canvas, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
  const final = downsample(crop, outW, outH);
  const toBlob = (type: string): Promise<Blob | null> =>
    new Promise((r) => final.toBlob(r, type, quality));
  const webp = await toBlob('image/webp');
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await toBlob('image/jpeg');
  if (jpeg) return jpeg;
  throw new Error('export failed');
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// COMPONENTE
// ============================================================================
interface PhotoCropDialogProps {
  file: File | null;
  open: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => void | Promise<void>;
  aspectRatio?: number;
  maxLongSide?: number;
  quality?: number;
  allowedRatios?: number[];
}

export function PhotoCropDialog({
  file,
  open,
  onClose,
  onSave,
  aspectRatio,
  maxLongSide = DEFAULT_MAX_LONG_SIDE,
  quality = DEFAULT_QUALITY,
  allowedRatios = [4 / 3, 16 / 9, 1, 0],
}: PhotoCropDialogProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [exif, setExif] = useState(0);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [ratio, setRatio] = useState(aspectRatio ?? (allowedRatios[0] || 0));
  const free = ratio === 0;
  const [estSize, setEstSize] = useState<number | null>(null);
  const [estFmt, setEstFmt] = useState('');
  const sizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [vpEl, setVpEl] = useState<HTMLDivElement | null>(null);
  const drag = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null);
  const lastTap = useRef(0);
  const pinch = useRef<{ d: number; z: number } | null>(null);

  useEffect(() => {
    if (!open || !file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, open]);

  useEffect(() => {
    if (!url || !file) return;
    const el = new Image();
    el.onload = () => { setImg(el); getExifOrientation(file).then(setExif); };
    el.onerror = () => setImg(null);
    el.src = url;
    return () => { el.onload = null; el.onerror = null; };
  }, [url, file]);

  useEffect(() => {
    if (!open || !vpEl) return;
    const m = () => {
      const w = vpEl.clientWidth;
      if (w > 0) setBox({ w, h: free ? vpEl.clientHeight : w / (ratio || 1) });
    };
    m();
    const ro = new ResizeObserver(m);
    ro.observe(vpEl);
    return () => ro.disconnect();
  }, [open, vpEl, ratio, free]);

  const coverScale = img && box
    ? Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight)
    : 0;

  const clamp = useCallback(
    (x: number, y: number, z: number) => {
      if (!img || !box || !coverScale) return { x: 0, y: 0 };
      const iw = img.naturalWidth * coverScale * z;
      const ih = img.naturalHeight * coverScale * z;
      return { x: Math.min(0, Math.max(box.w - iw, x)), y: Math.min(0, Math.max(box.h - ih, y)) };
    },
    [img, box, coverScale],
  );

  useEffect(() => {
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
    setEstSize(null);
    if (aspectRatio !== undefined) setRatio(aspectRatio);
  }, [img, aspectRatio]);

  useEffect(() => {
    if (!img || !box || !coverScale || !open) return;
    if (sizeTimer.current) clearTimeout(sizeTimer.current);
    sizeTimer.current = setTimeout(async () => {
      try {
        const corrected = applyExifOrientation(img, exif || 1);
        const sw = box.w / (coverScale * zoom);
        const sh = box.h / (coverScale * zoom);
        const cc = document.createElement('canvas');
        cc.width = Math.round(sw);
        cc.height = Math.round(sh);
        cc.getContext('2d')!.drawImage(corrected.canvas, 0, 0, cc.width, cc.height);
        const tr = free ? box.w / box.h : ratio;
        const [ow, oh] = tr >= 1
          ? [maxLongSide, Math.round(maxLongSide / tr)]
          : [Math.round(maxLongSide * tr), maxLongSide];
        const fc = downsample(cc, ow, oh);
        const tb = (type: string): Promise<Blob | null> => new Promise((r) => fc.toBlob(r, type, quality));
        const w = await tb('image/webp');
        if (w && w.type === 'image/webp') { setEstSize(w.size); setEstFmt('WebP'); return; }
        const j = await tb('image/jpeg');
        if (j) { setEstSize(j.size); setEstFmt('JPEG'); }
      } catch { setEstSize(null); }
    }, SIZE_DEBOUNCE);
    return () => { if (sizeTimer.current) clearTimeout(sizeTimer.current); };
  }, [img, box, coverScale, zoom, offset, ratio, free, maxLongSide, quality, exif, open]);

  const onPtrDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, bx: offset.x, by: offset.y };
    const now = Date.now();
    if (now - lastTap.current < 300) { setZoom(MIN_ZOOM); setOffset({ x: 0, y: 0 }); }
    lastTap.current = now;
  };
  const onPtrMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOffset(clamp(drag.current.bx + e.clientX - drag.current.sx, drag.current.by + e.clientY - drag.current.sy, zoom));
  };
  const onPtrUp = () => { drag.current = null; };

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev - e.deltaY * 0.001));
      setOffset((o) => {
        if (!box) return o;
        const cx = box.w / 2 - o.x;
        const cy = box.h / 2 - o.y;
        const r = next / prev;
        return clamp(box.w / 2 - cx * r, box.h / 2 - cy * r, next);
      });
      return next;
    });
  }, [box, clamp]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (!pinch.current) { pinch.current = { d, z: zoom }; }
      else {
        const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.current.z * (d / pinch.current.d)));
        setZoom(nz);
        setOffset((o) => {
          if (!box) return o;
          const cx = box.w / 2 - o.x;
          const cy = box.h / 2 - o.y;
          const r = nz / zoom;
          return clamp(box.w / 2 - cx * r, box.h / 2 - cy * r, nz);
        });
      }
    }
  }, [box, zoom, clamp]);
  const onTouchEnd = useCallback(() => { pinch.current = null; }, []);

  const changeZoom = (z: number) => {
    setZoom(z);
    setOffset((o) => {
      if (!box) return o;
      const cx = box.w / 2 - o.x;
      const cy = box.h / 2 - o.y;
      const r = z / zoom;
      return clamp(box.w / 2 - cx * r, box.h / 2 - cy * r, z);
    });
  };

  const save = async () => {
    if (!img || !box || !coverScale) return;
    setSaving(true);
    try {
      const tr = free ? box.w / box.h : ratio;
      const blob = await cropToBlob(img, exif, offset.x, offset.y, coverScale, zoom, box.w, box.h, tr, maxLongSide, quality);
      await onSave(blob);
      onClose();
    } catch { /* caller handles */ }
    finally { setSaving(false); }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); setOffset((o) => clamp(o.x + KEYBOARD_PAN_STEP, o.y, zoom)); break;
        case 'ArrowRight': e.preventDefault(); setOffset((o) => clamp(o.x - KEYBOARD_PAN_STEP, o.y, zoom)); break;
        case 'ArrowUp': e.preventDefault(); setOffset((o) => clamp(o.x, o.y + KEYBOARD_PAN_STEP, zoom)); break;
        case 'ArrowDown': e.preventDefault(); setOffset((o) => clamp(o.x, o.y - KEYBOARD_PAN_STEP, zoom)); break;
        case '+': case '=': e.preventDefault(); setZoom((z) => Math.min(MAX_ZOOM, z + KEYBOARD_ZOOM_STEP)); break;
        case '-': case '_': e.preventDefault(); setZoom((z) => Math.max(MIN_ZOOM, z - KEYBOARD_ZOOM_STEP)); break;
        case 'Enter': e.preventDefault(); void save(); break;
        case 'Escape': e.preventDefault(); onClose(); break;
      }
    };
    window.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey, true); document.body.style.overflow = ''; };
  }, [open, zoom, clamp, onClose]);

  const ratioLabel = (r: number) => {
    if (r === 0) return t('crop.free');
    const e = ([[4 / 3, '4:3'], [16 / 9, '16:9'], [1, '1:1'], [3 / 4, '3:4'], [9 / 16, '9:16']] as [number, string][])
      .find(([v]) => Math.abs(v - r) < 0.001);
    return e ? e[1] : r.toFixed(2);
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('crop.title')}
        className="w-full max-w-lg mx-4 rounded-2xl border border-app bg-surface shadow-soft"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-[17px] font-semibold text-[var(--text)]">{t('crop.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('crop.close')}
            className="w-8 h-8 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Ratio selector */}
        {allowedRatios.length > 1 && (
          <div className="flex gap-1.5 px-5 pb-3 flex-wrap">
            {allowedRatios.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRatio(r)}
                className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                  Math.abs(ratio - r) < 0.001
                    ? 'border-brand bg-brand text-brandfg'
                    : 'border-app text-muted hover:bg-surface2'
                }`}
              >
                {ratioLabel(r)}
              </button>
            ))}
          </div>
        )}

        {/* Viewport */}
        <div
          ref={setVpEl}
          role="application"
          tabIndex={0}
          aria-label={t('crop.viewport')}
          className="relative mx-5 rounded-xl overflow-hidden select-none outline-none focus-visible:ring-2 focus-visible:ring-brand"
          style={{
            aspectRatio: free ? undefined : `${ratio}`,
            height: free ? '240px' : undefined,
            backgroundColor: 'var(--surface-2)',
            touchAction: 'none',
            cursor: 'grab',
          }}
          onPointerDown={onPtrDown}
          onPointerMove={onPtrMove}
          onPointerUp={onPtrUp}
          onPointerCancel={onPtrUp}
          onWheel={onWheel}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {url && img && box && coverScale > 0 && (
            <img
              src={url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{
                width: img.naturalWidth * coverScale * zoom,
                height: img.naturalHeight * coverScale * zoom,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/3 top-0 h-full w-px bg-white/20" />
            <div className="absolute left-2/3 top-0 h-full w-px bg-white/20" />
            <div className="absolute left-0 top-1/3 h-px w-full bg-white/20" />
            <div className="absolute left-0 top-2/3 h-px w-full bg-white/20" />
          </div>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-3 px-5 pt-3">
          <ZoomIn className="w-4 h-4 shrink-0 text-faint" />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={ZOOM_STEP}
            value={zoom}
            onChange={(e) => changeZoom(parseFloat(e.target.value))}
            aria-label={t('crop.zoom')}
            className="flex-1 h-1.5 rounded-full appearance-none bg-app cursor-pointer"
            style={{ accentColor: 'var(--brand)' }}
          />
          <span className="w-12 text-right text-[13px] font-semibold text-[var(--text)] tabular-nums">
            {zoom.toFixed(1)}×
          </span>
        </div>

        {/* Size estimate */}
        {estSize !== null && (
          <div className="flex items-center gap-1.5 px-5 pt-1.5 text-[12px] text-faint">
            <RotateCcw className="w-3 h-3" />
            <span>~{fmtBytes(estSize)} {estFmt}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 px-5 pt-4 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-app px-4 text-[14px] font-semibold text-muted hover:bg-surface2 transition-colors"
          >
            {t('crop.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !img}
            onClick={() => void save()}
            className={`h-10 rounded-xl bg-brand text-brandfg px-5 text-[14px] font-semibold transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 shadow-soft ${
              reduce ? '' : ''
            }`}
          >
            {saving ? t('crop.saving') : t('crop.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
