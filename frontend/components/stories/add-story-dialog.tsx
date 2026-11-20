"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DragEvent, FormEvent, RefObject } from "react";
import { useAuth, useCurrentUser } from "@/components/auth/auth-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextAreaField } from "@/components/ui/field";
import { IconBadge } from "@/components/ui/icon-badge";
import { IconButton } from "@/components/ui/icon-button";
import {
  IconArrowLeft,
  IconClock,
  IconImage,
  IconImageAdd,
  IconShare,
  IconShieldCheck,
} from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
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

/* Full class names are listed so Tailwind can detect them. */

// The input before it is hidden but takes the focus, so the label shows its ring.
const photoLabelClass = buttonClass(
  "secondary",
  "md",
  "cursor-pointer peer-focus-visible:inset-ring peer-focus-visible:inset-ring-ink/72 peer-focus-visible:ring-4 peer-focus-visible:ring-accent/40 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
);

type PhotoInputProps = {
  label: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
  disabled?: boolean;
  invalid: boolean;
  describedBy?: string;
};

function PhotoInput({ label, inputRef, onFile, disabled, invalid, describedBy }: PhotoInputProps) {
  const id = useId();
  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={PICTURE_TYPES.join(",")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared, so choosing the same file again is a change.
          event.target.value = "";
          if (file) onFile(file);
        }}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="peer sr-only"
      />
      <label htmlFor={id} className={photoLabelClass}>
        <IconImage />
        {label}
      </label>
    </>
  );
}

/** Both true of every story: the backend redraws the picture and keeps it for 24 hours. */
function StoryFacts() {
  return (
    <ul className="flex flex-col gap-3 text-body text-secondary">
      <li className="flex gap-3">
        <IconClock className="mt-0.5 shrink-0" />
        Stories disappear after 24 hours.
      </li>
      <li className="flex gap-3">
        <IconShieldCheck className="mt-0.5 shrink-0" />
        We remove location and camera details from your photo.
      </li>
    </ul>
  );
}

type AddStoryDialogProps = {
  onPublished: (story: Story) => void;
  onClose: () => void;
};

