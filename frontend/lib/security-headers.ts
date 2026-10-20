/*
 * The security headers of the frontend's pages.
 *
 * The API sends its own headers for its own responses. These are for the
 * pages this application serves, which is where scripts run and where the
 * session can be used: what a page may load, whether another site may frame
 * it, and what it tells other sites about itself.
 *
 * The Content-Security-Policy is built per request in proxy.ts, because it
 * carries a nonce that is new for every page. The rest never change and are
 * set in next.config.ts.
 */

type PolicyOptions = {
  /** The nonce of this response: random, and used for no other response. */
  nonce: string;
  /** NEXT_PUBLIC_API_URL: where the pages send their requests. */
  apiUrl: string | undefined;
  /** `next dev`, whose scripts need a looser policy than a build. */
  development: boolean;
};

/**
 * The Content-Security-Policy of one page.
 *
 * Scripts run only if they carry the page's nonce, which Next.js puts on its
 * own scripts and nothing else can know. An injected <script>, an inline
 * event handler or a javascript: URL does not have it and is not run.
 * 'strict-dynamic' lets those scripts load the code they split off, and
 * makes the browser ignore any list of hosts.
 */
export function contentSecurityPolicy({
  nonce,
  apiUrl,
  development,
}: PolicyOptions): string {
  const api = originOf(apiUrl);
  // Served over plain HTTP: a machine of a developer, not a deployment.
  const local = api === null || api.startsWith("http:");

  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // React needs eval in development to rebuild server error stacks.
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    // `next dev` injects styles from scripts without a nonce.
    ["style-src", "'self'", development ? "'unsafe-inline'" : `'nonce-${nonce}'`],
    // Pictures come from the API, which stores them itself, and from no
    // other host: whoever views one is seen by Hopsnop alone. blob: is the
    // preview of a picture chosen for upload, before it is sent.
    ["img-src", "'self'", "data:", "blob:", ...(api ? [api] : [])],
    // next/font serves the fonts from this origin.
    ["font-src", "'self'"],
    // The API, and nothing else, is what the pages talk to.
    ["connect-src", "'self'", ...(api ? [api] : [])],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    // No other site may show these pages in a frame, where it could trick a
    // user into clicking Follow, Like or Delete.
    ["frame-ancestors", "'none'"],
  ];
  if (!local) {
    // Over HTTPS, a picture or request with an http: address is upgraded
    // instead of being sent in the clear. Locally it would break the API,
    // which is plain HTTP there.
    directives.push(["upgrade-insecure-requests"]);
  }
  return directives.map((parts) => parts.join(" ")).join("; ");
}

/** A nonce: 128 random bits, base64-encoded. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** Headers that are the same on every response of the frontend. */
export const staticSecurityHeaders: { key: string; value: string }[] = [
  // Read every file as the type it is sent as, never as a guess.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Tell no other site which page a request came from. Password reset and
  // email verification links carry their token in the address, and profile
  // and post addresses say what a user was looking at. The API's own
  // requests still carry their Origin, which is what its CSRF check reads.
  { key: "Referrer-Policy", value: "no-referrer" },
  // The older form of frame-ancestors 'none', for browsers without it.
  { key: "X-Frame-Options", value: "DENY" },
  // A window this site opens, or that opens it, gets no handle on it.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Features no page of Hopsnop uses, refused for the page and any frame.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

/** scheme://host[:port] of an absolute http(s) URL, or null. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { origin, protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? origin : null;
  } catch {
    return null;
  }
}
