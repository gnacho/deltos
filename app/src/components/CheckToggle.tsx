import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface CheckToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

export function CheckToggle({
  checked,
  onChange,
  label,
  icon: Icon,
  disabled,
  className,
  size = 'md',
}: CheckToggleProps) {
  const height = size === 'sm' ? 'h-8' : 'h-10';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex items-center gap-2 rounded-xl border px-3 transition-colors shrink-0',
        height,
        checked
          ? 'border-brand bg-brand/10 text-brand'
          : 'border-app bg-surface2 text-muted hover:bg-surface hover:text-text',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        className ?? '',
      ].join(' ')}
    >
      {Icon && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
      <span className="text-[13px] font-medium">{label}</span>
      {checked && (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-brandfg shadow">
          <Check className="w-2.5 h-2.5" strokeWidth={3} aria-hidden="true" />
        </span>
      )}
    </button>
  );
}
