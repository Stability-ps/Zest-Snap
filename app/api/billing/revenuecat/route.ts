import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { BillingNotConfigured, syncStoreEntitlement } from "@/lib/billing/server";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authorised(header: string | null) {
  const secret = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!secret || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * RevenueCat webhook (renewals, cancellations, billing issues, refunds, transfers). The payload is only a
 * trigger: the user's state is re-fetched from RevenueCat's API before anything is written.
 */
export async function POST(req: Request) {
  if (!authorised(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { event?: { app_user_id?: string; transferred_to?: string[]; transferred_from?: string[] } } | null;
  const ids = new Set([body?.event?.app_user_id, ...(body?.event?.transferred_to || []), ...(body?.event?.transferred_from || [])].filter((x): x is string => !!x && UUID.test(x)));
  try {
    for (const id of ids) await syncStoreEntitlement(id);
    return NextResponse.json({ ok: true, synced: ids.size });
  } catch (e) {
    if (e instanceof BillingNotConfigured) return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
    // Non-2xx makes RevenueCat retry with backoff.
    console.error(JSON.stringify({ event: "billing_webhook_failed", reason: e instanceof Error ? e.message : "unknown" }));
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
}
