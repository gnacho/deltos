import { useEffect, useState } from 'react';

export function VersionFooter() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/version', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j: { version: string }) => setVersion(j.version))
      .catch(() => {});
  }, []);

  if (!version) return null;

  return (
    <div className="fixed bottom-1 right-3 z-40 pointer-events-none">
      <span className="text-[10px] text-faint/50 font-medium tabular-nums select-none">
        v{version}
      </span>
    </div>
  );
}
