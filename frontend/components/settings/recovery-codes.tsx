"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { saveFile } from "@/lib/save-file";
import { CopyButton } from "./copy-button";
import { outlineButtonClass, primaryButtonClass, stepHeadingClass } from "./styles";

export const RECOVERY_CODES_FILENAME = "hopsnop-recovery-codes.txt";

type RecoveryCodesProps = {
  codes: string[];
  /** The codes go with this screen; the backend keeps only their hashes. */
  onClose: () => void;
};

export function RecoveryCodes({ codes, onClose }: RecoveryCodesProps) {
  const auth = useAuth();
  const [saved, setSaved] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const savedId = useId();
  const savedMessageId = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function download() {
    const text = [
      auth.status === "authenticated"
        ? `Hopsnop recovery codes for @${auth.user.username}`
        : "Hopsnop recovery codes",
      "",
      "Each code works once, in place of a code from your authenticator app.",
      "",
      ...codes,
      "",
    ].join("\n");
    // Made here and saved straight to disk; nothing is sent anywhere.
    saveFile(new Blob([text], { type: "text/plain;charset=utf-8" }), RECOVERY_CODES_FILENAME);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saved) {
      setSavedError("Confirm that you've saved your recovery codes.");
      document.getElementById(savedId)?.focus();
      return;
    }
    onClose();
  }

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      <h3
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className={stepHeadingClass}
      >
        Save your recovery codes
      </h3>
      <p className="text-body text-muted">
        If you can&apos;t use your authenticator app, each of these codes lets
        you log in once instead. Keep them somewhere safe, away from your
        phone. They&apos;re shown only this once.
      </p>

      {/* translate="no": page translation would send them to a third party. */}
      <ul
        translate="no"
        aria-label="Recovery codes"
        className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg bg-hover px-3 py-2 font-mono text-body sm:grid-cols-2"
      >
        {codes.map((code, index) => (
          <li key={index}>{code}</li>
        ))}
      </ul>

      <div className="flex flex-wrap items-start gap-2">
        <CopyButton
          text={codes.join("\n")}
          label="Copy all"
          className={outlineButtonClass}
        />
        <button type="button" onClick={download} className={outlineButtonClass}>
          Download as a text file
        </button>
      </div>

      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <div className="flex items-start gap-2">
            <input
              id={savedId}
              type="checkbox"
              checked={saved}
              onChange={(event) => {
                setSaved(event.target.checked);
                setSavedError(null);
              }}
              aria-invalid={savedError ? true : undefined}
              aria-describedby={savedError ? savedMessageId : undefined}
              className="mt-0.5 size-4 shrink-0 accent-accent"
            />
            <label htmlFor={savedId} className="text-sm">
              I&apos;ve saved these codes
            </label>
          </div>
          {savedError && (
            <p id={savedMessageId} className="mt-1 text-sm text-danger">
              {savedError}
            </p>
          )}
        </div>
        <div className="flex justify-end">
          <button type="submit" className={primaryButtonClass}>
            Done
          </button>
        </div>
      </form>
    </div>
  );
}
