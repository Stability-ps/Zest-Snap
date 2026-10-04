import { NextRequest, NextResponse } from "next/server";
import type { ExtractedEvent } from "@/lib/extraction-types";
import { createClient } from "@/lib/supabase/server";
import { createGoogleCalendarEvent, listGoogleCalendarEvents, upsertPlannerGoogleEvent, deletePlannerGoogleEvent } from "@/lib/google-calendar-server";
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


export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  try {
    const body = await request.json();
    if (!body?.plannerItemId || !body?.event) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const saved = await upsertPlannerGoogleEvent(user.id, String(body.plannerItemId), body.event, body.timezone || "UTC", Array.isArray(body.reminders) ? body.reminders : undefined);
    return NextResponse.json({ ok: true, eventId: saved.id, htmlLink: saved.htmlLink || null });
  } catch (error) {
    const code = error instanceof Error ? error.message : "google_calendar_sync_failed";
    const status = code === "google_calendar_not_connected" ? 409 : code === "google_calendar_reconnect_required" ? 401 : 502;
    return NextResponse.json({ error: code }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const plannerItemId = request.nextUrl.searchParams.get("plannerItemId");
  if (!plannerItemId) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    await deletePlannerGoogleEvent(user.id, plannerItemId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "google_calendar_sync_failed";
    const status = code === "google_calendar_not_connected" ? 409 : code === "google_calendar_reconnect_required" ? 401 : 502;
    return NextResponse.json({ error: code }, { status });
  }
}


/** One-time/idempotent backfill of existing active Zest Planner items into Google Calendar. */
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  let timezone = "UTC";
  try { timezone = (await request.json())?.timezone || "UTC"; } catch {}
  const { data: items, error } = await supabase
    .from("planner_items")
    .select("id,type,title,description,start_date,end_date,start_time,end_time,due_date,due_time,all_day,timezone,location,status,google_event_id")
    .eq("user_id", user.id)
    .neq("status", "cancelled")
    .is("google_event_id", null);
  if (error) return NextResponse.json({ error: "planner_load_failed" }, { status: 500 });

  let synced = 0, skipped = 0, failed = 0;
  for (const item of items || []) {
    const startDate = item.start_date || item.due_date;
    if (!startDate) { skipped++; continue; }
    const event = {
      title: item.title,
      description: item.description || "",
      startDate,
      endDate: item.end_date || item.due_date || startDate,
      startTime: item.start_time ? String(item.start_time).slice(0, 5) : item.due_time ? String(item.due_time).slice(0, 5) : "",
      endTime: item.end_time ? String(item.end_time).slice(0, 5) : "",
      allDay: Boolean(item.all_day) || !(item.start_time || item.due_time),
      timezone: item.timezone || timezone,
      location: item.location || "",
      sourceText: "",
    } as ExtractedEvent;
    try {
      await upsertPlannerGoogleEvent(user.id, item.id, event, item.timezone || timezone);
      synced++;
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "google_calendar_not_connected" || code === "google_calendar_reconnect_required")
        return NextResponse.json({ error: code, synced, skipped, failed }, { status: code === "google_calendar_not_connected" ? 409 : 401 });
      failed++;
    }
  }
  return NextResponse.json({ ok: true, synced, skipped, failed });
}
