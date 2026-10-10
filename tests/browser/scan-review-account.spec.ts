import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * Signed-in Save to Planner against a real Supabase stack (never production), incl. Plan with Zest, whose
 * results have no scan. Skipped unless pointed at one (same setup as appearance-account.spec.ts):
 *   SAVE_E2E_SUPABASE_URL=https://127.0.0.1:<port> SAVE_E2E_SECRET_KEY=<local secret key>
 *   TEST_BASE_URL=http://127.0.0.1:3101 npx playwright test scan-review-account
 */
const SUPABASE = process.env.SAVE_E2E_SUPABASE_URL || "";
const SECRET = process.env.SAVE_E2E_SECRET_KEY || "";
test.skip(!SUPABASE || !SECRET || /supabase\.co/.test(SUPABASE), "needs a local Supabase stack");
test.use({ ignoreHTTPSErrors: true, timezoneId: "Africa/Johannesburg", locale: "en-ZA", serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PASSWORD = "Save-Test-2026!";
const accounts = { a: `save-a-${run}@example.com`, b: `save-b-${run}@example.com` };
const ids: Record<string, string> = {};

async function admin(path: string, init: { method?: string; body?: string } = {}) {
  const { request } = await import("node:https");
  return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
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
const rows = async (who: "a" | "b") =>
  (await admin(`/rest/v1/planner_items?user_id=eq.${ids[who]}&select=title,start_date,start_time,end_time,timezone,all_day,source_scan_id&order=start_date`)).json as
    { title: string; start_date: string; start_time: string | null; end_time: string | null; source_scan_id: string | null }[];

const event = (title: string, date: string, start = "14:00", end = "15:00") => ({
  title, startDate: date, endDate: date, startTime: start, endTime: end, allDay: false, timezone: "Africa/Johannesburg",
  location: "", description: "", confidence: 0.9, confidenceReason: "", sourceText: "", category: "school",
});
const plan = [
  event("Study Session", "2031-11-03"), event("Study Session", "2031-11-04"), event("Study Session", "2031-11-05"),
  event("Maths test", "2031-11-06", "09:00", "10:00"), event("Swimming", "2031-11-07", "16:00", "17:00"),
];

async function device(browser: Browser) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, timezoneId: "Africa/Johannesburg", serviceWorkers: "block" });
  return { context, page: await context.newPage() };
}
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL(/\/app/);
}
async function planWithZest(page: Page, events: unknown[]) {
  await page.route("**/api/plan", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ documentType: "schedule", summary: "Your week", events, warnings: [] }) }),
  );
  await page.goto("/app");
  await page.getByRole("button", { name: /Plan with Zest/ }).click();
  await page.getByPlaceholder("Say it or type it here…").fill("Study sessions 3 to 5 November at 2pm, maths test on the 6th at 9, swimming on the 7th at 4");
  await page.getByRole("button", { name: /Organise my plan/ }).click();
  await expect(page.getByRole("heading", { name: `${events.length} ${events.length === 1 ? "event" : "events"} found` })).toBeVisible();
}

test.beforeAll(async () => {
  for (const [key, email] of Object.entries(accounts)) {
    const r = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    ids[key] = (r.json as { id: string }).id;
    await admin(`/rest/v1/profiles?id=eq.${ids[key]}`, { method: "PATCH", body: JSON.stringify({ onboarding_complete: true }) });
    // These accounts are not testing the one-time premium introduction (supabase/migrations/20261017100000_*).
    await admin(`/rest/v1/premium_onboarding?user_id=eq.${ids[key]}`, { method: "PATCH", body: JSON.stringify({ completed_at: new Date().toISOString(), choice: "free" }) });
  }
});

test("Plan with Zest: Save 5 to Planner saves all five to the account (was a silent no-op)", async ({ browser }) => {
  const d = await device(browser);
  await signIn(d.page, accounts.a);
  await planWithZest(d.page, plan);
  await expect(d.page.getByText("Review your plan before saving it.")).toHaveCount(0);
  await d.page.getByRole("button", { name: "Save 5 to Planner" }).click();
  await expect(d.page.getByRole("status").filter({ hasText: "5 events added to Planner" })).toBeVisible();
  const saved = await rows("a");
  expect(saved.map((r) => [r.title, r.start_date, r.start_time?.slice(0, 5)])).toEqual([
    ["Study Session", "2031-11-03", "14:00"], ["Study Session", "2031-11-04", "14:00"], ["Study Session", "2031-11-05", "14:00"],
    ["Maths test", "2031-11-06", "09:00"], ["Swimming", "2031-11-07", "16:00"],
  ]);
  expect(saved.every((r) => r.source_scan_id === null)).toBe(true);
  await d.page.getByRole("button", { name: "View in Planner" }).click();
  await expect.poll(async () => d.page.locator(".plannerCard h3").count()).toBe(5);
  // Still there after a reload and on a fresh device.
  await d.page.reload();
  await d.page.getByRole("tab", { name: "Upcoming" }).click();
  await expect(d.page.locator(".plannerCard", { hasText: "Maths test" })).toBeVisible();
  const other = await device(browser);
  await signIn(other.page, accounts.a);
  await other.page.goto("/app?view=planner&tab=upcoming");
  await expect.poll(async () => other.page.locator(".plannerCard h3").count()).toBe(5);
  await d.context.close();
  await other.context.close();
});

