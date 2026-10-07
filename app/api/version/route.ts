import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The release currently deployed. Compared with the build a native WebView is running after resume. */
export function GET() {
  return NextResponse.json({ build: process.env.NEXT_PUBLIC_ZEST_BUILD || "local" }, { headers: { "Cache-Control": "no-store" } });
}
