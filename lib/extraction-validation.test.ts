import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDocumentType, validateExtraction } from "./extraction-validation";

const ev = (over: Record<string, unknown> = {}) => ({
  title: "Mathematics", startDate: "", endDate: "", startTime: "08:00", endTime: "09:00", allDay: false, timezone: "UTC",
  location: "R12", description: "", confidence: 1, confidenceReason: "", sourceText: "", dayOfWeek: "monday",
  recurrence: "weekly", category: "school", ...over,
});

test("a weekly class timetable labelled 'schedule' still opens the timetable flow", () => {
  // Real production output (2026-10-07): five undated weekly classes, documentType "schedule".
  const out = validateExtraction({ documentType: "schedule", summary: "Weekly class timetable", warnings: [],
    events: ["monday", "monday", "wednesday", "thursday", "friday"].map((d) => ev({ dayOfWeek: d })) });
  assert.equal(out.documentType, "timetable");
});

test("exam and meal schedules, dated schedules and mostly one-off documents keep their type", () => {
  for (const documentType of ["exam_timetable", "meal_schedule", "travel"] as const)
    assert.equal(normalizeDocumentType({ documentType, events: [ev() as never] }).documentType, documentType);
  const dated = [ev({ startDate: "2026-11-09", recurrence: "none", dayOfWeek: "" }), ev({ startDate: "2026-11-11", recurrence: "none", dayOfWeek: "" })];
  assert.equal(normalizeDocumentType({ documentType: "schedule", events: dated as never[] }).documentType, "schedule");
  const mostlyOneOff = [ev(), ...[1, 2, 3].map((n) => ev({ startDate: `2026-11-0${n}`, recurrence: "none", dayOfWeek: "" }))];
  assert.equal(normalizeDocumentType({ documentType: "school_notice", events: mostlyOneOff as never[] }).documentType, "school_notice");
});
