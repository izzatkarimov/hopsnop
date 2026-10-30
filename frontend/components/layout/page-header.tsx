import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  children?: ReactNode;
};

/** Below the shell's sticky bar (--top-bar-height), which shows the brand on mobile. */
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
