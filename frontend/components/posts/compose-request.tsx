"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

type ComposeRequest = {
  /** New post was pressed and no composer has answered yet. */
  pending: boolean;
  request: () => void;
  settle: () => void;
};

const ComposeRequestContext = createContext<ComposeRequest | null>(null);

/** Lets New post, anywhere in the shell, reach Home's composer. */
export function ComposeRequestProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(false);
  const request = useCallback(() => setPending(true), []);
  const settle = useCallback(() => setPending(false), []);
  const value = useMemo(() => ({ pending, request, settle }), [pending, request, settle]);

  return <ComposeRequestContext value={value}>{children}</ComposeRequestContext>;
}

/** Null outside the shell, e.g. for a signed-out visitor. */
export function useComposeRequest(): ComposeRequest | null {
  return useContext(ComposeRequestContext);
}
