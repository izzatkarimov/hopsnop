import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";

export function GuestShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-edge/6 bg-bg/80 px-4 backdrop-blur-lg sm:px-6">
        <Wordmark />
        <nav aria-label="Account" className="flex items-center gap-2">
          <ButtonLink href="/login">Log in</ButtonLink>
          <ButtonLink href="/register" variant="primary">
            Sign up
          </ButtonLink>
        </nav>
      </header>
      <main id="main-content" className="flex flex-1 justify-center px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex w-full max-w-main min-w-0 flex-col gap-4">{children}</div>
      </main>
    </div>
  );
}
