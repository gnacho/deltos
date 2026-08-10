import { useLayoutEffect, useRef } from 'react';
import type { DragEvent, RefObject } from 'react';

const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * DnD de tablero kanban (escritorio) compartido por tareas y gastos.
 * Visual estilo Odoo: la imagen nativa se anula y un clon fixed, opaco e
 * inclinado, sigue al cursor; la tarjeta original desaparece dejando el hueco
 * punteado; la columna destino se enciende con su acento; al soltar, la
 * tarjeta aterriza con un pulso y el clon se desvanece (o vuelve elástico al
 * origen si se cancela). Incluye FLIP para recolocar el resto.
 *
 * Requisitos del markup: tarjetas con [data-task] + draggable, columnas
 * <section data-col> con [data-list] y opcional [data-empty].
 */
export function useKanbanDnD<Col extends string>({
  boardRef,
  items,
  onMove,
}: {
  boardRef: RefObject<HTMLDivElement | null>;
  /** Lista de datos del tablero: dispara el FLIP al cambiar. */
  items: unknown;
  onMove: (id: string, toCol: Col, refId: string | null) => void;
}) {
  const dragId = useRef<string | null>(null);
  const placeholder = useRef<HTMLDivElement | null>(null);
  const flipRects = useRef<Map<string, DOMRect> | null>(null);
  const dragClone = useRef<HTMLElement | null>(null);
  const dragOrigin = useRef<DOMRect | null>(null);
  const dropped = useRef(false);
  const movedId = useRef<string | null>(null);
  const docMove = useRef<((ev: globalThis.DragEvent) => void) | null>(null);

  /* FLIP: tras el cambio de datos provocado por un move, animar desde la
     posición anterior. La tarjeta aterrizada queda fuera (su pulso card-landed
     es dueño del transform) y toda transición inline se limpia con red de
     seguridad: un transitionend perdido dejaba transiciones pegadas que el
     clon heredaba por cloneNode y lo hacían ir lento. */
  useLayoutEffect(() => {
    const before = flipRects.current;
    if (!before) return;
    flipRects.current = null;
    const landed = movedId.current;
    movedId.current = null;
    if (reducedMotionMQ.matches || !boardRef.current) return;
    boardRef.current.querySelectorAll<HTMLElement>('[data-task]').forEach((el) => {
      if (el.dataset.task === landed) return;
      const old = before.get(el.dataset.task ?? '');
      if (!old) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px,${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform .28s ease';
        el.style.transform = '';
        const guard = window.setTimeout(() => (el.style.transition = ''), 350);
        el.addEventListener(
          'transitionend',
          () => {
            window.clearTimeout(guard);
            el.style.transition = '';
          },
          { once: true },
        );
      });
    });
    if (landed) {
      const el = boardRef.current.querySelector<HTMLElement>(`[data-task="${landed}"]`);
      if (el) {
        el.classList.add('card-landed');
        el.addEventListener('animationend', () => el.classList.remove('card-landed'), {
          once: true,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const cleanupDrag = () => {
    dragId.current = null;
    if (placeholder.current) {
      placeholder.current.remove();
      placeholder.current = null;
    }
    if (docMove.current) {
      document.removeEventListener('dragover', docMove.current);
      docMove.current = null;
    }
    boardRef.current
      ?.querySelectorAll('.col-target')
      .forEach((s) => s.classList.remove('col-target'));
    boardRef.current?.querySelectorAll('.dragging').forEach((c) => c.classList.remove('dragging'));
    boardRef.current?.querySelectorAll<HTMLElement>('[data-empty]').forEach((p) => {
      p.style.display = '';
    });
    /* El clon: si hubo drop se desvanece en el sitio; si no, vuelve elástico al origen */
    const clone = dragClone.current;
    if (clone) {
      dragClone.current = null;
      if (dropped.current || reducedMotionMQ.matches || !dragOrigin.current) {
        clone.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
        clone.style.opacity = '0';
        clone.style.transform += ' scale(0.9)';
      } else {
        const o = dragOrigin.current;
        clone.style.transition =
          'transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.32s ease';
        clone.style.transform = `translate(${o.left}px, ${o.top}px) rotate(0deg) scale(1)`;
        clone.style.opacity = '0.4';
      }
      window.setTimeout(() => clone.remove(), 360);
    }
    dragOrigin.current = null;
    dropped.current = false;
  };

  const onDragStart = (e: DragEvent) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-task]');
    if (!card) return;
    dragId.current = card.dataset.task ?? null;
    e.dataTransfer.setData('text/plain', dragId.current ?? '');
    e.dataTransfer.effectAllowed = 'move';
    const ph = document.createElement('div');
    ph.className = 'drop-placeholder';
    ph.style.height = `${card.offsetHeight}px`;
    ph.setAttribute('aria-hidden', 'true');
    placeholder.current = ph;

    /* Imagen de arrastre nativa invisible: el navegador SIEMPRE la pinta
       semitransparente, así que la anulamos y movemos un clon propio. */
    const blank = document.createElement('div');
    blank.style.cssText = 'position:fixed;top:-10px;left:-10px;width:1px;height:1px;opacity:0';
    document.body.appendChild(blank);
    e.dataTransfer.setDragImage(blank, 0, 0);
    window.setTimeout(() => blank.remove(), 0);

    /* Clon opaco e inclinado (estilo Odoo) pegado al cursor. transition:none
       inline: mata tanto el transition-transform del hover de la tarjeta como
       cualquier transición residual del FLIP copiada por cloneNode (el bug de
       "la segunda tarjeta va lenta"). */
    const rect = card.getBoundingClientRect();
    dragOrigin.current = rect;
    const clone = card.cloneNode(true) as HTMLElement;
    clone.classList.remove('card');
    clone.classList.add('drag-clone');
    clone.style.transition = 'none';
    clone.style.animation = 'none';
    clone.style.width = `${rect.width}px`;
    clone.style.transform = `translate(${rect.left}px, ${rect.top}px) rotate(2.5deg) scale(1.03)`;
    document.body.appendChild(clone);
    dragClone.current = clone;
    const grabX = e.clientX - rect.left;
    const grabY = e.clientY - rect.top;
    const mover = (ev: globalThis.DragEvent) => {
      if (!dragClone.current || ev.clientX === 0) return; /* FF emite (0,0) al final */
      dragClone.current.style.transform = `translate(${ev.clientX - grabX}px, ${ev.clientY - grabY}px) rotate(2.5deg) scale(1.03)`;
    };
    docMove.current = mover;
    document.addEventListener('dragover', mover);

    /* La original desaparece dejando el hueco punteado en su sitio */
    window.setTimeout(() => {
      card.parentElement?.insertBefore(ph, card);
      card.classList.add('dragging');
    }, 0);
  };

  const onDragOver = (e: DragEvent) => {
    if (!dragId.current) return;
    const section = (e.target as HTMLElement).closest<HTMLElement>('section[data-col]');
    if (!section) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    boardRef.current?.querySelectorAll('.col-target').forEach((s) => {
      if (s !== section) s.classList.remove('col-target');
    });
    section.classList.add('col-target');
    const list = section.querySelector('[data-list]');
    if (!list || !placeholder.current) return;
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-task]')).filter(
      (c) => c.dataset.task !== dragId.current,
    );
    let ref: HTMLElement | null = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        ref = c;
        break;
      }
    }
    const empty = list.querySelector<HTMLElement>('[data-empty]');
    if (empty) empty.style.display = 'none';
    if (ref) list.insertBefore(placeholder.current, ref);
    else list.appendChild(placeholder.current);
  };

  const onDrop = (e: DragEvent) => {
    if (!dragId.current) return;
    e.preventDefault();
    const section = (e.target as HTMLElement).closest<HTMLElement>('section[data-col]');
    if (!section) {
      cleanupDrag();
      return;
    }
    let refId: string | null = null;
    if (placeholder.current?.parentElement) {
      let n = placeholder.current.nextElementSibling as HTMLElement | null;
      while (n) {
        if (n.dataset?.task) {
          refId = n.dataset.task;
          break;
        }
        n = n.nextElementSibling as HTMLElement | null;
      }
    }
    const id = dragId.current;
    const toCol = section.dataset.col as Col;
    dropped.current = true;
    movedId.current = id;
    cleanupDrag();
    /* FLIP: capturar posiciones ahora, con el layout previo a la mutación */
    if (!reducedMotionMQ.matches && boardRef.current) {
      const map = new Map<string, DOMRect>();
      boardRef.current.querySelectorAll<HTMLElement>('[data-task]').forEach((el) => {
        map.set(el.dataset.task ?? '', el.getBoundingClientRect());
      });
      flipRects.current = map;
    }
    onMove(id, toCol, refId);
  };

  return { onDragStart, onDragOver, onDrop, onDragEnd: cleanupDrag };
}
