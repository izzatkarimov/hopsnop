import Link from "next/link";
import type { ComponentProps } from "react";

export const textLinkClass =
  "rounded-sm font-semibold text-ink underline-offset-4 hover:underline";

export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link className={`${textLinkClass} ${className ?? ""}`} {...props} />;
}
