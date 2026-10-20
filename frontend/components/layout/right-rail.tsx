/**
 * Secondary column on wide screens. It shows nothing that would need data
 * the backend does not have: there are no people suggestions to show.
 */
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
