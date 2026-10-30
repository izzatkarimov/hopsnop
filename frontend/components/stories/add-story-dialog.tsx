"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Notice } from "@/components/ui/notice";
import { TextAreaField } from "@/components/ui/text-field";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import type { ApiError } from "@/lib/api";
import { countCharacters } from "@/lib/posts";
import { PICTURE_TYPES, validatePictureFile } from "@/lib/profile-validation";
import {
  STORY_CAPTION_MAX_LENGTH,
  createStory,
  validateStoryCaption,
} from "@/lib/stories";
import type { Story } from "@/lib/types";

type Choice = { file: File; previewUrl: string };

function pictureErrorFrom(error: ApiError): string {
  if (error.status === 413) return "The file is too large.";
  if (error.kind === "forbidden") {
    return "Verify your email address before adding a story.";
  }
  // 422: not a picture the backend can use. Its own words.
  return error.fieldErrors.image ?? error.message;
}

type AddStoryDialogProps = {
  onPublished: (story: Story) => void;
  onClose: () => void;
};

export function AddStoryDialog({ onPublished, onClose }: AddStoryDialogProps) {
  const { expireSession } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [caption, setCaption] = useState("");
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<{ message: string; retry: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref, so a second submit is stopped before React renders the first.
  const inFlight = useRef(false);
  // Disabled while sending; takes focus once enabled again.
  const focusPictureNext = useRef(false);
  const titleId = useId();
  const inputId = useId();
  const pictureMessageId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    fileInputRef.current?.focus();
  }, []);

  // Given back when replaced, published or closed.
  const previewUrl = choice?.previewUrl ?? null;
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (submitting || !focusPictureNext.current) return;
    focusPictureNext.current = false;
    fileInputRef.current?.focus();
  }, [submitting]);

  function requestClose() {
    if (!inFlight.current) onClose();
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared, so choosing the same file again is a change.
    event.target.value = "";
    if (!file) return;

    const problem = validatePictureFile(file);
    setPictureError(problem);
    setFormError(null);
    if (!problem) setChoice({ file, previewUrl: URL.createObjectURL(file) });
  }

  function focusCaption(form: HTMLFormElement) {
    const field = form.elements.namedItem("caption");
    if (field instanceof HTMLElement) field.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !choice) return;

    // event.currentTarget is cleared after an await.
    const form = event.currentTarget;
    const problem = validateStoryCaption(caption);
    setCaptionError(problem);
    if (problem) {
      focusCaption(form);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setFormError(null);
    setPictureError(null);
    try {
      onPublished(await createStory(choice.file, caption));
    } catch (error) {
      if (isApiError(error) && error.kind === "unauthenticated") {
        expireSession();
      } else if (
        isApiError(error) &&
        error.kind === "validation" &&
        error.fieldErrors.caption
      ) {
        setCaptionError(error.fieldErrors.caption);
        focusCaption(form);
      } else if (
        isApiError(error) &&
        (error.kind === "validation" || error.kind === "forbidden" || error.status === 413)
      ) {
        setPictureError(pictureErrorFrom(error));
        focusPictureNext.current = true;
      } else {
        setFormError({
          message: unexpectedErrorMessage(error),
          retry: isApiError(error) && error.kind === "network",
        });
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onKeyDown={(event: KeyboardEvent<HTMLDialogElement>) => {
        if (event.key !== "Escape") return;
        // Handled here so it works the same in every browser.
        event.preventDefault();
        requestClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-background p-0 text-foreground backdrop:bg-black/60"
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
        <h2 id={titleId} className="text-lg font-semibold">
          Add a story
        </h2>

        {formError && (
          <Notice tone="error">
            {formError.message}
            {formError.retry && (
              <button type="submit" className="ml-2 font-semibold underline">
                Try again
              </button>
            )}
          </Notice>
        )}

        <div>
          <div className="flex aspect-3/4 max-h-[45dvh] w-full items-center justify-center overflow-hidden rounded-xl bg-hover">
            {previewUrl ? (
              // A blob: address of the file just chosen, on this device.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Preview of the chosen picture"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-sm text-muted">No picture chosen</span>
            )}
          </div>
          <div className="mt-3">
            <input
              ref={fileInputRef}
              id={inputId}
              type="file"
              accept={PICTURE_TYPES.join(",")}
              onChange={handleFile}
              disabled={submitting}
              aria-invalid={pictureError ? true : undefined}
              aria-describedby={pictureMessageId}
              className="peer sr-only"
            />
            <label
              htmlFor={inputId}
              className="inline-block cursor-pointer rounded-full border border-border px-4 py-1.5 text-body font-semibold transition-colors hover:bg-hover peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
            >
              {choice ? "Change picture" : "Choose picture"}
            </label>
          </div>
          <p
            id={pictureMessageId}
            className={`mt-2 text-sm ${pictureError ? "text-danger" : "text-muted"}`}
          >
            {pictureError ??
              "JPEG, PNG or WebP, up to 10 MB. Location, camera and other details in the file are removed."}
          </p>
        </div>

        <TextAreaField
          label="Caption"
          name="caption"
          rows={2}
          value={caption}
          onChange={(event) => {
            setCaption(event.target.value);
            setCaptionError(null);
          }}
          readOnly={submitting}
          hint={`${countCharacters(caption.trim())} / ${STORY_CAPTION_MAX_LENGTH}`}
          error={captionError}
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            className="rounded-full border border-border px-5 py-1.5 text-body font-semibold transition-colors hover:bg-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!choice || submitting}
            className="rounded-full bg-accent px-5 py-1.5 text-body font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent"
          >
            {submitting ? "Publishing…" : "Publish"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
