import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLElement> & {
  /** "shell" holds tiles 8px in, so their corners stay concentric. */
  surface?: "shell" | "tile";
  as?: "div" | "section" | "article" | "aside";
};

/* Full class names are listed so Tailwind can detect them. */
const surfaces = {
  shell: "surface-shell flex flex-col gap-2 rounded-shell p-2",
  tile: "surface-tile rounded-tile",
};

export function Card({
  surface = "tile",
  as: Element = "div",
  className,
  ...props
}: CardProps) {
  return (
    <Element
      className={`${surfaces[surface]} ${className ?? ""}`}
      {...props}
    />
  );
}
