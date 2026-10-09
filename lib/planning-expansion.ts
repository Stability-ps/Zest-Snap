import { Temporal } from "@js-temporal/polyfill";
import { plannerFingerprint, type PlannerItem } from "./planner";

export type TimetableClassInput = {
  subject: string;
  weekdays: number[]; // ISO Monday=1 ... Sunday=7
  startTime: string;
  endTime: string;
  location?: string;
};

export type TimetableScheduleInput = {
  title: string;
  termStart: string;
  termEnd: string;
  timezone: string;
  classes: TimetableClassInput[];
};

export type MealEntryInput = {
  title: string;
  mealDate: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack" | "other";
  startTime?: string;
};

function id() {
  return crypto.randomUUID();
}

export function validateTimetableSchedule(input: TimetableScheduleInput) {
  const start = Temporal.PlainDate.from(input.termStart);
  const end = Temporal.PlainDate.from(input.termEnd);
  if (Temporal.PlainDate.compare(end, start) < 0) throw new Error("Term end must be after the start date.");
  if (!input.title.trim()) throw new Error("Give the timetable a name.");
  if (!input.classes.length) throw new Error("Add at least one class.");
  if (start.until(end).days > 370) throw new Error("A timetable cannot run for more than 370 days.");
  for (const c of input.classes) {
    if (!c.subject.trim()) throw new Error("Every class needs a subject.");
    if (!c.weekdays.length || c.weekdays.some((d) => d < 1 || d > 7)) throw new Error("Choose at least one valid weekday.");
    if (!/^\d{2}:\d{2}$/.test(c.startTime) || !/^\d{2}:\d{2}$/.test(c.endTime) || c.endTime <= c.startTime)
      throw new Error("Choose valid class times.");
  }
}

export function timetablePlannerItems(input: TimetableScheduleInput): PlannerItem[] {
  validateTimetableSchedule(input);
  const now = new Date().toISOString();
  const start = Temporal.PlainDate.from(input.termStart);
  const end = Temporal.PlainDate.from(input.termEnd);
  const out: PlannerItem[] = [];
  for (let d = start; Temporal.PlainDate.compare(d, end) <= 0; d = d.add({ days: 1 })) {
    for (const c of input.classes) {
      if (!c.weekdays.includes(d.dayOfWeek)) continue;
      out.push({
        id: id(),
        type: "event",
        title: c.subject.trim(),
        description: input.title.trim(),
        startDate: d.toString(),
        endDate: d.toString(),
        startTime: c.startTime,
        endTime: c.endTime,
        dueDate: d.toString(),
        dueTime: "",
        allDay: false,
        timezone: input.timezone || "UTC",
        location: c.location?.trim() || "",
        status: "open",
        source: "manual",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return out;
}

/** Selects or clears one ISO weekday (Monday=1 … Sunday=7), keeping the list sorted and unique. */
export function toggleWeekday(weekdays: number[], day: number): number[] {
  const set = new Set(weekdays.filter((d) => d >= 1 && d <= 7));
  if (set.has(day)) set.delete(day);
  else if (day >= 1 && day <= 7) set.add(day);
  return [...set].sort((a, b) => a - b);
}

/** Drops classes already in the Planner (or repeated in the batch), so saving a timetable twice adds nothing. */
export function newTimetableItems(items: PlannerItem[], existing: PlannerItem[]): PlannerItem[] {
  const seen = new Set(existing.filter((x) => x.status !== "cancelled").map(plannerFingerprint));
  return items.filter((item) => {
    const key = plannerFingerprint(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mealPlannerItem(entry: MealEntryInput, timezone: string): PlannerItem {
  Temporal.PlainDate.from(entry.mealDate);
  if (!entry.title.trim()) throw new Error("Enter a meal.");
  const now = new Date().toISOString();
  return {
    id: id(),
    type: "event",
    title: entry.title.trim(),
    description: entry.mealType[0].toUpperCase() + entry.mealType.slice(1),
    startDate: entry.mealDate,
    endDate: entry.mealDate,
    startTime: entry.startTime || "",
    endTime: "",
    dueDate: entry.mealDate,
    dueTime: "",
    allDay: !entry.startTime,
    timezone: timezone || "UTC",
    location: "",
    status: "open",
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}
