/**
 * Google and Apple sign-in helpers. Pure where possible so they are unit-tested (tests/social-auth.test.ts).
 *
 * Flow (all platforms): Supabase OAuth with PKCE. The code verifier is stored by the browser client in this
 * origin's cookies, and /auth/callback exchanges the code on the server. Web and PWA return to
 * https://app.zestsnap.app/auth/callback. The iOS/Android apps start the flow in the system browser (Google
 * refuses embedded WebViews) and return through the registered zestsnap:// scheme, which the native bridge
 * loads in the WebView that holds the verifier.
 */
export type SocialProvider = "google" | "apple";
export const SOCIAL_PROVIDERS: readonly SocialProvider[] = ["google", "apple"];
export const providerLabel: Record<SocialProvider, string> = { google: "Google", apple: "Apple" };

/** Apple first on iOS (platform convention), Google first everywhere else. */
export function providerOrder(platform: string, enabled: SocialProvider[]): SocialProvider[] {
  const order: SocialProvider[] = platform === "ios" ? ["apple", "google"] : ["google", "apple"];
  return order.filter((p) => enabled.includes(p));
}

/** Reads Supabase's public /auth/v1/settings: only providers that are switched on are offered. */
export function enabledProviders(settings: unknown): SocialProvider[] {
  const external = (settings as { external?: Record<string, unknown> } | null)?.external;
  if (!external || typeof external !== "object") return [];
  return SOCIAL_PROVIDERS.filter((p) => external[p] === true);
}

export async function fetchEnabledProviders(supabaseUrl: string, key: string, fetcher: typeof fetch = fetch): Promise<SocialProvider[]> {
  try {
    const res = await fetcher(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key }, cache: "no-store" });
    if (!res.ok) return [];
    return enabledProviders(await res.json());
  } catch {
    return [];
  }
}

/** Where the provider sends the person back. `link` marks connecting a provider to the signed-in account. */
export function oauthRedirect(opts: { origin: string; provider: SocialProvider; next: string; native: boolean; link?: boolean }) {
  const params = new URLSearchParams({ provider: opts.provider, next: opts.next });
  if (opts.link) params.set("link", "1");
  return opts.native ? `zestsnap://auth/callback?${params}` : `${opts.origin}/auth/callback?${params}`;
}

export type OAuthErrorKind = "cancelled" | "network" | "conflict" | "expired" | "unavailable";

/** Classifies an OAuth failure reported by Supabase or the provider (query parameters or an error object). */
export function oauthErrorKind(code?: string | null, description?: string | null): OAuthErrorKind {
  const c = (code || "").toLowerCase();
  const d = (description || "").toLowerCase();
  if (c === "access_denied" || c === "user_cancelled" || d.includes("cancel") || d.includes("denied")) return "cancelled";
  if (c === "identity_already_exists" || c === "email_exists" || d.includes("already linked") || d.includes("already been linked") || d.includes("already exists"))
    return "conflict";
  if (c === "flow_state_expired" || c === "flow_state_not_found" || c === "bad_code_verifier" || c === "session_expired" || d.includes("expired") || d.includes("code verifier"))
    return "expired";
  if (c === "network" || d.includes("failed to fetch") || d.includes("network")) return "network";
  return "unavailable";
}

export function oauthErrorFromParams(params: URLSearchParams): OAuthErrorKind | null {
  if (!params.has("error") && !params.has("error_code") && !params.has("error_description")) return null;
  return oauthErrorKind(params.get("error_code") || params.get("error"), params.get("error_description"));
}

export const oauthErrorMessage: Record<OAuthErrorKind, string> = {
  cancelled: "Sign-in was cancelled. You can try again anytime.",
  network: "Unable to connect. Check your internet connection and try again.",
  conflict: "This sign-in method is already connected to another account.",
  expired: "Your session has expired. Please sign in again.",
  unavailable: "This sign-in option is temporarily unavailable. Please try another method.",
};

export function isOAuthErrorKind(v: string | null): v is OAuthErrorKind {
  return v === "cancelled" || v === "network" || v === "conflict" || v === "expired" || v === "unavailable";
}

/** True when the session was created by an external provider (from the access token's amr claim). */
export function isOAuthSession(methods: string[]) {
  return methods.includes("oauth") || methods.includes("sso/oidc");
}

/** Apple "Hide My Email" relay addresses: never show them as a name. */
export function isAppleRelayEmail(email?: string | null) {
  return /@privaterelay\.appleid\.com$/i.test(email || "");
}

/**
 * The display name to store after a social sign-in, or null to leave it. Apple sends the name only on the
 * first authorization; Google always does. An existing, chosen name is never replaced or blanked; a
 * placeholder derived from the email address (what the signup trigger stores when no name is known) is
 * replaced by the provider's name, or cleared when it is an Apple relay address.
 */
export function socialDisplayName(current: string | null | undefined, email: string | null | undefined, metadata: Record<string, unknown> | null | undefined) {
  const name = [metadata?.full_name, metadata?.name, [metadata?.given_name, metadata?.family_name].filter(Boolean).join(" ")]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .find((v) => v.length > 0 && v.length <= 100);
  const local = (email || "").split("@")[0];
  const placeholder = !current || current.trim() === "" || current === local;
  if (!placeholder) return null;
  if (name && name !== current) return name;
  if (current && isAppleRelayEmail(email) && current === local) return "";
  return null;
}
