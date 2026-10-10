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
  await expect(page.getByRole("list", { name: "What you get with Pro" }).getByRole("listitem")).toHaveCount(4);
  // Annual is preselected; the choice is a real radio group.
  const plans = page.getByRole("radiogroup", { name: "Choose your Pro plan" });
  await expect(plans.getByRole("radio", { name: /Pro – Annual/ })).toHaveAttribute("aria-checked", "true");
  await plans.getByRole("radio", { name: /Pro – Monthly/ }).click();
  await expect(plans.getByRole("radio", { name: /Pro – Monthly/ })).toHaveAttribute("aria-checked", "true");
  await expect(plans.getByRole("radio", { name: /Pro – Annual/ })).toHaveAttribute("aria-checked", "false");
  // On the web there is no store: no invented prices, only an honest note.
  await expect(plans.getByText("Price in app")).toHaveCount(2);
  await expect(page.locator(".pwPrice b")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore Purchases" })).toBeVisible();
  // Guests create an account before buying (plans follow the account); Continue with Pro goes to sign-up first.
  await expect(page.getByRole("link", { name: /Create a free account/ })).toBeVisible();
  await page.getByRole("button", { name: /Continue with Pro/ }).click();
  await page.waitForURL(/\/login\?mode=signup&next=%2Fupgrade%3Ffrom%3Dguest%26plan%3Dmonthly/);
  await page.goBack();
  await page.waitForURL(/\/upgrade\?from=guest/);
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
      // Primary actions are full-width and comfortably tappable.
      for (const cta of [page.getByRole("button", { name: /Continue with Pro/ }), page.locator(".pwFree")]) {
        const box = (await cta.boundingBox())!;
        expect(box.height, from).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width, from).toBeLessThanOrEqual(w);
      }
    }
  });
}

test("premium page: light in dark mode, no invented prices, honest on the web", async ({ page }) => {
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
  await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
});

test("Settings upgrade entry points open the Premium page; Back returns to Settings", async ({ page }) => {
  await page.goto("/settings?sheet=plans");
  await page.waitForURL(/\/upgrade\?from=settings/);
  await expect(page.getByRole("radiogroup", { name: "Choose your Pro plan" })).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await page.waitForURL(/\/settings$/);
  await page.getByRole("button", { name: /Monthly scans/ }).click();
  await page.waitForURL(/\/upgrade\?from=settings/);
  await expect(page.getByRole("heading", { name: "Get more from Zest Snap." })).toBeVisible();
});
