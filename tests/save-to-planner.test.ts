import { test } from "node:test";
import assert from "node:assert/strict";
import { saveEventsToPlanner, saveSummary, withStartTime } from "../lib/save-to-planner";
import { extractionToPlannerSuggestion } from "../lib/planner-from-extraction";
import { plannerFingerprint, type PlannerItem } from "../lib/planner";
import type { ExtractedEvent } from "../lib/extraction-types";
import { migratedDb, as } from "./helpers/db";

const ev = (over: Partial<ExtractedEvent> = {}): ExtractedEvent => ({
  title: "Study Session", startDate: "2026-11-03", endDate: "2026-11-03", startTime: "14:00", endTime: "15:00", allDay: false,
  timezone: "Africa/Johannesburg", location: "", description: "", confidence: 0.95, confidenceReason: "", sourceText: "", category: "school", ...over,
});
const days = (n: number) => Array.from({ length: n }, (_, i) => ev({ title: `Event ${i + 1}`, startDate: `2026-11-${String(i + 1).padStart(2, "0")}`, endDate: `2026-11-${String(i + 1).padStart(2, "0")}` }));

/** A Planner that stores by id (like the real upsert) and can be told to fail. */
function fakePlanner(failTitles: string[] = []) {
  const items = new Map<string, PlannerItem>();
  let calls = 0;
  return {
    items,
    get calls() { return calls; },
    upsert: async (item: PlannerItem) => {
      calls++;
      if (failTitles.includes(item.title)) throw new Error("network");
      items.set(item.id, item);
    },
    isDuplicate: (e: ExtractedEvent) => [...items.values()].some((i) => plannerFingerprint(i) === plannerFingerprint(extractionToPlannerSuggestion(e, "").item)),
  };
}
function run(events: ExtractedEvent[], indexes: number[], planner: ReturnType<typeof fakePlanner>, ids = new Map<number, string>()) {
  return saveEventsToPlanner({
    events, indexes, isDuplicate: planner.isDuplicate, upsert: planner.upsert,
    toItem: (e, i) => {
      const item = extractionToPlannerSuggestion(e, "").item;
      if (!ids.has(i)) ids.set(i, item.id);
      return { ...item, id: ids.get(i)!, sourceScanId: undefined };
    },
  });
}

for (const n of [1, 5, 10, 20]) {
  test(`saves all ${n} selected events`, async () => {
    const planner = fakePlanner();
    const events = days(n);
    const out = await run(events, events.map((_, i) => i), planner);
    assert.equal(out.saved.length, n);
    assert.equal(planner.items.size, n);
    assert.equal(saveSummary(out), `${n} ${n === 1 ? "event" : "events"} added to Planner`);
  });
}

test("same title on different dates are three events, not duplicates", async () => {
  const planner = fakePlanner();
  const events = ["2026-11-03", "2026-11-04", "2026-11-05"].map((d) => ev({ startDate: d, endDate: d }));
  const out = await run(events, [0, 1, 2], planner);
  assert.deepEqual(out.saved, [0, 1, 2]);
  assert.deepEqual([...planner.items.values()].map((i) => i.startDate).sort(), ["2026-11-03", "2026-11-04", "2026-11-05"]);
});

test("genuine duplicates are skipped: already in the Planner, or repeated within the selection", async () => {
  const planner = fakePlanner();
  await run([ev()], [0], planner);
  const out = await run([ev(), ev(), ev({ startDate: "2026-11-09", endDate: "2026-11-09" }), ev({ startDate: "2026-11-09", endDate: "2026-11-09" })], [0, 1, 2, 3], planner);
  assert.deepEqual(out.saved, [2]);
  assert.deepEqual(out.duplicates, [0, 1, 3]);
  assert.equal(planner.items.size, 2);
  assert.equal(saveSummary(out), "1 event saved · 3 duplicates skipped");
});

test("invalid or missing dates are reported, never changed or saved", async () => {
  const planner = fakePlanner();
  const out = await run([ev({ startDate: "1899-12-31", endDate: "1899-12-31" }), ev({ startDate: "", endDate: "" }), ev({ startDate: "2101-01-01", endDate: "2101-01-01" }), ev()], [0, 1, 2, 3], planner);
  assert.deepEqual(out.invalid, [0, 1, 2]);
  assert.deepEqual(out.saved, [3]);
  assert.equal(saveSummary(out), "1 event saved · 3 events need a valid date");
});

