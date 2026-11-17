import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  /** A short line above the title; "" keeps its room until it's known. */
  eyebrow?: string;
  /** Before the title, e.g. a back button. */
  leading?: ReactNode;
  /** On the right of the title, e.g. a button. */
  actions?: ReactNode;
  /** Below the title, e.g. tabs. */
  children?: ReactNode;
};

export function PageHeader({ title, eyebrow, leading, actions, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 px-1">
        {leading}
        <div className="flex min-w-0 flex-1 flex-col">
          {eyebrow !== undefined && (
            <p className="min-h-4 text-meta font-medium text-muted">{eyebrow}</p>
          )}
          <h1 className="text-title font-bold text-primary">{title}</h1>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
