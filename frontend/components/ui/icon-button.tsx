import type { ComponentProps, ReactNode } from "react";

export type IconButtonVariant = "ghost" | "secondary" | "glass" | "primary" | "overlay";
export type IconButtonSize = "sm" | "md" | "lg";

/* Full class names are listed so Tailwind can detect them. */

const variants: Record<IconButtonVariant, string> = {
  ghost: "text-secondary not-disabled:hover:bg-edge/6 not-disabled:hover:text-primary",
  secondary: "surface-raised text-primary not-disabled:hover:brightness-125",
  glass: "surface-glass text-primary not-disabled:hover:bg-edge/10",
  primary: "surface-primary text-white not-disabled:hover:brightness-110",
  // On a picture, where only white reads.
  overlay: "text-white not-disabled:hover:bg-white/16 aria-expanded:bg-white/16 aria-pressed:bg-white/24",
};

const sizes: Record<IconButtonSize, string> = {
  sm: "size-8",
  md: "size-9",
  lg: "size-10",
};

export function iconButtonClass(
  variant: IconButtonVariant = "ghost",
  size: IconButtonSize = "md",
): string {
  return `inline-flex shrink-0 items-center justify-center rounded-full focus-ring motion-safe:transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]}`;
}

type IconButtonProps = Omit<ComponentProps<"button">, "children" | "aria-label"> & {
  /** The button's accessible name: the icon says nothing to assistive technology. */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
};

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  type = "button",
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`${iconButtonClass(variant, size)} ${className ?? ""}`}
      {...props}
    >
      {icon}
    </button>
  );
}
