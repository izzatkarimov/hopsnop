"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PasswordField } from "@/components/auth/password-field";
import { Notice } from "@/components/ui/notice";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { isWrongCurrentPasswordError } from "@/lib/auth";
import { downloadAccountExport } from "@/lib/export";
import type { AccountExportFile } from "@/lib/export";

const PASSWORD_FIELD = "exportPassword";

/**
 * What the file holds, as the backend puts it together
 * (app/services/export.py). Keep in step with it.
 */
const CONTENTS = [
  "Your account details, including your email address and your profile picture",
  "Your posts and replies",
  "Your likes and reposts",
  "The accounts you follow and the accounts that follow you",
  "Your stories and their pictures, with how many people viewed each, and the stories you viewed",
  "When you signed in, and when verification and password reset emails were requested",
];

const outlineButtonClass =
  "rounded-full border border-border px-5 py-1.5 text-body font-semibold transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Hands the browser a file to save. The object URL is let go of once the
 * browser has had time to start the download, which keeps its own copy.
 */
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Downloads everything Hopsnop holds that is the signed-in user's own, as
 * one ZIP file. The backend asks for the password again before it hands
 * out an account's data, so the user is asked for it first.
 *
 * The password is only held in this form's state while it is typed, and the
 * export only in memory until the browser has taken it.
 */
export function ExportSection() {
  const { expireSession } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // The name of the file handed to the browser, once there is one.
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Guards against asking twice. A ref, because it changes at once:
  // `submitting` only changes when React next renders.
  const inFlight = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Whether the button that opens the form gets focus back when it closes.
  const returnFocus = useRef(false);
  const headingId = useId();

  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    triggerRef.current?.focus();
  }, [open]);

  function openForm() {
    setSavedAs(null);
    setOpen(true);
  }

  function closeForm() {
    setOpen(false);
    setPassword("");
    setPasswordError(null);
    setFormError(null);
    returnFocus.current = true;
  }

  function showPasswordError(form: HTMLFormElement, message: string) {
    setPasswordError(message);
    const input = form.elements.namedItem(PASSWORD_FIELD);
    if (input instanceof HTMLElement) input.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // Kept in a variable: event.currentTarget is cleared after an await.
    const form = event.currentTarget;
    setFormError(null);
    if (password === "") {
      showPasswordError(form, "Enter your password.");
      return;
    }
    setPasswordError(null);

    inFlight.current = true;
    setSubmitting(true);
    let file: AccountExportFile;
    try {
      // Sent exactly as typed.
      file = await downloadAccountExport(password);
    } catch (error) {
      inFlight.current = false;
      setSubmitting(false);
      if (isApiError(error) && error.kind === "unauthenticated") {
        // The session ended meanwhile. RequireAuth leads to the login page.
        expireSession();
        return;
      }
      if (isWrongCurrentPasswordError(error)) {
        showPasswordError(form, "Your password is incorrect.");
        return;
      }
      const rejected =
        isApiError(error) && error.kind === "validation"
          ? error.fieldErrors.password
          : undefined;
      if (rejected) {
        showPasswordError(form, rejected);
        return;
      }
      setFormError(unexpectedErrorMessage(error));
      return;
    }

    saveFile(file.blob, file.filename);
    inFlight.current = false;
    setSubmitting(false);
    setSavedAs(file.filename);
    closeForm();
  }

  return (
    <section aria-labelledby={headingId} className="border-b border-border">
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-lg font-semibold">
            Download your data
          </h2>
          <p className="text-body text-muted">
            A copy of what Hopsnop holds that is yours, as a ZIP file with
            your data in JSON and your pictures. It includes:
          </p>
        </div>
        <ul className="list-disc pl-5 text-body text-muted">
          {CONTENTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-body text-muted">
          It doesn&apos;t include your password, anything that would let
          someone sign in as you, or posts you&apos;ve deleted.
        </p>

        {savedAs && (
          <Notice tone="info">Your download has started: {savedAs}</Notice>
        )}

        {open ? (
          // method="post" matters if the form is submitted before the page's
          // JavaScript has loaded: the browser's default (GET) would put the
          // password into the URL.
          <form
            method="post"
            noValidate
            onSubmit={handleSubmit}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !submitting) closeForm();
            }}
            className="flex flex-col gap-3"
          >
            {formError && <Notice tone="error">{formError}</Notice>}
            <PasswordField
              label="Password"
              name={PASSWORD_FIELD}
              hint="Enter your password to confirm it's you."
              value={password}
              error={passwordError}
              onChange={(event) => {
                setPassword(event.target.value);
                // The message no longer describes what is in the field.
                setPasswordError(null);
              }}
              autoComplete="current-password"
              autoFocus
              required
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeForm}
                disabled={submitting}
                className={outlineButtonClass}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-accent px-5 py-1.5 text-body font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent"
              >
                {submitting ? "Preparing download…" : "Download"}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <button
              ref={triggerRef}
              type="button"
              onClick={openForm}
              className={outlineButtonClass}
            >
              Download your data
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
