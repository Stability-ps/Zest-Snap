/**
 * OneSignal (existing app 6cc98d02-4051-47bf-948a-5d515d3896a6) — marketing notifications only.
 * Reminders never go through here. The App ID is public by design; the REST API key is a server secret
 * (ONESIGNAL_REST_API_KEY, Vercel env) and is never sent to the browser or logged.
 */
export const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || "6cc98d02-4051-47bf-948a-5d515d3896a6";
export const MARKETING_CAMPAIGNS = ["reward_earned", "free_scans_exhausted", "inactive_users"] as const;
export type MarketingCampaign = (typeof MARKETING_CAMPAIGNS)[number];
export type CampaignCopy = { key: MarketingCampaign; title: string; body: string; path: string };

const IN_APP_PATH = /^\/app(\?[A-Za-z0-9=&_-]*)?$/;

/** The in-app destination with the send id, so opening the notification is attributed (record_marketing_open). */
export function campaignPath(path: string, sendId: string) {
  const safe = IN_APP_PATH.test(path) ? path : "/app";
  return `${safe}${safe.includes("?") ? "&" : "?"}mc=${encodeURIComponent(sendId)}`;
}

export function notificationPayload(copy: CampaignCopy, send: { id: string; user_id: string }, origin = "https://app.zestsnap.app") {
  const path = campaignPath(copy.path, send.id);
  return {
    app_id: ONESIGNAL_APP_ID,
    target_channel: "push",
    // Addressed by Zest user id only (OneSignal external_id, set when the person opted in).
    include_aliases: { external_id: [send.user_id] },
    headings: { en: copy.title },
    contents: { en: copy.body },
    // Web/PWA open the URL; the iOS/Android apps route `data.path` inside the app (lib/marketing/push.ts).
    web_url: origin + path,
    data: { path, campaign: copy.key },
    // OneSignal de-duplicates retries with the same key, so a retried request never notifies twice.
    idempotency_key: send.id,
    ttl: 60 * 60 * 24,
    // Marketing, not time-critical: let iOS group it quietly.
    ios_interruption_level: "passive",
  };
}

export type SendResult = { status: "sent" | "failed" | "skipped"; providerId?: string; error?: string };

/** Sends one notification. "skipped" = the person has no subscribed device (opted in but blocked or uninstalled). */
export async function sendOneSignal(payload: ReturnType<typeof notificationPayload>, restKey: string, fetcher: typeof fetch = fetch): Promise<SendResult> {
  try {
    const res = await fetcher("https://api.onesignal.com/notifications?c=push", {
      method: "POST",
      headers: { Authorization: `Key ${restKey}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; errors?: unknown };
    const errors = Array.isArray(body.errors) ? body.errors.map(String) : body.errors && typeof body.errors === "object" ? Object.keys(body.errors) : [];
    if (!res.ok) return { status: "failed", error: `http_${res.status}` };
    if (!body.id || errors.some((e) => /not subscribed|invalid_aliases|no recipients/i.test(e))) return { status: "skipped", error: "no_subscribed_device" };
    return { status: "sent", providerId: body.id };
  } catch (e) {
    return { status: "failed", error: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network" };
  }
}

/** Constant-time comparison for the cron secret. */
export function sameSecret(given: string | null, expected: string | undefined) {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
