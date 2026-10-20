import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  /** Optional content below the title, e.g. feed tabs. */
  children?: ReactNode;
};

/**
 * Sticky header at the top of the main column.
 * It sits below the shell's own sticky top bar, whose height the shell sets
 * as --top-bar-height. On mobile that bar already shows the brand, so the
 * visible title is reserved for larger screens.
 */
export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <div className="sticky top-(--top-bar-height) z-10 border-b border-border bg-background">
      <h1
        className={`px-4 py-3 text-xl font-semibold tracking-tight ${children ? "max-sm:sr-only" : ""}`}
      >
        {title}
      </h1>
      {children}
    </div>
  );
}
