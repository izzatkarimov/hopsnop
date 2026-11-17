"use client";

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

const NavigatedContext = createContext(false);

/** Whether this tab has moved between pages here, so Back stays on the site. */
export function NavigationHistoryProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [history, setHistory] = useState({ first: pathname, navigated: false });
  if (!history.navigated && pathname !== history.first) {
    setHistory({ first: history.first, navigated: true });
  }

  return <NavigatedContext value={history.navigated}>{children}</NavigatedContext>;
}

export function useHasNavigated(): boolean {
  return useContext(NavigatedContext);
}
