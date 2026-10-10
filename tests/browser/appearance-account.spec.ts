import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * Signed-in appearance sync against a real Supabase stack (never production). Skipped unless pointed at one:
 *   APPEARANCE_E2E_SUPABASE_URL=https://127.0.0.1:<port> APPEARANCE_E2E_SECRET_KEY=<local secret key>
 *   TEST_BASE_URL=http://127.0.0.1:3101 npx playwright test appearance-account
 * The app under test must be built with NEXT_PUBLIC_SUPABASE_URL set to the same stack. The URL must be https
 * (lib/supabase/config.ts); a self-signed proxy in front of `supabase start` works with ignoreHTTPSErrors.
 */
const SUPABASE = process.env.APPEARANCE_E2E_SUPABASE_URL || "";
const SECRET = process.env.APPEARANCE_E2E_SECRET_KEY || "";
test.skip(!SUPABASE || !SECRET || /supabase\.co/.test(SUPABASE), "needs a local Supabase stack");
test.use({ ignoreHTTPSErrors: true, timezoneId: "America/New_York", locale: "en-US" });
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PASSWORD = "Theme-Test-2026!";
const accounts = { a: `appearance-a-${run}@example.com`, b: `appearance-b-${run}@example.com` };
const ids: Record<string, string> = {};

async function admin(path: string, init: RequestInit = {}) {
  const { request } = await import("node:https");
  const url = new URL(path, SUPABASE);
  return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
    const req = request(
      url,
      { method: init.method || "GET", rejectUnauthorized: false, headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation" } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, json: body ? JSON.parse(body) : null }));
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
const savedAppearance = async (who: "a" | "b") =>
  ((await admin(`/rest/v1/profiles?id=eq.${ids[who]}&select=preferences`)).json as { preferences: Record<string, unknown> }[])[0]?.preferences;
const theme = (page: Page) => page.evaluate(() => ({ ...document.documentElement.dataset }));

async function device(browser: Browser, scheme: "light" | "dark") {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme: scheme, viewport: { width: 390, height: 844 } });
  return { context, page: await context.newPage() };
}
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL(/\/(app|onboarding)/);
}
async function choose(page: Page, mode: "Light" | "Dark" | "Automatic", accent: string) {
  await page.goto("/settings?sheet=appearance");
  await page.getByRole("dialog").getByText(mode, { exact: true }).click();
  await page.getByTitle(accent, { exact: true }).click();
}

test.beforeAll(async () => {
  for (const [key, email] of Object.entries(accounts)) {
    const r = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    ids[key] = (r.json as { id: string }).id;
    await admin(`/rest/v1/profiles?id=eq.${ids[key]}`, { method: "PATCH", body: JSON.stringify({ onboarding_complete: true }) });
  }
});

test("a choice is saved to the account and follows the person to another device", async ({ browser }) => {
  const one = await device(browser, "light");
  await signIn(one.page, accounts.a);
  await choose(one.page, "Dark", "Violet");
  expect(await theme(one.page)).toMatchObject({ theme: "dark", accent: "violet" });
  await expect.poll(async () => (await savedAppearance("a"))?.appearance, { timeout: 10_000 }).toMatchObject({ mode: "dark", accent: "violet" });

  // Saving an unrelated preference keeps the appearance (profiles.preferences is shared).
  await one.page.goto("/settings");
  await one.page.locator("label.settingsRow", { hasText: "Upcoming insights" }).locator("input").click();
  await expect(one.page.getByRole("status")).toHaveText("Saved");
  expect((await savedAppearance("a"))?.appearance).toMatchObject({ mode: "dark", accent: "violet" });

  // Second device, OS in light mode: adopts the account's Dark + Violet on sign-in.
  const two = await device(browser, "light");
  await signIn(two.page, accounts.a);
  await expect.poll(async () => theme(two.page)).toMatchObject({ theme: "dark", accent: "violet" });

  // A newer change on device two reaches device one when it returns to the foreground.
  await choose(two.page, "Light", "Amber");
  await expect.poll(async () => (await savedAppearance("a"))?.appearance).toMatchObject({ mode: "light", accent: "amber" });
  await one.page.goto("/app");
  await expect.poll(async () => theme(one.page), { timeout: 10_000 }).toMatchObject({ theme: "light", accent: "amber" });
  await one.context.close();
  await two.context.close();
});

