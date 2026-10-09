import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";
import { createNativeSender, nativeConfigFromEnv, type NativeMessage, type NativeToken } from "../_shared/native-push.ts";

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

  // Native push (iOS/Android apps). Platforms without credentials in the Edge Function secrets are skipped.
  const native = createNativeSender(nativeConfigFromEnv((name) => Deno.env.get(name)));
  const nativeTokens = async (userId: string) =>
    ((await db.from("native_push_tokens").select("id,platform,token,environment,failure_count").eq("user_id", userId)).data || []) as (NativeToken & { failure_count: number })[];
  const sendNative = async (tokens: (NativeToken & { failure_count: number })[], message: NativeMessage) => {
    let delivered = false, error = "";
    for (const t of tokens) {
      const r = await native.send(t, message);
      if (r.ok) {
        delivered = true;
        await db.from("native_push_tokens").update({ last_success_at: new Date().toISOString(), failure_count: 0, ...(r.environment ? { environment: r.environment } : {}) }).eq("id", t.id);
      } else if (r.invalid) {
        await db.from("native_push_tokens").delete().eq("id", t.id);
        error = r.error || "native_token_invalid";
      } else {
        error = r.error || "native_push_failed";
        if (r.error !== "native_push_unconfigured") await db.from("native_push_tokens").update({ failure_count: Math.min((t.failure_count || 0) + 1, 1000) }).eq("id", t.id);
      }
    }
    if (error && !delivered) log("native_push_failed", { reason: error });
    return { delivered, error };
  };
  const { data: due, error: claimError } = await db.rpc("claim_due_reminders", { p_limit: 100 });
  if (claimError) {
    log("reminder_claim_failed", { code: claimError.code });
    return Response.json({ error: "Queue unavailable" }, { status: 503 });
  }

  let sent = 0, failed = 0;
  for (const reminder of due || []) {
    const { data: detail } = await db.from("reminders")
      .select("id,label,planner_item_id,scheduled_at,device_armed_for,planner_items(title,type)")
      .eq("id", reminder.id).single();
    const item = one<Item>(detail?.planner_items as Item | Item[] | null);
    const title = detail?.label || item?.title || "Planner reminder";
    const { data: subs } = await db.from("push_subscriptions")
      .select("id,endpoint,keys,failure_count").eq("user_id", reminder.user_id);
    // A reminder a phone has armed as a local notification must not also arrive as a native push.
    const armedOnDevice = !!detail?.device_armed_for && detail.device_armed_for === detail.scheduled_at;
    const tokens = armedOnDevice ? [] : await nativeTokens(reminder.user_id);

    if (!subs?.length && !tokens.length) {
      await db.rpc("complete_push_reminder", { p_id: reminder.id, p_ok: false, p_error: "no_push_subscription" });
      failed++;
      continue;
    }

    let delivered = false;
    let lastError = "push_failed";
    for (const sub of (subs || []) as Sub[]) {
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
    let via = "web_push";
    if (tokens.length) {
      const r = await sendNative(tokens, {
        title: "Zest Snap reminder", body: title, url: `/app?view=planner&tab=reminders&reminderId=${reminder.id}`,
        tag: "zest-reminder-" + reminder.id, channel: "zest-reminders", data: { reminderId: String(reminder.id) },
      });
      if (r.delivered && !delivered) via = "native_push";
      if (r.delivered) delivered = true; else if (r.error) lastError = r.error;
    }
    await db.rpc("complete_push_reminder", { p_id: reminder.id, p_ok: delivered, p_error: delivered ? null : lastError, p_via: via });
    if (delivered) sent++; else { failed++; log("reminder_delivery_failed", { reminderId: reminder.id, reason: lastError }); }
  }
  if (due?.length) log("reminder_run", { claimed: due.length, sent, failed });

  // Daily briefing reuses the same push channel so there is no second notification service to operate.
  let briefingsSent = 0, briefingsFailed = 0;
  // Shared items have no direct relation to members, so resolve the user's active plans first. Weekly
  // timetable rows are stored once with a recurrence, so match them by weekday inside their date range.
  const sharedItemsFor = async (userId: string, day: string) => {
    const plans = await db.from("shared_plan_members").select("plan_id").eq("user_id", userId).eq("status", "active");
    if (plans.error) return { data: null, error: plans.error };
    const ids = (plans.data || []).map((p: { plan_id: string }) => p.plan_id);
    if (!ids.length) return { data: [] as any[], error: null };
    const weekday = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][new Date(day + "T12:00:00Z").getUTCDay()];
    const res = await db.from("shared_plan_items").select("title,item_type,start_date,start_time,due_date,due_time,recurrence")
      .in("plan_id", ids).neq("status", "cancelled")
      .or(`start_date.eq.${day},due_date.eq.${day},and(recurrence->>frequency.eq.weekly,start_date.lte.${day})`).limit(50);
    if (res.error) return res;
    const data = (res.data || []).filter((x: any) => x.start_date === day || x.due_date === day ||
      (x.recurrence?.frequency === "weekly" && String(x.recurrence?.dayOfWeek || "").toLowerCase() === weekday && (!x.recurrence?.until || x.recurrence.until >= day)));
    return { data: data.slice(0, 12), error: null };
  };
  const { data: briefings, error: briefingClaimError } = await db.rpc("claim_due_daily_briefings", { p_limit: 100 });
  if (briefingClaimError) log("briefing_claim_failed", { code: briefingClaimError.code });
  for (const briefing of briefings || []) {
    try {
      const day = briefing.local_date as string;
      const [plannerRes, sharedRes, subsRes] = await Promise.all([
        db.from("planner_items").select("title,type,start_date,start_time,due_date,due_time,status")
          .eq("user_id", briefing.user_id).eq("status","open")
          .or(`start_date.eq.${day},due_date.eq.${day}`).limit(12),
        briefing.include_shared ? sharedItemsFor(briefing.user_id, day) : Promise.resolve({ data: [] as any[], error: null }),
        db.from("push_subscriptions").select("id,endpoint,keys,failure_count").eq("user_id",briefing.user_id),
      ]);
      if (plannerRes.error || sharedRes.error || subsRes.error) throw new Error("briefing_query_failed");
      const tokens = await nativeTokens(briefing.user_id);
      // Nothing can be delivered without a push subscription or app token; retrying every minute would not change that.
      if (!subsRes.data?.length && !tokens.length) { await db.rpc("complete_daily_briefing",{p_user:briefing.user_id,p_ok:true}); log("briefing_no_subscription"); continue; }
      const personal = (plannerRes.data || []).filter((x:any)=>briefing.include_todos || x.type==="event");
      const shared = (sharedRes.data || []).filter((x:any)=>briefing.include_meals || x.item_type!=="meal");
      const all = [...personal,...shared] as any[];
      if (!all.length) { await db.rpc("complete_daily_briefing",{p_user:briefing.user_id,p_ok:true}); continue; }
      const names = all.slice(0,3).map(x=>x.title).filter(Boolean);
      const body = names.join(" · ") + (all.length>3 ? ` · +${all.length-3} more` : "");
      let delivered = false;
      for (const sub of (subsRes.data || []) as Sub[]) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys },JSON.stringify({
            title: `Today · ${all.length} ${all.length===1?"item":"items"}`, body, url:"/app?view=calendar&tab=upcoming", tag:"zest-daily-briefing-"+day,
          }),{TTL:21600,urgency:"normal"});
          delivered=true;
        } catch { /* regular reminder delivery will clean dead subscriptions */ }
      }
      if (tokens.length) {
        const r = await sendNative(tokens, {
          title: `Today · ${all.length} ${all.length===1?"item":"items"}`, body, url: "/app?view=calendar&tab=upcoming",
          tag: "zest-daily-briefing-" + day, channel: "zest-briefing",
        });
        if (r.delivered) delivered = true;
      }
      await db.rpc("complete_daily_briefing",{p_user:briefing.user_id,p_ok:delivered});
      if(delivered)briefingsSent++;else briefingsFailed++;
    } catch(e) {
      briefingsFailed++; await db.rpc("complete_daily_briefing",{p_user:briefing.user_id,p_ok:false});
      log("briefing_delivery_failed",{userId:briefing.user_id});
    }
  }
  if (briefings?.length) log("briefing_run",{claimed:briefings.length,sent:briefingsSent,failed:briefingsFailed});

  // Shared-plan messages use the same Web Push subscriptions as reminders.
  // Sender is excluded at enqueue time; each recipient gets at most one queue row per message.
  let messagePushClaimed = 0, messagePushSent = 0, messagePushFailed = 0;
  const { data: queuedMessages, error: messageClaimError } = await db.rpc("claim_shared_message_push", { p_limit: 100 });
  if (messageClaimError) log("shared_message_push_claim_failed", { code: messageClaimError.code });
  for (const job of queuedMessages || []) {
    messagePushClaimed++;
    try {
      const [{ data: message }, { data: plan }, { data: subs, error: subsError }] = await Promise.all([
        db.from("shared_plan_messages").select("id,body,deleted_at").eq("id",job.message_id).single(),
        db.from("shared_plans").select("id,name").eq("id",job.plan_id).single(),
        db.from("push_subscriptions").select("id,endpoint,keys,failure_count").eq("user_id",job.recipient_id),
      ]);
      if (subsError) throw new Error("subscription_query_failed");
      const tokens = await nativeTokens(job.recipient_id);
      if (!message || message.deleted_at || !plan) {
        await db.rpc("complete_shared_message_push",{p_id:job.id,p_ok:true,p_error:null});
        continue;
      }
      if (!subs?.length && !tokens.length) {
        await db.rpc("complete_shared_message_push",{p_id:job.id,p_ok:false,p_error:"no_push_subscription"});
        messagePushFailed++;
        continue;
      }
      // Resolve the sender name separately from the recipient profile. If unavailable, keep the copy neutral.
      const { data: messageRow } = await db.from("shared_plan_messages").select("sender_id").eq("id",job.message_id).single();
      const { data: senderProfile } = messageRow?.sender_id
        ? await db.from("profiles").select("display_name").eq("id",messageRow.sender_id).maybeSingle()
        : { data: null };
      const senderName = senderProfile?.display_name?.trim() || "Someone";
      const clean = String(message.body || "").replace(/\s+/g," ").trim();
      const body = clean.length > 140 ? clean.slice(0,137)+"…" : clean || "Sent a message";
      const url = `/shared/${job.plan_id}?tab=messages`;
      let delivered = false;
      let lastError = "push_failed";
      for (const sub of (subs || []) as Sub[]) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({
              title: `${senderName} · ${plan.name}`,
              body,
              url,
              tag: "zest-shared-message-" + job.plan_id,
              kind: "shared-message",
              planId: job.plan_id,
              messageId: job.message_id,
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
      if (tokens.length) {
        const r = await sendNative(tokens, {
          title: `${senderName} · ${plan.name}`, body, url, tag: "zest-shared-message-" + job.plan_id, channel: "zest-shared",
          data: { kind: "shared-message", planId: String(job.plan_id), messageId: String(job.message_id) },
        });
        if (r.delivered) delivered = true; else if (r.error) lastError = r.error;
      }
      await db.rpc("complete_shared_message_push",{p_id:job.id,p_ok:delivered,p_error:delivered?null:lastError});
      if (delivered) messagePushSent++; else messagePushFailed++;
    } catch {
      messagePushFailed++;
      await db.rpc("complete_shared_message_push",{p_id:job.id,p_ok:false,p_error:"shared_message_push_failed"});
    }
  }
  if (messagePushClaimed) log("shared_message_push_run",{claimed:messagePushClaimed,sent:messagePushSent,failed:messagePushFailed});

  // Shared invitations and Planner updates (written by database triggers into notification_queue).
  let notificationsClaimed = 0, notificationsSent = 0, notificationsFailed = 0;
  const { data: queued, error: queueError } = await db.rpc("claim_notifications", { p_limit: 100 });
  if (queueError) log("notification_claim_failed", { code: queueError.code });
  for (const n of queued || []) {
    notificationsClaimed++;
    try {
      const [{ data: subs }, tokens] = await Promise.all([
        db.from("push_subscriptions").select("id,endpoint,keys,failure_count").eq("user_id", n.recipient_id),
        nativeTokens(n.recipient_id),
      ]);
      let delivered = false, lastError = subs?.length || tokens.length ? "push_failed" : "no_push_subscription";
      const tag = `zest-${n.kind}-${n.id}`;
      for (const sub of (subs || []) as Sub[]) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({ title: n.title, body: n.body, url: n.url, tag, kind: n.kind }), { TTL: 86400, urgency: "high" });
          delivered = true;
        } catch (e) {
          const status = Number((e as { statusCode?: number }).statusCode || 0);
          lastError = status ? "push_http_" + status : "push_send_failed";
          if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
      if (tokens.length) {
        const r = await sendNative(tokens, { title: n.title, body: n.body, url: n.url, tag, channel: "zest-shared", data: { kind: n.kind } });
        if (r.delivered) delivered = true; else if (r.error) lastError = r.error;
      }
      // Someone with notifications off has nothing to retry; record it once rather than retrying five times.
      await db.rpc("complete_notification", { p_id: n.id, p_ok: delivered || lastError === "no_push_subscription", p_error: delivered ? null : lastError });
      if (delivered) notificationsSent++; else notificationsFailed++;
    } catch {
      notificationsFailed++;
      await db.rpc("complete_notification", { p_id: n.id, p_ok: false, p_error: "notification_failed" });
    }
  }
  if (notificationsClaimed) log("notification_run", { claimed: notificationsClaimed, sent: notificationsSent, failed: notificationsFailed });

  return Response.json({ ok: true, claimed: due?.length || 0, sent, failed, briefingsClaimed: briefings?.length || 0, briefingsSent, briefingsFailed, messagePushClaimed, messagePushSent, messagePushFailed, notificationsClaimed, notificationsSent, notificationsFailed, native: native.configured });
});
