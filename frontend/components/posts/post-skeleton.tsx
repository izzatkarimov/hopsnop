/** Placeholder shown while posts are loading. */
export function PostSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex animate-pulse gap-3 border-b border-border px-4 py-4"
    >
      <div className="size-10 shrink-0 rounded-full bg-hover" />
      <div className="flex flex-1 flex-col gap-2.5 pt-1">
        <div className="h-3 w-2/5 rounded bg-hover" />
        <div className="h-3 w-full rounded bg-hover" />
        <div className="h-3 w-3/4 rounded bg-hover" />
      </div>
    </div>
  );
}
