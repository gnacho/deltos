import { createContext, useContext } from 'react';
import type { BoardUser, Label, Project, Task, TaskDetail, TaskPatch } from './types';

export type ConnectionStatus = 'connected' | 'reconnecting';

export interface CreateTaskInput {
  project_id: string;
  title: string;
  description?: string;
  column?: string;
  priority?: string | null;
  due_date?: string | null;
  assignee_id?: string | null;
  labels?: string[];
}

export interface CreateProjectInput {
  name: string;
  emoji: string;
  color: string;
}

/** Contrato síncrono: los componentes no conocen HTTP. */
export interface DataApi {
  connectionStatus: ConnectionStatus;
  /** true cuando el bootstrap inicial ha llegado. */
  ready: boolean;
  bootstrapError: string | null;
  /** Refetch explícito del bootstrap. */
  refresh: () => void;

  getUsers: () => BoardUser[];
  getProjects: () => Project[];
  getLabels: () => Label[];
  getTasks: () => Task[];
  getProject: (id: string) => Project | undefined;
  getTask: (id: string) => Task | undefined;
  getUsername: (id: string | null | undefined) => string;

  /** Detalle perezoso: devuelve el último conocido y dispara fetch si falta. */
  getTaskDetail: (id: string) => TaskDetail | null;
  /** Invalida y re-pide el detalle (p. ej. al abrir el modal). */
  refreshTaskDetail: (id: string) => void;
  /** Olvida el detalle al cerrar el modal. */
  releaseTaskDetail: (id: string) => void;

  createTask: (input: CreateTaskInput) => Promise<Task>;
  patchTask: (id: string, patch: TaskPatch) => Promise<void>;
  moveTask: (id: string, column: string, position: number) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  addComment: (id: string, body: string) => Promise<void>;
  uploadAttachment: (id: string, file: File) => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  createLabel: (input: { name: string; color: string }) => Promise<Label>;
}

export const DataContext = createContext<DataApi | null>(null);

export function useData(): DataApi {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData debe usarse dentro de <DataProvider>');
  return ctx;
}
