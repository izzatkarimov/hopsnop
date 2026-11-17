import type { ReactNode } from "react";

/* Full class names are listed so Tailwind can detect them. */
const tones = {
  ink: "bg-ink/16 text-ink inset-ring-ink/24 shadow-[0_8px_12px] shadow-ink/20",
  success: "bg-success/16 text-success inset-ring-success/24 shadow-[0_8px_12px] shadow-success/20",
  warning: "bg-warning/16 text-warning inset-ring-warning/24 shadow-[0_8px_12px] shadow-warning/20",
  danger: "bg-danger/16 text-danger inset-ring-danger/24 shadow-[0_8px_12px] shadow-danger/20",
};

type IconBadgeProps = {
  tone: keyof typeof tones;
  /** 32px reads best. */
  icon: ReactNode;
};

/** Decorative: a screen's heading says what it is about. */
export function IconBadge({ tone, icon }: IconBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-16 shrink-0 items-center justify-center rounded-full inset-ring inset-shadow-[0_1px_0] inset-shadow-highlight/12 ${tones[tone]}`}
    >
      {icon}
    </span>
  );
}
