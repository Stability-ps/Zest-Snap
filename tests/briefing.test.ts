import { test } from "node:test";
import assert from "node:assert/strict";
import { briefingFor, nextBriefingTimes } from "../lib/briefing";
import type { PlannerItem } from "../lib/planner";

const now = "2026-10-10T08:00:00Z";
const item = (o: Partial<PlannerItem>): PlannerItem => ({
  id: crypto.randomUUID(), type: "event", title: "x", description: "", startDate: "2026-10-12", endDate: "", startTime: "", endTime: "",
  dueDate: "", dueTime: "", allDay: false, timezone: "Africa/Johannesburg", location: "", status: "open", source: "manual", createdAt: now, updatedAt: now, ...o,
});

test("briefing lists the day's open items, timed first, with a +N more tail", () => {
  const items = [
    item({ title: "Science Fair", startTime: "10:00" }),
    item({ title: "Dentist", startTime: "08:30" }),
    item({ type: "task", title: "Pay school trip", startDate: "", dueDate: "2026-10-12" }),
    item({ title: "Braai", startTime: "17:00" }),
    item({ title: "Done already", startTime: "07:00", status: "completed" }),
    item({ title: "Tomorrow", startDate: "2026-10-13", startTime: "09:00" }),
  ];
  const b = briefingFor(items, "2026-10-12", { includeTodos: true, locale: "en-GB" });
  assert.equal(b?.title, "Today · 4 items");
  assert.equal(b?.body, "08:30 Dentist · 10:00 Science Fair · 17:00 Braai · +1 more");
  assert.equal(briefingFor(items, "2026-10-12", { includeTodos: false, locale: "en-GB" })?.title, "Today · 3 items");
  assert.equal(briefingFor(items, "2026-10-20", { includeTodos: true }), null);
});

test("next briefing times are in the person's timezone and skip a time already passed today", () => {
  const t = nextBriefingTimes({ localTime: "07:00", timezone: "Africa/Johannesburg" }, new Date("2026-10-10T08:00:00Z"));
  assert.deepEqual(t.map((x) => x.day), ["2026-10-11", "2026-10-12", "2026-10-13"]);
  assert.equal(t[0].at.toISOString(), "2026-10-11T05:00:00.000Z");
  const early = nextBriefingTimes({ localTime: "11:00", timezone: "Africa/Johannesburg" }, new Date("2026-10-10T08:00:00Z"));
  assert.equal(early[0].day, "2026-10-10");
});

test("widget snapshot: next three days, open items only, timed first, capped per day, titles only", async () => {
  const { widgetSnapshot } = await import("../lib/native/widget");
  const items = [
    item({ title: "Science Fair", startTime: "10:00", description: "secret", location: "Hall" }),
    item({ title: "Dentist", startTime: "08:30" }),
    item({ title: "Done", startTime: "07:00", status: "completed" }),
    item({ title: "Later", startDate: "2026-10-20", startTime: "09:00" }),
  ];
  const s = widgetSnapshot(items, "Africa/Johannesburg", new Date("2026-10-11T08:00:00Z"));
  assert.deepEqual(Object.keys(s.days), ["2026-10-11", "2026-10-12", "2026-10-13"]);
  assert.equal(s.days["2026-10-12"].count, 2);
  assert.deepEqual(s.days["2026-10-12"].items, [{ time: "08:30", title: "Dentist", type: "event" }, { time: "10:00", title: "Science Fair", type: "event" }]);
  assert.ok(!JSON.stringify(s).includes("secret") && !JSON.stringify(s).includes("Hall"));
});
