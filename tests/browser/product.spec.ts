import { test, expect, type Page } from "@playwright/test";

// Runs against a production build in guest mode with the AI endpoint mocked, so it needs no
// credentials and never spends OpenAI credit. Signed-in flows are covered by the database tests
// and the manual production checklist in docs/production-readiness.md.
test.use({ timezoneId: "America/New_York", locale: "en-US" });

const todayIn = (page: Page) =>
  page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZsAAAAASUVORK5CYII=", "base64");
const event = (over: Record<string, unknown>) => ({
  title: "School meeting", startDate: "2027-04-03", endDate: "2027-04-03", startTime: "10:00", endTime: "11:00", allDay: false,
  timezone: "America/New_York", location: "Main hall", description: "", confidence: 0.92, confidenceReason: "Explicit date",
  sourceText: "", category: "school", ...over,
});

async function scan(page: Page, events: unknown[]) {
  await page.route("**/api/extract", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ documentType: "School notice", summary: "Dates found", events, warnings: [], trialRemaining: 1 }) }),
  );
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.locator("input[type=file]").last().setInputFiles({ name: "notice.png", mimeType: "image/png", buffer: PNG });
}

test("capture → review → save to Planner → Home Today stays in sync without reloads", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app");
  const today = await todayIn(page);
  await page.evaluate(() => ((window as unknown as { __warm: boolean }).__warm = true));
  await scan(page, [
    event({ title: "Parent evening", startDate: today, endDate: today, startTime: "18:00", endTime: "19:00" }),
    event({ title: "Submit permission slip", startDate: today, endDate: today, startTime: "", endTime: "", allDay: true, category: "deadline" }),
    event({ title: "Sports day", startDate: "2031-05-02", endDate: "2031-05-02" }),
  ]);
  await expect(page.getByRole("heading", { name: "3 events found" })).toBeVisible();
  await page.getByRole("button", { name: "Save to Planner" }).click();
  await expect(page.getByText("3 items saved to Planner.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Sports day" })).toBeVisible();

  // Home → Today shows exactly today's Planner items.
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByText("2 things in your day")).toBeVisible();
  await expect(page.locator(".homeTimeline").getByText("Parent evening")).toBeVisible();

  // Complete, edit and delete in Planner; Home reflects each change immediately.
  await page.getByRole("button", { name: "Planner", exact: true }).click();
  await page.getByRole("tab", { name: "Today" }).click();
  await page.getByRole("button", { name: "Mark Submit permission slip as done" }).click();
  await expect(page.getByRole("button", { name: "Mark Submit permission slip as not done" })).toBeVisible();
  await page.getByRole("button", { name: "Edit Parent evening" }).click();
  await page.getByLabel("Title").fill("Parent evening (hall B)");
  await page.getByRole("button", { name: "Save to Planner" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator(".homeTimeline").getByText("Parent evening (hall B)")).toBeVisible();
  await page.getByRole("button", { name: "Planner", exact: true }).click();
  await page.getByRole("button", { name: "Delete Parent evening (hall B)" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByText("1 thing in your day")).toBeVisible();

  // All navigation was client-side: no full reloads.
  expect(await page.evaluate(() => (window as unknown as { __warm?: boolean }).__warm)).toBe(true);

  // History lives in Settings (bottom nav is Home / Planner / To-Do / Shared). Re-opening the scan
  // marks saved events as already in the agenda.
  await page.goto("/app?view=history");
  await page.getByRole("button", { name: /notice\.png/ }).first().click();
  await expect(page.getByText("Already in your Zest agenda")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("Planner navigation: back button, deep links and warm return", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "Planner", exact: true }).click();
  await expect(page).toHaveURL(/view=planner/);
  await expect(page.getByRole("navigation").getByRole("button")).toHaveText(["Home", "Planner", "To-do", "Shared"]);
  await page.getByRole("button", { name: /rewards/i }).first().click();
  await expect(page).toHaveURL(/view=rewards/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Your planner" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "What do you want to remember?" })).toBeVisible();
  await page.goto("/app?view=planner&tab=reminders");
  await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();
  await expect(page.getByText("Stay ahead of what matters")).toBeVisible();
  // Exactly three Planner tabs; reminders live behind the bell.
  await page.getByRole("button", { name: "Back to Planner" }).click();
  await expect(page.getByRole("tab")).toHaveText(["Today", "Upcoming", "Calendar"]);
  await page.getByRole("button", { name: "Add to Planner" }).click();
  await expect(page.getByRole("radio")).toHaveText(["event", "task", "deadline"]);
});

test("Calendar date → action sheet → set a reminder with the date prefilled", async ({ page }) => {
  await page.goto("/app?view=planner");
  await page.getByRole("tab", { name: "Calendar" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  await page.locator(".monthGrid button:not(.outside)").nth(14).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: /Plan something/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /View day/ })).toBeVisible();
  const heading = await sheet.getByRole("heading").first().textContent();
  await sheet.getByRole("button", { name: /Set a reminder/ }).click();
  const dateValue = await page.getByLabel("Date").inputValue();
  expect(new Date(dateValue + "T12:00:00").toLocaleDateString("en-US", { dateStyle: "long" })).toBe(heading);
  await page.getByLabel("Remind me to").fill("Call the dentist");
  await page.getByLabel("Time").fill("14:30");
  await page.getByRole("button", { name: "Save reminder" }).click();
  await expect(page.getByText(/Reminder saved in Zest\. Sign in to get phone notifications/)).toBeVisible();
  await page.getByRole("button", { name: /Open reminders/ }).click();
  await expect(page.getByText("Call the dentist")).toBeVisible();
  // The overflow button opens a menu; it never snoozes on its own.
  await page.getByRole("button", { name: "Options for Call the dentist" }).click();
  await expect(page.getByRole("menuitem", { name: "Snooze 15 min" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Cancel reminder" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  // Guests are told plainly that phone notifications need an account.
  await expect(page.getByText("Notifications need an account")).toBeVisible();
});

test("a previous account's cached name, credits and Planner never appear for someone else", async ({ page }) => {
  await page.goto("/app");
  await page.evaluate(() => {
    const other = "99999999-9999-9999-9999-999999999999";
    localStorage.setItem("zest-active-user-v1", other);
    localStorage.setItem("zest-last-app-state-v1", JSON.stringify({ userId: other, credits: 42, displayName: "Morgan Secret", mode: "cloud" }));
    localStorage.setItem("zest-planner-last-used-v1", JSON.stringify({ items: [{ id: "x", type: "event", title: "Morgan private plan", startDate: "2030-01-01" }], pending: [] }));
    localStorage.setItem(`zest-cloud-${other}`, JSON.stringify({ state: { scans: [{ id: "s", fileName: "morgan.pdf", scannedAt: new Date().toISOString(), documentType: "x", summary: "x", events: [] }], events: [], credits: 42 } }));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "What do you want to remember?" })).toBeVisible();
  await expect(page.getByText("Morgan")).toHaveCount(0);
  await expect(page.getByText("42 credits")).toHaveCount(0);
  await page.goto("/app?view=history");
  await expect(page.getByText("morgan.pdf")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("zest-cloud-99999999-9999-9999-9999-999999999999"))).toBeNull();
});

test("guest Rewards routes to sign-up and returns; trial exhaustion offers an account", async ({ page }) => {
  await page.goto("/app?view=rewards");
  await expect(page.getByText("Rewards need a free account")).toBeVisible();
  await expect(page.getByText(/on-device/i)).toHaveCount(0);
  await page.getByRole("button", { name: /Share your experience/ }).click();
  await expect(page).toHaveURL(/\/login\?mode=signup&next=%2Fapp%3Fview%3Drewards/);
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();

  await page.goto("/app");
  await page.route("**/api/extract", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "guest_trial_exhausted", error: "You’ve used the free trial scans on this device. Create a free account to keep scanning." }) }),
  );
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.locator("input[type=file]").last().setInputFiles({ name: "x.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("button", { name: "Create a free account" })).toBeVisible();
});

