import type { ReactNode } from "react";

type NoticeProps = {
  tone: "error" | "info";
  children: ReactNode;
};

/**
 * Message box for the result of an action, such as a failed form submission.
 * Announced by screen readers when it appears.
 */
export function Notice({ tone, children }: NoticeProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border px-3 py-2 text-sm ${
        tone === "error"
          ? "border-danger/40 text-danger"
          : "border-border text-foreground"
      }`}
    >
      {children}
    </div>
  );
}
