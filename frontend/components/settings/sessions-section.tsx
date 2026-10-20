"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { formatFullDate } from "@/lib/format";
import {
  listSessions,
  revokeOtherSessions,
  revokeSession,
} from "@/lib/sessions";
import type { Session } from "@/lib/types";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sessions: Session[] };

/** What a pending request or an open confirmation is about. */
const OTHERS = "others";

const outlineButtonClass =
  "shrink-0 rounded-full border border-border px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The signed-in user's active sessions, with ways to end one of them or all
 * but the current one. The list is page data, loaded from GET
 * /auth/sessions; what it shows after a change is what the backend answers.
 *
 * The backend knows only when a session started, was last used and
 * expires, so that is all a session is shown with.
 */
export function SessionsSection() {
  const { expireSession } = useAuth();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // The session id, or OTHERS, whose request is on its way.
  const [pending, setPending] = useState<string | null>(null);
  // "current" or OTHERS while the user is asked to confirm.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: "error" | "info";
    text: string;
  } | null>(null);
  // Guards against sending a request while another is on its way. A ref,
  // because it changes at once: `pending` only changes when React next
  // renders.
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Where focus goes after the next render. A control that is no longer
  // there sends it to the heading, so that it is not lost.
  const focusNext = useRef<string | null>(null);
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const othersButtonId = `${baseId}-others`;
  const revokeButtonId = (session: Session) => `${baseId}-revoke-${session.id}`;

  useEffect(() => {
    // Set by the cleanup, so that a request this effect no longer cares
    // about (the page was left, or a newer load started) cannot change the
    // state.
    let ignore = false;

    listSessions().then(
      (sessions) => {
        if (!ignore) setState({ status: "ready", sessions });
      },
      (error: unknown) => {
        if (ignore) return;
        if (isApiError(error) && error.kind === "unauthenticated") {
          // The session is gone. RequireAuth leads to the login page.
          expireSession();
          return;
        }
        // A failed refresh after a change keeps the list that is shown: it
        // already leaves out what was signed out.
        setState((current) =>
          current.status === "ready"
            ? current
            : { status: "error", message: unexpectedErrorMessage(error) },
        );
      },
    );

    return () => {
      ignore = true;
    };
  }, [attempt, expireSession]);

  useEffect(() => {
    if (focusNext.current === null) return;
    const target =
      document.getElementById(focusNext.current) ?? headingRef.current;
    focusNext.current = null;
    target?.focus();
  });

  function retry() {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }

  /** Loads the list again while the one shown stays in place. */
  function refresh() {
    setAttempt((current) => current + 1);
  }

  function keepSessions(keep: (session: Session) => boolean) {
    setState((current) =>
      current.status === "ready"
        ? { status: "ready", sessions: current.sessions.filter(keep) }
        : current,
    );
  }

  function askToConfirm(what: string) {
    setNotice(null);
    setConfirming(what);
  }

  function cancelConfirmation(returnFocusTo: string) {
    setConfirming(null);
    focusNext.current = returnFocusTo;
  }

  async function signOutSession(session: Session) {
    if (inFlight.current) return;

    inFlight.current = true;
    setPending(session.id);
    setNotice(null);
    try {
      await revokeSession(session.id);
      if (session.isCurrent) {
        // The backend has cleared the cookie, so this browser is signed out.
        // RequireAuth leads to the login page.
        expireSession();
        return;
      }
      keepSessions((other) => other.id !== session.id);
      setNotice({ tone: "info", text: "The session was signed out." });
      refresh();
    } catch (error) {
      if (isApiError(error) && error.kind === "unauthenticated") {
        expireSession();
        return;
      }
      if (isApiError(error) && error.kind === "not_found") {
        // It had already ended, which is what was asked for.
        keepSessions((other) => other.id !== session.id);
        setNotice({ tone: "info", text: "That session had already ended." });
        refresh();
      } else {
        setNotice({ tone: "error", text: unexpectedErrorMessage(error) });
      }
    } finally {
      inFlight.current = false;
      setPending(null);
      setConfirming(null);
      focusNext.current = revokeButtonId(session);
    }
  }

  async function signOutOthers() {
    if (inFlight.current) return;

    inFlight.current = true;
    setPending(OTHERS);
    setNotice(null);
    try {
      const count = await revokeOtherSessions();
      keepSessions((session) => session.isCurrent);
      setNotice({
        tone: "info",
        text:
          count === 0
            ? "There were no other sessions to sign out."
            : `Signed out of ${count} other ${count === 1 ? "session" : "sessions"}.`,
      });
      refresh();
    } catch (error) {
      if (isApiError(error) && error.kind === "unauthenticated") {
        expireSession();
        return;
      }
      setNotice({ tone: "error", text: unexpectedErrorMessage(error) });
    } finally {
      inFlight.current = false;
      setPending(null);
      setConfirming(null);
      focusNext.current = othersButtonId;
    }
  }

  let content;
  if (state.status === "loading") {
    content = (
      <div role="status">
        <span className="sr-only">Loading sessions…</span>
        <SessionSkeleton />
        <SessionSkeleton />
      </div>
    );
  } else if (state.status === "error") {
    content = (
      <div role="alert">
        <EmptyState
          title="Couldn't load your sessions"
          description={state.message}
          action={
            <button
              type="button"
              onClick={retry}
              className="rounded-full bg-accent px-5 py-2 font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              Try again
            </button>
          }
        />
      </div>
    );
  } else if (state.sessions.length === 0) {
    content = (
      <EmptyState
        title="No active sessions"
        description="Sessions appear here when you sign in."
      />
    );
  } else {
    // The current session first; the others as the backend orders them,
    // most recently used first.
    const sessions = [...state.sessions].sort(
      (a, b) => Number(b.isCurrent) - Number(a.isCurrent),
    );
    const hasOthers = sessions.some((session) => !session.isCurrent);

    content = (
      <>
        <ul>
          {sessions.map((session, index) => (
            <SessionRow
              key={session.id}
              session={session}
              // Among the other sessions; the current one is always first.
              position={sessions[0].isCurrent ? index : index + 1}
              buttonId={revokeButtonId(session)}
              disabled={pending !== null}
              pending={pending === session.id}
              confirming={session.isCurrent && confirming === "current"}
              onSignOut={() =>
                session.isCurrent
                  ? askToConfirm("current")
                  : signOutSession(session)
              }
              onConfirm={() => signOutSession(session)}
              onCancel={() => cancelConfirmation(revokeButtonId(session))}
            />
          ))}
        </ul>

        <div className="border-t border-border px-4 py-3">
          {!hasOthers ? (
            <p className="text-sm text-muted">
              You aren&apos;t signed in anywhere else.
            </p>
          ) : confirming === OTHERS ? (
            <Confirmation
              question="Sign out of every other session? Each of them will have to log in again."
              confirmLabel="Sign out others"
              pending={pending === OTHERS}
              onConfirm={signOutOthers}
              onCancel={() => cancelConfirmation(othersButtonId)}
            />
          ) : (
            <button
              id={othersButtonId}
              type="button"
              onClick={() => askToConfirm(OTHERS)}
              disabled={pending !== null}
              className={outlineButtonClass}
            >
              Sign out other sessions
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="border-b border-border">
      <div className="flex flex-col gap-1 px-4 pt-4 pb-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-semibold"
        >
          Sessions
        </h2>
        <p className="text-body text-muted">
          Where you&apos;re signed in to Hopsnop. Signing out a session ends
          it at once.
        </p>
      </div>

      {notice && (
        <div className="px-4 pb-3">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      )}

      {content}
    </section>
  );
}

type SessionRowProps = {
  session: Session;
  /** 1-based place among the other sessions, for the button's name. */
  position: number;
  buttonId: string;
  /** While any session request is on its way. */
  disabled: boolean;
  /** While this session is being signed out. */
  pending: boolean;
  confirming: boolean;
  onSignOut: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

function SessionRow({
  session,
  position,
  buttonId,
  disabled,
  pending,
  confirming,
  onSignOut,
  onConfirm,
  onCancel,
}: SessionRowProps) {
  return (
    <li className="flex flex-col gap-3 border-t border-border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-body font-semibold">
            {session.isCurrent ? "Current session" : "Other session"}
            {session.isCurrent && (
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                This browser
              </span>
            )}
          </p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            <SessionDate label="Signed in" iso={session.createdAt} />
            <SessionDate label="Last active" iso={session.lastUsedAt} />
            <SessionDate label="Expires" iso={session.expiresAt} />
          </dl>
        </div>

        {!confirming && (
          <button
            id={buttonId}
            type="button"
            onClick={onSignOut}
            disabled={disabled}
            // Every row has the same button, so its name says which session
            // it is for. It starts with the visible text. The position keeps
            // names apart for sessions that started in the same minute.
            aria-label={`${pending ? "Signing out" : "Sign out"} ${
              session.isCurrent
                ? "this browser"
                : `other session ${position}, signed in ${formatFullDate(session.createdAt)}`
            }`}
            className={outlineButtonClass}
          >
            {pending ? "Signing out…" : "Sign out"}
          </button>
        )}
      </div>

      {confirming && (
        <Confirmation
          question="Sign out of this browser? You'll have to log in again."
          confirmLabel="Sign out"
          pending={pending}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )}
    </li>
  );
}

function SessionDate({ label, iso }: { label: string; iso: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd>
        <time dateTime={iso}>{formatFullDate(iso)}</time>
      </dd>
    </>
  );
}

type ConfirmationProps = {
  question: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Asks before a sign-out, in place. Cancel has focus first, so that Enter
 * does not sign anything out by accident; Escape cancels too.
 */
function Confirmation({
  question,
  confirmLabel,
  pending,
  onConfirm,
  onCancel,
}: ConfirmationProps) {
  const questionId = useId();

  return (
    <div
      role="group"
      aria-labelledby={questionId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) onCancel();
      }}
      className="flex flex-wrap items-center justify-end gap-2"
    >
      <p id={questionId} className="mr-auto text-sm">
        {question}
      </p>
      <button
        type="button"
        autoFocus
        onClick={onCancel}
        disabled={pending}
        className="rounded-full border border-border px-4 py-1 text-sm font-semibold transition-colors hover:bg-hover disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className="rounded-full border border-danger/40 px-4 py-1 text-sm font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Signing out…" : confirmLabel}
      </button>
    </div>
  );
}

/** Placeholder shown while the sessions are loading. */
function SessionSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex animate-pulse flex-col gap-2.5 border-t border-border px-4 py-4"
    >
      <div className="h-3 w-1/3 rounded bg-hover" />
      <div className="h-3 w-3/5 rounded bg-hover" />
      <div className="h-3 w-1/2 rounded bg-hover" />
    </div>
  );
}
