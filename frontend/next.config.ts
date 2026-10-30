import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers() {
    return [
      {
        // The CSP, which changes per page, is set in proxy.ts.
        source: "/:path*",
        headers: staticSecurityHeaders,
      },
    ];
  },
};

export default nextConfig;
