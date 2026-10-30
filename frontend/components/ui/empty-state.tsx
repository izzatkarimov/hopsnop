import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-6 py-16 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {description && <p className="text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
