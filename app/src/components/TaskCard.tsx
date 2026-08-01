import { MessageCircle, Paperclip } from 'lucide-react';
import type { Project, Task } from '@/data/types';
import { colorOf } from '@/lib/colors';
import { Avatar } from '@/components/Avatar';
import { DueBadge, PriorityBadge, TagChip, UnassignedAvatar } from '@/components/badges';

interface CardProps {
  task: Task;
  project: Project | undefined;
  index: number;
  onOpen: (id: string) => void;
}

/** Tarjeta desktop (completa): etiquetas, prioridad, vencimiento, contadores, avatar. */
export function TaskCard({ task, project, index, onOpen }: CardProps) {
  const done = task.column === 'hecho';
  const delay = Math.min(index, 10) * 40;
  return (
    <button
      type="button"
      data-task={task.id}
      draggable
      onClick={() => onOpen(task.id)}
      style={{ animationDelay: `${delay}ms` }}
      className={`card w-full text-left rounded-2xl bg-surface border border-app shadow-soft p-3.5 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-md ${done ? 'opacity-60' : ''}`}
    >
      {project && (
        <div className="flex items-center gap-1.5 mb-2">
          <span
            className={`w-2 h-2 rounded-full ${colorOf(project.color).dot}`}
            aria-hidden="true"
          />
          <span className="text-[11px] font-medium text-muted truncate">{project.name}</span>
        </div>
      )}
      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {task.labels.map((l) => (
            <TagChip key={l.id} label={l} />
          ))}
        </div>
      )}
      <h3
        className={`text-[15px] font-medium leading-snug ${done ? 'line-through decoration-1' : ''}`}
      >
        {task.title}
      </h3>
      {(task.priority || task.due_date) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          {task.priority && <PriorityBadge priority={task.priority} />}
          <DueBadge due={task.due_date} />
        </div>
      )}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-app">
        <span className="tnum flex items-center gap-3 text-xs text-faint">
          {task.counts.comments > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
              {task.counts.comments}
            </span>
          )}
          {task.counts.attachments > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
              {task.counts.attachments}
            </span>
          )}
        </span>
        {task.assignee ? (
          <Avatar name={task.assignee.username} color={task.assignee.color} />
        ) : (
          <UnassignedAvatar />
        )}
      </div>
    </button>
  );
}

/** Tarjeta MÓVIL simplificada: título (17px/600, 2 líneas), proyecto (dot+nombre), prioridad. */
export function TaskCardMobile({ task, project, index, onOpen }: CardProps) {
  const done = task.column === 'hecho';
  const delay = Math.min(index, 10) * 40;
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      style={{ animationDelay: `${delay}ms` }}
      className={`card w-full text-left rounded-2xl bg-surface border border-app shadow-soft px-4 py-3.5 min-h-[64px] flex flex-col justify-center gap-2 ${done ? 'opacity-60' : ''}`}
    >
      <h3
        className={`text-[17px] font-semibold leading-snug line-clamp-2 ${done ? 'line-through decoration-1' : ''}`}
      >
        {task.title}
      </h3>
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
        {project && (
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${colorOf(project.color).dot}`}
              aria-hidden="true"
            />
            <span className="text-[13px] text-muted truncate">{project.name}</span>
          </span>
        )}
        {task.priority && (
          <span className="text-[12px]">
            <PriorityBadge priority={task.priority} big />
          </span>
        )}
      </div>
    </button>
  );
}
