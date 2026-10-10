import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

// Scan review → Save to Planner, guest mode against a production build with extraction mocked.
// Signed-in saving (Plan with Zest, Supabase, partial failures) is in scan-review-account.spec.ts.
test.use({ timezoneId: "America/New_York", locale: "en-US", serviceWorkers: "block" });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZsAAAAASUVORK5CYII=", "base64");
const ev = (over: Record<string, unknown>) => ({
  title: "Study Session", startDate: "2031-11-03", endDate: "2031-11-03", startTime: "14:00", endTime: "15:00", allDay: false,
  timezone: "America/New_York", location: "", description: "", confidence: 0.95, confidenceReason: "Explicit date",
  sourceText: "", category: "school", ...over,
});
const day = (n: number) => `2031-11-${String(n).padStart(2, "0")}`;
const many = (n: number) => Array.from({ length: n }, (_, i) => ev({ title: `Lesson ${i + 1}`, startDate: day(i + 1), endDate: day(i + 1) }));

async function scan(page: Page, events: unknown[], documentType = "schedule") {
  await page.route("**/api/extract", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ documentType, summary: "Dates found", events, warnings: [], trialRemaining: 1 }) }),
  );
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.locator("input[type=file]").last().setInputFiles({ name: "notice.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("heading", { name: /events? found/ })).toBeVisible();
}
const plannerTitles = (page: Page) => page.locator(".plannerCard h3").allTextContents();

test("review screen: no technical badges or permanent banners; useful warnings stay", async ({ page }) => {
  await scan(page, [...many(4), ev({ title: "Unclear trip", confidence: 0.4, confidenceReason: "Year not stated" })]);
  await expect(page.getByText(/high confidence/i)).toHaveCount(0);
  await expect(page.locator(".reviewStats")).toHaveCount(0);
  await expect(page.locator(".reviewTop").getByText("schedule", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Review your plan before saving it.")).toHaveCount(0);
  await expect(page.getByText("Duplicates are skipped automatically")).toHaveCount(0);
  // Confident events carry no percentage; the uncertain one says what to check.
  await expect(page.getByText(/^\d+%$/)).toHaveCount(0);
  await expect(page.locator(".reviewEvent", { hasText: "Unclear trip" }).getByText("Check details")).toBeVisible();
  await expect(page.locator(".reviewEvent", { hasText: "Unclear trip" }).getByText("Year not stated")).toBeVisible();
  await expect(page.locator(".reviewEvent", { hasText: "Lesson 1" }).getByText("Explicit date")).toHaveCount(0);
  for (const name of ["Edit", "Add to calendar", "Share"]) await expect(page.locator(".reviewEvent").first().getByRole("button", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save 5 to Planner" })).toBeVisible();
});

for (const n of [1, 5, 10, 20]) {
  test(`saves ${n} selected ${n === 1 ? "event" : "events"} and opens them in Planner`, async ({ page }) => {
    await scan(page, many(n));
    await page.getByRole("button", { name: `Save ${n} to Planner` }).click();
    await expect(page.getByRole("status").filter({ hasText: `${n} ${n === 1 ? "event" : "events"} added to Planner` })).toBeVisible();
    await page.getByRole("button", { name: "View in Planner" }).click();
    await expect(page.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(async () => (await plannerTitles(page)).filter((t) => t.startsWith("Lesson")).length).toBe(n);
  });
}

test("same title on three dates saves three events; a second save skips them as duplicates", async ({ page }) => {
  await scan(page, [3, 4, 5].map((d) => ev({ startDate: day(d), endDate: day(d) })));
  await page.getByRole("button", { name: "Save 3 to Planner" }).click();
  await expect(page.getByRole("status").filter({ hasText: "3 events added to Planner" })).toBeVisible();
  await page.getByRole("button", { name: "View in Planner" }).click();
  await expect.poll(async () => (await plannerTitles(page)).filter((t) => t === "Study Session").length).toBe(3);
  // The same document again: everything is already in the Planner.
  await scan(page, [3, 4, 5].map((d) => ev({ startDate: day(d), endDate: day(d) })));
  await expect(page.getByText("Already in your Zest agenda")).toHaveCount(3);
  await page.getByRole("button", { name: "Select all" }).click();
  await page.getByRole("button", { name: "Save 3 to Planner" }).click();
  await expect(page.getByRole("status").filter({ hasText: "3 duplicates skipped" })).toBeVisible();
  await page.goto("/app?view=planner&tab=upcoming");
  await expect.poll(async () => (await plannerTitles(page)).filter((t) => t === "Study Session").length).toBe(3);
});

test("repeated taps save each event once", async ({ page }) => {
  await scan(page, many(5));
  const save = page.getByRole("button", { name: "Save 5 to Planner" });
  await save.evaluate((b: HTMLButtonElement) => { b.click(); b.click(); b.click(); });
  await expect(page.getByRole("status").filter({ hasText: "5 events added to Planner" })).toBeVisible();
  await page.goto("/app?view=planner&tab=upcoming");
  await expect.poll(async () => (await plannerTitles(page)).length).toBe(5);
});

test("an edited time is the time that is saved, and the event survives a reload", async ({ page }) => {
  await scan(page, [ev({})]);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Time", { exact: true }).fill("15:00");
  await page.getByLabel("Category").selectOption("meeting");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".reviewEvent").getByText(/3:00 PM/)).toBeVisible();
  await page.getByRole("button", { name: "Save 1 to Planner" }).click();
  await page.getByRole("button", { name: "View in Planner" }).click();
  await expect(page.locator(".plannerCard", { hasText: "Study Session" })).toContainText("3:00 PM");
  await page.reload();
  await page.getByRole("tab", { name: "Upcoming" }).click();
  await expect(page.locator(".plannerCard", { hasText: "Study Session" })).toContainText("3:00 PM");
  await expect(page.locator(".plannerCard", { hasText: "Study Session" })).not.toContainText("2:00 PM");
});

test("nothing selected: saving is disabled and says why", async ({ page }) => {
  await scan(page, many(2));
  await page.getByRole("button", { name: "Clear selection" }).click();
  const save = page.getByRole("button", { name: "Save to Planner" });
  await expect(save).toBeDisabled();
  await expect(save).toHaveAccessibleDescription("Select at least one event to save");
});

test("invalid dates are reported and never saved or changed", async ({ page }) => {
  await scan(page, [ev({ title: "Good one" }), ev({ title: "Missing date", startDate: "", endDate: "" })]);
  await page.getByRole("button", { name: "Select all" }).click();
  await page.getByRole("button", { name: "Save 2 to Planner" }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 event saved · 1 event needs a valid date" })).toBeVisible();
  await page.goto("/app?view=planner&tab=upcoming");
  await expect.poll(async () => plannerTitles(page)).toEqual(["Good one"]);
});

test("Save to Planner only saves inside Zest; it opens no external calendar", async ({ page, context }) => {
  let popups = 0;
  context.on("page", () => popups++);
  await scan(page, many(2));
  await page.getByRole("button", { name: "Save 2 to Planner" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 events added" })).toBeVisible();
  expect(popups).toBe(0);
});

for (const [width, height] of [[320, 568], [390, 844], [430, 932], [768, 1024], [1280, 800]] as const) {
  test(`action bar stays visible, clickable and above the navigation at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await scan(page, many(8));
    for (const scroll of [0, 600, 99999]) {
      await page.evaluate((y) => window.scrollTo(0, y), scroll);
      const bar = page.locator(".stickyAction");
      const button = bar.getByRole("button", { name: "Save 8 to Planner" });
      await expect(button).toBeInViewport();
      const box = (await button.boundingBox())!;
      const nav = (await page.locator(".bottomNav").boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(nav.y + 1);
      expect(box.height).toBeGreaterThanOrEqual(44);
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent, [box.x + box.width / 2, box.y + box.height / 2]);
      expect(hit).toContain("Save 8 to Planner");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("larger text: the action bar wraps instead of clipping", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await scan(page, many(3));
  await page.addStyleTag({ content: "html{font-size:130%} .stickyAction,.stickyAction *{font-size:130%!important}" });
  const button = page.getByRole("button", { name: "Save 3 to Planner" });
  await expect(button).toBeInViewport();
  expect(await button.evaluate((b) => b.scrollWidth <= b.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const scheme of ["light", "dark"] as const) {
  test(`native safe area: a solid strip covers the status bar and no card sits under it (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript((m) => localStorage.setItem("zest-appearance-v1", JSON.stringify({ mode: m, accent: "ocean", updatedAt: 1 })), scheme);
    await page.setViewportSize({ width: 393, height: 852 });
    await scan(page, many(8));
    // What the iOS app does: html.native plus the real top inset (59px on Dynamic Island iPhones).
    await page.evaluate(() => {
      document.documentElement.classList.add("native", "native-ios");
      document.documentElement.style.setProperty("--native-safe-top", "59px");
    });
    const strip = await page.evaluate(() => {
      const s = getComputedStyle(document.body, "::before");
      return { height: s.height, position: s.position, bg: s.backgroundColor, body: getComputedStyle(document.body).backgroundColor };
    });
    expect(strip).toMatchObject({ height: "59px", position: "fixed" });
    expect(strip.bg).toBe(strip.body);
    // The header starts below the inset, and when scrolled, whatever is at the top is the strip, not a card.
    expect((await page.locator(".appHeader").boundingBox())!.y).toBe(0);
    expect(await page.locator(".appHeader").evaluate((h) => parseFloat(getComputedStyle(h).paddingTop))).toBe(59);
    // Scrolled so review cards pass behind the status bar: the inset must still be one solid page colour.
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 393, height: 59 } });
    const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const colours = new Set<string>();
    for (let i = 0; i < data.length; i += 3) colours.add(`${data[i] >> 2},${data[i + 1] >> 2},${data[i + 2] >> 2}`);
    expect(colours.size).toBe(1);
  });
}
