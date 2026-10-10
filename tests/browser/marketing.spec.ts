import { test, expect } from "@playwright/test";

// Marketing notifications must not reach OneSignal (or load its SDK) before someone opts in.
test.use({ serviceWorkers: "block" });

test("no OneSignal requests on any screen without consent; guests can't turn it on", async ({ page }) => {
  const onesignal: string[] = [];
  page.on("request", (r) => { if (/onesignal\.com/.test(r.url())) onesignal.push(r.url()); });
  for (const path of ["/app", "/app?view=planner", "/app?view=rewards", "/settings", "/login"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  const toggle = page.getByRole("checkbox", { name: "Tips and offers notifications" });
  await page.goto("/settings");
  if (process.env.NEXT_PUBLIC_MARKETING_PUSH === "on") {
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeDisabled();
    await expect(page.getByText("Sign in to choose")).toBeVisible();
  } else {
    // Until OneSignal is configured the setting is not offered at all.
    await expect(toggle).toHaveCount(0);
  }
  // Reminders keep their own setting, unchanged.
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  expect(onesignal).toEqual([]);
});

test("Settings no longer repeats upgrade hints on every locked row", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Upgrade to unlock")).toHaveCount(0);
  // The plans entry point is still there.
  await expect(page.getByRole("button", { name: /Monthly scans/ })).toBeVisible();
});
