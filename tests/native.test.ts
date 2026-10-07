import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { inAppPath, needsFullNavigation } from "../lib/native/deep-links";
import { extractedToDeviceEvent, plannerToDeviceEvent, toDeviceEvent } from "../lib/native/calendar-event";
import { notificationId, reminderUrl, remindersToSchedule } from "../lib/native/notifications";
import { decideBack } from "../lib/native/back-button";
import { entitlementFromSubscriber } from "../lib/billing/entitlements";
import { planForProduct } from "../lib/billing/config";
import { runtime, isNative } from "../lib/native/runtime";
import type { ExtractedEvent } from "../lib/extraction-types";
import type { PlannerItem } from "../lib/planner";

test("runtime detection reports web outside the native shell", () => {
  assert.equal(isNative(), false);
  assert.equal(runtime(), "web");
});

test("deep links map only Zest Snap URLs to in-app paths", () => {
  assert.equal(inAppPath("https://app.zestsnap.app/app?view=planner&tab=reminders"), "/app?view=planner&tab=reminders");
  assert.equal(inAppPath("https://zestsnap.app/settings"), "/settings");
  assert.equal(inAppPath("https://app.zestsnap.app/auth/callback?code=abc&next=%2Fapp"), "/auth/callback?code=abc&next=%2Fapp");
  assert.equal(inAppPath("https://app.zestsnap.app/"), "/app");
  assert.equal(inAppPath("zestsnap://app?view=planner"), "/app?view=planner");
  assert.equal(inAppPath("zestsnap:///settings"), "/settings");
  assert.equal(inAppPath("zestsnap://reset-password#access_token=x"), "/reset-password#access_token=x");
  for (const bad of ["https://evil.example/app", "http://app.zestsnap.app/app", "https://app.zestsnap.app/admin", "https://app.zestsnap.app.evil.example/app",
    "javascript:alert(1)", "zestsnap://admin", "not a url", "https://app.zestsnap.app/api/account"])
    assert.equal(inAppPath(bad), null, bad);
  // Shared invitations open in the app, where the recipient is signed in.
  const token = "3f2b8c1e-9a4d-4f6b-8e2a-1c5d7e9f0a3b";
  assert.equal(inAppPath(`https://app.zestsnap.app/share/${token}`), `/share/${token}`);
  assert.equal(inAppPath(`https://app.zestsnap.app/shared/${token}`), `/shared/${token}`);
  for (const bad of ["https://app.zestsnap.app/sharedx", "https://app.zestsnap.app/shareholder"]) assert.equal(inAppPath(bad), null, bad);
  assert.equal(needsFullNavigation("/auth/callback?code=1"), true);
  assert.equal(needsFullNavigation("/app?view=planner"), false);
});

const event = (over: Partial<ExtractedEvent>): ExtractedEvent => ({
  title: "Dentist", startDate: "2026-11-02", endDate: "", startTime: "", endTime: "", timezone: "Africa/Johannesburg", location: "", description: "",
  allDay: false, confidence: 1, confidenceReason: "", sourceText: "", category: "appointment", ...over,
});

