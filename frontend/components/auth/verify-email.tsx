"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Notice } from "@/components/ui/notice";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { verifyEmail } from "@/lib/auth";
import { AuthScreen } from "./auth-screen";
import { ResendVerificationForm } from "./resend-verification-form";
import { primaryActionClass, textLinkClass } from "./styles";

type State =
  /** No token in the URL: the visitor is waiting for, or needs, a link. */
  | { phase: "waiting" }
  | { phase: "verifying" }
  | { phase: "verified" }
  /** The backend refused the token: wrong, expired or already used. */
  | { phase: "invalid" }
  /** The request itself failed; the token may still be good. */
  | { phase: "error"; message: string };

/**
 * Handles the link from the verification email: /verify-email?token=...
 *
 * The token is a single-use credential. It is read from the URL once, kept
 * only in memory, sent to the backend in a POST body, and never logged or
 * stored.
 */
export function VerifyEmail() {
  const urlToken = useSearchParams().get("token");
  const token = useRef<string | null>(null);
  const [state, setState] = useState<State>(
    urlToken ? { phase: "verifying" } : { phase: "waiting" },
  );

  const verify = useCallback(async (value: string) => {
    try {
      await verifyEmail(value);
      setState({ phase: "verified" });
    } catch (error) {
      const refused =
        isApiError(error) &&
        (error.kind === "bad_request" || error.kind === "validation");
      setState(
        refused
          ? { phase: "invalid" }
          : { phase: "error", message: unexpectedErrorMessage(error) },
      );
    }
  }, []);

  useEffect(() => {
    // A token can be redeemed only once, so it must be sent only once, even
    // though React runs effects twice in development.
    if (!urlToken || token.current !== null) return;
    token.current = urlToken;

    // Take the token out of the address bar and the browser history.
    window.history.replaceState(null, "", window.location.pathname);

    verify(urlToken);
  }, [urlToken, verify]);

  function retry() {
    if (token.current === null) return;
    setState({ phase: "verifying" });
    verify(token.current);
  }

  switch (state.phase) {
    case "verifying":
      return (
        <p role="status" className="text-center text-muted">
          Verifying your email address…
        </p>
      );

    case "verified":
      return (
        <AuthScreen title="Email verified">
          <p role="status" className="text-muted">
            Your account is ready. You can log in now.
          </p>
          <Link href="/login" className={primaryActionClass}>
            Log in
          </Link>
        </AuthScreen>
      );

    case "invalid":
      return (
        <AuthScreen title="This link didn't work">
          <Notice tone="error">
            The verification link is invalid or has expired.
          </Notice>
          <p className="text-muted">
            If you have already verified your email address, you can{" "}
            <Link href="/login" className={textLinkClass}>
              log in
            </Link>
            . Otherwise, request a new link below.
          </p>
          <ResendVerificationForm />
        </AuthScreen>
      );

    case "error":
      return (
        <AuthScreen title="Couldn't verify your email">
          <Notice tone="error">{state.message}</Notice>
          <button type="button" onClick={retry} className={primaryActionClass}>
            Try again
          </button>
        </AuthScreen>
      );

    case "waiting":
      return (
        <AuthScreen title="Verify your email">
          <p className="text-muted">
            Check your inbox for the verification link we sent when you
            registered. Open it to activate your account.
          </p>
          <p className="text-muted">Need a new link?</p>
          <ResendVerificationForm />
          <p className="text-center text-sm text-muted">
            <Link href="/login" className={textLinkClass}>
              Back to log in
            </Link>
          </p>
        </AuthScreen>
      );
  }
}
