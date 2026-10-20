/** Placeholder shown while a profile is loading. */
export function ProfileSkeleton() {
  return (
    <div role="status" className="border-b border-border px-4 py-4">
      <span className="sr-only">Loading profile…</span>
      <div aria-hidden="true" className="animate-pulse">
        <div className="size-20 rounded-full bg-hover" />
        <div className="mt-4 h-4 w-2/5 rounded bg-hover" />
        <div className="mt-2.5 h-3 w-1/4 rounded bg-hover" />
        <div className="mt-5 h-3 w-full rounded bg-hover" />
        <div className="mt-2.5 h-3 w-2/3 rounded bg-hover" />
      </div>
    </div>
  );
}
