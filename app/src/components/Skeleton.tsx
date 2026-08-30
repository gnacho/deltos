interface SkeletonLineProps {
  className?: string
}

function SkeletonLine({ className = '' }: SkeletonLineProps) {
  return <div className={`skeleton-line ${className}`} aria-hidden="true" />
}

interface SkeletonCardProps {
  lines?: number
}

export function SkeletonCard({ lines = 3 }: SkeletonCardProps) {
  return (
    <div className="skeleton-card rounded-xl border border-app bg-surface2 p-3 space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} className={i === lines - 1 ? 'w-2/3' : ''} />
      ))}
    </div>
  )
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" aria-hidden="true" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-card rounded-lg border border-app bg-surface2 p-3 flex items-center gap-3">
          <div className="skeleton-line h-8 w-8 rounded-lg shrink-0" />
          <div className="flex-1 space-y-1.5">
            <SkeletonLine className="w-3/4" />
            <SkeletonLine className="w-1/2 h-2.5" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function SkeletonBoard() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-hidden="true" aria-busy="true">
      {Array.from({ length: 3 }, (_, col) => (
        <div key={col} className="space-y-3">
          <SkeletonLine className="h-5 w-24" />
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonCard key={i} lines={2 + (i % 2)} />
          ))}
        </div>
      ))}
    </div>
  )
}