test("device calendar events use the event's timezone, inclusive all-day ends and a one-hour default", () => {
  const timed = extractedToDeviceEvent(event({ startTime: "09:30" }), "Europe/London");
  assert.equal(new Date(timed.startDate).toISOString(), "2026-11-02T07:30:00.000Z");
  assert.equal(timed.endDate - timed.startDate, 3_600_000);
  assert.equal(timed.isAllDay, false);
  assert.deepEqual(timed.alerts, [-60]);
  const ranged = extractedToDeviceEvent(event({ startTime: "22:00", endDate: "2026-11-03", endTime: "01:00" }), "UTC");
  assert.equal(ranged.endDate - ranged.startDate, 3 * 3_600_000);
  const allDay = extractedToDeviceEvent(event({ allDay: true, endDate: "2026-11-04" }), "Europe/London");
  assert.equal(allDay.isAllDay, true);
  assert.equal(new Date(allDay.startDate).toISOString(), "2026-11-02T00:00:00.000Z");
  assert.equal(new Date(allDay.endDate).toISOString(), "2026-11-05T00:00:00.000Z", "inclusive end → exclusive midnight");
  const backwards = toDeviceEvent({ title: "x", date: "2026-11-02", time: "10:00", endTime: "09:00", allDay: false, timezone: "UTC" }, "UTC");
  assert.equal(backwards.endDate - backwards.startDate, 3_600_000, "an end before the start falls back to one hour");
  assert.throws(() => toDeviceEvent({ title: "x", date: "", allDay: true }, "UTC"), /Check the date/);
  const withSource = extractedToDeviceEvent(event({ description: "Bring card", sourceText: "Mon 2 Nov 09:30" }), "UTC");
  assert.match(withSource.description || "", /Bring card[\s\S]*Source: Mon 2 Nov 09:30/);
});

test("Planner to-dos become due-time entries with sensible alerts", () => {
  const item: PlannerItem = {
    id: "1", type: "deadline", title: "Pay invoice", description: "", startDate: "", endDate: "", startTime: "", endTime: "",
    dueDate: "2026-11-10", dueTime: "17:00", allDay: false, timezone: "UTC", location: "", status: "open", source: "manual",
    createdAt: "", updatedAt: "",
  };
  const ev = plannerToDeviceEvent(item, "UTC");
  assert.equal(ev.title, "Deadline: Pay invoice");
  assert.equal(new Date(ev.startDate).toISOString(), "2026-11-10T17:00:00.000Z");
  assert.deepEqual(ev.alerts, [-1440, -60]);
});

test("only future, pending reminders are armed on the device, soonest first, capped for iOS", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  const r = (id: string, at: string, status = "pending") => ({ id, scheduledAt: at, status, plannerItemId: "p" });
  const list = [r("late", "2026-10-07T10:00:00Z"), r("past", "2026-10-05T09:00:00Z"), r("done", "2026-10-06T10:00:00Z", "handled"), r("soon", "2026-10-05T10:30:00Z")];
  assert.deepEqual(remindersToSchedule(list, now).map((x) => x.id), ["soon", "late"]);
  const many = Array.from({ length: 80 }, (_, i) => r(`r${i}`, new Date(now + (i + 1) * 60_000).toISOString()));
  assert.equal(remindersToSchedule(many, now).length, 60);
  const id = notificationId("d3b5e17e-fdc1-441d-9389-34a6dcd0028e");
  assert.ok(Number.isInteger(id) && id > 0 && id <= 2 ** 31 - 1);
  assert.equal(id, notificationId("d3b5e17e-fdc1-441d-9389-34a6dcd0028e"), "stable across launches");
  assert.notEqual(id, notificationId("d3b5e17e-fdc1-441d-9389-34a6dcd0028f"));
  assert.equal(inAppPath("https://app.zestsnap.app" + reminderUrl("abc")), "/app?view=planner&tab=reminders&reminderId=abc");
});

test("Android back closes the top overlay first, then goes back, then backgrounds the app", () => {
  const doc = (n: number) => ({ querySelectorAll: () => Array.from({ length: n }, (_, i) => ({ id: i }) as unknown as Element), dispatchEvent: () => true });
  assert.equal(decideBack(doc(2), true).decision, "closed-overlay");
  assert.equal((decideBack(doc(2), true).target as unknown as { id: number }).id, 1, "top-most overlay");
  assert.equal(decideBack(doc(0), true).decision, "history-back");
  assert.equal(decideBack(doc(0), false).decision, "minimize");
});

