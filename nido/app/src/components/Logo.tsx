export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-soft"
      style={{ width: size, height: size }}
    >
      <svg
        style={{ width: size * 0.56, height: size * 0.56 }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m4.5 12.5 5 5 10-11" />
      </svg>
    </span>
  );
}
