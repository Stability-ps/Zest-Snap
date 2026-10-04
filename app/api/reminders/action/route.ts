import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lets the service worker snooze or complete a reminder straight from the notification without
// opening the app. Authenticates with the user's own session cookie; RLS-scoped RPCs ignore
// reminders that belong to anyone else.
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  let body: { id?: unknown; action?: unknown; minutes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  const action = body.action === "snooze" || body.action === "done" ? body.action : null;
  const minutes = Number(body.minutes ?? 15);
  if (!id || !action || !Number.isInteger(minutes) || minutes < 1 || minutes > 10080)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const db = await createClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
    const { error } =
      action === "snooze"
        ? await db.rpc("snooze_planner_reminder", { p_id: id, p_minutes: minutes })
        : await db.rpc("mark_planner_reminder_handled", { p_id: id });
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.info(JSON.stringify({ event: "reminder_action_failed", action }));
    return NextResponse.json({ error: "Reminder could not be updated" }, { status: 503 });
  }
}
