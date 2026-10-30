"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { checkPostContent } from "@/lib/posts";
import type { Post } from "@/lib/types";
import type { EditResult } from "./use-post-actions";

const COUNTER_THRESHOLD = 20;

type PostEditorProps = {
  post: Post;
  onSave: (content: string) => Promise<EditResult>;
  onClose: () => void;
};

/** The post shows what was published until the backend accepts the new text. */
export function PostEditor({ post, onSave, onClose }: PostEditorProps) {
  const [text, setText] = useState(post.content);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A ref: `saving` only changes on the next render.
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
