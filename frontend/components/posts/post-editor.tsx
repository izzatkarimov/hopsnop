"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { checkPostContent } from "@/lib/posts";
import type { Post } from "@/lib/types";
import { CharacterCount } from "./character-count";
import { COUNTER_THRESHOLD } from "./use-composer";
import type { EditResult } from "./use-post-actions";

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
    <form onSubmit={handleSubmit} aria-label="Edit post" className="flex flex-col gap-2 pt-1">
      <label htmlFor={inputId} className="sr-only">
        Post text
      </label>
      <div className="rounded-field bg-well px-4 py-3 inset-ring inset-ring-edge/6 inset-shadow-well has-[textarea:focus-visible]:inset-ring-ink/72 has-[textarea:focus-visible]:ring-4 has-[textarea:focus-visible]:ring-accent/40">
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
          className="field-sizing-content block max-h-80 min-h-16 w-full resize-none bg-transparent text-body text-primary outline-hidden"
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {(error || hasNullCharacter) && (
          <p role="alert" className="mr-auto min-w-0 text-meta font-medium text-danger">
            {error ?? "This text contains a character that can't be posted."}
          </p>
        )}
        <CharacterCount id={counterId} remaining={remaining} />
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!isValid || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
