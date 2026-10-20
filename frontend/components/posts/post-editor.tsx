"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { checkPostContent } from "@/lib/posts";
import type { Post } from "@/lib/types";
import type { EditResult } from "./use-post-actions";

/** Show the remaining-characters counter once the user gets this close. */
const COUNTER_THRESHOLD = 20;

type PostEditorProps = {
  post: Post;
  /** Saves the text. Resolves with how that ended; never rejects. */
  onSave: (content: string) => Promise<EditResult>;
  /** Called when editing is over: saved, cancelled, or no longer possible. */
  onClose: () => void;
};

/**
 * Edits the text of a post in place of that text. The post itself is not
 * changed by typing here: it shows what was published until the backend has
 * accepted the new text.
 */
export function PostEditor({ post, onSave, onClose }: PostEditorProps) {
  const [text, setText] = useState(post.content);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Guards against saving twice. A ref, because it changes at once:
  // `saving` only changes when React next renders.
  const inFlight = useRef(false);
  const inputId = useId();
  const counterId = useId();

  const { content, remaining, isOverLimit, hasNullCharacter, isValid } =
    checkPostContent(text);
  const showCounter = remaining <= COUNTER_THRESHOLD;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid || inFlight.current) return;
    if (content === post.content) {
      // Nothing to save.
      onClose();
      return;
    }

    inFlight.current = true;
    setSaving(true);
    setError(null);
    const result = await onSave(content);
    inFlight.current = false;
    if (result.saved || result.close) {
      onClose();
      return;
    }
    // The text typed here is kept, and so is the published one.
    setSaving(false);
    setError(result.message);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && !saving) {
      event.preventDefault();
      onClose();
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Edit post" className="mt-1 pb-2">
      <label htmlFor={inputId} className="sr-only">
        Post text
      </label>
      <textarea
        id={inputId}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          // The message no longer describes what is in the field.
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        rows={2}
        autoFocus
        readOnly={saving}
        aria-describedby={showCounter ? counterId : undefined}
        aria-invalid={isOverLimit || hasNullCharacter || undefined}
        className="field-sizing-content block max-h-80 min-h-16 w-full resize-none rounded-lg border border-border bg-transparent px-3 py-2 text-body leading-relaxed focus:border-accent focus:outline-none"
      />

      <div className="mt-2 flex items-center justify-end gap-2">
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
          type="button"
          onClick={onClose}
          disabled={saving}
          className="shrink-0 rounded-full border border-border px-4 py-1 text-sm font-semibold transition-colors hover:bg-hover disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!isValid || saving}
          className="shrink-0 rounded-full bg-accent px-4 py-1 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
