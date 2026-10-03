import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin || req.headers.get("X-Zest-Action") !== "migrate-local")
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  try {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
    const { data: profile, error: profileError } = await db.from("profiles").select("preferences").eq("id", user.id).single();
    if (profileError) throw profileError;
    const preferences =
      profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences)
        ? profile.preferences as Record<string, unknown>
        : {};
    const rawImported = preferences.importedMilestones;
    const imported =
      rawImported && typeof rawImported === "object" && !Array.isArray(rawImported)
        ? rawImported as Record<string, unknown>
        : {};
    const admin = serviceClient();
    for (const reason of ["first_scan", "first_calendar"] as const) {
      const key = reason === "first_scan" ? "firstScan" : "firstCalendar";
      if (imported[key]) {
        const { error } = await admin.rpc("award_milestone", { p_user: user.id, p_reason: reason });
        if (error) throw error;
      }
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Local rewards could not be synced yet." }, { status: 503 });
  }
}
