/**
 * Content-Security-Policy for app.zestsnap.app, derived from what the browser actually loads:
 * - scripts/styles: same-origin Next.js assets plus Next's inline bootstrap/flight scripts and the native-class
 *   script in app/layout.tsx (hence 'unsafe-inline' until per-request nonces are adopted; no 'unsafe-eval').
 * - connect: same origin (API routes) and the Supabase project (REST/Auth/Storage, realtime websocket).
 *   OpenAI, Google APIs and RevenueCat are only called from the server, so they are deliberately absent.
 * - img: same origin, data:/blob: scan previews and exports, and Capacitor's local file URLs in the apps.
 * Google sign-in/Calendar handoffs are top-level navigations, which CSP does not restrict.
 * Shipped as Report-Only first; violations are posted to /api/csp-report.
 */
export function contentSecurityPolicy(supabaseUrl: string) {
  const supabase = new URL(supabaseUrl);
  const capacitor = "https://localhost capacitor://localhost";
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${capacitor}`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabase.origin} wss://${supabase.host} ${capacitor}`,
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}
