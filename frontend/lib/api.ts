/* The one way to the API. Content-Type is the only header the backend's CORS allows. */

// Next.js inlines NEXT_PUBLIC_ variables only when referenced exactly like this.
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");

export type ApiValidationIssue = {
  loc: (string | number)[];
  msg: string;
  type: string;
};

export type ApiErrorResponse = {
  detail: string | ApiValidationIssue[];
};

export type ApiErrorKind =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  /** Any other 4xx, e.g. an invalid or expired token. */
  | "bad_request"
  | "server"
  /** No response at all: offline, API unreachable, or blocked by CORS. */
  | "network";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly fieldErrors: Record<string, string>;
  readonly retryAfter: number | null;

  constructor(
    kind: ApiErrorKind,
    status: number | null,
    message: string,
    fieldErrors: Record<string, string> = {},
    retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.retryAfter = retryAfter;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function unexpectedErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "rate_limited") {
    return rateLimitMessage(error.retryAfter);
  }
  return isApiError(error) && error.kind === "network"
    ? "Couldn't reach Hopsnop. Check your connection and try again."
    : "Something went wrong. Please try again.";
}

/** No duration is made up for an answer without one. */
function rateLimitMessage(retryAfter: number | null): string {
  if (retryAfter === null) {
    return "Too many attempts. Please wait a while before trying again.";
  }
  if (retryAfter < 60) {
    const seconds = Math.max(1, retryAfter);
    return `Too many attempts. Please wait ${seconds} ${
      seconds === 1 ? "second" : "seconds"
    } before trying again.`;
  }
  // Rounded up, so the wait named is never too short.
  const minutes = Math.ceil(retryAfter / 60);
  return `Too many attempts. Please wait about ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  } before trying again.`;
}

type ApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
} & (
  | {
      body?: unknown;
      form?: never;
    }
  | {
      body?: never;
      /** The browser writes the Content-Type header itself, with the boundary. */
      form: FormData;
    }
);

/** Null for anything else: another host's address is never loaded. */
export function apiAssetUrl(path: string | null | undefined): string | null {
  if (!API_URL || !path) return null;
  // One leading slash: "//host/x" would be another host.
  if (!/^\/(?!\/)[\w\-./%]*$/.test(path)) return null;
  return `${API_URL}${path}`;
}

export type ApiFile = {
  blob: Blob;
  /** Null also if the API doesn't expose the header to this origin. */
  filename: string | null;
};

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const response = await send(path, options);

  if (response.status === 204) {
    return undefined as T;
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw unreadable(response);
  }
}

export async function apiDownload(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiFile> {
  const response = await send(path, options);

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    // The connection broke off while the body was arriving.
    throw unreadable(response);
  }
  return { blob, filename: filenameOf(response) };
}

async function send(
  path: string,
  { method = "GET", body, form }: ApiRequestOptions,
): Promise<Response> {
  if (!API_URL) {
    throw new Error("NEXT_PUBLIC_API_URL is not set. See .env.example.");
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      credentials: "include",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch {
    // fetch() rejects only when no response arrived.
    throw new ApiError("network", null, "The server could not be reached.");
  }

  if (response.ok) {
    return response;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw unreadable(response);
  }
  throw toApiError(response.status, data, retryAfterOf(response));
}

function unreadable(response: Response): ApiError {
  return new ApiError(
    "server",
    response.status,
    "The server sent an unreadable response.",
  );
}

/** Only safe characters are kept, so it cannot name a folder. */
function filenameOf(response: Response): string | null {
  const header = response.headers.get("Content-Disposition") ?? "";
  const match = /;\s*filename\s*=\s*(?:"([^"]*)"|([^";\s]+))/i.exec(header);
  const name = (match?.[1] ?? match?.[2] ?? "").replace(/[^\w.-]/g, "_");
  // Nothing but dots is no name.
  return /[^.]/.test(name) ? name : null;
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}

/** Whole seconds; anything else, or a withheld header, is no duration. */
function retryAfterOf(response: Response): number | null {
  if (response.status !== 429) return null;
  const value = response.headers.get("Retry-After")?.trim();
  return value && /^\d{1,9}$/.test(value) ? Number(value) : null;
}

function toApiError(
  status: number,
  body: unknown,
  retryAfter: number | null,
): ApiError {
  const detail =
    typeof body === "object" && body !== null && "detail" in body
      ? body.detail
      : undefined;

  if (Array.isArray(detail)) {
    return new ApiError(
      kindForStatus(status),
      status,
      "Some fields were rejected.",
      toFieldErrors(detail),
      retryAfter,
    );
  }
  return new ApiError(
    kindForStatus(status),
    status,
    typeof detail === "string" ? detail : "The request failed.",
    {},
    retryAfter,
  );
}

function toFieldErrors(issues: unknown[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of issues) {
    if (typeof issue !== "object" || issue === null) continue;
    const { loc, msg } = issue as Partial<ApiValidationIssue>;
    if (!Array.isArray(loc) || typeof msg !== "string") continue;

    // loc is ["body", "<field>", ...]; errors about the whole body have no field.
    const field = loc[1];
    if (loc[0] !== "body" || typeof field !== "string") continue;

    // Rules written in the backend arrive with this prefix.
    fieldErrors[field] ??= msg.replace(/^Value error, /, "");
  }
  return fieldErrors;
}
