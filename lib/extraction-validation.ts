import type { ExtractionResult, ExtractedEvent } from "./extraction-types";
import { isValidDate } from "./dates";
export const DATE_REVIEW_WARNING = "A date in this document didn’t look right, so it was left blank. Check it before saving.";

// Labels the model may give a class/work timetable instead of "timetable". Exam and meal schedules keep their own flows.
const TIMETABLE_FALLBACK_TYPES = new Set(["schedule", "event", "other", "school_notice", "task_list"]);

/**
 * The timetable flow (term dates → weekly occurrences) keys off documentType, but the model sometimes calls a
 * weekly class timetable a "schedule" while still returning undated weekly slots. Undated weekly rows can only be
 * placed with term dates, so treat them as a timetable rather than leaving every class as "date needs review".
 */
const MEAL_SLOT = /^(breakfast|brunch|lunch|dinner|supper|snack|tea|dessert)$/i;

/**
 * Meal schedules often come back titled only "Breakfast"/"Dinner" with the dish in the description. Shared meal plans
 * and the Daily Briefing show titles only, so put the dish in the title ("Dinner: Pasta bake").
 */
function nameMeals<T extends Pick<ExtractionResult, "documentType" | "events">>(r: T): T {
  if (r.documentType !== "meal_schedule") return r;
  return {
    ...r,
    events: r.events.map((e) => {
      const dish = (e.description || "").split("\n")[0].trim();
      return MEAL_SLOT.test(e.title.trim()) && dish && dish.length <= 200 ? { ...e, title: `${e.title.trim()}: ${dish}` } : e;
    }),
  };
}

export function normalizeDocumentType<T extends Pick<ExtractionResult, "documentType" | "events">>(r: T): T {
  if (!TIMETABLE_FALLBACK_TYPES.has(r.documentType)) return nameMeals(r);
  const undatedWeekly = r.events.filter((e) => e.recurrence === "weekly" && e.dayOfWeek && !e.startDate).length;
  return undatedWeekly > 0 && undatedWeekly * 2 >= r.events.length ? { ...r, documentType: "timetable" } : r;
}

export function validateExtraction(value: unknown): ExtractionResult {
  if (!value || typeof value !== "object") throw new Error("invalid_output");
  const r = value as ExtractionResult;
  if (
    typeof r.documentType !== "string" ||
    typeof r.summary !== "string" ||
    r.summary.length > 10000 ||
    !Array.isArray(r.events) ||
    r.events.length > 200 ||
    !Array.isArray(r.warnings) ||
    r.warnings.some((w) => typeof w !== "string" || w.length > 10000)
  )
    throw new Error("invalid_output");
  r.events = r.events.map((e: ExtractedEvent) => {
    if (
      !e ||
      typeof e.allDay !== "boolean" ||
      typeof e.confidence !== "number" ||
      e.confidence < 0 ||
      e.confidence > 1
    )
      throw new Error("invalid_output");
    for (const k of [
      "title",
      "startDate",
      "endDate",
      "startTime",
      "endTime",
      "timezone",
      "location",
      "description",
      "confidenceReason",
      "sourceText",
      "dayOfWeek",
      "recurrence",
      "category",
    ] as const)
      if (typeof e[k] !== "string" || e[k].length > 10000)
        throw new Error("invalid_output");
    if (e.recurrence !== undefined && !["none","weekly"].includes(e.recurrence)) throw new Error("invalid_output");
    if (e.dayOfWeek && !["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].includes(e.dayOfWeek.toLowerCase())) throw new Error("invalid_output");
    // An impossible or out-of-range date is cleared for review, never "fixed" by guessing.
    for (const k of ["startDate", "endDate"] as const)
      if (e[k] && !isValidDate(e[k])) {
        e[k] = "";
        e.confidence = Math.min(e.confidence, 0.4);
        if (!r.warnings.includes(DATE_REVIEW_WARNING)) r.warnings.push(DATE_REVIEW_WARNING);
      }
    if (e.timezone)
      try {
        new Intl.DateTimeFormat("en", { timeZone: e.timezone });
      } catch {
        e.timezone = "";
        r.warnings.push("Choose the correct timezone before exporting.");
      }
    return e;
  });
  return normalizeDocumentType(r);
}
