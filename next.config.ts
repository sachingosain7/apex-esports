import type { NextConfig } from "next";

const securityHeaders = [
  // 1. Prevent Clickjacking: stops other malicious websites from putting your site inside an iframe to steal logins or clicks
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  // 2. Prevent MIME-type sniffing: stops browsers from executing uploaded screenshots or non-script files as scripts
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  // 3. Strict Referrer Policy: prevents leaking private query tokens or URLs to external third parties
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  // 4. Cross-Site Scripting (XSS) filter for older browsers
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  // 5. Hardware Permissions Policy: restricts camera, microphone, and geolocation access
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // Anti-Fingerprinting: Hide 'X-Powered-By: Next.js' header from automated vulnerability scanners
  poweredByHeader: false,

  // Anti-Theft: Do NOT publish TypeScript source maps to client browsers in production
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

  experimental: {
    agentFeedback: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