test("photo scan: partial failure says so, keeps the failed events selected, and the retry adds no duplicates", async ({ browser }) => {
  const d = await device(browser);
  await signIn(d.page, accounts.b);
  await d.page.route("**/api/extract", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ documentType: "school_notice", summary: "Term dates", events: plan, warnings: [] }) }),
  );
  // The server rejects two of the five inserts (as a dropped connection would).
  let blocked = true;
  await d.page.route("**/rest/v1/planner_items*", async (r) => {
    const body = r.request().postData() || "";
    if (blocked && r.request().method() === "POST" && /Maths test|Swimming/.test(body)) return r.abort("connectionreset");
    return r.continue();
  });
  await d.page.goto("/app");
  await expect(d.page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await d.page.locator("input[type=file]").last().setInputFiles({ name: "notice.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZsAAAAASUVORK5CYII=", "base64") });
  await d.page.getByRole("button", { name: "Save 5 to Planner" }).click();
  await expect(d.page.getByRole("status").filter({ hasText: "3 events saved · 2 couldn’t be saved" })).toBeVisible();
  await expect(d.page.getByText(/added to Planner/)).toHaveCount(0);
  expect((await rows("b")).length).toBe(3);
  blocked = false;
  await d.page.getByRole("button", { name: "Retry 2" }).click();
  await expect(d.page.getByRole("status").filter({ hasText: "2 events added to Planner" })).toBeVisible();
  const saved = await rows("b");
  expect(saved.length).toBe(5);
  expect(new Set(saved.map((r) => r.title + r.start_date)).size).toBe(5);
  // Scan items keep their link to the (owned) scan.
  expect(saved.every((r) => r.source_scan_id)).toBe(true);
  await d.context.close();
});

test("expired sign-in: saving reports failure, keeps the review, and nothing leaks between accounts", async ({ browser }) => {
  const d = await device(browser);
  await signIn(d.page, accounts.a);
  await planWithZest(d.page, [event("After expiry", "2031-12-01"), event("After expiry 2", "2031-12-02")]);
  // Simulate an expired/invalid session: every Planner write is rejected by the server.
  await d.page.route("**/rest/v1/planner_items*", (r) =>
    r.request().method() === "POST" ? r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "JWT expired" }) }) : r.continue(),
  );
  await d.page.getByRole("button", { name: "Save 2 to Planner" }).click();
  await expect(d.page.getByRole("status").filter({ hasText: "Couldn’t save your events. Please try again." })).toBeVisible();
  await expect(d.page.getByRole("heading", { name: "2 events found" })).toBeVisible();
  await expect(d.page.getByRole("button", { name: "Retry 2" })).toBeEnabled();
  expect((await rows("a")).some((r) => r.title.startsWith("After expiry"))).toBe(false);
  // Account B never sees A's items, and vice versa.
  expect((await rows("b")).some((r) => ["Maths test", "Swimming"].includes(r.title) && r.start_date === "2031-11-06")).toBe(true);
  const b = await device(browser);
  await signIn(b.page, accounts.b);
  await b.page.goto("/app?view=planner&tab=upcoming");
  await expect.poll(async () => b.page.locator(".plannerCard h3").count()).toBe(5);
  await expect(b.page.locator(".plannerCard", { hasText: "After expiry" })).toHaveCount(0);
  await d.context.close();
  await b.context.close();
});

test("offline while saving: events are queued, shown, and reach the account when back online", async ({ browser }) => {
  const d = await device(browser);
  await signIn(d.page, accounts.a);
  await planWithZest(d.page, [event("Offline lesson", "2031-12-10")]);
  await d.context.setOffline(true);
  await d.page.getByRole("button", { name: "Save 1 to Planner" }).click();
  await expect(d.page.getByRole("status").filter({ hasText: "1 event added to Planner" })).toBeVisible();
  expect((await rows("a")).some((r) => r.title === "Offline lesson")).toBe(false);
  await d.context.setOffline(false);
  await d.page.goto("/app?view=planner&tab=upcoming");
  await expect.poll(async () => (await rows("a")).filter((r) => r.title === "Offline lesson").length, { timeout: 20_000 }).toBe(1);
  await d.context.close();
});
