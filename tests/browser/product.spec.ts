import { test, expect } from "@playwright/test";
const event = {
  title: "School meeting",
  startDate: "2027-04-03",
  endDate: "2027-04-03",
  startTime: "10:00",
  endTime: "11:00",
  allDay: false,
  timezone: "Europe/London",
  location: "Long location ".repeat(12),
  description: "Notes",
  confidence: 0.9,
  confidenceReason: "Explicit date",
  sourceText: "",
  category: "school",
};
test("capture → review/edit → multi-calendar export → history → agenda → offline", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/extract", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        documentType: "School notice",
        summary: "Two meetings",
        events: [
          event,
          {
            ...event,
            title: "Second meeting",
            startDate: "2027-04-05",
            endDate: "2027-04-05",
          },
        ],
        warnings: ["Check dates"],
      }),
    }),
  );
  await page.goto("/app");
  await expect(
    page.getByRole("button", { name: "Upload", exact: true }),
  ).toBeEnabled();
  await page
    .locator("input[type=file]")
    .last()
    .setInputFiles({
      name: "notice.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZsAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(
    page.getByRole("heading", { name: "2 events found" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Edited meeting");
  await page.getByRole("button", { name: "Save changes" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add selected", exact: true }).click();
  const d = await download;
  const stream = await d.createReadStream();
  let text = "";
  for await (const chunk of stream!) text += chunk.toString();
  expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  await expect(page.getByText("Already in your Zest agenda")).toHaveCount(2);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Edited meeting", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Edited meeting", exact: true }),
  ).toBeVisible();
  for (const width of [320, 360, 375, 390, 412, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Upload", exact: true }),
  ).toBeEnabled();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("notice.png")).toBeVisible();
  await page.getByRole("button", { name: "Rewards", exact: true }).click();
  await expect(page.getByText("8", { exact: true })).toBeVisible();
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
test("settings save and account-disabled experience", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Timezone", { exact: true }).fill("Europe/Paris");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue(
    "Europe/Paris",
  );
  await page.goto("/login");
  await expect(
    page.getByRole("link", { name: "Continue on this device" }),
  ).toBeVisible();
  await page.goto("/admin?admin=true");
  await expect(
    page.getByRole("heading", { name: "Admin setup" }),
  ).toBeVisible();
});
test("private pages and API responses absent from service-worker caches", async ({
  page,
}) => {
  await page.goto("/app");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.goto("/login");
  await page.goto("/admin");
  const paths = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const key of await caches.keys()) {
      for (const r of await (await caches.open(key)).keys())
        paths.push(new URL(r.url).pathname);
    }
    return paths;
  });
  expect(paths.some((p) => /^\/(api|admin|auth|login)/.test(p))).toBeFalsy();
});