test("offline changes apply immediately and upload when the connection returns", async ({ browser }) => {
  const d = await device(browser, "light");
  await signIn(d.page, accounts.a);
  await d.page.goto("/settings?sheet=appearance");
  await d.context.setOffline(true);
  await d.page.getByText("Dark", { exact: true }).click();
  await d.page.getByTitle("Teal", { exact: true }).click();
  expect(await theme(d.page)).toMatchObject({ theme: "dark", accent: "teal" });
  expect(JSON.parse((await d.page.evaluate(() => localStorage.getItem("zest-appearance-v1")))!)).toMatchObject({ dirty: true });
  expect((await savedAppearance("a"))?.appearance).toMatchObject({ mode: "light", accent: "amber" });
  await d.context.setOffline(false);
  await expect.poll(async () => (await savedAppearance("a"))?.appearance, { timeout: 10_000 }).toMatchObject({ mode: "dark", accent: "teal" });
  await d.context.close();
});

test("account switching: each account keeps its own appearance across sign-out and sign-in", async ({ browser }) => {
  const d = await device(browser, "light");
  await signIn(d.page, accounts.a);
  await expect.poll(async () => theme(d.page)).toMatchObject({ theme: "dark", accent: "teal" });
  await d.page.goto("/settings");
  await d.page.getByRole("button", { name: /Account/ }).click();
  await d.page.getByRole("button", { name: "Sign out" }).click();
  await d.page.waitForURL(/\/login/);
  // Signed out, the device keeps the last look (no flash back to defaults).
  expect((await theme(d.page)).theme).toBe("dark");

  // B has never chosen: B's account receives what this device shows, then B makes their own choice.
  await signIn(d.page, accounts.b);
  await expect.poll(async () => (await savedAppearance("b"))?.appearance, { timeout: 10_000 }).toMatchObject({ mode: "dark", accent: "teal" });
  await choose(d.page, "Light", "Rose");
  await expect.poll(async () => (await savedAppearance("b"))?.appearance).toMatchObject({ mode: "light", accent: "rose" });
  await d.page.goto("/settings");
  await d.page.getByRole("button", { name: /Account/ }).click();
  await d.page.getByRole("button", { name: "Sign out" }).click();
  await d.page.waitForURL(/\/login/);

  // A signs back in on the same device: A's own Dark + Teal returns; B's choice is untouched.
  await signIn(d.page, accounts.a);
  await expect.poll(async () => theme(d.page), { timeout: 10_000 }).toMatchObject({ theme: "dark", accent: "teal" });
  expect((await savedAppearance("a"))?.appearance).toMatchObject({ mode: "dark", accent: "teal" });
  expect((await savedAppearance("b"))?.appearance).toMatchObject({ mode: "light", accent: "rose" });
  await d.context.close();
});

test("Shared plans and messages follow the theme", async ({ browser }, info) => {
  const d = await device(browser, "dark");
  await signIn(d.page, accounts.b);
  await choose(d.page, "Automatic", "Ocean Blue");
  await d.page.goto("/app?view=shared");
  await d.page.getByRole("button", { name: /Create sh/ }).first().click();
  await d.page.getByPlaceholder("e.g. Sibande family").fill("Theme test family");
  await d.page.getByRole("button", { name: "Create plan" }).click();
  await d.page.getByText("Theme test family").first().click();
  await d.page.waitForURL(/\/shared\//);
  await d.page.getByRole("button", { name: "Messages", exact: true }).click();
  const box = d.page.getByPlaceholder("Message the group…");
  await box.fill("Who is bringing snacks?");
  await d.page.getByRole("button", { name: /Send/ }).click();
  await expect(d.page.getByText("Who is bringing snacks?")).toBeVisible();
  for (const scheme of ["dark", "light"] as const) {
    await d.page.emulateMedia({ colorScheme: scheme });
    await expect.poll(async () => (await theme(d.page)).theme).toBe(scheme);
    await expect(d.page.getByText("Who is bringing snacks?")).toBeVisible();
    await d.page.screenshot({ path: info.outputPath(`shared-chat-${scheme}.png`), fullPage: true });
    const bubble = d.page.getByText("Who is bringing snacks?");
    const [fg, bg] = await bubble.evaluate((e) => {
      const b = e.closest("[class*=bubble]") || e;
      return [getComputedStyle(e).color, getComputedStyle(b).backgroundColor];
    });
    expect(fg).not.toBe(bg);
  }
  await d.context.close();
});
