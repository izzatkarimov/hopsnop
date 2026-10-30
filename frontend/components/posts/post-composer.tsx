"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Avatar } from "@/components/ui/avatar";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { checkPostContent } from "@/lib/posts";
import type { User } from "@/lib/types";

const COUNTER_THRESHOLD = 20;

function publishErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.kind === "validation") {
      return (
        error.fieldErrors.content ??
        "This post wasn't accepted. Check it and try again."
      );
    }
    if (error.kind === "forbidden") {
      return "You're not allowed to post right now.";
    }
    if (error.kind === "not_found") {
      // Only a reply can get this answer: what it answers is gone.
      return "This post is no longer available, so it can't be replied to.";
    }
  }
  return unexpectedErrorMessage(error);
}

const WORDING = {
  post: {
    label: "Write a post",
    placeholder: "What's on your mind?",
    submit: "Post",
    submitting: "Posting…",
    published: "Your post was published.",
  },
  reply: {
    label: "Write a reply",
    placeholder: "Post your reply",
    submit: "Reply",
    submitting: "Replying…",
    published: "Your reply was published.",
  },
};

type PostComposerProps = {
  viewer: User;
  kind?: keyof typeof WORDING;
  onSubmit: (content: string) => Promise<void>;
};

export function PostComposer({
  viewer,
  kind = "post",
  onSubmit,
}: PostComposerProps) {
  const wording = WORDING[kind];
  const { expireSession } = useAuth();
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref: `submitting` only changes on the next render, too late for a second submit.
  const inFlight = useRef(false);
  const inputId = useId();
  const counterId = useId();

  const {
    content,
    remaining,
    isOverLimit,
    hasNullCharacter,
    isValid: canSubmit,
  } = checkPostContent(text);
  const showCounter = remaining <= COUNTER_THRESHOLD;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || inFlight.current) return;

    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setStatus("");
    try {
      await onSubmit(content);
      // Only now: the text is kept until the backend has the post.
      setText("");
      setStatus(wording.published);
    } catch (error) {
      if (isApiError(error) && error.kind === "unauthenticated") {
        // The session is gone; a public page goes on as for a signed-out visitor.
        expireSession();
        return;
      }
      setError(publishErrorMessage(error));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="group flex gap-3 border-b border-border px-4 pt-4 pb-3"
    >
      <Avatar user={viewer} />

      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="sr-only">
          {wording.label}
        </label>
        <textarea
          id={inputId}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setStatus("");
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={wording.placeholder}
          rows={2}
          // Not disabled, which would take the focus away.
          readOnly={submitting}
          aria-describedby={showCounter ? counterId : undefined}
          aria-invalid={isOverLimit || hasNullCharacter || undefined}
          className="field-sizing-content block max-h-80 min-h-16 w-full resize-none bg-transparent pt-1.5 text-lg leading-snug placeholder:text-muted focus:outline-none"
        />

        <div className="mt-2 flex items-center justify-end gap-3 border-t border-border pt-3 transition-colors group-focus-within:border-accent/50">
          {(error || hasNullCharacter) && (
            <p role="alert" className="mr-auto min-w-0 text-sm text-danger">
              {error ?? "This text contains a character that can't be posted."}
            </p>
          )}
          {showCounter && (
            <span
              id={counterId}
              aria-live="polite"
              className={`shrink-0 text-sm tabular-nums ${isOverLimit ? "font-semibold text-danger" : "text-muted"}`}
            >
              {remaining}
              <span className="sr-only"> characters remaining</span>
            </span>
          )}
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="shrink-0 rounded-full bg-accent px-5 py-1.5 text-body font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent"
          >
            {submitting ? wording.submitting : wording.submit}
          </button>
        </div>

        <p role="status" className="sr-only">
          {status}
        </p>
      </div>
    </form>
  );
}
