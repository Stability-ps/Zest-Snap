import { test, expect, type Page } from "@playwright/test";
import { ACCENTS, NEUTRALS, accentTokens } from "../../lib/appearance/palette";

// Guest mode against a production build (see product.spec.ts). Account sync is covered by tests/appearance.test.ts.
// No service worker: requests it passes through are invisible to page.route (the scan below is mocked).
test.use({ timezoneId: "America/New_York", locale: "en-US", serviceWorkers: "block" });

const KEY = "zest-appearance-v1";
const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  return `rgb(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;
};
const theme = (page: Page) => page.evaluate(() => ({ ...document.documentElement.dataset }));
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
async function openAppearance(page: Page) {
  await page.goto("/settings?sheet=appearance");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
}

/**
 * Every visible text node whose colour fails WCAG AA against the solid background behind it
 * (4.5:1, or 3:1 for large/bold-large text). Elements over gradients or images are skipped.
 */
async function unreadableText(page: Page) {
  return page.evaluate(() => {
    const parse = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]: number[]) =>
      [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const blend = (top: number[], bottom: number[]) => {
      const a = top[3] ?? 1;
      return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a));
    };
    const backgroundOf = (el: Element | null): number[] | null => {
      const stack: number[][] = [];
      for (let e = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.backgroundImage !== "none" && !/^url/.test(s.backgroundImage)) return null;
        const c = parse(s.backgroundColor);
        if (c.length >= 3 && (c[3] ?? 1) > 0) {
          stack.push(c);
          if ((c[3] ?? 1) >= 1) break;
        }
      }
      if (!stack.length) stack.push(parse(getComputedStyle(document.body).backgroundColor));
      return stack.reverse().reduce((acc, c) => blend(c, acc), [255, 255, 255]);
    };
    const bad: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent?.trim()) continue;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (s.visibility === "hidden" || +s.opacity === 0 || r.width === 0 || r.bottom < 0 || r.top > innerHeight) continue;
      // Logotypes (the "Zest Snap" wordmark) are exempt from WCAG contrast and must keep the brand colour.
      if (el.closest("[aria-hidden=true], .appearanceThumb, [disabled], .outside, svg, .brand")) continue;
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity;
      if (o < 0.9) continue; // deliberately de-emphasised (disabled, completed)
      const bg = backgroundOf(el);
      if (!bg) continue;
      const fg = blend(parse(s.color), bg);
      const size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      const got = ratio(fg, bg);
      if (got < need - 0.05) bad.push(`${n.textContent.trim().slice(0, 30)} (${el.className || el.tagName}) ${got.toFixed(2)}`);
    }
    return bad;
  });
}

test("Light is the default, even on a dark device; Automatic follows the device, including live changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/app");
  expect(await theme(page)).toMatchObject({ theme: "light", themeMode: "light" });
  await openAppearance(page);
  await expect(page.getByRole("radio", { name: /Light/ })).toBeChecked();
  await page.locator("label.appearanceMode", { hasText: "Automatic" }).click();
  await page.goto("/app");
  expect(await theme(page)).toMatchObject({ theme: "dark", themeMode: "system" });
  expect(await bodyBg(page)).toBe(rgb(NEUTRALS.dark.bg));
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(async () => (await theme(page)).theme).toBe("light");
  expect(await bodyBg(page)).toBe(rgb(NEUTRALS.light.bg));
  expect(await page.locator('meta[name="theme-color"]').first().getAttribute("content")).toBe("#0B1F3B");
});

test("explicit Light and Dark override the device and persist across reloads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openAppearance(page);
  await expect(page.getByRole("radio", { name: /Light/ })).toBeChecked();
  await page.getByText("Dark", { exact: true }).click();
  await expect(page.getByRole("radio", { name: /Dark/ })).toBeChecked();
  expect(await theme(page)).toMatchObject({ theme: "dark", themeMode: "dark" });
  await page.reload();
  expect((await theme(page)).theme).toBe("dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByText("Light", { exact: true }).click();
  expect((await theme(page)).theme).toBe("light");
  await page.goto("/app");
  expect((await theme(page)).theme).toBe("light");
  expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY))!)).toMatchObject({ mode: "light", accent: "ocean", dirty: true });
});

test("all six accent colours apply immediately in Light and Dark", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await openAppearance(page);
    // Light is the default; choose the mode under test explicitly.
    await page.locator("label.appearanceMode", { hasText: scheme === "dark" ? "Dark" : "Light" }).click();
    for (const accent of ACCENTS) {
      await page.getByTitle(accent.name, { exact: true }).click();
      await expect(page.getByRole("radio", { name: accent.name, exact: true })).toBeChecked();
      const expected = accentTokens(accent.hex, scheme);
      expect(await token(page, "--accent-strong")).toBe(expected["accent-strong"]);
      expect(await token(page, "--accent-text")).toBe(expected["accent-text"]);
      expect(await page.locator(".appearancePreviewScan").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(rgb(expected["accent-strong"]));
    }
  }
  // Semantic colours never follow the accent.
  expect(await token(page, "--danger-text")).toBe(NEUTRALS.dark["danger-text"]);
});

test("reset restores Light and Ocean Blue", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript((k) => localStorage.setItem(k, JSON.stringify({ mode: "dark", accent: "rose", updatedAt: 1 })), KEY);
  await openAppearance(page);
  expect(await theme(page)).toMatchObject({ theme: "dark", accent: "rose" });
  await page.getByRole("button", { name: "Reset appearance" }).click();
  expect(await theme(page)).toMatchObject({ theme: "light", themeMode: "light" });
  expect((await theme(page)).accent).toBeUndefined();
  await expect(page.getByRole("radio", { name: "Ocean Blue" })).toBeChecked();
});

test("no theme flash: the stored theme is applied before any app JavaScript runs", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript((k) => localStorage.setItem(k, JSON.stringify({ mode: "dark", accent: "amber", updatedAt: 1 })), KEY);
  await page.route("**/_next/static/chunks/**/*.js", (r) => r.abort());
  await page.goto("/app");
  expect(await theme(page)).toMatchObject({ theme: "dark", accent: "amber" });
  expect(await bodyBg(page)).toBe(rgb(NEUTRALS.dark.bg));
});

test("invalid stored preferences fall back to the defaults", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript((k) => localStorage.setItem(k, "{oops"), KEY);
  await page.goto("/app");
  expect(await theme(page)).toMatchObject({ theme: "light", themeMode: "light" });
});

test("changing the theme never reloads the page or loses typed input (and other tabs follow)", async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/app?view=todo");
  const input = page.getByPlaceholder("Add a to-do");
  await input.fill("Buy school shoes");
  await page.evaluate(() => ((window as unknown as { __alive: boolean }).__alive = true));
  const other = await context.newPage();
  await openAppearance(other);
  await other.getByText("Dark", { exact: true }).click();
  await other.getByTitle("Violet", { exact: true }).click();
  await expect.poll(async () => (await theme(page)).theme).toBe("dark");
  expect((await theme(page)).accent).toBe("violet");
  await expect(input).toHaveValue("Buy school shoes");
  expect(await page.evaluate(() => (window as unknown as { __alive?: boolean }).__alive)).toBe(true);
});

const screens: [string, string][] = [
  ["home", "/app"],
  ["planner", "/app?view=planner&tab=today"],
  ["calendar", "/app?view=planner&tab=calendar"],
  ["todo", "/app?view=todo"],
  ["reminders", "/app?view=planner&tab=reminders"],
  ["rewards", "/app?view=rewards"],
  ["history", "/app?view=history"],
  ["shared", "/app?view=shared"],
  ["settings", "/settings"],
  ["appearance", "/settings?sheet=appearance"],
  ["login", "/login"],
  ["reset-password", "/reset-password"],
  ["onboarding", "/onboarding"],
  ["offline", "/offline"],
  ["landing", "/"],
  ["upgrade", "/upgrade?from=guest"],
  ["upgrade-onboarding", "/upgrade?from=onboarding"],
];

for (const scheme of ["light", "dark"] as const) {
  test(`no unreadable text on any screen in ${scheme} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.addInitScript(([k, m]) => localStorage.setItem(k, JSON.stringify({ mode: m, accent: "ocean", updatedAt: 1 })), [KEY, scheme] as const);
    const failures: string[] = [];
    for (const [name, path] of screens) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      // The landing and premium pages are light by design, like Admin.
      expect((await theme(page)).theme, name).toBe(name === "landing" || name.startsWith("upgrade") ? "light" : scheme);
      for (const f of await unreadableText(page)) failures.push(`${name}: ${f}`);
    }
    expect(failures).toEqual([]);
  });
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZsAAAAASUVORK5CYII=", "base64");
const event = (over: Record<string, unknown>) => ({
  title: "School meeting", startDate: "2031-04-03", endDate: "2031-04-03", startTime: "10:00", endTime: "11:00", allDay: false,
  timezone: "America/New_York", location: "Main hall", description: "", confidence: 0.92, confidenceReason: "Explicit date",
  sourceText: "", category: "school", ...over,
});

