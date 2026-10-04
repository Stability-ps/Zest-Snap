import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { Temporal } from "@js-temporal/polyfill";

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = new MemoryStorage();
g.sessionStorage = new MemoryStorage();
g.window = { location: { search: "" }, addEventListener() {}, dispatchEvent() {} };
g.document = { cookie: "" };

const item = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(), type: "event", title: "x", description: "", startDate: "", endDate: "", startTime: "", endTime: "",
  dueDate: "", dueTime: "", allDay: true, timezone: "UTC", location: "", status: "open", source: "manual",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});

test("Home Today and Planner Today use one timezone-aware definition", async () => {
  const { plannerTodayItems, todayDate } = await import("../lib/planner");
  // 22:30 UTC on 4 Oct is already 5 Oct in Auckland and still 4 Oct in Los Angeles.
  const now = Temporal.Instant.from("2026-10-04T22:30:00Z");
  const items = [
    item({ title: "Auckland morning", startDate: "2026-10-05", timezone: "Pacific/Auckland" }),
    item({ title: "LA evening", startDate: "2026-10-04", timezone: "America/Los_Angeles" }),
    item({ title: "Task due", type: "task", dueDate: "2026-10-05" }),
    item({ title: "Cancelled", startDate: "2026-10-05", status: "cancelled" }),
  ] as never[];
  assert.equal(todayDate("Pacific/Auckland", now), "2026-10-05");
  assert.deepEqual(plannerTodayItems(items, "Pacific/Auckland", now).map((i: { title: string }) => i.title), ["Auckland morning", "Task due"]);
  assert.deepEqual(plannerTodayItems(items, "America/Los_Angeles", now).map((i: { title: string }) => i.title), ["LA evening"]);
});

test("scan extraction never creates hidden reminder-type Planner items", async () => {
  const { extractionToPlannerSuggestion } = await import("../lib/planner-from-extraction");
  const base = { title: "Reminder: renew licence", startDate: "2027-01-02", endDate: "2027-01-02", startTime: "", endTime: "", timezone: "Europe/Berlin", location: "", description: "", allDay: true, confidence: 0.9, confidenceReason: "", sourceText: "", category: "other" as const };
  assert.notEqual(extractionToPlannerSuggestion(base, "scan").item.type, "reminder");
  assert.equal(extractionToPlannerSuggestion({ ...base, title: "Invoice due" }, "scan").item.type, "deadline");
});

test("signing out or switching accounts removes the previous person's cached data", async () => {
  const { clearAccountCaches, setActiveUser, STARTUP_STATE_KEY, deviceId } = await import("../lib/session");
  const ls = g.localStorage as MemoryStorage;
  const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
  const device = deviceId();
  setActiveUser(A);
  ls.setItem(STARTUP_STATE_KEY, JSON.stringify({ userId: A, credits: 9, displayName: "Alex" }));
  ls.setItem("zest-planner-last-used-v1", "{}");
  ls.setItem("zest-last-display-name", "Alex");
  ls.setItem(`zest-cloud-${A}`, "{}");
  ls.setItem(`zest-planner-cloud-${A}`, "{}");
  ls.setItem(`zest-cloud-reminders-${A}`, "[]");
  ls.setItem("zest-snap-local-v2", '{"scans":[],"events":[]}');
  setActiveUser(B);
  for (const k of [STARTUP_STATE_KEY, "zest-planner-last-used-v1", "zest-last-display-name", `zest-cloud-${A}`, `zest-planner-cloud-${A}`, `zest-cloud-reminders-${A}`])
    assert.equal(ls.getItem(k), null, k);
  ls.setItem(`zest-cloud-${B}`, "{}");
  clearAccountCaches();
  assert.equal(ls.getItem(`zest-cloud-${B}`), null);
  assert.equal(deviceId(), device, "device id survives so trial limits still apply");
  assert.ok(ls.getItem("zest-snap-local-v2"), "guest data is not an account cache");
});

test("first render reads the signed-in user from the auth cookie without a network call", async () => {
  const { sessionUserIdSync } = await import("../lib/session");
  const { getSupabasePublicConfig } = await import("../lib/supabase/config");
  const ref = new URL(getSupabasePublicConfig().url).hostname.split(".")[0];
  const id = "33333333-3333-3333-3333-333333333333";
  const value = "base64-" + Buffer.from(JSON.stringify({ access_token: "t", user: { id } })).toString("base64url");
  (g.document as { cookie: string }).cookie = `other=1; sb-${ref}-auth-token.0=${value.slice(0, 40)}; sb-${ref}-auth-token.1=${value.slice(40)}`;
  assert.equal(sessionUserIdSync(), id);
  (g.document as { cookie: string }).cookie = "other=1";
  assert.equal(sessionUserIdSync(), null);
  (g.document as { cookie: string }).cookie = `sb-${ref}-auth-token=garbage`;
  assert.equal(sessionUserIdSync(), null);
});

test("auth redirects stay inside the app and keep Rewards return paths", async () => {
  const { safeAuthNext } = await import("../lib/auth");
  assert.equal(safeAuthNext("/app?view=rewards"), "/app?view=rewards");
  assert.equal(safeAuthNext("/settings"), "/settings");
  for (const bad of ["https://evil.example/app", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/admin", null])
    assert.equal(safeAuthNext(bad as string | null), "/app");
});

test("timezone picker offers every IANA zone the runtime supports", async () => {
  const { timezoneOptions, timezoneLabel } = await import("../lib/timezones");
  const zones = timezoneOptions().map(([z]) => z);
  assert.ok(zones.length > 300, `only ${zones.length} zones`);
  for (const z of ["UTC", "Asia/Kathmandu", "America/St_Johns", "Africa/Johannesburg", "Pacific/Chatham"]) assert.ok(zones.includes(z), z);
  assert.match(timezoneLabel("Africa/Johannesburg"), /Johannesburg · Africa \(GMT\+2\)/);
});

test("service worker cache name changes on every build and never caches API or auth routes", () => {
  const run = () => {
    execFileSync("node", ["scripts/prepare-sw.mjs"]);
    return readFileSync("public/sw.js", "utf8");
  };
  const first = run(), second = run();
  const name = (sw: string) => /const CACHE = "(zest-snap-shell-[0-9a-f]{16})"/.exec(sw)?.[1];
  assert.ok(name(first) && name(second));
  assert.notEqual(name(first), name(second));
  assert.ok(!first.includes("__ZEST_SW_VERSION__"));
  assert.match(first, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(first, /url\.pathname\.startsWith\("\/auth\/"\)/);
});

test("manifest icons exist and the maskable icon is a distinct full-bleed asset", async () => {
  const manifest = (await import("../app/manifest")).default();
  const sha = (p: string) => createHash("sha256").update(readFileSync("public" + p)).digest("hex");
  for (const icon of manifest.icons || []) assert.ok(existsSync("public" + icon.src), icon.src);
  const any = manifest.icons!.find((i) => i.purpose === "any" && i.sizes === "512x512")!;
  const maskable = manifest.icons!.filter((i) => i.purpose === "maskable");
  assert.ok(maskable.length >= 2);
  for (const m of maskable) assert.notEqual(sha(m.src), sha(any.src));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/app");
});
