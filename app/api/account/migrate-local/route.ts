import { NextResponse } from "next/server";

// Kept so previously installed app versions keep working.
// Guest milestones live in client storage and cannot be verified, so they are never converted into
// spendable cloud credits. Cloud milestones are awarded only by server actions: a metered scan
// completing (finish_scan), a calendar export (/api/calendar/ics) and Planner database triggers.
export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin || req.headers.get("X-Zest-Action") !== "migrate-local")
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
