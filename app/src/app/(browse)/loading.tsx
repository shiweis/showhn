export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading page">
      <div className="mb-6 h-7 w-48 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="aspect-[16/10] animate-pulse bg-muted" />
            <div className="space-y-3 p-3">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading projects…</span>
    </div>
  );
}
