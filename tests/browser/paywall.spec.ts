import { test, expect } from "@playwright/test";

// Guest-side paywall and premium page against a production build (no account, extraction mocked).
// The server-enforced limit, refunds and signup are covered by tests/onboarding.test.ts and funnel-account.spec.ts.
test.use({ serviceWorkers: "block" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZsAAAAASUVORK5CYII=", "base64");
const usedUp = () => localStorage.setItem("zest-guest-trial-v1", JSON.stringify({ remaining: 0, at: 1 }));

test("a guest who used the trial sees the upgrade options instead of a file picker; Not now closes it", async ({ page }) => {
  let uploads = 0;
  await page.route("**/api/extract", (r) => { uploads++; return r.abort(); });
  await page.addInitScript(usedUp);
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "You’ve captured 3 important moments." });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Ready for more?")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Explore Premium" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create a free account — get 3 more scans" })).toBeVisible();
  await expect(dialog.getByText("No payment required.", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Take photo" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(dialog).toHaveCount(0);
  expect(uploads).toBe(0);
  // Saved work stays reachable.
  await page.getByRole("button", { name: "Planner", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your planner" })).toBeVisible();
});

test("the server's refusal shows the same paywall (the local hint is only a shortcut)", async ({ page }) => {
  await page.route("**/api/extract", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "guest_trial_exhausted", error: "You’ve used the free trial scans on this device." }) }),
  );
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.locator("input[type=file]").last().setInputFiles({ name: "x.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("dialog", { name: "You’ve captured 3 important moments." })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("zest-guest-trial-v1") || "{}").remaining)).toBe(0);
});

test("paywall buttons: Explore Premium opens the premium page; Create a free account opens sign-up", async ({ page }) => {
  await page.addInitScript(usedUp);
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.getByRole("button", { name: "Explore Premium" }).click();
  await page.waitForURL(/\/upgrade\?from=guest/);
  await expect(page.getByRole("heading", { name: "You’ve captured 3 important moments." })).toBeVisible();
  await expect(page.getByRole("list", { name: "What Pro adds" }).getByRole("listitem")).toHaveCount(4);
  // Guests create an account before buying (plans follow the account); no invented prices or buy buttons.
  await expect(page.getByRole("link", { name: /Create a free account/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Subscribe/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Create a free account/ }).click();
  await page.waitForURL(/\/login\?mode=signup/);
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
});

for (const [w, h] of [[320, 568], [375, 667], [430, 932], [1280, 800]] as const) {
  test(`paywall and premium page fit ${w}×${h} without horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(usedUp);
    await page.goto("/app");
    await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    const create = page.getByRole("button", { name: /Create a free account/ });
    await expect(create).toBeInViewport();
    expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const from of ["guest", "onboarding", "free_limit", "settings"]) {
      await page.goto(`/upgrade?from=${from}`);
      await expect(page.locator("h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), from).toBe(true);
    }
  });
}

test("premium page (Figma 4:2): light in dark mode, no invented prices, honest on the web", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("zest-appearance-v1", JSON.stringify({ mode: "dark", accent: "violet", updatedAt: 1 })));
  await page.goto("/upgrade?from=settings");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveAttribute("data-accent", /./);
  await expect(page.getByRole("heading", { name: "Get more from Zest Snap." })).toBeVisible();
  await expect(page.getByText("Coffee with Sarah")).toBeVisible();
  for (const b of ["More AI scans", "Smart reminders", "Plan with Zest AI", "Sync everywhere"]) await expect(page.getByText(b, { exact: true })).toBeVisible();
  // Not signed in: account first, no prices anywhere.
  await expect(page.getByRole("link", { name: /Create a free account/ })).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(/[$€£¥]\s?\d|R\s?\d+[.,]\d{2}/);
  await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
});
