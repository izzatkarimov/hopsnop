import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, generateNonce } from "@/lib/security-headers";

/**
 * Gives every page its Content-Security-Policy, with a nonce of its own.
 *
 * The policy is set on the request as well as on the response: Next.js
 * reads the nonce from the request's header while it renders the page and
 * puts it on each of its scripts. That only happens when the page is
 * rendered for the request, which is why the root layout waits for one
 * (app/layout.tsx).
 */
export function proxy(request: NextRequest) {
  const policy = contentSecurityPolicy({
    nonce: generateNonce(),
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    development: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages, not the files they load: scripts, styles, fonts and the icon
      // are not documents and run nothing under a policy of their own.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      // Prefetches of links fetch data for a page, not a page.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
