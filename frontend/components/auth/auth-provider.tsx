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
  /** The session has not been checked yet. */
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  | { status: "unauthenticated" }
  /** The session could not be checked, e.g. the API is unreachable. */
  | { status: "error" };

type AuthActions = {
  /** Rejects with the API's error if the credentials are not accepted. */
  logIn: (credentials: LoginRequest) => Promise<void>;
  /** Rejects if the session could not be ended on the server. */
  logOut: () => Promise<void>;
  /**
   * Checks the session again: after a failed check, or after something that
   * may have ended it on the server, such as a password reset.
   */
  retry: () => void;
  /**
   * Applies a profile change that also affects how the signed-in user is
   * shown in the shell, so that it does not show stale details.
   */
  updateUser: (changes: Partial<Pick<User, "displayName" | "avatarUrl">>) => void;
  /** To be called when the API answers that the session is no longer valid. */
  expireSession: () => void;
};

type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds who is signed in, for the whole application: the user's identity
 * (id, username, display name, avatar) and nothing more. Profile data such
 * as the bio or follower counts is loaded by the pages that show it.
 *
 * The session itself is an HttpOnly cookie that JavaScript cannot read, so
 * the only way to know whether the browser is signed in is to ask the backend
 * (GET /auth/me). That happens once, here, when the application starts.
 *
 * This state decides what the UI shows. It is not a security control: the
 * backend checks the session on every request and is the only authority.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // Counts the events that decide the auth state. A session check that is
  // still in flight when the user logs in or out is out of date by the time
  // it answers, and must not overwrite the newer state.
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
        // Not treated as "signed out": the user may well have a session.
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
      // A session that is already invalid is as good as logged out. Any
      // other failure means the session may still be alive on the server,
      // so the UI must not claim that the user has been logged out.
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

/**
 * The signed-in user. Only for components rendered inside RequireAuth, which
 * guarantees that there is one.
 */
export function useCurrentUser(): User {
  const auth = useAuth();
  if (auth.status !== "authenticated") {
    throw new Error("useCurrentUser must be used inside RequireAuth.");
  }
  return auth.user;
}
