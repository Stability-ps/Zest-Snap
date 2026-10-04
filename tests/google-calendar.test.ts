import assert from "node:assert/strict";
import test from "node:test";
import { googleCalendarUrl } from "../lib/google-calendar";
import type { ExtractedEvent } from "../lib/extraction-types";

const base: ExtractedEvent = {
  title: "Court appearance",
  startDate: "2026-10-12",
  endDate: "2026-10-12",
  startTime: "09:00",
  endTime: "10:30",
  timezone: "Africa/Johannesburg",
  location: "Pretoria",
  description: "Bring the file",
  allDay: false,
  confidence: 0.95,
  confidenceReason: "clear date",
  sourceText: "",
  category: "appointment",
};

test("builds a timed Google Calendar handoff without an ICS file", () => {
  const url = new URL(googleCalendarUrl(base));
  assert.equal(url.hostname, "calendar.google.com");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), "Court appearance");
  assert.equal(url.searchParams.get("dates"), "20261012T090000/20261012T103000");
  assert.equal(url.searchParams.get("ctz"), "Africa/Johannesburg");
  assert.equal(url.searchParams.get("location"), "Pretoria");
});

test("all-day end date is exclusive for Google Calendar", () => {
  const url = new URL(googleCalendarUrl({ ...base, allDay: true, startTime: "", endTime: "" }));
  assert.equal(url.searchParams.get("dates"), "20261012/20261013");
  assert.equal(url.searchParams.get("ctz"), null);
});

test("defaults a timed event to one hour", () => {
  const url = new URL(googleCalendarUrl({ ...base, startTime: "23:30", endTime: "" }));
  assert.equal(url.searchParams.get("dates"), "20261012T233000/20261013T003000");
});
