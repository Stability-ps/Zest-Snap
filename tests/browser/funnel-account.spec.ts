import { test, expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

/**
 * Guest → paywall → free account → one-time premium screen → Free → free limit, against a real local Supabase
 * stack and the real /api/extract reservation/refund path (never production). The AI call itself must be
 * pointed at a local stub (a scratch build that replaces the OpenAI URL; see docs/guest-to-pro-onboarding.md).
 *   FUNNEL_E2E_SUPABASE_URL=https://127.0.0.1:<port> FUNNEL_E2E_SECRET_KEY=<local secret key>
 *   FUNNEL_E2E_AI_STUB=http://127.0.0.1:56999 TEST_BASE_URL=http://127.0.0.1:3101 npx playwright test funnel-account
 */
const SUPABASE = process.env.FUNNEL_E2E_SUPABASE_URL || "";
const SECRET = process.env.FUNNEL_E2E_SECRET_KEY || "";
const STUB = process.env.FUNNEL_E2E_AI_STUB || "";
test.skip(!SUPABASE || !SECRET || !STUB || /supabase\.co/.test(SUPABASE), "needs a local Supabase stack and AI stub");
test.use({ ignoreHTTPSErrors: true, serviceWorkers: "block", viewport: { width: 390, height: 844 } });
test.describe.configure({ mode: "serial", timeout: 120_000 });

const run = Date.now().toString(36);
const PASSWORD = "Funnel-Test-2026!";

async function admin(path: string, init: { method?: string; body?: string } = {}) {
  const { request } = await import("node:https");
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const req = request(new URL(path, SUPABASE), {
      method: init.method || "GET", rejectUnauthorized: false,
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation" },
    }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, json: body ? JSON.parse(body) : null }));
    });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
const stub = (path: string) => fetch(STUB + path).then((r) => r.text());

/** A distinct valid 1×1 PNG per call, so every upload is a new file (no cached result). */
let pixel = 0;
function png() {
  pixel++;
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, pixel & 255, (pixel >> 8) & 255, 77]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
let lastUpload = 0;
async function upload(page: Page) {
  // The server refuses a second scan within 5 seconds of the previous one (anti-burst); scan at a human pace.
  const wait = lastUpload + 5300 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  lastUpload = Date.now();
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.locator("input[type=file]").last().setInputFiles({ name: `notice-${pixel}.png`, mimeType: "image/png", buffer: png() });
}
const deviceOf = (page: Page) => page.evaluate(() => localStorage.getItem("zest-device-id-v1"));
const events = async (subject: string) =>
  ((await admin(`/rest/v1/conversion_events?subject=eq.${encodeURIComponent(subject)}&select=event`)).json as { event: string }[]).map((r) => r.event).sort();

test.beforeAll(async () => {
  await stub("/reset");
  // Every test device shares 127.0.0.1, so lift the per-network guest cap for this local run only.
  await admin(`/rest/v1/app_limits?key=eq.guest_scans_per_network_day`, { method: "PATCH", body: JSON.stringify({ value: 1000 }) });
  await admin(`/rest/v1/app_limits?key=eq.device_scans_per_hour`, { method: "PATCH", body: JSON.stringify({ value: 1000 }) });
});

