"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { isApiError } from "@/lib/api";
import * as authApi from "@/lib/auth";
import type { LoginRequest } from "@/lib/auth";
import type { User } from "@/lib/types";

export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  | { status: "unauthenticated" }
  | { status: "error" };

type AuthActions = {
  logIn: (credentials: LoginRequest) => Promise<void>;
  logOut: () => Promise<void>;
  retry: () => void;
  updateUser: (changes: Partial<Pick<User, "displayName" | "avatarUrl">>) => void;
  expireSession: () => void;
};

type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

/** UI state, not a security control: the backend checks every request's session. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // A check in flight during a login or logout must not overwrite the newer state.
  const latestChange = useRef(0);

  useEffect(() => {
    const change = ++latestChange.current;

    authApi.getCurrentUser().then(
      (user) => {
        if (latestChange.current !== change) return;
        setState(
          user ? { status: "authenticated", user } : { status: "unauthenticated" },
        );
      },
      (error: unknown) => {
        if (latestChange.current !== change) return;
        // Not "signed out": the user may well have a session.
        console.error("Could not check the session.", error);
        setState({ status: "error" });
      },
    );
  }, [attempt]);

  const logIn = useCallback(async (credentials: LoginRequest) => {
    const user = await authApi.logIn(credentials);
    latestChange.current++;
    setState({ status: "authenticated", user });
  }, []);

  const logOut = useCallback(async () => {
    try {
      await authApi.logOut();
    } catch (error) {
      // Any other failure: the session may still be alive, so don't claim a logout.
      if (!(isApiError(error) && error.kind === "unauthenticated")) throw error;
    }
    latestChange.current++;
    setState({ status: "unauthenticated" });
  }, []);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }, []);

  const updateUser = useCallback<AuthActions["updateUser"]>((changes) => {
    setState((current) =>
      current.status === "authenticated"
        ? { ...current, user: { ...current.user, ...changes } }
        : current,
    );
  }, []);

  const expireSession = useCallback(() => {
    latestChange.current++;
    setState({ status: "unauthenticated" });
  }, []);

  const value = useMemo(
    () => ({ ...state, logIn, logOut, retry, updateUser, expireSession }),
    [state, logIn, logOut, retry, updateUser, expireSession],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return value;
}

/** Only inside RequireAuth, which guarantees a user. */
export function useCurrentUser(): User {
  const auth = useAuth();
  if (auth.status !== "authenticated") {
    throw new Error("useCurrentUser must be used inside RequireAuth.");
  }
  return auth.user;
}
