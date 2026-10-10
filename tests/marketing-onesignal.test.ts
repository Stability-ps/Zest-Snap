import { test } from "node:test";
import assert from "node:assert/strict";
import { ONESIGNAL_APP_ID, campaignPath, notificationPayload, sameSecret, sendOneSignal } from "../lib/marketing/onesignal";

const send = { id: "11111111-1111-4111-8111-111111111111", user_id: "00000000-0000-4000-8000-0000000000a1" };
const copy = { key: "reward_earned" as const, title: "You earned Zest credits", body: "Use them for extra scans.", path: "/app?view=rewards" };

test("payload: existing OneSignal app, addressed by Zest user id only, idempotent, opens inside the app", () => {
  assert.equal(ONESIGNAL_APP_ID, "6cc98d02-4051-47bf-948a-5d515d3896a6");
  const p = notificationPayload(copy, send);
  assert.equal(p.app_id, ONESIGNAL_APP_ID);
  assert.deepEqual(p.include_aliases, { external_id: [send.user_id] });
  assert.equal(p.idempotency_key, send.id);
  assert.equal(p.web_url, `https://app.zestsnap.app/app?view=rewards&mc=${send.id}`);
  assert.deepEqual(p.data, { path: `/app?view=rewards&mc=${send.id}`, campaign: "reward_earned" });
  assert.doesNotMatch(JSON.stringify(p), /@|email|display_name/i, "no personal data beyond the user id");
  // Paths that aren't the app fall back to /app.
  assert.equal(campaignPath("https://evil.example", send.id), `/app?mc=${send.id}`);
  assert.equal(campaignPath("/settings", send.id), `/app?mc=${send.id}`);
  assert.equal(campaignPath("/app", send.id), `/app?mc=${send.id}`);
});

test("sending: the REST key only in the Authorization header; results classified", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const ok = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ id: "os-notification-1" }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await sendOneSignal(notificationPayload(copy, send), "secret-rest-key", ok);
  assert.deepEqual(r, { status: "sent", providerId: "os-notification-1" });
  assert.equal(seen!.url, "https://api.onesignal.com/notifications?c=push");
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Key secret-rest-key");
  assert.doesNotMatch(String(seen!.init.body), /secret-rest-key/);

  const noDevice = (async () => new Response(JSON.stringify({ id: "", errors: ["All included players are not subscribed"] }), { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await sendOneSignal(notificationPayload(copy, send), "k", noDevice), { status: "skipped", error: "no_subscribed_device" });
  const invalidAlias = (async () => new Response(JSON.stringify({ id: "x", errors: { invalid_aliases: { external_id: [send.user_id] } } }), { status: 200 })) as unknown as typeof fetch;
  assert.equal((await sendOneSignal(notificationPayload(copy, send), "k", invalidAlias)).status, "skipped");
  const denied = (async () => new Response(JSON.stringify({ errors: ["Access denied"] }), { status: 403 })) as unknown as typeof fetch;
  assert.deepEqual(await sendOneSignal(notificationPayload(copy, send), "k", denied), { status: "failed", error: "http_403" });
  const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  assert.deepEqual(await sendOneSignal(notificationPayload(copy, send), "k", down), { status: "failed", error: "network" });
});

test("scheduler secret comparison", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abd", "abc"), false);
  assert.equal(sameSecret("ab", "abc"), false);
  assert.equal(sameSecret(null, "abc"), false);
  assert.equal(sameSecret("abc", undefined), false, "no secret configured: always refused");
});

test("scheduler route: refused without the secret; without the OneSignal key it claims nothing", async () => {
  const saved = { cron: process.env.CRON_SECRET, key: process.env.ONESIGNAL_REST_API_KEY };
  process.env.CRON_SECRET = "cron-test-secret";
  delete process.env.ONESIGNAL_REST_API_KEY;
  try {
    const { GET } = await import("../app/api/cron/marketing/route");
    assert.equal((await GET(new Request("https://app.zestsnap.app/api/cron/marketing"))).status, 401);
    assert.equal((await GET(new Request("https://app.zestsnap.app/api/cron/marketing", { headers: { authorization: "Bearer wrong" } }))).status, 401);
    const res = await GET(new Request("https://app.zestsnap.app/api/cron/marketing", { headers: { authorization: "Bearer cron-test-secret" } }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, skipped: "onesignal_not_configured" });
  } finally {
    process.env.CRON_SECRET = saved.cron;
    if (saved.key) process.env.ONESIGNAL_REST_API_KEY = saved.key;
  }
});