test("store entitlements come only from RevenueCat's verified record, highest tier first", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const active = entitlementFromSubscriber({
    entitlements: {
      plus: { expires_date: "2026-11-05T00:00:00Z", product_identifier: "app.zestsnap.plus.monthly" },
      business: { expires_date: "2026-11-05T00:00:00Z", product_identifier: "zestsnap_business:monthly" },
    },
    subscriptions: {
      "app.zestsnap.plus.monthly": { store: "app_store", expires_date: "2026-11-05T00:00:00Z" },
      "zestsnap_business:monthly": { store: "play_store", expires_date: "2026-11-05T00:00:00Z", unsubscribe_detected_at: "2026-10-04T00:00:00Z" },
    },
  }, now);
  assert.equal(active.active, true);
  if (active.active) {
    assert.equal(active.plan, "business");
    assert.equal(active.source, "play_store");
    assert.equal(active.willRenew, false);
  }
  const expired = entitlementFromSubscriber({
    entitlements: { plus: { expires_date: "2026-10-01T00:00:00Z", product_identifier: "app.zestsnap.plus.monthly" } },
    subscriptions: { "app.zestsnap.plus.monthly": { store: "app_store", expires_date: "2026-10-01T00:00:00Z" } },
  }, now);
  assert.deepEqual(expired, { active: false, lastSource: "app_store", expiredAt: "2026-10-01T00:00:00Z" });
  const grace = entitlementFromSubscriber({
    entitlements: { plus: { expires_date: "2026-10-04T00:00:00Z", grace_period_expires_date: "2026-10-10T00:00:00Z", product_identifier: "app.zestsnap.plus.monthly" } },
    subscriptions: { "app.zestsnap.plus.monthly": { store: "app_store", expires_date: "2026-10-04T00:00:00Z", billing_issues_detected_at: "2026-10-04T00:00:00Z" } },
  }, now);
  assert.equal(grace.active && grace.billingIssue, true, "billing grace period keeps access and flags the issue");
  assert.equal(entitlementFromSubscriber({}, now).active, false);
  assert.equal(entitlementFromSubscriber({ entitlements: { plus: { expires_date: null, product_identifier: "x" } }, subscriptions: { x: { store: "promotional", expires_date: null } } }, now).active, false,
    "unknown stores never grant access");
});

test("store product IDs map to plans", () => {
  assert.equal(planForProduct("app.zestsnap.plus.monthly"), "plus");
  assert.equal(planForProduct("zestsnap_business:annual"), "business");
  assert.equal(planForProduct("zestsnap_plus"), "plus", "Play subscription id without base plan");
  assert.equal(planForProduct("something.else"), null);
});

test("native code never awaits a bare Capacitor plugin proxy", () => {
  // `return Plugin` from an async function makes JS call Plugin.then(), which Capacitor rejects at runtime.
  const dir = "lib/native";
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(`${dir}/${f}`, "utf8");
    assert.doesNotMatch(src, /return\s+\(await import\([^)]*\)\)\.[A-Z]\w+\s*;/, f);
    assert.doesNotMatch(src, /return (LocalNotifications|Purchases|Camera|Share|Filesystem|App|Haptics|CapacitorCalendar);/, f);
  }
});

