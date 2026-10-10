import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import config from "../capacitor.config";
import { CaptureCancelled, CapturePermissionError, CaptureUnavailable, classifyCaptureError, photoFile } from "../lib/native/camera";
import { newTimetableItems, timetablePlannerItems, toggleWeekday } from "../lib/planning-expansion";

// Regressions found in TestFlight on a physical iPhone (2026-10-09).

test("Info.plist declares every usage description the installed Camera plugin checks before opening", () => {
  // The plugin rejects every getPhoto call, camera or library, if any one of these keys is missing.
  const types = readFileSync("node_modules/@capacitor/camera/ios/Sources/CameraPlugin/CameraTypes.swift", "utf8");
  const required = [...types.matchAll(/case \w+ = "(NS\w+UsageDescription)"/g)].map((m) => m[1]);
  assert.ok(required.includes("NSPhotoLibraryAddUsageDescription"), "plugin key list could not be read");
  const plist = readFileSync("ios/App/App/Info.plist", "utf8");
  for (const key of required) assert.match(plist, new RegExp(`<key>${key}</key>\\s*<string>[^<]{20,}</string>`), key);
});

/** Capacitor's iOS rule (WebViewDelegationHandler) and Android rule (Bridge.launchIntent) for top-level navigations. */
function staysInApp(url: string) {
  const server = config.server!.url!;
  const host = new URL(url).hostname;
  return url.startsWith(server) || (config.server!.allowNavigation ?? []).some((h) => h === host || (h.startsWith("*.") && host.endsWith(h.slice(1))));
}

test("every in-app route stays inside the native WebView instead of opening Safari", () => {
  for (const path of ["/app", "/settings", "/settings?sheet=plans", "/upgrade?from=settings", "/login", "/login?mode=signup", "/reset-password", "/auth/callback?code=x", "/onboarding", "/shared/1b4e28ba-2fa1-11d2-883f-0016d3cca427"])
    assert.ok(staysInApp("https://app.zestsnap.app" + path), path);
  for (const external of ["https://evil.example/settings", "https://accounts.google.com/o/oauth2/auth", "https://app.zestsnap.app.evil.example/settings"])
    assert.equal(staysInApp(external), false, external);
});

test("native camera failures never show plugin developer text", () => {
  const missing = new Error(
    "You are missing NSPhotoLibraryAddUsageDescription in your Info.plist file. Camera will not function without it. Learn more: https://developer.apple.com/",
  );
  const sorted = classifyCaptureError(missing, "camera");
  assert.ok(sorted instanceof CaptureUnavailable);
  assert.doesNotMatch(sorted.message, /Info\.plist|NSPhoto|developer\.apple/);
  assert.match(sorted.message, /Upload/);
  assert.ok(classifyCaptureError(new Error("User cancelled photos app"), "photos") instanceof CaptureCancelled);
  assert.ok(classifyCaptureError(new Error("User denied access to camera"), "camera") instanceof CapturePermissionError);
  const unknown = classifyCaptureError(new Error("Load failed"), "photos");
  assert.ok(unknown instanceof CaptureUnavailable);
  assert.doesNotMatch(unknown.message, /Load failed/);
});

test("a captured photo reaches the scan pipeline as an image File", async () => {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const file = photoFile(Buffer.from(bytes).toString("base64"), "jpeg", 1);
  assert.equal(file.type, "image/jpeg");
  assert.equal(file.name, "zest-scan-1.jpeg");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  assert.equal(photoFile("iVBORw0K", "png").type, "image/png");
  assert.throws(() => photoFile(undefined, "jpeg"), /no_image/);
});

test("timetable weekdays select, combine and deselect", () => {
  assert.deepEqual(toggleWeekday([1], 3), [1, 3]);
  assert.deepEqual(toggleWeekday([5, 1, 3], 7), [1, 3, 5, 7]);
  assert.deepEqual(toggleWeekday([1, 3], 1), [3]);
  assert.deepEqual(toggleWeekday([3], 3), []);
  assert.deepEqual(toggleWeekday([2, 2, 9], 0), [2]);
});

test("each weekday alone and in combination creates classes on exactly those days", () => {
  // 2026-10-05 is a Monday; one full week.
  const week = (weekdays: number[]) =>
    timetablePlannerItems({ title: "Term", termStart: "2026-10-05", termEnd: "2026-10-11", timezone: "Africa/Johannesburg", classes: [{ subject: "Math", weekdays, startTime: "08:00", endTime: "09:00" }] }).map((x) => x.startDate);
  for (let d = 1; d <= 7; d++) assert.deepEqual(week([d]), [`2026-10-${String(4 + d).padStart(2, "0")}`], `weekday ${d}`);
  assert.deepEqual(week([2, 4, 6]), ["2026-10-06", "2026-10-08", "2026-10-10"]);
  assert.equal(week([1, 2, 3, 4, 5, 6, 7]).length, 7);
});

test("saving the same timetable twice does not duplicate classes", () => {
  const input = { title: "Term", termStart: "2026-10-05", termEnd: "2026-10-18", timezone: "Africa/Johannesburg", classes: [{ subject: "Math", weekdays: [1, 3], startTime: "08:00", endTime: "09:00" }] };
  const first = timetablePlannerItems(input);
  assert.equal(newTimetableItems(first, []).length, 4);
  assert.equal(newTimetableItems(timetablePlannerItems(input), first).length, 0);
  const longer = timetablePlannerItems({ ...input, termEnd: "2026-10-25" });
  assert.equal(newTimetableItems(longer, first).length, 2);
  // A cancelled class does not block re-adding it.
  assert.equal(newTimetableItems(first, first.map((x) => ({ ...x, status: "cancelled" as const }))).length, 4);
});

test("iOS fields never trigger focus zoom and date/time fields fit phone columns", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const ios = css.slice(css.lastIndexOf("@supports (-webkit-touch-callout: none)"));
  assert.match(ios, /select,\s*textarea\s*\{\s*font-size: 16px !important;/);
  assert.match(ios, /input\[type="date"\],\s*input\[type="time"\][\s\S]*?min-width: 0;/);
  assert.match(css, /\.planningToolGrid \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\); \}/);
  assert.match(css, /\.weekdayPicker button\{min-width:0;height:44px;/, "weekday buttons keep a 44pt touch target");
});
