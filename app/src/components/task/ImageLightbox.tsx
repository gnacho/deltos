import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface LightboxImage {
  src: string;
  alt: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  /** Índice de la imagen visible; null = visor cerrado. */
  index: number | null;
  onIndexChange: (i: number | null) => void;
}

const SWIPE_MIN_PX = 40;

/** Visor de imágenes a pantalla completa: flechas, teclado (←/→/Esc) y deslizamiento táctil. */
export function ImageLightbox({ images, index, onIndexChange }: ImageLightboxProps) {
  const { t } = useTranslation();
  const open = index !== null;
  const touchX = useRef<number | null>(null);

  const close = useCallback(() => onIndexChange(null), [onIndexChange]);
  const step = useCallback(
    (d: number) => {
      if (index === null || images.length === 0) return;
      onIndexChange((index + d + images.length) % images.length);
    },
    [index, images.length, onIndexChange],
  );

  useEffect(() => {
    if (!open) return;
    /* capture + stopPropagation: el modal de tarea cierra con Esc en burbuja;
       con el visor abierto, las teclas son solo del visor. */
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.stopPropagation();
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = '';
    };
  }, [open, close, step]);

  if (!open || index === null || !images[index]) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('attachments.viewer')}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={close}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) >= SWIPE_MIN_PX) step(dx < 0 ? 1 : -1);
      }}
    >
      <button
        type="button"
        onClick={close}
        aria-label={t('attachments.closeViewer')}
        className="absolute right-3 top-3 z-10 w-10 h-10 rounded-full bg-black/55 text-white hover:bg-black/75 flex items-center justify-center transition-colors"
      >
        <X className="w-5 h-5" aria-hidden="true" />
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            aria-label={t('attachments.prevPhoto')}
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-black/55 text-white hover:bg-black/75 flex items-center justify-center transition-colors"
          >
            <ChevronLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            aria-label={t('attachments.nextPhoto')}
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-black/55 text-white hover:bg-black/75 flex items-center justify-center transition-colors"
          >
            <ChevronRight className="w-5 h-5" aria-hidden="true" />
          </button>
        </>
      )}

      <img
        key={images[index].src}
        src={images[index].src}
        alt={images[index].alt}
        draggable={false}
        className="max-h-[85vh] max-w-[92vw] rounded-xl object-contain shadow-2xl select-none"
        onClick={(e) => e.stopPropagation()}
      />

      {images.length > 1 && (
        <span className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[12px] font-medium text-white">
          {t('attachments.counter', { current: index + 1, total: images.length })}
        </span>
      )}
    </div>,
    document.body,
  );
}
