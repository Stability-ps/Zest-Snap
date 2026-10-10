import { test } from "node:test";
import assert from "node:assert/strict";
import { smartReminder } from "../lib/smart-reminder";

const base = { type: "event" as const, description: "", location: "", allDay: false, startTime: "10:00", dueTime: "" };

test("defaults follow the kind of item", () => {
  assert.deepEqual(smartReminder({ ...base, title: "Parent evening" }).preset, "1d");
  assert.equal(smartReminder({ ...base, title: "Parent evening" }).allDayTime, "18:00");
  assert.equal(smartReminder({ ...base, title: "Dentist" }).preset, "1d");
  const bill = smartReminder({ ...base, type: "deadline", title: "Pay car licence", startTime: "" });
  assert.equal(bill.preset, "custom");
  assert.equal(bill.customDays, 3);
  assert.equal(smartReminder({ ...base, title: "Team meeting" }).preset, "15m");
});

test("all-day work items get a day's notice; unknown items keep the old defaults", () => {
  assert.equal(smartReminder({ ...base, title: "Project deadline", allDay: true, startTime: "" }).preset, "1d");
  assert.equal(smartReminder({ ...base, title: "Call mom" }).preset, "1h");
  assert.equal(smartReminder({ ...base, type: "task", title: "Buy groceries" }).preset, "1d");
});
