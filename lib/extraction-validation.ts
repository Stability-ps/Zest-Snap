import type { ExtractionResult, ExtractedEvent } from "./extraction-types";
import { Temporal } from "@js-temporal/polyfill";
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
    if (!["none","weekly"].includes(e.recurrence)) throw new Error("invalid_output");
    if (e.dayOfWeek && !["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].includes(e.dayOfWeek.toLowerCase())) throw new Error("invalid_output");
    for (const k of ["startDate", "endDate"] as const)
      if (e[k])
        try {
          Temporal.PlainDate.from(e[k]);
        } catch {
          e[k] = "";
          e.confidence = Math.min(e.confidence, 0.4);
          r.warnings.push("An invalid date needs correction.");
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
  return r;
}
