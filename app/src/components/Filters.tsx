import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Funnel, ChevronDown, X, Check, Search } from 'lucide-react';
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

/** Desplegable multi-selección para grupos largos (proyectos, etiquetas):
 *  botón con contador + popover con búsqueda cuando la lista crece. */
function FilterDropdown({
  label,
  items,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  items: { id: string; name: string; color: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const showSearch = items.length > 8;
  const filtered = query
    ? items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
    : items;

  return (
    <div className="relative" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
          selected.size
            ? 'bg-brand/10 border border-brand/40 text-brand font-medium'
            : 'bg-surface border border-app text-muted hover:bg-surface2'
        }`}
      >
        {label}
        {selected.size > 0 && (
          <span className="tnum px-1.5 rounded-full bg-brand text-brandfg text-[10px] font-semibold">
            {selected.size}
          </span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            className="absolute z-30 left-0 mt-1.5 w-72 max-w-[calc(100vw-3rem)] rounded-xl bg-surface border border-app shadow-2xl p-2"
          >
            {showSearch && (
              <div className="relative mb-1.5">
                <Search
                  className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('filters.search')}
                  aria-label={t('filters.search')}
                  className="w-full bg-surface2 border border-app rounded-lg pl-8 pr-2.5 py-1.5 text-[13px] outline-none focus:border-brand"
                />
              </div>
            )}
            <ul className="max-h-56 overflow-y-auto nice-scroll">
              {filtered.map((item) => {
                const active = selected.has(item.id);
                return (
                  <li key={item.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => onToggle(item.id)}
                      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface2 text-left text-[13px]"
                    >
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          active
                            ? 'bg-brand border-brand text-brandfg'
                            : 'border-app text-transparent'
                        }`}
                        aria-hidden="true"
                      >
                        <Check className="w-3 h-3" />
                      </span>
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${colorOf(item.color).dot}`}
                        aria-hidden="true"
                      />
                      <span className="flex-1 truncate">{item.name}</span>
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="px-2.5 py-3 text-center text-xs text-faint" aria-live="polite">
                  {t('filters.noResults')}
                </li>
              )}
            </ul>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="w-full mt-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-muted hover:bg-surface2 hover:text-text"
              >
                <X className="w-3 h-3" aria-hidden="true" />
                {t('filters.clearGroup', { count: selected.size })}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Barra de filtros de la vista Todo: panel colapsable en móvil, siempre visible en desktop.
 *  Proyectos y etiquetas van en desplegables (escalan con listas largas);
 *  personas y prioridades quedan como chips (conjuntos acotados). */
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

  const clearGroup = (group: keyof FilterState) => {
    onChange({ ...filters, [group]: new Set() } as FilterState);
  };

  const chipGroups = useMemo(
    () => [
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
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, users, filters],
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
            <FilterDropdown
              label={t('filters.project')}
              items={projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
              selected={filters.projects}
              onToggle={(id) => toggle('projects', id)}
              onClear={() => clearGroup('projects')}
            />
            {chipGroups.map((g) => (
              <div key={g.label} className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold tracking-wide uppercase text-faint mr-0.5">
                  {g.label}
                </span>
                {g.chips}
              </div>
            ))}
            <FilterDropdown
              label={t('filters.label')}
              items={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
              selected={filters.tags}
              onToggle={(id) => toggle('tags', id)}
              onClear={() => clearGroup('tags')}
            />
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
