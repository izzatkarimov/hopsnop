import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // server.js and only the traced node_modules, for the container (frontend/Dockerfile).
  output: "standalone",
  poweredByHeader: false,
  // Nothing uses next/image; this makes /_next/image a 404 that fetches and decodes nothing.
  images: { unoptimized: true },
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
