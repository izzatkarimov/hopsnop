import { ApiError, apiDownload } from "./api";

/* Handed on as it arrived; only checked to be a ZIP, never unpacked or stored. */

export type ExportRequest = {
  password: string;
};

export type AccountExportFile = {
  blob: Blob;
  filename: string;
};

/** For an answer whose name the page can't read. */
const FALLBACK_FILENAME = "hopsnop-export.zip";

/** Every ZIP file that holds anything begins with these four bytes. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

async function isZip(blob: Blob): Promise<boolean> {
  const start = new Uint8Array(await blob.slice(0, ZIP_SIGNATURE.length).arrayBuffer());
  return ZIP_SIGNATURE.every((byte, index) => start[index] === byte);
}

/** Can be "rate_limited" as well as "bad_request" for a wrong password. */
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
  // Never a name that would save it as another type.
  const name = filename && /\.zip$/i.test(filename) ? filename : FALLBACK_FILENAME;
  return { blob, filename: name };
}
