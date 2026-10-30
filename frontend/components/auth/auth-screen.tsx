import type { ReactNode } from "react";

export function AuthScreen({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}
