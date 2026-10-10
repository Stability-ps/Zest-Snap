import { Temporal } from "@js-temporal/polyfill";
import type { ExtractedEvent } from "./extraction-types";

/**
 * "Zest suggests" on the scan review screen: preparation to-dos found in a notice's own words ("Please bring your
 * project board", "Return the signed form", "Pay R50 for the trip"). Each becomes an optional to-do due the day
 * before the event. Only phrases actually present in the scan are used; nothing is invented.
 */
export type PrepSuggestion = { title: string; dueDate: string; forTitle: string };

const VERBS = "bring|pack|wear|return|sign|pay|submit|send|complete|prepare|collect|book|buy|print|confirm|rsvp";
const PHRASE = new RegExp(
  `\\b(?:please\\s+|kindly\\s+|remember\\s+to\\s+|don['’]t\\s+forget\\s+to\\s+|do\\s+not\\s+forget\\s+to\\s+|learners\\s+must\\s+|you\\s+must\\s+|must\\s+)?(${VERBS})\\b\\s+([^.;!?\\n]{3,70})`,
  "gi",
);
const TRAILING = /\s+(?:with you|by|before|on|at|to school|to the event|for the event|if possible|as well)\s*$/i;

function tidy(verb: string, rest: string) {
  let object = rest.trim().replace(/\s+/g, " ").replace(/[,:]+$/, "");
  object = object.split(/\s+(?:and then|so that|because|which|who)\s+/i)[0];
  // The due date already carries the timing: drop "by Friday", "before 12 October", "on the day", etc.
  object = object.replace(/\s+(?:by|before|on|until|no later than|not later than)\s+.*$/i, "");
  for (let i = 0; i < 2; i++) object = object.replace(TRAILING, "");
  const words = object.split(" ").slice(0, 8).join(" ");
  const v = verb.toLowerCase() === "rsvp" ? "RSVP" : verb[0].toUpperCase() + verb.slice(1).toLowerCase();
  return `${v} ${words}`.trim();
}

function dayBefore(date: string) {
  try {
    return Temporal.PlainDate.from(date).subtract({ days: 1 }).toString();
  } catch {
    return date;
  }
}

export function prepSuggestions(event: ExtractedEvent, max = 2): PrepSuggestion[] {
  if (!event.startDate) return [];
  const text = `${event.description || ""}\n${event.sourceText || ""}`;
  const title = event.title.trim().toLowerCase();
  const seen = new Set<string>();
  const out: PrepSuggestion[] = [];
  for (const m of text.matchAll(PHRASE)) {
    const suggestion = tidy(m[1], m[2]);
    const key = suggestion.toLowerCase();
    // Skip the event's own action ("Pay school trip" is already the item) and near-duplicates.
    if (suggestion.split(" ").length < 2 || key === title || title.includes(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: suggestion, dueDate: dayBefore(event.startDate), forTitle: event.title });
    if (out.length >= max) break;
  }
  return out;
}

/** The review-list entry for an accepted suggestion: saved to the Planner as a task. */
export function suggestionToEvent(s: PrepSuggestion, from: ExtractedEvent): ExtractedEvent {
  return {
    title: s.title,
    startDate: s.dueDate,
    endDate: "",
    startTime: "",
    endTime: "",
    timezone: from.timezone,
    location: "",
    description: `To get ready for ${s.forTitle}.`,
    allDay: true,
    confidence: 1,
    confidenceReason: "",
    sourceText: "",
    category: "other",
    plannerType: "task",
  };
}