test("no server secrets or service keys can reach the native shell or client bundles", () => {
  const config = readFileSync("capacitor.config.ts", "utf8");
  assert.match(config, /appId: "app\.zestsnap"/);
  assert.match(config, /https:\/\/app\.zestsnap\.app/);
  for (const f of ["capacitor.config.ts", "android/app/src/main/AndroidManifest.xml", "ios/App/App/Info.plist", "lib/billing/config.ts", "lib/native/billing.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /SERVICE_ROLE|SUPABASE_SECRET|sb_secret_|REVENUECAT_SECRET|OPENAI_API_KEY|sk_live|-----BEGIN/, f);
  }
  const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  for (const p of ["READ_CALENDAR", "WRITE_CALENDAR", "READ_MEDIA_IMAGES", "ACCESS_FINE_LOCATION", "READ_CONTACTS", "RECORD_AUDIO"])
    assert.doesNotMatch(manifest, new RegExp(p), `unexpected permission ${p}`);
  const plist = readFileSync("ios/App/App/Info.plist", "utf8");
  for (const key of ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription", "NSCalendarsWriteOnlyAccessUsageDescription"]) assert.match(plist, new RegExp(key));
  assert.doesNotMatch(plist, /We need access/i);
});


test("Android release builds regenerate approved branding and publish real system insets", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts["mobile:build:android"], /mobile:assets/, "release build must regenerate launcher and splash resources");
  // Regeneration only rewrites ic_launcher*/splash*; the launcher and splash use hand-tuned v6 resources it never touches.
  const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  assert.match(manifest, /android:icon="@mipmap\/zest_launcher_v6"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/zest_launcher_round_v6"/);
  assert.match(readFileSync("android/app/src/main/res/values/styles.xml", "utf8"), /@drawable\/zest_splash_v6/);
  const brand = readFileSync("scripts/mobile-assets.mjs", "utf8");
  assert.match(brand, /#0B1F3B/);
  assert.match(brand, /#00C6A7/);
  const androidPlugin = readFileSync("android/app/src/main/java/app/zestsnap/ZestNativePlugin.java", "utf8");
  assert.match(androidPlugin, /getSystemInsets/);
  assert.match(androidPlugin, /WindowInsetsCompat\.Type\.systemBars/);
  const bridge = readFileSync("app/native-bridge.tsx", "utf8");
  assert.match(bridge, /--native-safe-bottom/);
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /--zest-safe-bottom/);
  assert.match(css, /html\.native \.settingsPage/);
});

test("a resumed native WebView moves to the live release only when nothing is in progress", async () => {
  const { shouldReloadForRelease, hasWorkInProgress } = await import("../lib/native/release");
  assert.equal(shouldReloadForRelease("abc", "def", false), true);
  assert.equal(shouldReloadForRelease("abc", "abc", false), false);
  assert.equal(shouldReloadForRelease("abc", "def", true), false, "never reload over a scan review or open sheet");
  for (const live of [undefined, null, "", "local", 42]) assert.equal(shouldReloadForRelease("abc", live, false), false);
  assert.equal(shouldReloadForRelease("local", "def", false), false);
  assert.equal(hasWorkInProgress({ querySelector: () => null }), false);
  assert.equal(hasWorkInProgress({ querySelector: (s: string) => (s.includes(".reviewTop") ? ({} as Element) : null) }), true);
});

test("the Universal Links file stays 404 until a Team ID is set, then names the app and its link routes", async () => {
  const { GET } = await import("../app/.well-known/apple-app-site-association/route");
  const previous = process.env.APPLE_TEAM_ID;
  try {
    delete process.env.APPLE_TEAM_ID;
    assert.equal(GET().status, 404);
    process.env.APPLE_TEAM_ID = "not-a-team";
    assert.equal(GET().status, 404);
    process.env.APPLE_TEAM_ID = "D64PWXTUJ5";
    const res = GET();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /application\/json/);
    const body = await res.json();
    assert.deepEqual(body.applinks.details[0].appIDs, ["D64PWXTUJ5.app.zestsnap"]);
    const routes = body.applinks.details[0].components.map((c: { "/": string }) => c["/"]);
    for (const r of ["/app*", "/auth/callback*", "/reset-password*", "/share/*", "/shared/*"]) assert.ok(routes.includes(r), r);
    assert.equal(routes.some((r: string) => r.startsWith("/admin") || r.startsWith("/api")), false);
    assert.deepEqual(body.webcredentials.apps, ["D64PWXTUJ5.app.zestsnap"]);
  } finally {
    if (previous === undefined) delete process.env.APPLE_TEAM_ID; else process.env.APPLE_TEAM_ID = previous;
  }
});
