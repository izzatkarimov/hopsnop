"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Notice } from "@/components/ui/notice";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { disableTwoFactor, replaceRecoveryCodes } from "@/lib/auth";
import { getTwoFactorStatus } from "@/lib/profiles";
import type { TwoFactorStatus } from "@/lib/types";
import { RecoveryCodes } from "./recovery-codes";
import { dangerButtonClass, outlineButtonClass, primaryButtonClass } from "./styles";
import { TwoFactorConfirmForm } from "./two-factor-confirm-form";
import { TwoFactorSetup } from "./two-factor-setup";

/** At or below this, the section asks for new codes. */
export const LOW_RECOVERY_CODES = 3;

type StatusState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; twoFactor: TwoFactorStatus };

/** Anything secret lives in a step's own state, and goes when the step does. */
type Flow =
  | { step: "idle" }
  | { step: "enable" }
  | { step: "replace" }
  | { step: "disable" }
  | { step: "codes"; codes: string[] };

type Trigger = "enable" | "replace" | "disable";

const SESSIONS_ENDED = "Your other sessions have been signed out.";

type TwoFactorSectionProps = {
  /** The backend has ended the other sessions. */
  onChanged: () => void;
};

export function TwoFactorSection({ onChanged }: TwoFactorSectionProps) {
  const { expireSession } = useAuth();
  const [state, setState] = useState<StatusState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [flow, setFlow] = useState<Flow>({ step: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Where focus goes once a step has closed: its button, or the heading.
  const focusNext = useRef<Trigger | "heading" | null>(null);
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const triggerId = (trigger: Trigger) => `${baseId}-${trigger}`;

  useEffect(() => {
    // Set by the cleanup, so a stale request can't change the state.
    let ignore = false;

    getTwoFactorStatus().then(
      (twoFactor) => {
        if (!ignore) setState({ status: "ready", twoFactor });
      },
      (error: unknown) => {
        if (ignore) return;
        if (isApiError(error) && error.kind === "unauthenticated") {
          expireSession();
          return;
        }
        setState({ status: "error", message: unexpectedErrorMessage(error) });
      },
    );

    return () => {
      ignore = true;
    };
  }, [attempt, expireSession]);

  useEffect(() => {
    if (focusNext.current === null) return;
    const target =
      focusNext.current === "heading"
        ? headingRef.current
        : (document.getElementById(triggerId(focusNext.current)) ?? headingRef.current);
    focusNext.current = null;
    target?.focus();
  });

  function reload() {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }

  function open(step: Trigger) {
    setNotice(null);
    setFlow({ step });
  }

  function close(focusTo: Trigger | "heading") {
    setFlow({ step: "idle" });
    focusNext.current = focusTo;
  }

  function changed(twoFactor: TwoFactorStatus, message: string) {
    setState({ status: "ready", twoFactor });
    setNotice(`${message} ${SESSIONS_ENDED}`);
    onChanged();
  }

  function showCodes(codes: string[], message: string) {
    changed({ enabled: true, recoveryCodesLeft: codes.length }, message);
    setFlow({ step: "codes", codes });
  }

  function outOfDate() {
    close("heading");
    setNotice(
      "Two-factor login was changed elsewhere, so nothing was done here. What's shown is now up to date.",
    );
    reload();
  }

  let content;
  if (state.status === "loading") {
    content = (
      <p role="status" className="text-body text-muted">
        Loading…
      </p>
    );
  } else if (state.status === "error") {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Notice tone="error">
          Couldn&apos;t load your two-factor login settings. {state.message}
        </Notice>
        <button type="button" onClick={reload} className={outlineButtonClass}>
          Try again
        </button>
      </div>
    );
  } else {
    const { enabled, recoveryCodesLeft } = state.twoFactor;
    content = (
      <>
        <div className="text-body">
          <p>
            Two-factor login is <strong>{enabled ? "on" : "off"}</strong>.
          </p>
          {enabled && (
            <p className="text-muted">
              {recoveryCodesLeft === 1
                ? "1 recovery code left."
                : `${recoveryCodesLeft} recovery codes left.`}
            </p>
          )}
        </div>

        {enabled && recoveryCodesLeft <= LOW_RECOVERY_CODES && flow.step !== "codes" && (
          <p className="rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger">
            <strong>Warning: </strong>
            {recoveryCodesLeft === 0
              ? "You have no recovery codes left."
              : `You have only ${recoveryCodesLeft} recovery ${
                  recoveryCodesLeft === 1 ? "code" : "codes"
                } left.`}{" "}
            Replace them, so that you can still log in if you lose your phone.
          </p>
        )}

        {flow.step === "idle" &&
          (enabled ? (
            <div className="flex flex-wrap gap-2">
              <button
                id={triggerId("replace")}
                type="button"
                onClick={() => open("replace")}
                className={outlineButtonClass}
              >
                Replace recovery codes
              </button>
              <button
                id={triggerId("disable")}
                type="button"
                onClick={() => open("disable")}
                className={dangerButtonClass}
              >
                Turn off two-factor login
              </button>
            </div>
          ) : (
            <div>
              <button
                id={triggerId("enable")}
                type="button"
                onClick={() => open("enable")}
                className={primaryButtonClass}
              >
                Turn on two-factor login
              </button>
            </div>
          ))}

        {flow.step === "enable" && (
          <TwoFactorSetup
            onEnabled={(codes) => showCodes(codes, "Two-factor login is on.")}
            onCancel={() => close("enable")}
            onOutOfDate={outOfDate}
          />
        )}
        {flow.step === "replace" && (
          <TwoFactorConfirmForm
            kind="replace"
            submit={async (password, code) => {
              const codes = await replaceRecoveryCodes(password, code);
              showCodes(codes, "Your recovery codes have been replaced, and the old ones no longer work.");
            }}
            onCancel={() => close("replace")}
            onOutOfDate={outOfDate}
          />
        )}
        {flow.step === "disable" && (
          <TwoFactorConfirmForm
            kind="disable"
            submit={async (password, code) => {
              await disableTwoFactor(password, code);
              changed({ enabled: false, recoveryCodesLeft: 0 }, "Two-factor login is off.");
              close("heading");
            }}
            onCancel={() => close("disable")}
            onOutOfDate={outOfDate}
          />
        )}
        {flow.step === "codes" && (
          <RecoveryCodes codes={flow.codes} onClose={() => close("heading")} />
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="border-b border-border">
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex flex-col gap-1">
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold"
          >
            Two-factor login
          </h2>
          <p className="text-body text-muted">
            Ask for a code from an authenticator app on your phone, as well as
            your password, whenever you log in. Turning it on or off, or
            replacing your recovery codes, signs you out of all your other
            sessions.
          </p>
        </div>

        {notice && <Notice tone="info">{notice}</Notice>}

        {content}
      </div>
    </section>
  );
}
