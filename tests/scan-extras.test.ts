import { test } from "node:test";
import assert from "node:assert/strict";
import { prepSuggestions, suggestionToEvent } from "../lib/scan-extras";
import { extractionToPlannerSuggestion } from "../lib/planner-from-extraction";
import type { ExtractedEvent } from "../lib/extraction-types";

const ev = (over: Partial<ExtractedEvent>): ExtractedEvent => ({
  title: "Science Fair", startDate: "2026-10-23", endDate: "", startTime: "09:00", endTime: "", timezone: "Africa/Johannesburg",
  location: "School hall", description: "", allDay: false, confidence: 0.9, confidenceReason: "", sourceText: "", category: "school", ...over,
});

test("finds prep actions in the notice's own words, due the day before", () => {
  const s = prepSuggestions(ev({ description: "Please bring your project board. Learners must wear school uniform." }));
  assert.deepEqual(s.map((x) => x.title), ["Bring your project board", "Wear school uniform"]);
  assert.equal(s[0].dueDate, "2026-10-22");
});

test("trims trailing filler and caps at two suggestions", () => {
  const s = prepSuggestions(ev({ sourceText: "Don't forget to return the signed consent form by Friday. Pack a lunch. Bring a hat." }));
  assert.equal(s.length, 2);
  assert.equal(s[0].title, "Return the signed consent form");
});

test("no date, no suggestions; the event's own action is not repeated", () => {
  assert.deepEqual(prepSuggestions(ev({ startDate: "", description: "Bring a hat" })), []);
  assert.deepEqual(prepSuggestions(ev({ title: "Pay school trip", description: "Pay school trip" })), []);
});

test("an accepted suggestion saves to the Planner as a task due that day", () => {
  const [s] = prepSuggestions(ev({ description: "Please bring your project board." }));
  const { item } = extractionToPlannerSuggestion(suggestionToEvent(s, ev({})), "scan-1");
  assert.equal(item.type, "task");
  assert.equal(item.dueDate, "2026-10-22");
  assert.equal(item.title, "Bring your project board");
});
