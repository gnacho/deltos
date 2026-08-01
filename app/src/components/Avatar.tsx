import { colorOf } from '@/lib/colors';

export function Avatar({
  name,
  color,
  size = 'md',
}: {
  name: string;
  color: string | null | undefined;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const cls =
    size === 'sm'
      ? 'w-6 h-6 text-[10px]'
      : size === 'lg'
        ? 'w-8 h-8 text-[12px]'
        : size === 'xl'
          ? 'w-12 h-12 text-lg'
          : 'w-6 h-6 text-[11px]';
  return (
    <span
      className={`${cls} rounded-full ${colorOf(color).chip} inline-flex items-center justify-center font-semibold shrink-0 select-none`}
      title={name}
      aria-hidden="true"
    >
      {(name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}
