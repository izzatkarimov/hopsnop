/*
 * Small client for the Hopsnop API (the FastAPI backend).
 *
 * Every request to the backend goes through apiRequest(), or apiDownload()
 * for a file, so the cookie setting, JSON encoding and error handling live
 * in one place.
 *
 * Session: the backend keeps the session in an HttpOnly cookie. The browser
 * stores it and attaches it to requests; this code never sees the token.
 * `credentials: "include"` is what lets the browser send and accept that
 * cookie, because the API is a different origin from the frontend.
 *
 * CSRF: the backend only accepts state-changing requests whose Origin header
 * is the frontend's origin. The browser sets that header itself, so there is
 * no token to attach here. Content-Type is the only request header the
 * backend's CORS policy allows; adding others would make requests fail.
 *
 * Pictures: the API stores and serves them itself, and names them by paths
 * on the API. apiAssetUrl() turns such a path into an address to load.
 */

// Next.js inlines NEXT_PUBLIC_ variables at build time, and only when they
// are referenced exactly like this.
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");

/** One entry of a 422 response: which part of the request was rejected. */
export type ApiValidationIssue = {
  loc: (string | number)[];
  msg: string;
  type: string;
};

/** Body of every error response from the backend. */
export type ApiErrorResponse = {
  detail: string | ApiValidationIssue[];
};

export type ApiErrorKind =
  /** 422: the request body did not pass validation. */
  | "validation"
  /** 401: no usable session, or wrong credentials. */
  | "unauthenticated"
  /** 403: the request was understood but is not allowed. */
  | "forbidden"
  /** 404: there is no such resource, or it is not available. */
  | "not_found"
  /** 409: the request conflicts with existing data. */
  | "conflict"
  /** 429: too many requests of this kind were made; wait before the next. */
  | "rate_limited"
  /** Any other 4xx, e.g. an invalid or expired token. */
  | "bad_request"
  /** 5xx, or a response that could not be understood. */
  | "server"
  /** No response at all: offline, API unreachable, or blocked by CORS. */
  | "network";

/**
 * The one error type thrown by apiRequest(). `kind` lets the UI tell a
 * failure the user can fix (validation, credentials) from an unexpected one
 * (server, network) without looking at status codes.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status, or null when there was no response. */
  readonly status: number | null;
  /** For "validation": the reason each field was rejected, by field name. */
  readonly fieldErrors: Record<string, string>;
  /**
   * For "rate_limited": how many seconds the backend said to wait, or null
   * if it did not say.
   */
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

/**
 * Message for failures the user can only respond to by trying again, at
 * once or, when the backend asked for that, after waiting.
 */
export function unexpectedErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "rate_limited") {
    return rateLimitMessage(error.retryAfter);
  }
  return isApiError(error) && error.kind === "network"
    ? "Couldn't reach Hopsnop. Check your connection and try again."
    : "Something went wrong. Please try again.";
}

/**
 * Says how long to wait only when the backend said so: no duration is made
 * up for an answer that came without one.
 */
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
  // Rounded up, so that the wait named is never too short.
  const minutes = Math.ceil(retryAfter / 60);
  return `Too many attempts. Please wait about ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  } before trying again.`;
}

type ApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
} & (
  | {
      /** Sent as JSON. */
      body?: unknown;
      form?: never;
    }
  | {
      body?: never;
      /**
       * Sent as multipart/form-data, for a file. The browser writes the
       * Content-Type header itself, with the boundary between the parts.
       */
      form: FormData;
    }
);

/**
 * The address of something the API serves at `path`, such as a picture.
 * Null for anything that is not a path on the API: an address of another
 * host is never loaded, whatever a response says.
 */
export function apiAssetUrl(path: string | null | undefined): string | null {
  if (!API_URL || !path) return null;
  // One leading slash: "//host/x" would be an address of another host.
  if (!/^\/(?!\/)[\w\-./%]*$/.test(path)) return null;
  return `${API_URL}${path}`;
}

/** A file the API sent, such as a data export. */
export type ApiFile = {
  /** The response body, exactly as it was sent. */
  blob: Blob;
  /**
   * The file name the response gives in its Content-Disposition header, or
   * null. The browser withholds that header from this page unless the API
   * exposes it to the frontend's origin, and it is null then as well.
   */
  filename: string | null;
};

/**
 * Calls the API and returns the parsed response body.
 * Throws ApiError for every failure that comes from the request itself.
 */
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

/**
 * Calls the API for a file and returns the response body as it is, instead
 * of parsing it. Fails in the same ways as apiRequest().
 */
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

/**
 * Sends the request and returns the response if it is a success. Every
 * failure, from no response at all to an error answer, is thrown as ApiError.
 */
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

/**
 * The file name a response gives in its Content-Disposition header, or null.
 * Only a plain filename parameter is read, and of it only letters, digits,
 * dots, dashes and underscores are kept, so it cannot name a folder.
 */
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

/**
 * The seconds to wait that a 429 response names in its Retry-After header,
 * or null. The backend sends whole seconds; anything else, including a
 * header that is missing or that the browser withholds, is no duration.
 */
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

/** Collects the first message for each rejected field of a 422 response. */
function toFieldErrors(issues: unknown[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of issues) {
    if (typeof issue !== "object" || issue === null) continue;
    const { loc, msg } = issue as Partial<ApiValidationIssue>;
    if (!Array.isArray(loc) || typeof msg !== "string") continue;

    // loc is ["body", "<field>", ...]; errors about the body as a whole
    // have no field and are left out.
    const field = loc[1];
    if (loc[0] !== "body" || typeof field !== "string") continue;

    // Rules written in the backend arrive with this prefix.
    fieldErrors[field] ??= msg.replace(/^Value error, /, "");
  }
  return fieldErrors;
}
