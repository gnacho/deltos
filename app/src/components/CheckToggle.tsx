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
  size: _size,
  variant = 'check',
}: CheckToggleProps) {
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
          'inline-flex items-center gap-2 shrink-0 cursor-pointer select-none',
          'transition-opacity',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
          className ?? '',
        ].join(' ')}
      >
        {Icon && <Icon className="w-4 h-4 shrink-0 text-muted" aria-hidden="true" />}
        <span className="text-[13px] font-medium">{label}</span>
        <span
          className={[
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
            checked ? 'bg-brand' : 'bg-surface2 border border-app',
          ].join(' ')}
        >
          <span
            className={[
              'pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform',
              checked ? 'translate-x-[18px]' : 'translate-x-0.5',
            ].join(' ')}
          />
        </span>
      </button>
    );
  }

  const height = _size === 'sm' ? 'h-8' : 'h-9';

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
