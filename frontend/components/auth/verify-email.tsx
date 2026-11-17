"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { IconBadge } from "@/components/ui/icon-badge";
import {
  IconArrowLeft,
  IconClock,
  IconInfo,
  IconMailCheck,
  IconShieldCheck,
  IconWarning,
} from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { TextLink } from "@/components/ui/text-link";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { verifyEmail } from "@/lib/auth";
import { AuthScreen } from "./auth-screen";
import { ResendVerificationForm } from "./resend-verification-form";

const warningBadge = <IconBadge tone="danger" icon={<IconWarning size={32} />} />;

type State =
  | { phase: "waiting" }
  | { phase: "verifying" }
  | { phase: "verified" }
  | { phase: "invalid" }
  /** The request itself failed; the token may still be good. */
  | { phase: "error"; message: string };

/** The token is read once, kept in memory, POSTed, and never logged or stored. */
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
    // A token is single-use, and React runs effects twice in development.
    if (!urlToken || token.current !== null) return;
    token.current = urlToken;

    // Take the token out of the address bar and history.
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
        <p role="status" className="text-center text-body text-secondary">
          Verifying your email address…
        </p>
      );

    case "verified":
      return (
        <AuthScreen
          badge={<IconBadge tone="success" icon={<IconShieldCheck size={32} />} />}
          title="Email verified"
        >
          <p role="status" className="text-center text-body text-secondary">
            Your account is ready. You can log in now.
          </p>
          <ButtonLink href="/login" variant="primary" size="lg">
            Log in
          </ButtonLink>
        </AuthScreen>
      );

    case "invalid":
      return (
        <AuthScreen badge={warningBadge} title="This link didn't work">
          <Notice tone="error">
            The verification link is invalid or has expired.
          </Notice>
          <p className="text-body text-secondary">
            If you have already verified your email address, you can{" "}
            <TextLink href="/login">log in</TextLink>. Otherwise, request a new
            link below.
          </p>
          <ResendVerificationForm />
        </AuthScreen>
      );

    case "error":
      return (
        <AuthScreen badge={warningBadge} title="Couldn't verify your email">
          <Notice tone="error">{state.message}</Notice>
          <Button variant="primary" size="lg" onClick={retry}>
            Try again
          </Button>
        </AuthScreen>
      );

    case "waiting":
      return (
        <AuthScreen
          badge={<IconBadge tone="ink" icon={<IconMailCheck size={32} />} />}
          title="Check your inbox"
          description="If your address can be used, we've sent you an email. Follow what it says to finish."
        >
          <ul className="flex flex-col gap-3 rounded-field surface-well p-4 text-body text-secondary">
            <li className="flex items-center gap-3">
              <IconClock className="shrink-0 text-muted" />
              The link works only for a limited time.
            </li>
            <li className="flex items-center gap-3">
              <IconInfo className="shrink-0 text-muted" />
              Nothing there? Check your spam folder.
            </li>
          </ul>
          <div className="flex flex-col gap-4">
            <p className="text-body text-secondary">Need a new verification link?</p>
            <ResendVerificationForm />
          </div>
          <ButtonLink
            href="/login"
            variant="ghost"
            icon={<IconArrowLeft />}
            className="self-center"
          >
            Back to log in
          </ButtonLink>
        </AuthScreen>
      );
  }
}
