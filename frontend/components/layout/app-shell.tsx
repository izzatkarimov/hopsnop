import type { ReactNode } from "react";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { MobileHeader } from "./mobile-header";
import { RightRail } from "./right-rail";
import { Sidebar } from "./sidebar";

/** Shows the signed-in user, so render it only for one. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-full bg-accent px-4 py-2 text-accent-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <div className="flex justify-center">
        <Sidebar />

        {/* The mobile top bar (h-14) is hidden from sm up. */}
        <div className="flex min-h-dvh w-full max-w-feed min-w-0 flex-col border-border [--top-bar-height:3.5rem] sm:border-x sm:[--top-bar-height:0px]">
          <MobileHeader />
          <main
            id="main-content"
            className="flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0"
          >
            {children}
          </main>
        </div>

        <RightRail />
      </div>

      <BottomNav />
    </>
  );
}
