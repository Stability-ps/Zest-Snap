import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { authLinkDestination, authLinkErrorFrom, authLinkErrorStatus, safeAuthNext, sessionMethods } from "@/lib/auth";
import { isOAuthSession, oauthErrorFromParams, oauthErrorKind, type OAuthErrorKind } from "@/lib/social-auth";

/**
 * PKCE links (`?code=`). Kept for links sent before the email templates moved to token_hash links
 * (/auth/confirm) and for Supabase redirects that carry an error. token_hash links sent here are forwarded.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // token_hash links that were pointed here (#83) are verified by /auth/confirm, like every newer email link.
  if (url.searchParams.has("token_hash")) return NextResponse.redirect(new URL(`/auth/confirm${url.search}`, url.origin));
  const result = (status: string) => NextResponse.redirect(new URL(`/auth/confirmed?status=${status}`, url.origin));
  // Google / Apple (sign-in or connecting to an account): failures go back to where the person started,
  // with a plain message, never to the email-link result screen.
  const provider = url.searchParams.get("provider");
  const social = provider === "google" || provider === "apple";
  const linking = url.searchParams.get("link") === "1";
  const socialFailed = (kind: OAuthErrorKind) =>
    NextResponse.redirect(new URL(linking ? `/settings?sheet=account&auth_error=${kind}` : `/login?auth_error=${kind}`, url.origin));
  if (social) {
    const kind = oauthErrorFromParams(url.searchParams);
    if (kind) return socialFailed(kind);
  }
  const linkError = authLinkErrorFrom(url.searchParams);
  if (linkError) return result(linkError);
  const code = url.searchParams.get("code");
  if (!code || !isSupabaseConfigured()) return social ? socialFailed(code ? "unavailable" : "expired") : result("invalid");
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.info(JSON.stringify({ event: "auth_callback_failed", code: error.code || error.name, social }));
      return social ? socialFailed(oauthErrorKind(error.code, error.message)) : result(authLinkErrorStatus(error.code, error.message));
    }
    const next = safeAuthNext(url.searchParams.get("next"));
    // Connecting Google/Apple to the signed-in account (Settings › Account): back to Settings.
    if (social && linking) return NextResponse.redirect(new URL(`/settings?sheet=account&linked=${provider === "apple" ? "apple" : "google"}`, url.origin));
    // A provider sign-in (from the token itself, not the query string) is a sign-in, not an email confirmation.
    if (isOAuthSession(sessionMethods(data.session?.access_token))) {
      return NextResponse.redirect(new URL(`/auth/social-complete?next=${encodeURIComponent(next)}`, url.origin));
    }
    const destination = authLinkDestination({
      type: next === "/reset-password" ? "recovery" : null,
      methods: sessionMethods(data.session?.access_token),
    });
    // Confirmations show the result screen first; it continues to `next`.
    const target = destination.startsWith("/auth/confirmed") && next !== "/app" ? `${destination}&next=${encodeURIComponent(next)}` : destination;
    return NextResponse.redirect(new URL(target, url.origin));
  } catch {
    // Show an actionable error without provider internals.
    console.info(JSON.stringify({ event: "auth_callback_failed", code: "exception", social }));
    return social ? socialFailed("unavailable") : result("invalid");
  }
}