test("partial failure is reported honestly; retrying saves the rest without duplicating", async () => {
  const flaky = fakePlanner(["Event 2", "Event 4"]);
  const events = days(5);
  const ids = new Map<number, string>();
  const first = await run(events, [0, 1, 2, 3, 4], flaky, ids);
  assert.deepEqual(first.saved, [0, 2, 4]);
  assert.deepEqual(first.failed, [1, 3]);
  assert.equal(saveSummary(first), "3 events saved · 2 couldn’t be saved");
  // Connection back: retry only the failed ones (what the review screen keeps selected), with the same ids.
  const healthy = { ...fakePlanner(), items: flaky.items } as ReturnType<typeof fakePlanner>;
  healthy.upsert = async (item) => void flaky.items.set(item.id, item);
  healthy.isDuplicate = flaky.isDuplicate;
  const retry = await run(events, first.failed, healthy, ids);
  assert.deepEqual(retry.saved, [1, 3]);
  assert.equal(flaky.items.size, 5);
  // Retrying everything again (e.g. a repeated tap) inserts nothing new.
  const again = await run(events, [0, 1, 2, 3, 4], healthy, ids);
  assert.equal(again.saved.length, 0);
  assert.equal(flaky.items.size, 5);
});

test("a total failure never claims success", async () => {
  const out = await run(days(2), [0, 1], fakePlanner(["Event 1", "Event 2"]));
  assert.equal(saveSummary(out), "Couldn’t save your events. Please try again.");
});

test("edited values are what gets saved, with every field preserved", async () => {
  const planner = fakePlanner();
  const edited = ev({ startTime: "15:00", endTime: "16:30", description: "Bring notes", location: "Library", allDay: false });
  await run([edited], [0], planner);
  const item = [...planner.items.values()][0];
  assert.equal(item.startTime, "15:00");
  assert.equal(item.endTime, "16:30");
  assert.equal(item.description, "Bring notes");
  assert.equal(item.location, "Library");
  assert.equal(item.timezone, "Africa/Johannesburg");
  assert.equal(item.allDay, false);
});

test("no selection saves nothing", async () => {
  const planner = fakePlanner();
  const out = await run(days(3), [], planner);
  assert.equal(planner.calls, 0);
  assert.equal(saveSummary(out), "Nothing to save.");
});

test("database: plans without a scan save; another person's scan can't be linked; no cross-account reads", async () => {
  const db = await migratedDb();
  const A = "00000000-0000-4000-8000-0000000000a1", B = "00000000-0000-4000-8000-0000000000b1";
  for (const id of [A, B]) await db.exec(`insert into auth.users(id,email) values('${id}','${id.slice(-2)}@example.com')`);
  await db.exec(`insert into public.scans(id,user_id,payload) values('00000000-0000-4000-8000-00000000c0b1','${B}','{}')`);
  const insert = (scan: string | null) =>
    as(db, A, `insert into public.planner_items(user_id,type,title,start_date,source,source_scan_id) values($1,'event','Study Session','2026-11-03','scan',$2)`, [A, scan]);
  await insert(null);
  await assert.rejects(insert("00000000-0000-4000-8000-00000000c0b1"), /source_scan_not_owned/);
  const seenByB = await as(db, B, `select * from public.planner_items`);
  assert.equal(seenByB.rows.length, 0);
  await db.close();
});

test("editing the start time keeps the duration; untimed and overnight edits are left alone", () => {
  assert.deepEqual([withStartTime(ev(), "15:00").startTime, withStartTime(ev(), "15:00").endTime], ["15:00", "16:00"]);
  assert.equal(withStartTime(ev({ endTime: "" }), "09:30").endTime, "");
  assert.equal(withStartTime(ev(), "23:30").endTime, "15:00", "would cross midnight: the person adjusts the end");
  assert.equal(withStartTime(ev(), "").allDay, true);
});
