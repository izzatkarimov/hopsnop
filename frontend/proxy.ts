import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, generateNonce } from "@/lib/security-headers";

/** On the request too: Next.js reads the nonce there while rendering. */
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
      // Pages only: scripts, styles, fonts and the icon run nothing under a policy.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      // Link prefetches fetch data for a page, not a page.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
