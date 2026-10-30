import Link from "next/link";

type WordmarkProps = {
  compactOnTablet?: boolean;
};

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
