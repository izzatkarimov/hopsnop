/** Full-page placeholder shown while the session is being checked. */
export function SessionLoading() {
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center">
      <span
        aria-hidden="true"
        className="flex size-10 animate-pulse items-center justify-center rounded-xl bg-accent text-xl font-bold leading-none text-accent-foreground"
      >
        h
      </span>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
