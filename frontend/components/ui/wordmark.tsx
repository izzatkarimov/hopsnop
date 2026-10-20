import Link from "next/link";

type WordmarkProps = {
  /** Hide the text on tablet widths where the sidebar is icon-only. */
  compactOnTablet?: boolean;
};

/** Temporary text-based Hopsnop wordmark until a final logo exists. */
export function Wordmark({ compactOnTablet = false }: WordmarkProps) {
  return (
    <Link
      href="/"
      aria-label="Hopsnop home"
      className="inline-flex items-center gap-2 rounded-full p-1"
    >
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-lg bg-accent text-lg font-bold leading-none text-accent-foreground"
      >
        h
      </span>
      <span
        aria-hidden="true"
        className={`text-xl font-semibold tracking-tight ${compactOnTablet ? "sm:hidden lg:inline" : ""}`}
      >
        hopsnop
      </span>
    </Link>
  );
}
