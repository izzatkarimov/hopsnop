import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/ui/wordmark";

/**
 * Frame for public pages when nobody is signed in: the content column of the
 * application without its navigation, and a way to log in or register.
 */
export function GuestShell({ children }: { children: ReactNode }) {
  return (
    // The header (h-14) stays at every width, so PageHeader always sits below it.
    <div className="mx-auto flex min-h-dvh w-full max-w-feed flex-col border-border [--top-bar-height:3.5rem] sm:border-x">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-background px-3">
        <Wordmark />
        <nav aria-label="Account" className="flex items-center gap-1 text-body">
          <Link
            href="/login"
            className="rounded-full px-4 py-1.5 font-semibold transition-colors hover:bg-hover"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-accent px-4 py-1.5 font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
          >
            Sign up
          </Link>
        </nav>
      </header>
      <main id="main-content" className="flex-1">
        {children}
      </main>
    </div>
  );
}
