import { test, expect, type Page } from "@playwright/test";

/**
 * Marketing notifications end to end against a local Supabase stack (never production): opt-in in Settings
 * (OneSignal's web SDK is replaced in the browser by a fake), a campaign enabled in Admin › Campaigns, the real
 * scheduler route delivering to a local stand-in for api.onesignal.com (scratch build only — the host is replaced
 * there, never in the repository), and the open recorded from the deep link.
 *   MARKETING_E2E_SUPABASE_URL=https://127.0.0.1:<port> MARKETING_E2E_SECRET_KEY=<local secret key>
 *   MARKETING_E2E_ONESIGNAL_STUB=http://127.0.0.1:56998 MARKETING_E2E_CRON_SECRET=<server CRON_SECRET>
 *   TEST_BASE_URL=http://localhost:3101 npx playwright test marketing-account
 */
const SUPABASE = process.env.MARKETING_E2E_SUPABASE_URL || "";
const SECRET = process.env.MARKETING_E2E_SECRET_KEY || "";
const STUB = process.env.MARKETING_E2E_ONESIGNAL_STUB || "";
const CRON = process.env.MARKETING_E2E_CRON_SECRET || "";
test.skip(!SUPABASE || !SECRET || !STUB || !CRON || /supabase\.co/.test(SUPABASE), "needs a local stack and OneSignal stand-in");
test.use({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

const PASSWORD = "Marketing-Test-2026!";
const run = Date.now().toString(36);
const ids: Record<string, string> = {};
async function admin(path: string, init: { method?: string; body?: string } = {}) {
  const { request } = await import("node:https");
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const req = request(new URL(path, SUPABASE), {
      method: init.method || "GET", rejectUnauthorized: false,
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation" },
    }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode || 0, json: b ? JSON.parse(b) : null })); });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL((u) => u.pathname === "/app" || u.pathname.startsWith("/admin"));
}
/** Stand-in for OneSignal's web SDK v16: records calls, grants permission. */
async function fakeOneSignal(page: Page) {
  await page.route("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js", (r) =>
    r.fulfill({ contentType: "application/javascript", body: `
      window.__os = [];
      const OneSignal = {
        init: async (o) => { window.__os.push(["init", o.appId, o.serviceWorkerParam && o.serviceWorkerParam.scope]); },
        login: async (id) => { window.__os.push(["login", id]); },
        logout: async () => { window.__os.push(["logout"]); },
        Notifications: { permission: false, requestPermission: async () => { OneSignal.Notifications.permission = true; window.__os.push(["permission"]); } },
        User: { PushSubscription: { optIn: async () => window.__os.push(["optIn"]), optOut: async () => window.__os.push(["optOut"]) } },
      };
      for (const f of window.OneSignalDeferred || []) f(OneSignal);
      window.OneSignalDeferred = { push: (f) => f(OneSignal) };` }));
}

