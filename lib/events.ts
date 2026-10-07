import { Temporal } from "@js-temporal/polyfill";
import type { ExtractedEvent } from "./extraction-types";
import { requireValidDate } from "./dates";
const normalize = (s: string) =>
  s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export function eventFingerprint(e: ExtractedEvent): string {
  return JSON.stringify([
    normalize(e.title),
    e.startDate,
    e.allDay ? "" : e.startTime,
    e.allDay ? "" : e.timezone || "UTC",
    normalize(e.location),
  ]);
}
export function validateEvent(e: ExtractedEvent) {
  if (
    !e ||
    typeof e.title !== "string" ||
    !e.title.trim() ||
    e.title.length > 500
  )
    throw new Error("Enter an event title.");
  const start = Temporal.PlainDate.from(requireValidDate(e.startDate, "Check this event's date before exporting it."));
  const end = Temporal.PlainDate.from(requireValidDate(e.endDate || e.startDate, "Check this event's end date before exporting it."));
  if (Temporal.PlainDate.compare(end, start) < 0)
    throw new Error("End date must follow the start date.");
  for (const key of ["description", "location", "timezone"] as const)
    if (typeof e[key] !== "string" || e[key].length > 10000)
      throw new Error("Invalid event details.");
  if (!e.allDay) {
    if (!e.timezone) throw new Error("Choose a timezone for this event.");
    if (!/^\d{2}:\d{2}$/.test(e.startTime))
      throw new Error("Enter a start time or choose all day.");
    const first = instant(e.startDate, e.startTime, e.timezone);
    if (
      e.endTime &&
      instant(e.endDate || e.startDate, e.endTime, e.timezone)
        .epochMilliseconds <= first.epochMilliseconds
    )
      throw new Error("End time must follow the start time.");
  }
}
export function instant(date: string, time: string, timezone: string) {
  return Temporal.PlainDateTime.from(`${date}T${time}`)
    .toZonedDateTime(timezone || "UTC", { disambiguation: "reject" })
    .toInstant();
}
export function agendaGroup(e: ExtractedEvent, now = Temporal.Now.instant()) {
  let today;
  try {
    today = now.toZonedDateTimeISO(e.timezone || "UTC").toPlainDate();
  } catch {
    return "Needs review";
  }
  if (!e.startDate) return "Needs review";
  let days;
  try {
    days = today.until(Temporal.PlainDate.from(e.endDate || e.startDate)).days;
  } catch {
    return "Needs review";
  }
  return days < 0
    ? "Past"
    : days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days < 7
          ? "This week"
          : "Later";
}
