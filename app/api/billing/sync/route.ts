import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BillingNotConfigured, syncStoreEntitlement } from "@/lib/billing/server";

export const runtime = "nodejs";

/**
 * Called by the app after a store purchase or "Restore purchases". The client's claim is ignored:
 * the entitlement is re-read from RevenueCat (which verified the receipt with Apple/Google).
 */
export async function POST(req: Request) {
  if (req.headers.get("origin") && new URL(req.url).origin !== req.headers.get("origin"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  try {
    const { plan, entitlement } = await syncStoreEntitlement(user.id);
    return NextResponse.json({ plan, active: entitlement.active, source: entitlement.active ? entitlement.source : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof BillingNotConfigured) return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
    console.error(JSON.stringify({ event: "billing_sync_failed", reason: e instanceof Error ? e.message : "unknown" }));
    return NextResponse.json({ error: "billing_unavailable" }, { status: 502 });
  }
}