test("guest: exactly three successful scans (a failed one is free), then the paywall — guest data moves to the new account", async ({ page }) => {
  const email = `funnel-${run}@example.com`;
  await page.goto("/app");
  await upload(page);
  await expect(page.getByText("Free trial: 2 scans left on this device.", { exact: false })).toBeVisible();
  // A scan the AI fails on is refunded.
  await stub("/fail-next");
  await page.getByRole("button", { name: /Scan another/ }).click();
  await upload(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await upload(page);
  await expect(page.getByText("Free trial: 1 scan left on this device.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /Save 1 to Planner/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 event added to Planner" })).toBeVisible();
  await page.getByRole("button", { name: /Scan another/ }).click();
  await upload(page);
  await expect(page.getByText("That was your last free trial scan.", { exact: false })).toBeVisible();
  const device = await deviceOf(page);
  const usage = (await admin(`/rest/v1/guest_scan_usage?select=status`)).json as { status: string }[];
  expect(usage.filter((u) => u.status === "completed").length).toBeGreaterThanOrEqual(3);

  // Fourth attempt: the paywall, without uploading anything.
  const before = Number(await stub("/calls"));
  await page.getByRole("button", { name: /Scan another/ }).click();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const paywall = page.getByRole("dialog", { name: "You’ve captured 3 important moments." });
  await expect(paywall).toBeVisible();
  await expect(paywall.getByRole("button", { name: "Explore Premium" })).toBeVisible();
  expect(Number(await stub("/calls"))).toBe(before);
  // Even if the local hint is cleared, the server refuses and the same paywall appears.
  await paywall.getByRole("button", { name: "Not now" }).click();
  await page.evaluate(() => localStorage.removeItem("zest-guest-trial-v1"));
  await upload(page);
  await expect(page.getByRole("dialog", { name: "You’ve captured 3 important moments." })).toBeVisible();
  expect(Number(await stub("/calls"))).toBe(before);

  // Create a free account from the paywall.
  await page.getByRole("button", { name: /Create a free account/ }).click();
  await page.waitForURL(/\/login\?mode=signup/);
  await page.getByPlaceholder("What should Zest call you?").fill("Funnel Tester");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[autocomplete="new-password"]').last().fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // New verified account: the premium screen, once.
  await page.waitForURL(/\/upgrade\?from=onboarding/);
  await expect(page.getByRole("heading", { name: "Get more from Zest Snap." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Free plan" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Free plan" }).click();
  await page.waitForURL(/\/app$/);
  await expect(page.getByText("Your guest scans and plans were saved to your account.")).toBeVisible();

  const user = (await admin(`/auth/v1/admin/users?per_page=200`)).json.users.find((u: { email: string }) => u.email === email);
  const scans = (await admin(`/rest/v1/scans?user_id=eq.${user.id}&select=id`)).json as unknown[];
  const planner = (await admin(`/rest/v1/planner_items?user_id=eq.${user.id}&select=title`)).json as { title: string }[];
  expect(scans.length).toBe(3);
  expect(planner.length).toBe(1);
  const onboarding = (await admin(`/rest/v1/premium_onboarding?user_id=eq.${user.id}&select=choice,completed_at`)).json[0];
  expect(onboarding.choice).toBe("free");

  // Funnel events recorded, pseudonymously and once each.
  const { createHash } = await import("node:crypto");
  const guestEvents = await events("d:" + createHash("sha256").update(device!).digest("hex"));
  expect(guestEvents).toEqual(expect.arrayContaining(["free_registration_started", "guest_limit_reached", "guest_paywall_viewed"]));
  expect(guestEvents.filter((e) => e === "guest_limit_reached").length).toBe(1);
  expect(await events("u:" + user.id)).toEqual(expect.arrayContaining(["free_plan_selected", "verified_paywall_viewed"]));

  // Sign out and back in: no second premium screen; the data is still there.
  await page.goto("/settings");
  await page.getByRole("button", { name: /Account/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL(/\/app$/);
  await page.goto("/app?view=planner&tab=upcoming");
  await expect(page.locator(".plannerCard")).toHaveCount(1);
});

test("registered Free: its own monthly allowance (independent of the guest trial), then a contextual upgrade", async ({ browser }) => {
  const email = `free-${run}@example.com`;
  const created = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) });
  const id = created.json.id as string;
  await admin(`/rest/v1/profiles?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ onboarding_complete: true }) });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL(/\/upgrade\?from=onboarding/);
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.waitForURL(/\/app$/);
  for (let i = 0; i < 3; i++) {
    await upload(page);
    await expect(page.getByRole("heading", { name: /event found/ })).toBeVisible();
    await page.getByRole("button", { name: /Scan another/ }).click();
  }
  await upload(page);
  await expect(page.locator(".errorBox")).toContainText(/scan/i);
  await page.getByRole("button", { name: "See plans" }).click();
  await page.waitForURL(/\/upgrade\?from=free_limit/);
  await expect(page.getByRole("heading", { name: "You’ve used this month’s scans." })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("3 of 3");
  await expect(page.getByRole("button", { name: "Back to my Planner" })).toBeVisible();
  // Skipping recorded a choice, so the welcome screen never returns.
  expect((await admin(`/rest/v1/premium_onboarding?user_id=eq.${id}&select=choice`)).json[0].choice).toBe("dismissed");
  await context.close();
});

test("accounts that existed before the feature are never shown the premium screen", async ({ browser }) => {
  const email = `existing-${run}@example.com`;
  const created = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) });
  // What a pre-feature account looks like: no onboarding row.
  await admin(`/rest/v1/premium_onboarding?user_id=eq.${created.json.id}`, { method: "DELETE" });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL(/\/app$/);
  await context.close();
});
