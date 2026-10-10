import type { ExtractedEvent } from "./extraction-types";
import { plannerFingerprint, validatePlannerItem, type PlannerItem } from "./planner";

/**
 * Saves the selected review events (photo scans and Plan with Zest) to the Planner, one item at a time so a
 * single failure never hides the others. Every outcome is reported per event; nothing is silently dropped.
 */
export type SaveOutcome = {
  saved: number[];
  /** Already in the Planner or agenda, or repeated within this selection. */
  duplicates: number[];
  /** Missing or out-of-range dates and other validation failures; never auto-corrected. */
  invalid: number[];
  /** Valid events the store could not save (network, auth, server). Safe to retry. */
  failed: number[];
};

export async function saveEventsToPlanner(opts: {
  events: ExtractedEvent[];
  indexes: number[];
  /** Existing Planner/agenda duplicate check. */
  isDuplicate: (event: ExtractedEvent) => boolean;
  /** Maps an event to its Planner item. Must return the same id for the same index so retries update, not insert. */
  toItem: (event: ExtractedEvent, index: number) => PlannerItem;
  upsert: (item: PlannerItem) => Promise<void>;
}): Promise<SaveOutcome> {
  const out: SaveOutcome = { saved: [], duplicates: [], invalid: [], failed: [] };
  const batch = new Set<string>();
  for (const index of [...new Set(opts.indexes)].sort((a, b) => a - b)) {
    const event = opts.events[index];
    if (!event) continue;
    if (opts.isDuplicate(event)) {
      out.duplicates.push(index);
      continue;
    }
    let item: PlannerItem;
    try {
      if (!event.startDate) throw new Error("missing date");
      item = opts.toItem(event, index);
      validatePlannerItem(item);
    } catch {
      out.invalid.push(index);
      continue;
    }
    const print = plannerFingerprint(item);
    if (batch.has(print)) {
      out.duplicates.push(index);
      continue;
    }
    batch.add(print);
    try {
      await opts.upsert(item);
      out.saved.push(index);
    } catch {
      out.failed.push(index);
    }
  }
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Short result line for the review action bar, e.g. "3 saved · 2 duplicates skipped". */
export function saveSummary(o: SaveOutcome) {
  const parts: string[] = [];
  if (o.saved.length) parts.push(plural(o.saved.length, "event saved", "events saved"));
  if (o.duplicates.length) parts.push(plural(o.duplicates.length, "duplicate skipped", "duplicates skipped"));
  if (o.invalid.length) parts.push(`${plural(o.invalid.length, "event needs", "events need")} a valid date`);
  if (o.failed.length) parts.push(`${o.failed.length} couldn’t be saved`);
  if (!parts.length) return "Nothing to save.";
  if (o.saved.length && !o.duplicates.length && !o.invalid.length && !o.failed.length)
    return `${plural(o.saved.length, "event", "events")} added to Planner`;
  if (!o.saved.length && o.failed.length && !o.duplicates.length && !o.invalid.length) return "Couldn’t save your events. Please try again.";
  return parts.join(" · ");
}

const minutes = (t: string) => (/^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : NaN);
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Review editor: changing the start time moves a same-day end time with it, so the duration is kept
 * (14:00–15:00 moved to 15:00 becomes 15:00–16:00 instead of an invalid 15:00–15:00).
 */
export function withStartTime(event: ExtractedEvent, startTime: string): ExtractedEvent {
  const next = { ...event, startTime, allDay: !startTime };
  const [from, to, at] = [minutes(event.startTime), minutes(event.endTime), minutes(startTime)];
  const sameDay = !event.endDate || event.endDate === event.startDate;
  if (sameDay && to > from && !Number.isNaN(at) && at + (to - from) < 24 * 60) next.endTime = clock(at + (to - from));
  return next;
}
