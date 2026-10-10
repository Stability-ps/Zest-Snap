import { NextResponse } from "next/server";
import { MARKETING_CAMPAIGNS, notificationPayload, sameSecret, sendOneSignal, type CampaignCopy } from "@/lib/marketing/onesignal";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Hourly scheduler (vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`. Eligibility, consent,
 * frequency caps and quiet hours are decided in the database (claim_marketing_sends); this only delivers.
 * Without ONESIGNAL_REST_API_KEY nothing is claimed, so no send is ever recorded that wasn't sent.
 */
export async function GET(req: Request) {
  if (!sameSecret(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null, process.env.CRON_SECRET))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const restKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!restKey) return NextResponse.json({ ok: true, skipped: "onesignal_not_configured" });
  // Loaded only now: unauthorised or unconfigured calls never touch the service-role client.
  const { serviceClient } = await import("@/lib/supabase/admin");
  const db = serviceClient();
  const { data: campaigns, error } = await db.from("marketing_campaigns").select("key,title,body,path,enabled").eq("enabled", true);
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const summary: Record<string, Record<string, number>> = {};
  for (const copy of (campaigns || []) as (CampaignCopy & { enabled: boolean })[]) {
    if (!MARKETING_CAMPAIGNS.includes(copy.key)) continue;
    const { data: sends, error: claimError } = await db.rpc("claim_marketing_sends" as never, { p_campaign: copy.key } as never);
    if (claimError) {
      console.error(JSON.stringify({ event: "marketing_claim_failed", campaign: copy.key }));
      continue;
    }
    const counts: Record<string, number> = { sent: 0, failed: 0, skipped: 0 };
    for (const send of (sends || []) as { id: string; user_id: string }[]) {
      const result = await sendOneSignal(notificationPayload(copy, send), restKey);
      counts[result.status]++;
      await db.rpc("finish_marketing_send" as never, { p_id: send.id, p_status: result.status, p_provider_id: result.providerId ?? null, p_error: result.error ?? null } as never);
    }
    summary[copy.key] = counts;
  }
  // Counts only — never user ids, message content or keys.
  console.info(JSON.stringify({ event: "marketing_run", summary }));
  return NextResponse.json({ ok: true, summary });
}
