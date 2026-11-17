export function PostSkeleton() {
  return (
    <div aria-hidden="true" className="flex gap-3 p-4 motion-safe:animate-pulse">
      <div className="size-10 shrink-0 rounded-full bg-edge/6" />
      <div className="flex flex-1 flex-col gap-3 pt-1">
        <div className="h-3 w-2/5 rounded-full bg-edge/6" />
        <div className="h-3 w-full rounded-full bg-edge/6" />
        <div className="h-3 w-3/4 rounded-full bg-edge/6" />
      </div>
    </div>
  );
}
