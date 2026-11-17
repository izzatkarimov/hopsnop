import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  /** A short line above the title. */
  eyebrow?: string;
  /** On the right of the title, e.g. a button. */
  actions?: ReactNode;
  /** Below the title, e.g. tabs. */
  children?: ReactNode;
};

export function PageHeader({ title, eyebrow, actions, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 px-1">
        <div className="flex min-w-0 flex-col">
          {eyebrow && <p className="text-meta font-medium text-muted">{eyebrow}</p>}
          <h1 className="text-title font-bold text-primary">{title}</h1>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
