import type { ReactNode } from "react";
import { IconInfo, IconWarning } from "./icons";

/* Full class names are listed so Tailwind can detect them. */
const tones = {
  error: { box: "bg-danger/12 inset-ring-danger/24", icon: "text-danger" },
  info: { box: "bg-ink/12 inset-ring-ink/24", icon: "text-ink" },
};

type NoticeProps = {
  tone: keyof typeof tones;
  /** Bold first line; the children then explain it. */
  title?: string;
  children?: ReactNode;
};

/** An error is announced at once (role="alert"), information politely. */
export function Notice({ tone, title, children }: NoticeProps) {
  const Glyph = tone === "error" ? IconWarning : IconInfo;
  const role = tone === "error" ? "alert" : "status";

  return (
    <div className={`flex gap-3 rounded-field px-4 py-3 inset-ring ${tones[tone].box}`}>
      <Glyph className={`mt-0.5 shrink-0 ${tones[tone].icon}`} />
      {title ? (
        <div role={role} className="flex min-w-0 flex-col gap-1">
          <p className="text-body font-semibold text-primary">{title}</p>
          {children && (
            <div className="text-meta font-medium text-secondary">{children}</div>
          )}
        </div>
      ) : (
        <div role={role} className="min-w-0 text-body text-primary">
          {children}
        </div>
      )}
    </div>
  );
}
