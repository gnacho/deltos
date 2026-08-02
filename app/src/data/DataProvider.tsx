import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { apiDelete, apiFetch, apiPatch, apiPost, apiUpload } from './api-client';
import {
  DataContext,
  type ConnectionStatus,
  type CreateProjectInput,
  type CreateTaskInput,
  type DataApi,
} from './data-context';
import type { Bootstrap, Label, Project, Task, TaskDetail, TaskPatch } from './types';

/**
 * Capa de datos desacoplada (contrato síncrono):
 * - bootstrapRef: UNA llamada /api/bootstrap con todo el tablero.
 * - SSE /api/events: eventos NOMBRADOS `<dominio>.changed` (task.changed,
 *   project.changed, …) con id monótono → refetch (debounce) del bootstrap y
 *   de los detalles cacheados. `sync.resync` (reconexión con eventos
 *   perdidos) → refetch total inmediato. El heartbeat es un comentario
 *   `: ping` (no es evento: no se escucha; el estado conectado/reconectando
 *   se deriva de onopen/onerror de EventSource).
 * - Detalles de tarea: caché en ref + pending anti-duplicados; el getter es
 *   síncrono (devuelve el último conocido) y bump() re-renderiza al completar.
 * - value = useMemo([version, connectionStatus]) con closures NUEVAS: los
 *   useMemo de los consumidores recomputan al cambiar los datos.
 */

