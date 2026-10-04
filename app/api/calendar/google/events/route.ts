import { NextRequest, NextResponse } from "next/server";
import type { ExtractedEvent } from "@/lib/extraction-types";
import { createClient } from "@/lib/supabase/server";
import { createGoogleCalendarEvent, listGoogleCalendarEvents } from "@/lib/google-calendar-server";
import { validateEvent } from "@/lib/events";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  let body: { event?: ExtractedEvent; timezone?: string };
  try {
    body = await request.json();
    if (!body.event) throw new Error("missing_event");
    validateEvent(body.event);
  } catch {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  try {
    const created = await createGoogleCalendarEvent(user.id, body.event!, body.timezone || "UTC");
    return NextResponse.json({ ok: true, id: created.id, htmlLink: created.htmlLink || null });
  } catch (error) {
    const code = error instanceof Error ? error.message : "google_calendar_create_failed";
    if (code === "google_calendar_not_connected") return NextResponse.json({ error: code }, { status: 409 });
    if (code === "google_calendar_reconnect_required") return NextResponse.json({ error: code }, { status: 401 });
    return NextResponse.json({ error: code }, { status: 502 });
  }
}


export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const q = request.nextUrl.searchParams;
  const timeMin = q.get("timeMin");
  const timeMax = q.get("timeMax");
  const timezone = q.get("timezone") || "UTC";
  if (!timeMin || !timeMax || Number.isNaN(Date.parse(timeMin)) || Number.isNaN(Date.parse(timeMax))) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }
  // Bound reads to a useful app window and prevent an accidental unbounded Google API query.
  if (Date.parse(timeMax) - Date.parse(timeMin) > 370 * 86400000) {
    return NextResponse.json({ error: "range_too_large" }, { status: 400 });
  }
  try {
    const events = await listGoogleCalendarEvents(user.id, { timeMin, timeMax, fallbackTimezone: timezone });
    return NextResponse.json({ ok: true, events }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "google_calendar_list_failed";
    if (code === "google_calendar_not_connected") return NextResponse.json({ error: code, events: [] }, { status: 409 });
    if (code === "google_calendar_reconnect_required") return NextResponse.json({ error: code }, { status: 401 });
    return NextResponse.json({ error: code }, { status: 502 });
  }
}