test.beforeAll(async () => {
  for (const [key, email] of [["person", `mkt-${run}@example.com`], ["admin", `mkt-admin-${run}@example.com`]]) {
    const r = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    ids[key] = r.json.id;
  }
  await admin(`/rest/v1/profiles?id=eq.${ids.admin}`, { method: "PATCH", body: JSON.stringify({ is_admin: true }) });
  // Deterministic regardless of when the test runs.
  for (const key of ["marketing_quiet_start_hour", "marketing_quiet_end_hour"])
    await admin(`/rest/v1/app_limits?key=eq.${key}`, { method: "PATCH", body: JSON.stringify({ value: 0 }) });
  // Start from the shipped state: every campaign off, nothing sent.
  await admin(`/rest/v1/marketing_campaigns?key=neq.none`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  await fetch(STUB + "/reset");
});

test("opt-in in Settings links this device to the account and records consent; opting out withdraws it", async ({ page }) => {
  await fakeOneSignal(page);
  await signIn(page, `mkt-${run}@example.com`);
  await page.goto("/settings");
  const toggle = page.getByRole("checkbox", { name: "Tips and offers notifications" });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(page.locator(".settingsSaved")).toHaveText("Tips and offers are on. At most 2 a week, never at night.");
  await expect(toggle).toBeChecked();
  const calls = await page.evaluate(() => (window as unknown as { __os: unknown[] }).__os);
  expect(calls).toEqual([["init", "6cc98d02-4051-47bf-948a-5d515d3896a6", "/push/onesignal/"], ["login", ids.person], ["permission"], ["optIn"]]);
  const consent = (await admin(`/rest/v1/marketing_consent?user_id=eq.${ids.person}&select=push_opt_in,platform,opted_in_at`)).json[0];
  expect(consent).toMatchObject({ push_opt_in: true, platform: "web" });
  // Off and on again: consent follows.
  await toggle.click();
  await expect(page.locator(".settingsSaved")).toHaveText("Tips and offers are off. Reminders are not affected.");
  expect((await admin(`/rest/v1/marketing_consent?user_id=eq.${ids.person}&select=push_opt_in`)).json[0].push_opt_in).toBe(false);
  await toggle.click();
  await expect(toggle).toBeChecked();
});

test("admin enables a campaign; the scheduler delivers once, idempotently, by user id; the open is recorded", async ({ page, request }) => {
  await admin(`/rest/v1/reward_ledger`, { method: "POST", body: JSON.stringify({ user_id: ids.person, entry_type: "earn", amount: 5, reason: "first_scan" }) });
  // Nothing is sent while the campaign is off.
  const off = await request.get("/api/cron/marketing", { headers: { authorization: `Bearer ${CRON}` } });
  expect(await off.json()).toMatchObject({ ok: true, summary: {} });
  expect(JSON.parse(await (await fetch(STUB + "/seen")).text())).toEqual([]);

  await signIn(page, `mkt-admin-${run}@example.com`);
  await page.goto("/admin/campaigns");
  await expect(page.getByText("OneSignal REST API key")).toBeVisible();
  const card = page.locator(".zadm-card", { hasText: "When someone earns credits" });
  await card.getByLabel("Send this campaign").check();
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Campaign saved")).toBeVisible();

  expect((await request.get("/api/cron/marketing")).status()).toBe(401);
  const res = await request.get("/api/cron/marketing", { headers: { authorization: `Bearer ${CRON}` } });
  expect(await res.json()).toMatchObject({ ok: true, summary: { reward_earned: { sent: 1, failed: 0, skipped: 0 } } });
  const seen = JSON.parse(await (await fetch(STUB + "/seen")).text());
  expect(seen.length).toBe(1);
  expect(seen[0].authScheme).toBe("Key");
  const body = seen[0].body;
  expect(body.app_id).toBe("6cc98d02-4051-47bf-948a-5d515d3896a6");
  expect(body.include_aliases).toEqual({ external_id: [ids.person] });
  const send = (await admin(`/rest/v1/marketing_sends?user_id=eq.${ids.person}&select=id,status,provider_id`)).json[0];
  expect(send).toMatchObject({ status: "sent", provider_id: "stub-1" });
  expect(body.idempotency_key).toBe(send.id);
  expect(body.data.path).toBe(`/app?view=rewards&mc=${send.id}`);
  // A second run sends nothing (same reward, and the 72-hour gap).
  const again = await request.get("/api/cron/marketing", { headers: { authorization: `Bearer ${CRON}` } });
  expect(await again.json()).toMatchObject({ summary: { reward_earned: { sent: 0 } } });

  // The person taps it: the open is recorded and the parameter removed.
  const person = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
  const p = await person.newPage();
  await signIn(p, `mkt-${run}@example.com`);
  await p.goto(body.data.path);
  await expect(p).toHaveURL(/view=rewards$/);
  await expect.poll(async () => (await admin(`/rest/v1/marketing_sends?id=eq.${send.id}&select=opened_at`)).json[0].opened_at).not.toBeNull();
  await person.close();

  await page.goto("/admin/campaigns");
  const after = page.locator(".zadm-card", { hasText: "When someone earns credits" });
  await expect(after).toContainText("Sent");
  // Totals include earlier runs on the same local database: at least this send, sent and opened.
  await expect(after).toContainText(/Opened\s*[1-9]\d* · /);
});
