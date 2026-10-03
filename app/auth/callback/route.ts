import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { safeAuthNext } from "@/lib/auth";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code && isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error)
        return NextResponse.redirect(
          new URL(safeAuthNext(url.searchParams.get("next")), url.origin),
        );
    } catch {
      /* Show an actionable error without provider internals. */
    }
  }
  return NextResponse.redirect(
    new URL("/login?error=expired-link", url.origin),
  );
}
