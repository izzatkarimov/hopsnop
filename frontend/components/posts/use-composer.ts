"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { checkPostContent } from "@/lib/posts";

/** The remaining count shows from here on, as the limit nears. */
export const COUNTER_THRESHOLD = 20;

export function publishErrorMessage(error: unknown): string {
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

type ComposerOptions = {
  onSubmit: (content: string) => Promise<void>;
  /** Said once the backend has the text. */
  published: string;
};

/** Text, checks and sending, shared by the new post dialog and the reply box. */
export function useComposer({ onSubmit, published }: ComposerOptions) {
  const { expireSession } = useAuth();
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref: `submitting` only changes on the next render, too late for a second submit.
  const inFlight = useRef(false);
  const check = checkPostContent(text);

  function change(value: string) {
    setText(value);
    setStatus("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check.isValid || inFlight.current) return;

    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setStatus("");
    try {
      await onSubmit(check.content);
      // Only now: the text is kept until the backend has the post.
      setText("");
      setStatus(published);
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

  return {
    text,
    change,
    check,
    showCounter: check.remaining <= COUNTER_THRESHOLD,
    status,
    error: error ?? (check.hasNullCharacter ? "This text contains a character that can't be posted." : null),
    submitting,
    handleSubmit,
    handleKeyDown,
  };
}

/** Grows the textarea with its text, up to its CSS max-height. */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [ref, value]);
}
