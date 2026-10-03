import {
  getSupabasePublicConfig,
  isSupabaseConfigured,
} from "./config";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const { url, key } = getSupabasePublicConfig();
  if (!isSupabaseConfigured() || !url || !key)
    return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  try {
    await supabase.auth.getClaims();
  } catch {
    /* Protected handlers verify independently and fail closed. */
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
