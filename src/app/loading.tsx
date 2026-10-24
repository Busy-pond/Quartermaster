/** Shown while any page loads its data, so a slow database never leaves a blank screen. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-1/2 animate-pulse rounded-lg bg-line motion-reduce:animate-none" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-line motion-reduce:animate-none" />
      <div className="card h-40 animate-pulse motion-reduce:animate-none" />
      <div className="card h-24 animate-pulse motion-reduce:animate-none" />
    </div>
  );
}
