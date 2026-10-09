import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { authLinkDestination, authLinkErrorFrom, authLinkErrorStatus, safeAuthNext, sessionMethods } from "@/lib/auth";

/**
 * PKCE links (`?code=`). Kept for links sent before the email templates moved to token_hash links
 * (/auth/confirm) and for Supabase redirects that carry an error.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = (status: string) => NextResponse.redirect(new URL(`/auth/confirmed?status=${status}`, url.origin));
  const linkError = authLinkErrorFrom(url.searchParams);
  if (linkError) return result(linkError);
  const code = url.searchParams.get("code");
  if (!code || !isSupabaseConfigured()) return result("invalid");
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.info(JSON.stringify({ event: "auth_callback_failed", code: error.code || error.name }));
      return result(authLinkErrorStatus(error.code, error.message));
    }
    const next = safeAuthNext(url.searchParams.get("next"));
    const destination = authLinkDestination({
      type: next === "/reset-password" ? "recovery" : null,
      methods: sessionMethods(data.session?.access_token),
    });
    // Confirmations show the result screen first; it continues to `next`.
    const target = destination.startsWith("/auth/confirmed") && next !== "/app" ? `${destination}&next=${encodeURIComponent(next)}` : destination;
    return NextResponse.redirect(new URL(target, url.origin));
  } catch {
    // Show an actionable error without provider internals.
    console.info(JSON.stringify({ event: "auth_callback_failed", code: "exception" }));
    return result("invalid");
  }
}
