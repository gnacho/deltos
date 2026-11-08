import { CalendarCheck } from 'lucide-react';

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-soft"
      style={{ width: size, height: size }}
    >
      <CalendarCheck
        style={{ width: size * 0.6, height: size * 0.6 }}
        strokeWidth={2.4}
        aria-hidden="true"
      />
    </span>
  );
}
