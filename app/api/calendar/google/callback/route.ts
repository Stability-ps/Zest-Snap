import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeGoogleCode, saveGoogleConnection } from "@/lib/google-calendar-server";

export async function GET(request: NextRequest) {
  const target = new URL("/settings?calendar=google", request.url);
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const expected = request.cookies.get("zest-gcal-state")?.value;

  if (error || !state || !code || !expected || state !== expected) {
    target.searchParams.set("status", "error");
    return NextResponse.redirect(target);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=%2Fsettings", request.url));

  try {
    const token = await exchangeGoogleCode(request.nextUrl.origin, code);
    await saveGoogleConnection(user.id, token);
    target.searchParams.set("status", "connected");
  } catch {
    target.searchParams.set("status", "error");
  }

  const response = NextResponse.redirect(target);
  response.cookies.set("zest-gcal-state", "", { maxAge: 0, path: "/" });
  return response;
}
