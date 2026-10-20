import { ApiError, apiDownload } from "./api";

/*
 * The export of the signed-in user's data: POST /users/me/export.
 *
 * The backend answers with one ZIP archive (app/services/export.py): a
 * folder holding export.json and the pictures it names. It is handed on
 * exactly as it arrived. It is looked at here only to check that it is a
 * ZIP file; it is never unpacked, kept, stored or logged.
 */

/** Body of POST /users/me/export. */
export type ExportRequest = {
  password: string;
};

/** The export, ready to be saved. */
export type AccountExportFile = {
  /** The archive, exactly as the backend sent it. */
  blob: Blob;
  filename: string;
};

/**
 * For an answer whose name the page cannot read. The backend exposes
 * Content-Disposition to the frontend, so this is the exception.
 */
const FALLBACK_FILENAME = "hopsnop-export.zip";

/** Every ZIP file that holds anything begins with these four bytes. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

async function isZip(blob: Blob): Promise<boolean> {
  const start = new Uint8Array(await blob.slice(0, ZIP_SIGNATURE.length).arrayBuffer());
  return ZIP_SIGNATURE.every((byte, index) => start[index] === byte);
}

/**
 * Everything Hopsnop holds that is the signed-in user's own, as a file. The
 * password has to be given again, exactly as typed. Requires a session.
 *
 * Wrong passwords and exports are both limited per account, so the ApiError
 * can be "rate_limited" as well as "bad_request" for a wrong password (see
 * isWrongCurrentPasswordError).
 */
export async function downloadAccountExport(
  password: string,
): Promise<AccountExportFile> {
  const { blob, filename } = await apiDownload("/users/me/export", {
    method: "POST",
    body: { password } satisfies ExportRequest,
  });

  if (!(await isZip(blob))) {
    throw new ApiError("server", null, "The server sent an unexpected export.");
  }
  // Only a name for what it is: never one that would save it as another type.
  const name = filename && /\.zip$/i.test(filename) ? filename : FALLBACK_FILENAME;
  return { blob, filename: name };
}
