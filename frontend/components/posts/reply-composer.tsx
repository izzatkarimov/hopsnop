"use client";

import { useId, useRef } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/types";
import { CharacterCount } from "./character-count";
import { useAutosize, useComposer } from "./use-composer";

type ReplyComposerProps = {
  viewer: User;
  onSubmit: (content: string) => Promise<void>;
};

/** Inline on a post's page, with the same limits as a new post. */
export function ReplyComposer({ viewer, onSubmit }: ReplyComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const counterId = useId();
  const errorId = useId();
  const composer = useComposer({ onSubmit, published: "Your reply was published." });
  const { remaining, isOverLimit, hasNullCharacter, isValid } = composer.check;
  useAutosize(textareaRef, composer.text);

  const describedBy = [composer.showCounter && counterId, composer.error && errorId]
    .filter(Boolean)
    .join(" ");

  return (
    <form onSubmit={composer.handleSubmit} className="flex flex-col gap-2 py-3 pr-3 pl-4">
      <div className="flex items-start gap-3">
        <Avatar user={viewer} size="compact" />
        <label htmlFor={inputId} className="sr-only">
          Write a reply
        </label>
        <textarea
          ref={textareaRef}
          id={inputId}
          value={composer.text}
          onChange={(event) => composer.change(event.target.value)}
          onKeyDown={composer.handleKeyDown}
          placeholder="Post your reply"
          rows={1}
          // Not disabled, which would take the focus away.
          readOnly={composer.submitting}
          aria-describedby={describedBy || undefined}
          aria-invalid={isOverLimit || hasNullCharacter || undefined}
          className="block max-h-80 min-h-8 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1 text-body text-primary outline-hidden placeholder:text-muted"
        />
        <div className="flex shrink-0 items-center gap-3">
          <CharacterCount id={counterId} remaining={remaining} />
          <Button type="submit" variant="primary" disabled={!isValid || composer.submitting}>
            {composer.submitting ? "Replying…" : "Reply"}
          </Button>
        </div>
      </div>

      {composer.error && (
        <p id={errorId} role="alert" className="pl-11 text-meta font-medium text-danger">
          {composer.error}
        </p>
      )}
      <p role="status" className="sr-only">
        {composer.status}
      </p>
    </form>
  );
}
