import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./lib/csp";
// Identifies the deployed release so long-lived native WebViews can tell when they are running an old build.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "local";
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  env: { NEXT_PUBLIC_ZEST_BUILD: buildId },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
          {
            // Report-Only while violations are reviewed; switch to Content-Security-Policy once clean.
            key: "Content-Security-Policy-Report-Only",
            value: contentSecurityPolicy(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rnlqsaaoywqrvokoysei.supabase.co"),
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};
export default config;
