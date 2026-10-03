import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { Task } from '@/data/types';
import { useData } from '@/data/data-context';

const titleSchema = z.string().trim().min(1).max(200);

/** Estado y persistencia del título y la descripción de una tarea,
 *  compartidos por la pestaña Tarea y la pestaña Detalles. Cada cambio se
 *  confirma con PATCH al perder el foco (mismo contrato que antes). */
export function useTaskText(task: Task) {
  const { t } = useTranslation();
  const data = useData();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');

  /* Sincroniza campos si la tarea cambia por SSE/refresco */
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description), [task.description]);

  const patch = async (p: Parameters<typeof data.patchTask>[1]) => {
    try {
      await data.patchTask(task.id, p);
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 1500);
    } catch {
      setSaveState('error');
    }
  };

  const commitTitle = () => {
    const parsed = titleSchema.safeParse(title);
    if (!parsed.success) {
      setTitleError(t('newTask.titleRequired'));
      setTitle(task.title);
      return;
    }
    setTitleError(null);
    if (parsed.data !== task.title) void patch({ title: parsed.data });
  };

  const commitDescription = () => {
    if (description !== task.description) void patch({ description });
  };

  return {
    title,
    setTitle,
    description,
    setDescription,
    titleError,
    saveState,
    setSaveState,
    patch,
    commitTitle,
    commitDescription,
  };
}
