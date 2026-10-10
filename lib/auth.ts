/** Only same-site app paths are allowed after sign-in, so auth links can't redirect elsewhere. */
export function safeAuthNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/app";
  try {
    const url = new URL(value, "https://zestsnap.app");
    if (url.origin !== "https://zestsnap.app") return "/app";
    if (url.pathname === "/auth/verified" || url.pathname === "/reset-password" || url.pathname === "/settings" || url.pathname === "/upgrade" || url.pathname === "/app" || url.pathname === "/admin" || /^\/admin\/[a-z0-9/_-]{1,120}$/i.test(url.pathname) || /^\/share(d)?\/[0-9a-f-]{36}$/i.test(url.pathname))
      return url.pathname + url.search;
  } catch {}
  return "/app";
}

/** Outcomes shown on the /auth/confirmed result screen. */
export type AuthLinkStatus = "verified" | "email-changed" | "expired" | "invalid" | "unfinished";
export const AUTH_LINK_STATUSES: readonly AuthLinkStatus[] = ["verified", "email-changed", "expired", "invalid", "unfinished"];

/** Email link types Zest Snap sends (Supabase `type` values used with token_hash links). */
export type EmailLinkType = "signup" | "email" | "recovery" | "email_change" | "invite" | "magiclink";
const LINK_TYPES = new Set<EmailLinkType>(["signup", "email", "recovery", "email_change", "invite", "magiclink"]);
export function emailLinkType(value: string | null): EmailLinkType | null {
  return value && LINK_TYPES.has(value as EmailLinkType) ? (value as EmailLinkType) : null;
}

/**
 * Supabase reports a used link and an expired link with the same codes (otp_expired / "invalid or has
 * expired"), so both map to "expired"; malformed or unknown links map to "invalid".
 */
export function authLinkErrorStatus(code?: string | null, description?: string | null): AuthLinkStatus {
  const c = (code || "").toLowerCase();
  const d = (description || "").toLowerCase();
  if (c === "otp_expired" || c === "flow_state_expired" || d.includes("expired") || d.includes("already been used")) return "expired";
  if (c === "bad_code_verifier" || c === "flow_state_not_found" || d.includes("code verifier")) return "unfinished";
  return "invalid";
}

/** Reads Supabase's error parameters from a redirect's query string or #fragment. */
export function authLinkErrorFrom(params: URLSearchParams): AuthLinkStatus | null {
  if (!params.has("error") && !params.has("error_code") && !params.has("error_description")) return null;
  return authLinkErrorStatus(params.get("error_code"), params.get("error_description"));
}

/** Decodes the authentication methods (amr) of a Supabase access token without verifying it. */
export function sessionMethods(accessToken?: string | null): string[] {
  try {
    const payload = accessToken?.split(".")[1];
    if (!payload) return [];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return Array.isArray(json.amr) ? json.amr.map((m: { method?: string }) => String(m?.method || "")).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Where a successfully used email link should land. Recovery always goes to /reset-password (never the
 * homepage or the app) so the new password is set before anything else; confirmations go to the result
 * screen.
 */
export function authLinkDestination(kind: { type?: EmailLinkType | null; methods?: string[] }) {
  const methods = kind.methods || [];
  if (kind.type === "recovery" || methods.includes("recovery")) return "/reset-password";
  if (kind.type === "email_change" || methods.includes("email_change")) return "/auth/confirmed?status=email-changed";
  return "/auth/confirmed?status=verified";
}

/** Supabase sends at most one confirmation email per address per minute (smtp_max_frequency = 60s). */
export const RESEND_COOLDOWN_SECONDS = 60;
const RESEND_KEY = "zest-auth-resend-v1";

type Store = Pick<Storage, "getItem" | "setItem">;
function resendLog(store: Store): Record<string, number> {
  try {
    const value = JSON.parse(store.getItem(RESEND_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** Seconds until another verification email may be requested for this address (0 = now). */
export function resendWaitSeconds(store: Store, email: string, now = Date.now()) {
  const sentAt = resendLog(store)[email.trim().toLowerCase()];
  if (!sentAt) return 0;
  return Math.max(0, Math.ceil((sentAt + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000));
}

export function recordResend(store: Store, email: string, now = Date.now()) {
  const log = resendLog(store);
  for (const [key, at] of Object.entries(log)) if (now - at > RESEND_COOLDOWN_SECONDS * 1000) delete log[key];
  log[email.trim().toLowerCase()] = now;
  try {
    store.setItem(RESEND_KEY, JSON.stringify(log));
  } catch {}
}

/** Remembers where to go after confirming, for links opened on the device that signed up. */
export const PENDING_NEXT_KEY = "zest-auth-next-v1";
