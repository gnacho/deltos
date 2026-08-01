import { createContext, useContext } from 'react';
import type { ColumnId } from '@/data/types';

export type TaskTab = 'detalles' | 'adjuntos' | 'comentarios' | 'actividad';

export interface NewTaskDefaults {
  projectId?: string;
  column?: ColumnId;
}

export interface ModalApi {
  /** Abre el detalle de una tarea (modal de 4 pestañas). */
  openTask: (id: string, tab?: TaskTab) => void;
  /** Abre el modal de creación de tarea. */
  openNewTask: (defaults?: NewTaskDefaults) => void;
}

export const ModalContext = createContext<ModalApi | null>(null);

export function useTaskModal(): ModalApi {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useTaskModal debe usarse dentro de <Layout>');
  return ctx;
}