for (const scheme of ["light", "dark"] as const) {
  test(`screens with real content (scan review, Planner, sheets, reminders, to-dos) are readable in ${scheme} mode`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.addInitScript(([k, m]) => localStorage.setItem(k, JSON.stringify({ mode: m, accent: "ocean", updatedAt: 1 })), [KEY, scheme] as const);
    const failures: string[] = [];
    const audit = async (name: string) => {
      await page.screenshot({ path: info.outputPath(`${name}.png`) });
      for (const f of await unreadableText(page)) failures.push(`${name}: ${f}`);
    };
    await page.goto("/app");
    const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()));
    await page.route("**/api/extract", (r) =>
      r.fulfill({ contentType: "application/json", body: JSON.stringify({ documentType: "School notice", summary: "Dates found", warnings: ["One date was unclear"], trialRemaining: 1, events: [
        event({ title: "Parent evening", startDate: today, endDate: today, startTime: "18:00", endTime: "19:00" }),
        event({ title: "Submit permission slip", startDate: today, endDate: today, startTime: "", endTime: "", allDay: true, category: "deadline" }),
        event({ title: "Sports day", confidence: 0.41, confidenceReason: "Year not stated" }),
      ] }) }),
    );
    await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
    await page.locator("input[type=file]").last().setInputFiles({ name: "notice.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByRole("heading", { name: "3 events found" })).toBeVisible();
    await audit("review");
    await page.getByRole("button", { name: "Save 3 to Planner" }).click();
    await expect(page.getByRole("status").filter({ hasText: "3 events added to Planner" })).toBeVisible();
    await page.getByRole("button", { name: "View in Planner" }).click();
    await audit("planner-upcoming");
    await page.getByRole("tab", { name: "Today" }).click();
    await page.getByRole("button", { name: "Mark Submit permission slip as done" }).click();
    await audit("planner-today");
    await page.getByRole("button", { name: "Edit Parent evening" }).click();
    await audit("planner-edit-sheet");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.locator(".homeTimeline").getByText("Parent evening")).toBeVisible();
    await audit("home-today");
    await page.goto("/app?view=planner&tab=calendar");
    await page.locator(".monthGrid button:not(.outside)").nth(14).click();
    await audit("calendar-day-sheet");
    await page.getByRole("dialog").getByRole("button", { name: /Set a reminder/ }).click();
    await audit("reminder-sheet");
    await page.getByLabel("Remind me to").fill("Call the dentist");
    await page.getByLabel("Time").fill("14:30");
    await page.getByRole("button", { name: "Save reminder" }).click();
    await page.getByRole("navigation").getByRole("button", { name: "Reminders" }).click();
    await expect(page.getByText("Call the dentist")).toBeVisible();
    await audit("reminders-list");
    await page.goto("/app?view=todo");
    await page.getByPlaceholder("Add a to-do").fill("Buy school shoes");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByPlaceholder("Add a to-do").fill("Pack lunch");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Buy school shoes")).toBeVisible();
    await audit("todo-list");
    await page.goto("/app?view=history");
    await audit("history-list");
    // Settings' plans link now opens the Premium page (always light by design).
    await page.goto("/settings?sheet=plans");
    await page.waitForURL(/\/upgrade\?from=settings/);
    await page.waitForLoadState("networkidle");
    await audit("premium-from-settings");
    expect(failures).toEqual([]);
  });
}

// Visual regression for representative screens (macOS baselines; refresh with --update-snapshots after an
// intended design change).
for (const [width, height, label] of [[390, 844, "mobile"], [1280, 900, "desktop"]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`visual: ${label} ${scheme}`, async ({ page }) => {
      test.skip(process.platform !== "darwin", "baselines are recorded on macOS");
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.addInitScript(([k, m]) => localStorage.setItem(k, JSON.stringify({ mode: m, accent: "ocean", updatedAt: 1 })), [KEY, scheme] as const);
    await page.addInitScript(([k, m]) => localStorage.setItem(k, JSON.stringify({ mode: m, accent: "ocean", updatedAt: 1 })), [KEY, scheme] as const);
      // Fixed clock so greetings and calendars are stable.
      await page.clock.setFixedTime(new Date("2026-10-12T09:30:00-04:00"));
      for (const name of ["home", "calendar", "todo", "settings", "appearance"]) {
        await page.goto(screens.find(([n]) => n === name)![1]);
        await page.waitForLoadState("networkidle");
        await expect(page).toHaveScreenshot(`${name}-${label}-${scheme}.png`, { maxDiffPixelRatio: 0.01, animations: "disabled" });
      }
    });
  }
}
