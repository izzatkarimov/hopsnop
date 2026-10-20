"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PasswordField } from "@/components/auth/password-field";
import { Notice } from "@/components/ui/notice";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { deleteAccount, isWrongCurrentPasswordError } from "@/lib/auth";

/** The fields, in the order they appear. */
const FIELDS = ["deletePassword", "confirmDeletion"] as const;

type FieldName = (typeof FIELDS)[number];
type FieldErrors = Partial<Record<FieldName, string>>;

/** Moves focus to the first field with an error. False if there is none. */
function focusFirstInvalid(form: HTMLFormElement, errors: FieldErrors): boolean {
  const field = FIELDS.find((name) => errors[name]);
  if (!field) return false;

  const control = form.elements.namedItem(field);
  if (control instanceof HTMLElement) control.focus();
  return true;
}

const dangerButtonClass =
  "rounded-full border border-danger/40 px-5 py-1.5 text-body font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Deletes the signed-in user's account. What it says happens is what the
 * backend does (app/services/erasure.py): the account goes at once and for
 * good, and nothing is kept from which it could be restored.
 *
 * Asking for it takes three deliberate steps: opening the form, giving the
 * password, which the backend requires, and confirming in so many words
 * that the deletion is permanent.
 */
export function DeleteAccountSection() {
  const { expireSession } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Guards against asking twice. A ref, because it changes at once:
  // `submitting` only changes when React next renders.
  const inFlight = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Whether the button that opens the form gets focus back when it closes.
  const returnFocus = useRef(false);
  const headingId = useId();
  const confirmId = useId();
  const confirmMessageId = useId();

  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    triggerRef.current?.focus();
  }, [open]);

  function closeForm() {
    setOpen(false);
    setPassword("");
    setUnderstood(false);
    setErrors({});
    setFormError(null);
    returnFocus.current = true;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // Kept in a variable: event.currentTarget is cleared after an await.
    const form = event.currentTarget;
    const found: FieldErrors = {};
    if (password === "") found.deletePassword = "Enter your password.";
    if (!understood) {
      found.confirmDeletion =
        "Confirm that you understand your account will be deleted for good.";
    }
    setErrors(found);
    setFormError(null);
    if (focusFirstInvalid(form, found)) return;

    inFlight.current = true;
    setSubmitting(true);
    try {
      // Sent exactly as typed.
      await deleteAccount(password);
    } catch (error) {
      inFlight.current = false;
      setSubmitting(false);
      if (isApiError(error) && error.kind === "unauthenticated") {
        // The session ended meanwhile. RequireAuth leads to the login page.
        expireSession();
        return;
      }
      const rejected: FieldErrors = isWrongCurrentPasswordError(error)
        ? { deletePassword: "Your password is incorrect." }
        : isApiError(error) && error.kind === "validation" && error.fieldErrors.password
          ? { deletePassword: error.fieldErrors.password }
          : {};
      setErrors(rejected);
      if (!focusFirstInvalid(form, rejected)) {
        setFormError(unexpectedErrorMessage(error));
      }
      return;
    }

    // The account is gone, and with it every session; the backend has
    // cleared this browser's cookie as well. The page lets go of the user
    // too, and RequireAuth leads to the login page. Until then the form
    // stays disabled.
    setPassword("");
    expireSession();
  }

  return (
    <section aria-labelledby={headingId} className="border-b border-border">
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-lg font-semibold text-danger">
            Delete account
          </h2>
          <p className="text-body text-muted">
            Deleting your account is immediate and permanent. It can&apos;t be
            undone, and nothing is kept from which it could be restored.
          </p>
        </div>
        <ul className="list-disc pl-5 text-body text-muted">
          <li>
            Your profile, posts, replies, stories, likes, reposts and follows
            are deleted.
          </li>
          <li>
            If others replied to one of your posts, their replies stay, and
            your post is replaced by an empty placeholder without your name
            or text.
          </li>
          <li>You&apos;re signed out on every device.</li>
          <li>
            Your username and email address become available to others right
            away.
          </li>
        </ul>
        <p className="text-body text-muted">
          If you want a copy of your data, download it first.
        </p>

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
            aria-label="Confirm account deletion"
            className="flex flex-col gap-4 rounded-lg border border-danger/40 p-3"
          >
            {formError && <Notice tone="error">{formError}</Notice>}

            <PasswordField
              label="Password"
              name="deletePassword"
              hint="Enter your password to confirm it's you."
              value={password}
              error={errors.deletePassword}
              onChange={(event) => {
                setPassword(event.target.value);
                // The message no longer describes what is in the field.
                setErrors((current) => ({ ...current, deletePassword: undefined }));
              }}
              autoComplete="current-password"
              autoFocus
              required
            />

            <div>
              <div className="flex items-start gap-2">
                <input
                  id={confirmId}
                  name="confirmDeletion"
                  type="checkbox"
                  checked={understood}
                  onChange={(event) => {
                    setUnderstood(event.target.checked);
                    setErrors((current) => ({
                      ...current,
                      confirmDeletion: undefined,
                    }));
                  }}
                  aria-invalid={errors.confirmDeletion ? true : undefined}
                  aria-describedby={
                    errors.confirmDeletion ? confirmMessageId : undefined
                  }
                  className="mt-0.5 size-4 shrink-0 accent-danger"
                />
                <label htmlFor={confirmId} className="text-sm">
                  I understand that my account and everything in it will be
                  deleted permanently.
                </label>
              </div>
              {errors.confirmDeletion && (
                <p id={confirmMessageId} className="mt-1 text-sm text-danger">
                  {errors.confirmDeletion}
                </p>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeForm}
                disabled={submitting}
                className="rounded-full border border-border px-5 py-1.5 text-body font-semibold transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={dangerButtonClass}
              >
                {submitting ? "Deleting account…" : "Delete account permanently"}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setOpen(true)}
              className={dangerButtonClass}
            >
              Delete account
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
