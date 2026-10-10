import { test, expect } from "@playwright/test";

// Provider availability as production reports it (/auth/v1/settings), against a production build.
test.use({ serviceWorkers: "block" });
const settings = (google: boolean, apple: boolean) => (route: import("@playwright/test").Route) =>
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ external: { email: true, google, apple }, disable_signup: false }) });

test("providers switched off (production today): no social buttons, email sign-in unchanged", async ({ page }) => {
  await page.route("**/auth/v1/settings", settings(false, false));
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator(".socialButton")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Sign in/ })).toBeVisible();
});

test("settings unreachable: no social buttons rather than broken ones", async ({ page }) => {
  await page.route("**/auth/v1/settings", (r) => r.abort());
  await page.goto("/login?mode=signup");
  await expect(page.getByRole("heading", { name: "Create your Zest account" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator(".socialButton")).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`providers on: Google then Apple, branded, readable and full-width (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 667 });
    await page.route("**/auth/v1/settings", settings(true, true));
    await page.goto("/login");
    const buttons = page.locator(".socialButton");
    await expect(buttons).toHaveText(["Continue with Google", "Continue with Apple"]);
    for (const b of await buttons.all()) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThan(280);
      const [fg, bg] = await b.evaluate((e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]);
      expect(fg).not.toBe(bg);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
