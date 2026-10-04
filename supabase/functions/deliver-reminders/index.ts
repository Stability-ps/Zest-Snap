import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

// Source of truth for the live function. Supersedes live version 2 (2026-10-04), which already fixed the
// subscription query to select failure_count; that fix is kept below together with the relation-shape and
// deep-link changes. Never deploy an older copy over this file.
// Invoked every minute by pg_cron (job "zest-deliver-reminders") with the x-zest-cron secret.
// Payloads never contain document content: only the Planner item title the user typed or approved.
type Sub = { id: string; endpoint: string; keys: { p256dh: string; auth: string }; failure_count: number | null };
type Item = { title?: string | null; type?: string | null };

// PostgREST returns a many-to-one embed as an object, but generated types (and some versions) use arrays.
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

Deno.serve(async (req: Request) => {
  const runId = crypto.randomUUID();
  const log = (event: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, runId, ...extra }));
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });
  const supplied = req.headers.get("x-zest-cron") || "";
  const { data: allowed, error: authError } = await db.rpc("verify_push_cron_secret", { p_secret: supplied });
  if (authError || !allowed) return new Response("Forbidden", { status: 403 });

  const { data: config, error: configError } = await db.rpc("get_push_delivery_config");
  const cfg = config?.[0];
  if (configError || !cfg?.public_key || !cfg?.private_key) {
    log("push_config_unavailable");
    return Response.json({ error: "Push configuration unavailable" }, { status: 503 });
  }

  webpush.setVapidDetails("mailto:hello@zestsnap.app", cfg.public_key, cfg.private_key);
  const { data: due, error: claimError } = await db.rpc("claim_due_reminders", { p_limit: 100 });
  if (claimError) {
    log("reminder_claim_failed", { code: claimError.code });
    return Response.json({ error: "Queue unavailable" }, { status: 503 });
  }

  let sent = 0, failed = 0;
  for (const reminder of due || []) {
    const { data: detail } = await db.from("reminders")
      .select("id,label,planner_item_id,planner_items(title,type)")
      .eq("id", reminder.id).single();
    const item = one<Item>(detail?.planner_items as Item | Item[] | null);
    const title = detail?.label || item?.title || "Planner reminder";
    const { data: subs } = await db.from("push_subscriptions")
      .select("id,endpoint,keys,failure_count").eq("user_id", reminder.user_id);

    if (!subs?.length) {
      await db.rpc("complete_push_reminder", { p_id: reminder.id, p_ok: false, p_error: "no_push_subscription" });
      failed++;
      continue;
    }

    let delivered = false;
    let lastError = "push_failed";
    for (const sub of subs as Sub[]) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify({
            title: "Zest Snap reminder",
            body: title,
            url: `/app?view=planner&tab=reminders&reminderId=${reminder.id}`,
            reminderId: reminder.id,
            tag: "zest-reminder-" + reminder.id,
          }),
          { TTL: 86400, urgency: "high" },
        );
        delivered = true;
        await db.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", sub.id);
      } catch (e) {
        const status = Number((e as { statusCode?: number }).statusCode || 0);
        lastError = status ? "push_http_" + status : "push_send_failed";
        if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("id", sub.id);
        else await db.from("push_subscriptions").update({ failure_count: Math.min((sub.failure_count || 0) + 1, 1000) }).eq("id", sub.id);
      }
    }
    await db.rpc("complete_push_reminder", { p_id: reminder.id, p_ok: delivered, p_error: delivered ? null : lastError });
    if (delivered) sent++; else { failed++; log("reminder_delivery_failed", { reminderId: reminder.id, reason: lastError }); }
  }
  if (due?.length) log("reminder_run", { claimed: due.length, sent, failed });
  return Response.json({ ok: true, claimed: due?.length || 0, sent, failed });
});
