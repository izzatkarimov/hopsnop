"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Notice } from "@/components/ui/notice";
import { TextAreaField, TextField } from "@/components/ui/text-field";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { validateDisplayName } from "@/lib/auth-validation";
import { countCharacters } from "@/lib/posts";
import { BIO_MAX_LENGTH, validateBio } from "@/lib/profile-validation";
import {
  removeCurrentAvatar,
  setCurrentAvatar,
  updateCurrentProfile,
} from "@/lib/profiles";
import type { UpdateProfileRequest } from "@/lib/profiles";
import type { Profile } from "@/lib/types";
import { PictureField } from "./picture-field";
import type { PictureChoice } from "./picture-field";

/** The text fields, in the order they appear. */
const TEXT_FIELDS = ["displayName", "bio"] as const;

type TextFieldName = (typeof TEXT_FIELDS)[number];
type Values = Record<TextFieldName, string>;
type FieldErrors = Partial<Record<TextFieldName, string>>;

/** Field names in the backend's validation errors, mapped to this form's. */
const API_FIELDS: Record<string, TextFieldName> = {
  display_name: "displayName",
  bio: "bio",
};

function validate(values: Values): FieldErrors {
  const errors: FieldErrors = {};
  const results: Record<TextFieldName, string | null> = {
    displayName: validateDisplayName(values.displayName),
    bio: validateBio(values.bio),
  };
  for (const field of TEXT_FIELDS) {
    const error = results[field];
    if (error) errors[field] = error;
  }
  return errors;
}

/**
 * The fields whose value differs from the saved profile, and only those:
 * PATCH /users/me changes exactly what it is sent. An emptied bio is sent
 * as null, which clears it.
 */
function changesFrom(profile: Profile, values: Values): UpdateProfileRequest {
  const changes: UpdateProfileRequest = {};
  const displayName = values.displayName.trim();
  const bio = values.bio.trim() || null;

  if (displayName !== profile.displayName) changes.display_name = displayName;
  if (bio !== profile.bio) changes.bio = bio;
  return changes;
}

/** What to tell about a picture the backend did not take. */
function pictureErrorFrom(error: unknown): string | null {
  if (!isApiError(error)) return null;
  if (error.kind === "forbidden") {
    return "Verify your email address before adding a picture.";
  }
  // 422: not a picture it can read; 413: too large. The backend's own words.
  if (error.kind === "validation" || error.status === 413) {
    return error.message;
  }
  return null;
}

function fieldErrorsFrom(error: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (isApiError(error) && error.kind === "validation") {
    for (const [apiField, message] of Object.entries(error.fieldErrors)) {
      const field = API_FIELDS[apiField];
      if (field) errors[field] = message;
    }
  }
  return errors;
}

/** Moves focus to the first field with an error. False if there is none. */
function focusFirstInvalid(form: HTMLFormElement, errors: FieldErrors): boolean {
  const field = TEXT_FIELDS.find((name) => errors[name]);
  if (!field) return false;

  const control = form.elements.namedItem(field);
  if (control instanceof HTMLElement) control.focus();
  return true;
}

type EditProfileFormProps = {
  profile: Profile;
  /** Called with the profile as the backend saved it. */
  onSaved: (profile: Profile) => void;
  onCancel: () => void;
};

/**
 * Edits the signed-in user's own profile. The username and the email address
 * are not here: the backend does not allow either to be changed.
 *
 * The picture is sent on its own request, before the text. If the picture is
 * saved and the text then is not, the form stays open with the picture
 * counted as saved, so that trying again sends only what is left.
 */
export function EditProfileForm({
  profile: initialProfile,
  onSaved,
  onCancel,
}: EditProfileFormProps) {
  const { expireSession, updateUser } = useAuth();
  // The profile as the backend has it now: what the changes are counted from.
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [values, setValues] = useState<Values>({
    displayName: initialProfile.displayName,
    bio: initialProfile.bio ?? "",
  });
  const [picture, setPicture] = useState<PictureChoice>({ kind: "keep" });
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Guards against sending the same change twice. A ref, because it changes
  // at once: `submitting` only changes when React next renders, which can be
  // after a second submit event has already arrived.
  const inFlight = useRef(false);

  const hasChanges =
    picture.kind !== "keep" || Object.keys(changesFrom(profile, values)).length > 0;

  /** Closes the form. What was saved on the way is not lost to the page. */
  function leave() {
    if (profile !== initialProfile) {
      onSaved(profile);
    } else {
      onCancel();
    }
  }

  function textProps(field: TextFieldName) {
    return {
      name: field,
      value: values[field],
      error: errors[field],
      onChange: (event: { target: { value: string } }) => {
        setValues((current) => ({ ...current, [field]: event.target.value }));
        // The message no longer describes what is in the field.
        setErrors((current) => ({ ...current, [field]: undefined }));
      },
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // Kept in a variable: event.currentTarget is cleared after an await.
    const form = event.currentTarget;
    const found = validate(values);
    setErrors(found);
    setFormError(null);
    if (focusFirstInvalid(form, found)) return;

    if (!hasChanges) {
      // Nothing to save, and the backend rejects an empty update.
      leave();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setPictureError(null);
    let saved = profile;
    let step: "picture" | "text" = "picture";
    try {
      if (picture.kind !== "keep") {
        saved =
          picture.kind === "new"
            ? await setCurrentAvatar(picture.file)
            : await removeCurrentAvatar();
        setProfile(saved);
        setPicture({ kind: "keep" });
        // The sidebar and the composer show the same picture.
        updateUser({ avatarUrl: saved.avatarUrl });
      }
      step = "text";
      const changes = changesFrom(saved, values);
      if (Object.keys(changes).length > 0) {
        saved = await updateCurrentProfile(changes);
      }
      onSaved(saved);
    } catch (error) {
      if (isApiError(error) && error.kind === "unauthenticated") {
        // The session ended while editing. RequireAuth leads to the login page.
        expireSession();
        return;
      }
      if (step === "picture") {
        const message = pictureErrorFrom(error);
        if (message) {
          setPictureError(message);
        } else {
          setFormError(unexpectedErrorMessage(error));
        }
        inFlight.current = false;
        setSubmitting(false);
        return;
      }
      const rejected = fieldErrorsFrom(error);
      setErrors(rejected);
      if (!focusFirstInvalid(form, rejected)) {
        setFormError(
          isApiError(error) && error.kind === "validation"
            ? "Some details were not accepted. Check them and try again."
            : unexpectedErrorMessage(error),
        );
      }
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form
      method="post"
      noValidate
      onSubmit={handleSubmit}
      aria-label="Edit profile"
      className="flex flex-col gap-4 border-b border-border px-4 py-4"
    >
      <h2 className="text-lg font-semibold">Edit profile</h2>

      {formError && <Notice tone="error">{formError}</Notice>}

      <PictureField
        profile={profile}
        choice={picture}
        onChoice={setPicture}
        error={pictureError}
        onError={setPictureError}
        disabled={submitting}
      />

      <TextField
        label="Display name"
        autoComplete="name"
        autoFocus
        required
        {...textProps("displayName")}
      />
      <TextAreaField
        label="Bio"
        rows={3}
        hint={`${countCharacters(values.bio.trim())} / ${BIO_MAX_LENGTH}`}
        {...textProps("bio")}
      />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={leave}
          disabled={submitting}
          className="rounded-full border border-border px-5 py-1.5 text-body font-semibold transition-colors hover:bg-hover disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !hasChanges}
          className="rounded-full bg-accent px-5 py-1.5 text-body font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
