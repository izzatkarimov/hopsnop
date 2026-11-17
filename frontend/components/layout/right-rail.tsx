/** From 1100px. Shows nothing needing data the backend lacks: no people suggestions. */
export function RightRail() {
  return (
    <aside
      aria-label="About Hopsnop"
      className="sticky top-6 hidden w-60 shrink-0 self-start wide:block"
    >
      <p className="px-2 text-meta font-medium text-muted">Hopsnop · Early preview</p>
    </aside>
  );
}
