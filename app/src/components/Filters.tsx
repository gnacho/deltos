import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Funnel, ChevronDown, X } from 'lucide-react';
import type { Priority } from '@/data/types';
import { emptyFilters, type FilterState } from '@/components/filters-state';
import { useData } from '@/data/data-context';
import { PRIORITIES, PRIORITY_BADGE } from '@/lib/constants';
import { colorOf } from '@/lib/colors';
import { ArrowUp, ArrowRight, ArrowDown } from 'lucide-react';

const PR_ICON: Record<Priority, typeof ArrowUp> = {
  alta: ArrowUp,
  media: ArrowRight,
  baja: ArrowDown,
};

/** Botón "Filtros" móvil reutilizable (icono + contador activos), para que el
 *  padre lo ponga en la misma horizontal que el alcance. */
export function FiltersToggleButton({
  activeCount,
  open,
  onClick,
}: {
  activeCount: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="filters-panel"
      onClick={onClick}
      className={`lg:hidden inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-2 shadow-soft ${
        activeCount ? 'border-brand/50 text-brand' : 'border-app text-muted hover:bg-surface2'
      }`}
    >
      <Funnel className="w-4 h-4" aria-hidden="true" />
      {activeCount > 0 && (
        <span className="tnum text-[11px] font-semibold">{activeCount}</span>
      )}
      <ChevronDown
        className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        aria-hidden="true"
      />
    </button>
  );
}

function Chip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls = active
    ? `${colorOf(color).chip} ring-1 ring-current font-medium`
    : 'bg-surface border border-app text-muted hover:bg-surface2';
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${cls}`}
    >
      {children}
    </button>
  );
}

/** Barra de filtros de la vista Todo: panel colapsable en móvil, siempre visible en desktop.
 *  Incluye el toggle "Mis tareas" en la misma barra. */
export function Filters({
  filters,
  onChange,
  mineOnly,
  onToggleMine,
  open: openControlled,
  onToggleOpen,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  mineOnly?: boolean;
  onToggleMine?: () => void;
  open?: boolean;
  onToggleOpen?: () => void;
}) {
  const { t } = useTranslation();
  const data = useData();
  const [openInternal, setOpenInternal] = useState(false);
  const open = openControlled ?? openInternal;
  const toggleOpen = onToggleOpen ?? (() => setOpenInternal((o) => !o));

  const projects = data.getProjects();
  const users = data.getUsers();
  const labels = data.getLabels();

  const activeCount =
    filters.projects.size + filters.people.size + filters.priorities.size + filters.tags.size;

  const labelMine = t('board.mineOnly');

  const toggle = (group: keyof FilterState, value: string) => {
    const next: FilterState = {
      projects: new Set(filters.projects),
      people: new Set(filters.people),
      priorities: new Set(filters.priorities),
      tags: new Set(filters.tags),
    };
    const set = next[group] as Set<string>;
    if (set.has(value)) set.delete(value);
    else set.add(value);
    onChange(next);
  };

  const groups = useMemo(
    () => [
      {
        label: t('filters.project'),
        chips: projects.map((p) => (
          <Chip
            key={p.id}
            active={filters.projects.has(p.id)}
            color={p.color}
            onClick={() => toggle('projects', p.id)}
          >
            <span className={`w-2 h-2 rounded-full ${colorOf(p.color).dot}`} aria-hidden="true" />
            {p.name}
          </Chip>
        )),
      },
      {
        label: t('filters.person'),
        chips: [
          ...users.map((u) => (
            <Chip
              key={u.id}
              active={filters.people.has(u.id)}
              color={u.color}
              onClick={() => toggle('people', u.id)}
            >
              <span className={`w-2 h-2 rounded-full ${colorOf(u.color).dot}`} aria-hidden="true" />
              {u.username}
            </Chip>
          )),
          <Chip
            key="none"
            active={filters.people.has('none')}
            color="slate"
            onClick={() => toggle('people', 'none')}
          >
            <span className="w-2 h-2 rounded-full bg-slate-400" aria-hidden="true" />
            {t('filters.unassigned')}
          </Chip>,
        ],
      },
      {
        label: t('filters.priority'),
        chips: PRIORITIES.map((pr) => {
          const Icon = PR_ICON[pr];
          const color = pr === 'alta' ? 'rose' : pr === 'media' ? 'amber' : 'slate';
          void PRIORITY_BADGE;
          return (
            <Chip
              key={pr}
              active={filters.priorities.has(pr)}
              color={color}
              onClick={() => toggle('priorities', pr)}
            >
              <Icon className="w-3 h-3" aria-hidden="true" />
              {t(`priority.${pr}`)}
            </Chip>
          );
        }),
      },
      {
        label: t('filters.label'),
        chips: labels.map((l) => (
          <Chip
            key={l.id}
            active={filters.tags.has(l.id)}
            color={l.color}
            onClick={() => toggle('tags', l.id)}
          >
            <span className={`w-2 h-2 rounded-full ${colorOf(l.color).dot}`} aria-hidden="true" />
            {l.name}
          </Chip>
        )),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, projects, users, labels, filters],
  );

  return (
    <div className="mb-6">
      {/* Botón "Filtros" solo en móvil (<lg): icono + contador, sin texto.
          Si el padre controla open/onToggleOpen, el botón lo pone el padre
          (misma horizontal que el alcance). */}
      {openControlled === undefined && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="filters-panel"
          onClick={toggleOpen}
          className={`lg:hidden inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-2 shadow-soft ${
            activeCount ? 'border-brand/50 text-brand' : 'border-app text-muted hover:bg-surface2'
          }`}
        >
          <Funnel className="w-4 h-4" aria-hidden="true" />
          {activeCount > 0 && (
            <span className="tnum text-[11px] font-semibold">{activeCount}</span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      )}

      <div
        id="filters-panel"
        className={`grid transition-[grid-template-rows] duration-300 ease-out lg:grid-rows-[1fr] ${
          open ? 'grid-rows-[1fr] visible' : 'grid-rows-[0fr] invisible lg:visible'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="rounded-2xl bg-surface border border-app p-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
            {groups.map((g) => (
              <div key={g.label} className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold tracking-wide uppercase text-faint mr-0.5">
                  {g.label}
                </span>
                {g.chips}
              </div>
            ))}
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => onChange(emptyFilters())}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-surface2 text-muted hover:text-[var(--text)]"
              >
                <X className="w-3 h-3" aria-hidden="true" />
                {t('filters.clear', { count: activeCount })}
              </button>
            )}
            {mineOnly !== undefined && onToggleMine && (
              <button
                type="button"
                onClick={onToggleMine}
                aria-pressed={mineOnly}
                className={`ml-auto rounded-full border px-3.5 h-9 text-[13px] font-medium transition-colors ${
                  mineOnly ? 'border-brand/50 bg-brand/10 text-brand' : 'border-app bg-surface2 text-muted hover:bg-surface'
                }`}
              >
                {labelMine}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