/** Eventos de dominio del hub SSE (server/src/sse.js). */
const SSE_CHANGED_EVENTS = [
  'task.changed',
  'project.changed',
  'label.changed',
  'comment.changed',
  'attachment.changed',
  'user.changed',
  'settings.changed',
] as const;
export function DataProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting');
  const [ready, setReady] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const bootstrapRef = useRef<Bootstrap | null>(null);
  const detailCache = useRef(new Map<string, TaskDetail>());
  const detailPending = useRef(new Set<string>());
  const bootstrapInFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const fetchBootstrap = useCallback(async (): Promise<void> => {
    if (bootstrapInFlight.current) return bootstrapInFlight.current;
    const p = (async () => {
      try {
        const data = await apiFetch<Bootstrap>('/api/bootstrap');
        if (!mounted.current) return;
        bootstrapRef.current = data;
        setReady(true);
        setBootstrapError(null);
        bump();
      } catch (err) {
        if (!mounted.current) return;
        setBootstrapError(err instanceof Error ? err.message : String(err));
        bump();
      } finally {
        bootstrapInFlight.current = null;
      }
    })();
    bootstrapInFlight.current = p;
    return p;
  }, [bump]);

  const fetchDetail = useCallback(
    async (id: string): Promise<void> => {
      if (detailPending.current.has(id)) return;
      detailPending.current.add(id);
      try {
        const detail = await apiFetch<TaskDetail>(`/api/tasks/${encodeURIComponent(id)}`);
        if (!mounted.current) return;
        detailCache.current.set(id, detail);
        bump();
      } catch {
        /* el detalle se reintentará al reabrir o con el próximo cambio SSE */
      } finally {
        detailPending.current.delete(id);
      }
    },
    [bump],
  );

  /* Refetch tras mutaciones propias y eventos SSE (debounce para ráfagas). */
  const sseTimer = useRef<number | null>(null);
  const refreshAll = useCallback(() => {
    void fetchBootstrap();
    for (const id of detailCache.current.keys()) void fetchDetail(id);
  }, [fetchBootstrap, fetchDetail]);

  const scheduleRefresh = useCallback(() => {
    if (sseTimer.current !== null) window.clearTimeout(sseTimer.current);
    sseTimer.current = window.setTimeout(() => {
      sseTimer.current = null;
      refreshAll();
    }, 250);
  }, [refreshAll]);

  /* Bootstrap inicial + SSE */
  useEffect(() => {
    mounted.current = true;
    void fetchBootstrap();

    let es: EventSource | null = null;
    let failures = 0;
    let retryTimer: number | null = null;

    const connect = () => {
      es = new EventSource('/api/events');
      es.onopen = () => {
        failures = 0;
        setConnectionStatus('connected');
      };
      /* Cambios de dominio: refetch con debounce (ráfagas de una mutación). */
      for (const ev of SSE_CHANGED_EVENTS) es.addEventListener(ev, scheduleRefresh);
      /* Reconexión con eventos perdidos: refetch total (bootstrap + detalle
         abierto), inmediato — los eventos no llevan datos, solo avisan. */
      es.addEventListener('sync.resync', refreshAll);
      es.onerror = () => {
        setConnectionStatus('reconnecting');
        failures += 1;
        /* EventSource reintenta solo; tras 3 fallos, backoff manual */
        if (failures >= 3 && es) {
          es.close();
          retryTimer = window.setTimeout(connect, 5000);
          failures = 0;
        }
      };
    };
    connect();

    return () => {
      mounted.current = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (sseTimer.current !== null) window.clearTimeout(sseTimer.current);
      es?.close();
    };
  }, [fetchBootstrap, scheduleRefresh, refreshAll]);

  /* --- Mutaciones: API + refresco de cachés --- */

  const createTask = useCallback(
    async (input: CreateTaskInput): Promise<Task> => {
      const res = await apiPost<{ task: Task }>('/api/tasks', input);
      await fetchBootstrap();
      return res.task;
    },
    [fetchBootstrap],
  );

  const patchTask = useCallback(
    async (id: string, patch: TaskPatch): Promise<void> => {
      await apiPatch<{ task: Task }>(`/api/tasks/${encodeURIComponent(id)}`, patch);
      await fetchBootstrap();
      if (detailCache.current.has(id)) await fetchDetail(id);
    },
    [fetchBootstrap, fetchDetail],
  );

  const moveTask = useCallback(
    async (id: string, column: string, position: number): Promise<void> => {
      await apiPost<{ task: Task }>(`/api/tasks/${encodeURIComponent(id)}/move`, {
        column,
        position,
      });
      await fetchBootstrap();
      if (detailCache.current.has(id)) await fetchDetail(id);
    },
    [fetchBootstrap, fetchDetail],
  );

  const deleteTask = useCallback(
    async (id: string): Promise<void> => {
      await apiDelete(`/api/tasks/${encodeURIComponent(id)}`);
      detailCache.current.delete(id);
      await fetchBootstrap();
    },
    [fetchBootstrap],
  );

  const addComment = useCallback(
    async (id: string, body: string): Promise<void> => {
      await apiPost(`/api/tasks/${encodeURIComponent(id)}/comments`, { body });
      await Promise.all([fetchBootstrap(), fetchDetail(id)]);
    },
    [fetchBootstrap, fetchDetail],
  );

  const uploadAttachment = useCallback(
    async (id: string, file: File): Promise<void> => {
      const form = new FormData();
      form.append('file', file);
      await apiUpload(`/api/tasks/${encodeURIComponent(id)}/attachments`, form);
      await Promise.all([fetchBootstrap(), fetchDetail(id)]);
    },
    [fetchBootstrap, fetchDetail],
  );

  const createProject = useCallback(
    async (input: CreateProjectInput): Promise<Project> => {
      const res = await apiPost<{ project: Project }>('/api/projects', input);
      await fetchBootstrap();
      return res.project;
    },
    [fetchBootstrap],
  );

  const createLabel = useCallback(
    async (input: { name: string; color: string }): Promise<Label> => {
      const res = await apiPost<{ label: Label }>('/api/labels', input);
      await fetchBootstrap();
      return res.label;
    },
    [fetchBootstrap],
  );

  const updateLabel = useCallback(
    async (id: string, patch: { name?: string; color?: string }): Promise<void> => {
      await apiPatch<{ label: Label }>(`/api/labels/${encodeURIComponent(id)}`, patch);
      await fetchBootstrap();
    },
    [fetchBootstrap],
  );

  const deleteLabel = useCallback(
    async (id: string): Promise<void> => {
      await apiDelete(`/api/labels/${encodeURIComponent(id)}`);
      await fetchBootstrap();
    },
    [fetchBootstrap],
  );

  const refreshTaskDetail = useCallback(
    (id: string) => {
      detailCache.current.delete(id);
      void fetchDetail(id);
    },
    [fetchDetail],
  );

  const releaseTaskDetail = useCallback((id: string) => {
    detailCache.current.delete(id);
  }, []);

  /* value = useMemo([version, ...]) con closures nuevas (regla a fuego). */
  const value = useMemo<DataApi>(() => {
    const getBootstrapData = () => bootstrapRef.current;
    return {
      connectionStatus,
      ready,
      bootstrapError,
      refresh: () => void fetchBootstrap(),
      getUsers: () => getBootstrapData()?.users ?? [],
      getProjects: () => getBootstrapData()?.projects ?? [],
      getLabels: () => getBootstrapData()?.labels ?? [],
      getTasks: () => getBootstrapData()?.tasks ?? [],
      getProject: (id) => getBootstrapData()?.projects.find((p) => p.id === id),
      getTask: (id) => getBootstrapData()?.tasks.find((t) => t.id === id),
      getUsername: (id) => getBootstrapData()?.users.find((u) => u.id === id)?.username ?? '?',
      getTaskDetail: (id) => {
        const cached = detailCache.current.get(id);
        if (!cached) void fetchDetail(id);
        return cached ?? null;
      },
      refreshTaskDetail,
      releaseTaskDetail,
      createTask,
      patchTask,
      moveTask,
      deleteTask,
      addComment,
      uploadAttachment,
      createProject,
      createLabel,
      updateLabel,
      deleteLabel,
    };
    // version es el disparador de recomputo (cachés en refs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, connectionStatus, ready, bootstrapError]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
