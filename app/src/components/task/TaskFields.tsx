import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, ArrowRight, ArrowDown, User } from 'lucide-react';
import type { Label, Priority, Project, TaskRecurrence } from '@/data/types';
import { PRIORITIES, PRIORITY_BADGE } from '@/lib/constants';
import { colorOf } from '@/lib/colors';
import { Avatar } from '@/components/Avatar';
import { ProjectSelect } from '@/components/task/ProjectSelect';
import { LabelsSelect } from '@/components/task/LabelsSelect';
import { RecurrenceField } from '@/components/task/RecurrenceField';

export interface TaskFieldsValue {
  title: string;
  description: string;
  project_id: string;
  priority: Priority | null;
  assignee_id: string | null;
  due_date: string | null;
  recurrence: TaskRecurrence | null;
  labelIds: string[];
}

interface FieldUser {
  id: string;
  username: string;
  color: string;
}

const PR_ICON = { alta: ArrowUp, media: ArrowRight, baja: ArrowDown } as const;

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
      {children}
    </p>
  );
}

/** Formulario de campos de tarea compartido por el modal de creación y la
 *  pestaña Detalles (paridad de campos y layout). Presentacional: el padre
 *  decide cómo persiste cada cambio. */
export function TaskFields({
  value,
  onChange,
  onTextCommit,
  titleError,
  idPrefix,
  projects,
  labels,
  users,
  titleInputRef,
  titleExtra,
  columnSlot,
  subtasksSlot,
  children,
}: {
  value: TaskFieldsValue;
  onChange: (patch: Partial<TaskFieldsValue>) => void;
  onTextCommit?: (field: 'title' | 'description') => void;
  titleError?: string | null;
  idPrefix: string;
  projects: Project[];
  labels: Label[];
  users: FieldUser[];
  titleInputRef?: Ref<HTMLInputElement>;
  titleExtra?: ReactNode;
  columnSlot?: ReactNode;
  subtasksSlot?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <div>
        <label
          htmlFor={`${idPrefix}-title`}
          className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5"
        >
          {t('task.titleLabel')}
        </label>
        <input
          ref={titleInputRef}
          id={`${idPrefix}-title`}
          type="text"
          value={value.title}
          maxLength={200}
          placeholder={t('task.titlePlaceholder')}
          onChange={(e) => onChange({ title: e.target.value })}
          onBlur={() => onTextCommit?.('title')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          aria-invalid={titleError !== null && titleError !== undefined}
          className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] font-medium outline-none focus:border-brand"
        />
        {titleError && (
          <p role="alert" className="text-[12px] text-rose-600 dark:text-rose-400 mt-1">
            {titleError}
          </p>
        )}
        {titleExtra}
      </div>

      {columnSlot}

      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <div>
          <FieldLabel>{t('task.project')}</FieldLabel>
          <ProjectSelect
            id={`${idPrefix}-project`}
            value={value.project_id}
            onChange={(projectId) => onChange({ project_id: projectId })}
            projects={projects}
            ariaLabel={t('task.project')}
          />
        </div>

        <div>
          <FieldLabel>{t('task.priority')}</FieldLabel>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('task.priority')}>
            {PRIORITIES.map((pr) => {
              const Icon = PR_ICON[pr];
              const active = value.priority === pr;
              return (
                <button
                  key={pr}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ priority: active ? null : pr })}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs ${
                    active
                      ? `${PRIORITY_BADGE[pr]} ring-1 ring-current font-medium`
                      : 'bg-surface border border-app text-muted hover:bg-surface2'
                  }`}
                >
                  <Icon className="w-3 h-3" aria-hidden="true" />
                  {t(`priority.${pr}`)}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={value.priority === null}
              onClick={() => onChange({ priority: null })}
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs ${
                value.priority === null
                  ? 'bg-slate-200/70 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300 ring-1 ring-current font-medium'
                  : 'bg-surface border border-app text-muted hover:bg-surface2'
              }`}
            >
              {t('priority.none')}
            </button>
          </div>
        </div>

        <div>
          <FieldLabel>{t('task.assignee')}</FieldLabel>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('task.assignee')}>
            {users.map((u) => {
              const active = value.assignee_id === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ assignee_id: active ? null : u.id })}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                    active
                      ? `${colorOf(u.color).chip} ring-1 ring-current font-medium`
                      : 'bg-surface border border-app text-muted hover:bg-surface2'
                  }`}
                >
                  <Avatar name={u.username} color={u.color} />
                  {u.username}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={value.assignee_id === null}
              onClick={() => onChange({ assignee_id: null })}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                value.assignee_id === null
                  ? 'bg-slate-200/70 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300 ring-1 ring-current font-medium'
                  : 'bg-surface border border-app text-muted hover:bg-surface2'
              }`}
            >
              <User className="w-3 h-3" aria-hidden="true" />
              {t('filters.unassigned')}
            </button>
          </div>
        </div>

        <div>
          <FieldLabel>{t('task.dueDate')}</FieldLabel>
          <input
            id={`${idPrefix}-due`}
            type="date"
            value={value.due_date ?? ''}
            onChange={(e) => onChange({ due_date: e.target.value || null })}
            className="w-full bg-surface2 border border-app rounded-xl px-3 py-2 text-[14px] outline-none focus:border-brand"
          />
        </div>
      </div>

      {/* Fila compacta: etiquetas (desplegable) + subtareas + repetición */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-4 gap-y-5">
        <div>
          <FieldLabel>{t('task.labels')}</FieldLabel>
          <LabelsSelect
            id={`${idPrefix}-labels`}
            labels={labels}
            selected={value.labelIds}
            onChange={(ids) => onChange({ labelIds: ids })}
            ariaLabel={t('task.labels')}
          />
        </div>
        <div>
          <FieldLabel>{t('task.subtasks')}</FieldLabel>
          {subtasksSlot}
        </div>
        <div>
          <RecurrenceField
            value={value.recurrence}
            onChange={(r) => onChange({ recurrence: r })}
            idPrefix={idPrefix}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-description`}
          className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5"
        >
          {t('task.description')}
        </label>
        <textarea
          id={`${idPrefix}-description`}
          value={value.description}
          maxLength={5000}
          rows={4}
          placeholder={t('task.descriptionPlaceholder')}
          onChange={(e) => onChange({ description: e.target.value })}
          onBlur={() => onTextCommit?.('description')}
          className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] leading-relaxed outline-none focus:border-brand resize-y"
        />
      </div>

      {children}
    </div>
  );
}
