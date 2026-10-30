/** Shows nothing needing data the backend lacks: no people suggestions. */
export function RightRail() {
  return (
    <aside
      aria-label="About Hopsnop"
      className="sticky top-0 hidden h-dvh w-80 shrink-0 flex-col gap-4 px-6 py-4 xl:flex"
    >
      <p className="px-4 text-sm text-muted">
        Hopsnop · Early preview
      </p>
    </aside>
  );
}
