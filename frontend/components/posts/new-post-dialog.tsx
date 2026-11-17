"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { createPost } from "@/lib/posts";
import type { Post, User } from "@/lib/types";
import { CharacterCount } from "./character-count";
import { useAutosize, useComposer } from "./use-composer";

type NewPostDialogProps = {
  viewer: User;
  onClose: () => void;
  onPublished: (post: Post) => void;
};

export function NewPostDialog({ viewer, onClose, onPublished }: NewPostDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  // Unsent text is never thrown away without asking.
  const [confirming, setConfirming] = useState(false);
  const focusText = useRef(false);
  const formId = useId();
  const inputId = useId();
  const counterId = useId();
  const errorId = useId();
  const confirmId = useId();

  const composer = useComposer({
    onSubmit: async (content) => onPublished(await createPost(content)),
    published: "Your post was published.",
  });
  const { remaining, isOverLimit, hasNullCharacter, isValid } = composer.check;
  useAutosize(textareaRef, composer.text);

  useEffect(() => {
    if (confirming) {
      keepEditingRef.current?.focus();
    } else if (focusText.current) {
      focusText.current = false;
      textareaRef.current?.focus();
    }
  }, [confirming]);

  function keepEditing() {
    focusText.current = true;
    setConfirming(false);
  }

  function requestClose() {
    if (confirming) keepEditing();
    else if (composer.text.trim() === "") onClose();
    else setConfirming(true);
  }

  const describedBy = [composer.showCounter && counterId, composer.error && errorId]
    .filter(Boolean)
    .join(" ");

  return (
    <Dialog
      title="New post"
      onClose={requestClose}
      dismissible={!composer.submitting}
      initialFocus={textareaRef}
      size="lg"
      footer={
        !confirming && (
          <>
            <CharacterCount id={counterId} remaining={remaining} />
            <Button
              type="submit"
              form={formId}
              variant="primary"
              disabled={!isValid || composer.submitting}
            >
              {composer.submitting ? "Posting…" : "Post"}
            </Button>
          </>
        )
      }
    >
      {confirming && (
        <div role="group" aria-labelledby={confirmId} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p id={confirmId} className="text-body font-semibold text-primary">
              Discard this post?
            </p>
            <p className="text-body text-secondary">What you wrote will be lost.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button ref={keepEditingRef} onClick={keepEditing}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={onClose}>
              Discard
            </Button>
          </div>
        </div>
      )}

      <form
        id={formId}
        hidden={confirming}
        noValidate
        onSubmit={composer.handleSubmit}
        className="flex gap-3"
      >
        <Avatar user={viewer} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p aria-hidden="true" className="truncate text-body font-semibold text-primary">
            {viewer.displayName}
          </p>
          <label htmlFor={inputId} className="sr-only">
            Write a post
          </label>
          <textarea
            ref={textareaRef}
            id={inputId}
            value={composer.text}
            onChange={(event) => composer.change(event.target.value)}
            onKeyDown={composer.handleKeyDown}
            placeholder="What's on your mind?"
            rows={3}
            // Not disabled, which would take the focus away.
            readOnly={composer.submitting}
            aria-describedby={describedBy || undefined}
            aria-invalid={isOverLimit || hasNullCharacter || undefined}
            className="block max-h-80 min-h-18 w-full resize-none overflow-y-auto bg-transparent text-body text-primary outline-hidden placeholder:text-muted"
          />
          {composer.error && (
            <p id={errorId} role="alert" className="text-meta font-medium text-danger">
              {composer.error}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}
