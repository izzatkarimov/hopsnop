import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Responses do not announce which framework made them.
  poweredByHeader: false,
  headers() {
    return [
      {
        // Every response. The Content-Security-Policy, which changes with
        // every page, is set in proxy.ts.
        source: "/:path*",
        headers: staticSecurityHeaders,
      },
    ];
  },
};

export default nextConfig;
