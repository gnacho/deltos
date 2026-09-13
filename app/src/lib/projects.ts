import type { Project } from '@/data/types';

type Translate = (key: string) => string;

/** Nombre visible de un proyecto: el inbox se muestra como "Sin proyecto". */
export function projectDisplayName(
  project: { name: string; is_inbox?: boolean } | undefined | null,
  t: Translate,
): string {
  if (!project) return '';
  return project.is_inbox ? t('task.noProject') : project.name;
}

/** Proyectos "reales", sin el inbox (gestión y selectores que no lo admiten). */
export function realProjects(projects: Project[]): Project[] {
  return projects.filter((p) => !p.is_inbox);
}

/** Proyecto inbox ("Sin proyecto"), si existe. */
export function inboxProject(projects: Project[]): Project | undefined {
  return projects.find((p) => p.is_inbox);
}