/** Two steps: choose a photo, then add a caption and share it. */
export function AddStoryDialog({ onPublished, onClose }: AddStoryDialogProps) {
  const { expireSession } = useAuth();
  const viewer = useCurrentUser();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [step, setStep] = useState<"photo" | "details">("photo");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [dragging, setDragging] = useState(false);
  const [caption, setCaption] = useState("");
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<{ message: string; retry: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref, so a second submit is stopped before React renders the first.
  const inFlight = useRef(false);
  const focusStep = useRef(false);
  // Disabled while sending; takes focus once enabled again.
  const focusPhotoNext = useRef(false);
  const formId = useId();
  const pictureMessageId = useId();

  // Given back when replaced, published or closed.
  const previewUrl = choice?.previewUrl ?? null;
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!focusStep.current) return;
    focusStep.current = false;
    (step === "details" ? captionRef : photoInputRef).current?.focus();
  }, [step]);

  useEffect(() => {
    if (submitting || !focusPhotoNext.current) return;
    focusPhotoNext.current = false;
    photoInputRef.current?.focus();
  }, [submitting]);

  function goTo(next: "photo" | "details") {
    focusStep.current = true;
    setPictureError(null);
    setStep(next);
  }

  function choose(file: File) {
    const problem = validatePictureFile(file);
    setPictureError(problem);
    setFormError(null);
    if (!problem) setChoice({ file, previewUrl: URL.createObjectURL(file) });
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // Without this the browser opens the file instead.
    event.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) choose(file);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !choice) return;

    const problem = validateStoryCaption(caption);
    setCaptionError(problem);
    if (problem) {
      captionRef.current?.focus();
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
        captionRef.current?.focus();
      } else if (
        isApiError(error) &&
        (error.kind === "validation" || error.kind === "forbidden" || error.status === 413)
      ) {
        setPictureError(pictureErrorFrom(error));
        focusPhotoNext.current = true;
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

  const pictureMessage = pictureError && (
    <p id={pictureMessageId} role="alert" className="text-meta font-medium text-danger">
      {pictureError}
    </p>
  );

  if (step === "photo") {
    return (
      <Dialog
        title="New story"
        onClose={onClose}
        initialFocus={photoInputRef}
        size="xl"
        footer={
          <Button variant="primary" onClick={() => goTo("details")} disabled={!choice}>
            Next
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {/* Dropping is for pointers; the button does the same for everyone. */}
          <div
            data-testid="photo-drop-zone"
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex min-h-80 flex-col items-center justify-center gap-4 rounded-tile border-[1.5px] border-dashed p-6 text-center motion-safe:transition-colors sm:min-h-90 sm:p-10 ${
              dragging ? "border-ink/72 bg-ink/8" : "border-edge/16 bg-edge/2"
            }`}
          >
            {previewUrl ? (
              // A blob: address of the file just chosen, on this device.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Preview of the chosen photo"
                className="h-40 max-w-full rounded-item bg-black object-contain"
              />
            ) : (
              <>
                <IconBadge tone="ink" icon={<IconImageAdd size={32} />} />
                <div className="hidden flex-col pointer-fine:flex">
                  <p className="text-title font-bold text-primary">Drag a photo here</p>
                  <p className="text-body text-secondary">or pick one from your computer</p>
                </div>
              </>
            )}
            <PhotoInput
              label={choice ? "Choose another photo" : "Choose photo"}
              inputRef={photoInputRef}
              onFile={choose}
              invalid={pictureError !== null}
              describedBy={pictureMessageId}
            />
            {pictureMessage || (
              <p id={pictureMessageId} className="text-meta font-medium text-muted">
                JPG, PNG or WebP, up to 10 MB
              </p>
            )}
          </div>
          <StoryFacts />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="New story"
      onClose={onClose}
      dismissible={!submitting}
      // The same as the first step's, so the dialog isn't opened again.
      initialFocus={photoInputRef}
      size="2xl"
      headerStart={
        <IconButton
          label="Back"
          icon={<IconArrowLeft />}
          size="sm"
          onClick={() => goTo("photo")}
          disabled={submitting}
          className="ml-2"
        />
      }
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            icon={<IconShare />}
            disabled={submitting}
          >
            {submitting ? "Sharing…" : "Share story"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-6 sm:flex-row"
      >
        <div className="relative aspect-9/16 w-full max-w-48 shrink-0 self-center overflow-clip rounded-field bg-black shadow-story-preview sm:w-72 sm:max-w-none sm:self-start">
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Preview of the chosen photo"
              className="absolute inset-0 size-full object-contain"
            />
          )}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 flex h-24 items-start gap-2 bg-linear-to-b from-black/48 to-transparent p-3 text-meta font-semibold text-white"
          >
            <Avatar user={viewer} size="xs" />
            Your story
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {formError && (
            <Notice tone="error">
              {formError.message}
              {formError.retry && (
                <button
                  type="submit"
                  className="ml-2 rounded-chip font-semibold text-ink underline focus-ring"
                >
                  Try again
                </button>
              )}
            </Notice>
          )}
          <TextAreaField
            ref={captionRef}
            label="Caption"
            name="caption"
            rows={3}
            placeholder="Add a caption"
            value={caption}
            onChange={(event) => {
              setCaption(event.target.value);
              setCaptionError(null);
            }}
            readOnly={submitting}
            hint={`${countCharacters(caption.trim())} / ${STORY_CAPTION_MAX_LENGTH}`}
            error={captionError}
          />
          <div className="flex flex-col items-start gap-2">
            <PhotoInput
              label="Replace photo"
              inputRef={photoInputRef}
              onFile={choose}
              disabled={submitting}
              invalid={pictureError !== null}
              describedBy={pictureError ? pictureMessageId : undefined}
            />
            {pictureMessage}
          </div>
          <StoryFacts />
        </div>
      </form>
    </Dialog>
  );
}
