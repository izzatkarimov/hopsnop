import type { ReactNode } from "react";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { ComposeRequestProvider } from "@/components/posts/compose-request";
import { MobileHeader } from "./mobile-header";
import { RightRail } from "./right-rail";
import { Sidebar } from "./sidebar";

/** Shows the signed-in user, so render it only for one. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ComposeRequestProvider>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-full bg-accent px-4 py-2 text-control font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <div className="flex min-h-dvh sm:p-6">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <MobileHeader />
          {/* The bottom padding keeps content clear of the floating phone nav. */}
          <main
            id="main-content"
            className="flex min-w-0 flex-1 justify-center px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-0 sm:pb-0"
          >
            <div className="flex w-full max-w-main min-w-0 flex-col gap-4">{children}</div>
          </main>
        </div>

        <RightRail />
      </div>

      <BottomNav />
    </ComposeRequestProvider>
  );
}
