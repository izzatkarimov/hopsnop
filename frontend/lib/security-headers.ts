/* The CSP is per request in proxy.ts (nonce); the rest are in next.config.ts. */

type PolicyOptions = {
  nonce: string;
  apiUrl: string | undefined;
  /** `next dev`, whose scripts need a looser policy than a build. */
  development: boolean;
};

/** Scripts run only with this page's nonce; 'strict-dynamic' lets them split code. */
export function contentSecurityPolicy({
  nonce,
  apiUrl,
  development,
}: PolicyOptions): string {
  const api = originOf(apiUrl);
  // Served over plain HTTP: a developer's machine, not a deployment.
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
    // The API and no other host, so only Hopsnop sees viewers; blob: is the preview.
    ["img-src", "'self'", "data:", "blob:", ...(api ? [api] : [])],
    // next/font serves the fonts from this origin.
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...(api ? [api] : [])],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    // No framing, where a site could trick a user into clicking Follow, Like or Delete.
    ["frame-ancestors", "'none'"],
  ];
  if (!local) {
    // Locally it would break the API, which is plain HTTP there.
    directives.push(["upgrade-insecure-requests"]);
  }
  return directives.map((parts) => parts.join(" ")).join("; ");
}

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export const staticSecurityHeaders: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Reset and verify links carry tokens in the address; CSRF checks read Origin.
  { key: "Referrer-Policy", value: "no-referrer" },
  // The older form of frame-ancestors 'none'.
  { key: "X-Frame-Options", value: "DENY" },
  // A window this site opens, or that opens it, gets no handle on it.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Features no page of Hopsnop uses, refused for the page and any frame.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { origin, protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? origin : null;
  } catch {
    return null;
  }
}
