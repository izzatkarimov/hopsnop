import { countCharacters } from "./posts";

/*
 * Client-side checks for the edit profile form.
 *
 * Like the registration checks, they mirror the backend's rules
 * (app/schemas/user.py) to give quick feedback; the backend validates
 * everything again and has the final say. The display name follows the same
 * rule as at registration (validateDisplayName in auth-validation.ts).
 *
 * Each function returns an error message, or null if the value is acceptable.
 */

export const BIO_MAX_LENGTH = 160;

/** An empty bio is fine: it means "no bio". */
export function validateBio(value: string): string | null {
  if (countCharacters(value.trim()) > BIO_MAX_LENGTH) {
    return `Use at most ${BIO_MAX_LENGTH} characters.`;
  }
  return null;
}

/** The kinds of picture the backend reads. */
export const PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** The largest picture file the backend accepts (MAX_IMAGE_UPLOAD_BYTES). */
export const PICTURE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * A quick check of a chosen picture file. The type is the one the browser
 * guessed, from the file's name; the backend reads the file itself and
 * decides. A file whose type the browser does not know is left to it.
 */
export function validatePictureFile(file: Pick<File, "type" | "size">): string | null {
  if (file.type !== "" && !PICTURE_TYPES.includes(file.type)) {
    return "Choose a JPEG, PNG or WebP picture.";
  }
  if (file.size > PICTURE_MAX_BYTES) {
    return "Choose a picture of at most 10 MB.";
  }
  return null;
}
