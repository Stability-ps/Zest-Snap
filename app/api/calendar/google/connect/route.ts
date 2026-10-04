import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGoogleOAuthState, googleCalendarAuthorizeUrl } from "@/lib/google-calendar-server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=%2Fsettings", request.url));

  const state = createGoogleOAuthState(user.id);
  const response = NextResponse.redirect(googleCalendarAuthorizeUrl(request.nextUrl.origin, state));
  response.cookies.set("zest-gcal-state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/",
  });
  return response;
}
