import { test } from "node:test";
import assert from "node:assert/strict";
import { hasWeeklyValue, weeklyValue } from "../lib/weekly-value";

const now = new Date("2026-10-10T18:00:00Z"); // 20:00 in Johannesburg
const tz = "Africa/Johannesburg";
const ago = (days: number, hour = 10) => new Date(Date.UTC(2026, 9, 10 - days, hour - 2)).toISOString();

test("counts the last 7 days only and estimates minutes saved", () => {
  const v = weeklyValue({
    now, timezone: tz,
    scans: [{ scannedAt: ago(1), events: [1, 2, 3] }, { scannedAt: ago(9), events: [1] }, { scannedAt: ago(2), events: [1], status: "failed" }],
    items: [{ createdAt: ago(1), status: "completed", completedAt: ago(0) }, { createdAt: ago(3), status: "open" }],
    reminders: [{ status: "sent", deliveredAt: ago(2), scheduledAt: ago(2) }, { status: "pending", scheduledAt: ago(-1) }],
  });
  assert.equal(v.captured, 3);
  assert.equal(v.completed, 1);
  assert.equal(v.remindersSent, 1);
  assert.equal(v.minutesSaved, 6);
  assert.ok(hasWeeklyValue(v));
});

test("streak counts consecutive active days and survives a quiet morning", () => {
  const items = [1, 2, 3].map((d) => ({ createdAt: ago(d) }));
  assert.equal(weeklyValue({ now, timezone: tz, scans: [], items, reminders: [] }).streak, 3);
  assert.equal(weeklyValue({ now, timezone: tz, scans: [], items: [...items, { createdAt: ago(0) }], reminders: [] }).streak, 4);
  assert.equal(weeklyValue({ now, timezone: tz, scans: [], items: [{ createdAt: ago(2) }], reminders: [] }).streak, 0);
});

test("nothing this week means no card", () => {
  assert.equal(hasWeeklyValue(weeklyValue({ now, timezone: tz, scans: [], items: [], reminders: [] })), false);
});
