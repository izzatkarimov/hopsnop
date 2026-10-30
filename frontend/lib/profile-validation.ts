import { countCharacters } from "./posts";

/* Quick feedback mirroring app/schemas/user.py; the backend has the final say. */

export const BIO_MAX_LENGTH = 160;

export function validateBio(value: string): string | null {
  if (countCharacters(value.trim()) > BIO_MAX_LENGTH) {
    return `Use at most ${BIO_MAX_LENGTH} characters.`;
  }
  return null;
}

export const PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** The backend's MAX_IMAGE_UPLOAD_BYTES. */
export const PICTURE_MAX_BYTES = 10 * 1024 * 1024;

/** The type is the browser's guess from the name; the backend reads the file itself. */
export function validatePictureFile(file: Pick<File, "type" | "size">): string | null {
  if (file.type !== "" && !PICTURE_TYPES.includes(file.type)) {
    return "Choose a JPEG, PNG or WebP picture.";
  }
  if (file.size > PICTURE_MAX_BYTES) {
    return "Choose a picture of at most 10 MB.";
  }
  return null;
}
