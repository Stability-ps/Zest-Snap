import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DATE, MIN_DATE, isValidDate, requireValidDate, formatDisplayDate, formatDisplayTime } from "./dates";
import { validateExtraction, DATE_REVIEW_WARNING } from "./extraction-validation";
import { validatePlannerItem, type PlannerItem } from "./planner";
import { validateEvent } from "./events";
import { googleCalendarUrl } from "./google-calendar";
import { toDeviceEvent } from "./native/calendar-event";
import { materializeWeeklySchedule } from "./schedule";
import type { ExtractedEvent } from "./extraction-types";

const BAD = ["100720-02-06", "+100720-02-06", "2026-02-30", "2026-13-01", "2026-2-3", "2026-02-28T10:00", "1899-12-31", "2101-01-01", "", " 2026-01-01", null, 20260101];

test("only real YYYY-MM-DD dates between 1900 and 2100 are accepted, and nothing is repaired", () => {
  for (const ok of [MIN_DATE, MAX_DATE, "2024-02-29", "2026-10-07"]) assert.equal(isValidDate(ok), true, ok);
  for (const bad of BAD) assert.equal(isValidDate(bad), false, String(bad));
  assert.throws(() => requireValidDate("2026-02-30"), /between 1900 and 2100/);
});

const ev = (startDate: string): ExtractedEvent => ({ title: "Parent evening", startDate, endDate: "", startTime: "", endTime: "", allDay: true,
  timezone: "UTC", location: "", description: "", confidence: 0.95, confidenceReason: "", sourceText: "", dayOfWeek: "", recurrence: "none", category: "school" });

test("AI output with an impossible or out-of-range date is cleared for review, never silently fixed", () => {
  for (const bad of ["2026-02-30", "+100720-02-06", "1850-06-01"]) {
    const out = validateExtraction({ documentType: "school_notice", summary: "s", warnings: [], events: [ev(bad)] });
    assert.equal(out.events[0].startDate, "", bad);
    assert.ok(out.events[0].confidence <= 0.4);
    assert.deepEqual(out.warnings, [DATE_REVIEW_WARNING]);
  }
  assert.equal(validateExtraction({ documentType: "event", summary: "s", warnings: [], events: [ev("2026-11-09")] }).events[0].startDate, "2026-11-09");
});

test("Planner, To-Do, reminders, exports and timetables reject out-of-range dates with a friendly message", () => {
  const item = (over: Partial<PlannerItem>): PlannerItem => ({ id: "1", type: "task", title: "Pay school fees", description: "", startDate: "", endDate: "",
    startTime: "", endTime: "", dueDate: "2026-11-01", dueTime: "", allDay: true, timezone: "UTC", location: "", status: "open", source: "manual",
    createdAt: "", updatedAt: "", ...over } as PlannerItem);
  assert.doesNotThrow(() => validatePlannerItem(item({})));
  for (const dueDate of ["100720-02-06", "2026-02-30", "2101-01-01"]) assert.throws(() => validatePlannerItem(item({ dueDate })), /between 1900 and 2100/);
  assert.throws(() => validatePlannerItem(item({ type: "event", dueDate: "", startDate: "2026-11-01", endDate: "+100720-01-01" })), /between 1900 and 2100/);
  assert.throws(() => validateEvent(ev("+100720-02-06")), /Check this event/);
  assert.throws(() => googleCalendarUrl(ev("2026-02-30")), /Check the date/);
  assert.throws(() => toDeviceEvent({ title: "x", date: "2101-01-01", allDay: true }, "UTC"), /Check the date/);
  assert.throws(() => materializeWeeklySchedule([], "2026-09-01", "100720-12-01"), /term start and end dates/);
});

test("display formatting matches the Planner and never invents a date", () => {
  assert.equal(formatDisplayDate("2026-10-17", "en-GB"), "17 Oct 2026");
  assert.equal(formatDisplayDate("2026-10-17", "en-US"), "Oct 17, 2026");
  assert.equal(formatDisplayDate("", "en-GB"), "");
  assert.equal(formatDisplayDate("2026-02-30", "en-GB"), "2026-02-30");
  assert.equal(formatDisplayTime("09:15", "en-GB"), "09:15");
  assert.equal(formatDisplayTime("18:30:00", "en-US").replace(/\s/g, " "), "6:30 PM");
  assert.equal(formatDisplayTime("soon", "en-GB"), "soon");
});
