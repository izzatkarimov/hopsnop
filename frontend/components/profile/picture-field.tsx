"use client";

import { useEffect, useId } from "react";
import type { ChangeEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { PICTURE_TYPES, validatePictureFile } from "@/lib/profile-validation";
import type { Profile } from "@/lib/types";

/** What is to become of the picture when the form is saved. */
export type PictureChoice =
  | { kind: "keep" }
  | {
      kind: "new";
      file: File;
      /** A blob: address of the file, on this device, to show it before it is sent. */
      previewUrl: string;
    }
  | { kind: "remove" };

type PictureFieldProps = {
  /** The profile as saved, whose picture is shown while nothing is chosen. */
  profile: Profile;
  choice: PictureChoice;
  onChoice: (choice: PictureChoice) => void;
  error: string | null;
  onError: (error: string | null) => void;
  disabled: boolean;
};

/**
 * Choosing a profile picture: a file from the device, shown at once as it
 * will be cropped, or none. Nothing is sent until the form is saved.
 */
export function PictureField({
  profile,
  choice,
  onChoice,
  error,
  onError,
  disabled,
}: PictureFieldProps) {
  const inputId = useId();
  const messageId = useId();

  // The address of the chosen file is given back once it is no longer
  // shown: another file was chosen, the picture was saved, or the form went
  // away.
  const previewUrl = choice.kind === "new" ? choice.previewUrl : null;
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const hasPicture =
    choice.kind === "new" || (choice.kind === "keep" && profile.avatarUrl !== null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared, so that choosing the same file again is a change as well.
    event.target.value = "";
    if (!file) return;

    const problem = validatePictureFile(file);
    onError(problem);
    if (!problem) {
      onChoice({ kind: "new", file, previewUrl: URL.createObjectURL(file) });
    }
  }

  function handleRemove() {
    onError(null);
    // "Remove" means: no picture once saved. With none saved, that is
    // simply keeping what there is.
    onChoice(profile.avatarUrl === null ? { kind: "keep" } : { kind: "remove" });
  }

  return (
    <div>
      <p className="text-sm font-medium">Profile picture</p>
      <div className="mt-2 flex items-center gap-4">
        {previewUrl ? (
          // A blob: address of the file the user just chose, on this device.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Preview of the chosen picture"
            className="size-24 shrink-0 rounded-full bg-hover object-cover"
          />
        ) : (
          <Avatar
            size="xl"
            user={{
              ...profile,
              avatarUrl: choice.kind === "remove" ? null : profile.avatarUrl,
            }}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            type="file"
            accept={PICTURE_TYPES.join(",")}
            onChange={handleChange}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={messageId}
            className="peer sr-only"
          />
          <label
            htmlFor={inputId}
            className="cursor-pointer rounded-full border border-border px-4 py-1.5 text-body font-semibold transition-colors hover:bg-hover peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
          >
            {hasPicture ? "Change picture" : "Choose picture"}
          </label>
          {hasPicture && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={disabled}
              className="rounded-full border border-border px-4 py-1.5 text-body font-semibold transition-colors hover:bg-hover disabled:opacity-50"
            >
              Remove picture
            </button>
          )}
        </div>
      </div>
      <p
        id={messageId}
        className={`mt-2 text-sm ${error ? "text-danger" : "text-muted"}`}
      >
        {error ??
          "JPEG, PNG or WebP, up to 10 MB. It is cropped to a square, and location, camera and other details in the file are removed."}
      </p>
    </div>
  );
}