test("unsupported files are rejected before any upload", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/extract", (r) => {
    calls++;
    return r.abort();
  });
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.locator("input[type=file]").last().setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByRole("alert").first()).toContainText("photos, screenshots");
  expect(calls).toBe(0);
});

test("settings: full timezone list and clear device data", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: /Timezone/ }).click();
  await page.getByPlaceholder("Search city or timezone").fill("kathmandu");
  await expect(page.getByRole("button", { name: /Kathmandu · Asia/ })).toBeVisible();
  await page.getByRole("button", { name: /Kathmandu · Asia/ }).click();
  await expect(page.locator(".settingsValue").first()).toContainText("Kathmandu");
  await page.getByRole("button", { name: /Clear device data/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Clear device data?");
});

test("layout fits small, large and desktop widths without horizontal scroll", async ({ page }) => {
  await page.goto("/app");
  for (const view of ["", "?view=planner", "?view=history", "?view=rewards"]) {
    await page.goto("/app" + view);
    for (const width of [320, 360, 390, 412, 600, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${view} @${width}`).toBeTruthy();
    }
  }
});

test("offline: the installed shell opens and private responses are never cached", async ({ page, context }) => {
  await page.goto("/app");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.goto("/login");
  await context.setOffline(true);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "What do you want to remember?" })).toBeVisible();
  // The worker is scoped to /app (the marketing pages are not part of the installed app).
  await page.goto("/app/not-cached").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
  await context.setOffline(false);
  const paths = await page.evaluate(async () => {
    const out: string[] = [];
    for (const key of await caches.keys()) for (const r of await (await caches.open(key)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  expect(paths.some((p) => /^\/(api|admin|auth|login)/.test(p))).toBeFalsy();
});

test("Reminders: bell shows active state, add while inside Reminders, View day works", async ({ page }) => {
  await page.goto("/app?view=planner");
  const bell = page.getByRole("button", { name: /Open reminders/ });
  await expect(bell).toHaveAttribute("aria-pressed", "false");
  await bell.click();
  await expect(bell).toHaveAttribute("aria-pressed", "true");
  await expect(bell).toHaveClass(/active/);
  await page.getByRole("button", { name: "Add reminder" }).click();
  await page.getByLabel("Remind me to").fill("Renew passport");
  await page.getByLabel("Date").fill("2031-03-04");
  await page.getByLabel("Time").fill("10:15");
  await page.getByRole("button", { name: "Save reminder" }).click();
  await expect(page.getByText("Renew passport")).toBeVisible();
  for (const f of ["All", "Today", "Upcoming", "Overdue"]) await expect(page.getByRole("tab", { name: f })).toBeVisible();
  await page.getByRole("tab", { name: "Upcoming" }).click();
  await expect(page.getByText("Renew passport")).toBeVisible();
  await page.getByRole("tab", { name: "Overdue" }).click();
  await expect(page.getByText("Renew passport")).toHaveCount(0);

  // Calendar → date with an item → View day closes the sheet and shows that day's items.
  await page.getByRole("button", { name: "Back to Planner" }).click();
  await page.getByRole("tab", { name: "Calendar" }).click();
  for (let i = 0; i < 60; i++) {
    if ((await page.locator(".calendarTop strong").textContent())?.includes("March 2031")) break;
    await page.getByRole("button", { name: "Next month" }).click();
  }
  await page.getByRole("button", { name: /March 4, 2031/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("1 scheduled");
  await expect(sheet).toContainText("On this day");
  await sheet.getByRole("button", { name: /View day/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".plannerCard").getByText("Renew passport")).toBeVisible();
  // No redundant large add card under the calendar.
  await expect(page.getByRole("button", { name: "Add to Planner" })).toHaveCount(1);
});

test("Upcoming excludes today's events once their time has passed; greeting never flashes generic for a known name", async ({ page }) => {
  await page.goto("/app");
  const today = await todayIn(page);
  await page.evaluate((t) => {
    const base = { description: "", endDate: t, endTime: "", dueDate: "", dueTime: "", allDay: false, timezone: "America/New_York", location: "", status: "open", source: "manual", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    localStorage.setItem("zest-planner-v1", JSON.stringify({ items: [
      { ...base, id: "p1", type: "event", title: "Already happened", startDate: t, startTime: "00:00" },
      { ...base, id: "p2", type: "event", title: "All day thing", startDate: t, startTime: "", allDay: true },
    ], pending: [] }));
    localStorage.setItem("zest-preferences", JSON.stringify({ displayName: "Patric Example", timezone: "America/New_York" }));
    localStorage.setItem("zest-last-app-state-v1", JSON.stringify({ displayName: "Patric Example", mode: "local" }));
  }, today);
  await page.reload();
  const greeting = page.locator(".homeGreeting");
  await expect(greeting).toContainText("Patric");
  await page.getByRole("navigation").getByRole("button", { name: "Planner" }).click();
  await page.getByRole("tab", { name: "Today" }).click();
  await expect(page.locator(".plannerCard.past").getByText("Already happened")).toBeVisible();
  await page.getByRole("tab", { name: "Upcoming" }).click();
  await expect(page.getByText("Already happened")).toHaveCount(0);
  await expect(page.getByText("All day thing")).toBeVisible();
});

test("Planner refuses dates outside 1900–2100 with a friendly message and saves nothing", async ({ page }) => {
  await page.goto("/app?view=planner");
  await page.getByRole("button", { name: "Add to Planner" }).first().click();
  await page.getByLabel("Title").fill("Typo date check");
  const date = page.getByLabel("Date");
  await expect(date).toHaveAttribute("min", "1900-01-01");
  await expect(date).toHaveAttribute("max", "2100-12-31");
  await date.fill("2101-01-01");
  await page.getByRole("button", { name: "Save to Planner" }).click();
  await expect(page.getByText("Choose a real date between 1900 and 2100.")).toBeVisible();
  const saved = await page.evaluate(() => JSON.stringify(localStorage).includes("Typo date check"));
  expect(saved).toBe(false);
});

test("the report-only CSP raises no violations across the main views", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) violations.push(m.text()); });
  const response = await page.goto("/app");
  expect(response?.headers()["content-security-policy-report-only"]).toContain("frame-ancestors 'none'");
  for (const view of ["planner", "todo", "shared"]) {
    await page.goto(`/app?view=${view}`);
    await page.waitForLoadState("load");
    await page.waitForTimeout(400);
  }
  for (const path of ["/settings", "/login", "/privacy", "/offline", "/share/3f2b8c1e-9a4d-4f6b-8e2a-1c5d7e9f0a3b"]) {
    await page.goto(path);
    await page.waitForLoadState("load");
    await page.waitForTimeout(400);
  }
  expect(violations).toEqual([]);
});
