import { NextRequest, NextResponse } from "next/server";
import { exchangeGoogleCode, saveGoogleConnection, verifyGoogleOAuthState } from "@/lib/google-calendar-server";

export async function GET(request: NextRequest) {
  // Always return OAuth callbacks to the canonical app host in production.
  const appOrigin = process.env.VERCEL_ENV === "production"
    ? "https://app.zestsnap.app"
    : request.nextUrl.origin;
  const target = new URL("/settings?calendar=google", appOrigin);
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const expected = request.cookies.get("zest-gcal-state")?.value;
  const userId = state ? verifyGoogleOAuthState(state) : null;

  // The signed state is authoritative. The cookie is an extra same-browser check when
  // available, but Android installed PWAs can complete Google OAuth in a Chrome custom
  // tab where the PWA's cookie jar is not available.
  if (error || !state || !code || !userId || (expected && state !== expected)) {
    target.searchParams.set("status", "error");
    return NextResponse.redirect(target);
  }

  try {
    const token = await exchangeGoogleCode(request.nextUrl.origin, code);
    await saveGoogleConnection(userId, token);
    target.searchParams.set("status", "connected");
  } catch {
    target.searchParams.set("status", "error");
  }

  const response = NextResponse.redirect(target);
  response.cookies.set("zest-gcal-state", "", { maxAge: 0, path: "/" });
  return response;
}
