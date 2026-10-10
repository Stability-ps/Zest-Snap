import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const APP_HOST = "app.zestsnap.app";
const MARKETING_HOSTS = new Set(["zestsnap.app", "www.zestsnap.app"]);
const PRODUCT_PATHS = ["/app", "/login", "/settings", "/upgrade", "/onboarding", "/intro", "/reset-password", "/admin", "/auth"];
// Supabase params on an auth redirect. Older emails (and any redirect Supabase rejects) fall back to the
// bare Site URL; those are forwarded to the auth routes instead of showing the homepage or the app.
const AUTH_REDIRECT_PARAMS = ["code", "token_hash", "error", "error_code"];

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];
  const { pathname } = request.nextUrl;

  if ((host === APP_HOST || MARKETING_HOSTS.has(host)) && pathname === "/" && AUTH_REDIRECT_PARAMS.some((p) => request.nextUrl.searchParams.has(p))) {
    const url = request.nextUrl.clone();
    url.hostname = APP_HOST;
    url.port = "";
    url.protocol = "https:";
    url.pathname = request.nextUrl.searchParams.has("token_hash") ? "/auth/confirm" : "/auth/callback";
    return NextResponse.redirect(url, 307);
  }

  if (host === APP_HOST && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url, 307);
  }

  if (
    MARKETING_HOSTS.has(host) &&
    PRODUCT_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"))
  ) {
    const url = request.nextUrl.clone();
    url.hostname = APP_HOST;
    url.port = "";
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }

  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
