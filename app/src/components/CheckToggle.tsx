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
  variant?: 'check' | 'switch';
}

export function CheckToggle({
  checked,
  onChange,
  label,
  icon: Icon,
  disabled,
  className,
  size = 'md',
  variant = 'check',
}: CheckToggleProps) {
  const height = size === 'sm' ? 'h-8' : 'h-9';

  if (variant === 'switch') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          'inline-flex items-center gap-2 rounded-xl border px-3 transition-colors shrink-0',
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
        <span
          className={[
            'relative ml-1 w-11 h-6 rounded-full shrink-0 transition-colors',
            checked ? 'bg-brand' : 'bg-surface border border-app',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
              checked ? 'translate-x-[22px]' : 'translate-x-0.5',
            ].join(' ')}
          />
        </span>
      </button>
    );
  }

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
