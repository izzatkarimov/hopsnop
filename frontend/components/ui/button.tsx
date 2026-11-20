import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

/* Full class names are listed so Tailwind can detect them. */

const baseClass =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-full text-control font-semibold whitespace-nowrap focus-ring motion-safe:transition disabled:cursor-not-allowed disabled:opacity-50";

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: "surface-primary text-white not-disabled:hover:brightness-110",
  secondary: "surface-raised text-primary not-disabled:hover:brightness-125",
  ghost: "text-secondary not-disabled:hover:bg-edge/6 not-disabled:hover:text-primary",
  danger: "surface-danger text-white not-disabled:hover:brightness-110",
};

export const buttonSizes: Record<ButtonSize, string> = {
  md: "h-9 px-4",
  lg: "h-12 px-5",
};

type ButtonStyle = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading, decorative. */
  icon?: ReactNode;
};

/** For something that only looks like a button, e.g. a file input's label. */
export function buttonClass(
  variant: ButtonVariant,
  size: ButtonSize,
  className?: string,
): string {
  return [baseClass, buttonVariants[variant], buttonSizes[size], className]
    .filter(Boolean)
    .join(" ");
}

type ButtonProps = ComponentProps<"button"> & ButtonStyle;

/** type="button" unless told otherwise, so it never submits a form by accident. */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & ButtonStyle;

export function ButtonLink({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}
