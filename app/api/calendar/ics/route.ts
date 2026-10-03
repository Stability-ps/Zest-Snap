import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/admin";
import { readBoundedJson } from "@/lib/upload";
import { generateIcs } from "@/lib/ics";
export async function POST(req: NextRequest) {
  try {
    if (
      req.headers.get("origin") &&
      req.headers.get("origin") !== req.nextUrl.origin
    )
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const body = (await readBoundedJson(req, 500000)) as {
      events?: Parameters<typeof generateIcs>[0];
    };
    const text = await generateIcs(
      Array.isArray(body.events)
        ? body.events
        : ([body] as Parameters<typeof generateIcs>[0]),
    );
    if (isSupabaseConfigured()) {
      const db = await createClient();
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user)
        return NextResponse.json({ error: "Sign in first" }, { status: 401 });
      const { error } = await serviceClient().rpc("award_milestone", {
        p_user: user.id,
        p_reason: "first_calendar",
      });
      if (error)
        return NextResponse.json(
          { error: "Could not save calendar action. Try again." },
          { status: 503 },
        );
    }
    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="zest-snap-events.ics"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Check the selected dates, times and timezones before exporting.",
      },
      { status: 400 },
    );
  }
}
