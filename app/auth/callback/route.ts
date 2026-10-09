import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { safeAuthNext } from "@/lib/auth";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeAuthNext(url.searchParams.get("next"));
  if (isSupabaseConfigured() && tokenHash && (type === "signup" || type === "email" || type === "recovery")) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error) return NextResponse.redirect(new URL(type === "recovery" ? "/reset-password" : "/auth/verified", url.origin));
    } catch {
      console.info(JSON.stringify({ event: "auth_confirmation_failed", code: "exception" }));
    }
    return NextResponse.redirect(new URL("/login?error=expired-link", url.origin));
  }
  if (code && isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) console.info(JSON.stringify({ event: "auth_callback_failed", code: error.code || error.name }));
      if (!error)
        return NextResponse.redirect(
          new URL(next, url.origin),
        );
    } catch {
      // Show an actionable error without provider internals.
      console.info(JSON.stringify({ event: "auth_callback_failed", code: "exception" }));
    }
  }
  return NextResponse.redirect(
    new URL("/login?error=expired-link", url.origin),
  );
}
