import { Temporal } from "@js-temporal/polyfill";
import type { ExtractedEvent } from "../extraction-types";
import { isValidDate } from "../dates";
import { plannerReferenceDate, plannerReferenceTime, type PlannerItem } from "../planner";

/** What the system calendar editor needs. Times are epoch milliseconds. */
export type DeviceCalendarEvent = {
  title: string;
  startDate: number;
  endDate: number;
  isAllDay: boolean;
  location?: string;
  description?: string;
  /** Minutes relative to start (negative = before). iOS shows up to two. */
  alerts?: number[];
};

const TIME = /^\d{2}:\d{2}$/;

function zone(tz: string | undefined, fallback: string) {
  for (const z of [tz, fallback, "UTC"]) {
    if (!z) continue;
    try {
      new Intl.DateTimeFormat("en", { timeZone: z });
      return z;
    } catch {}
  }
  return "UTC";
}

/**
 * Converts wall-clock date/time in the event's own timezone into instants. All-day events are anchored at
 * midnight in the device's timezone (that's how system calendars store them); end dates are inclusive.
 * A missing end time becomes a one-hour event, matching the Google Calendar handoff and ICS export.
 */
export function toDeviceEvent(
  input: { title: string; date: string; endDate?: string; time?: string; endTime?: string; allDay: boolean; timezone?: string; location?: string; description?: string },
  deviceTimezone: string,
  alerts?: number[],
): DeviceCalendarEvent {
  if (!isValidDate(input.date)) throw new Error("Check the date before adding this to your calendar.");
  const title = input.title.trim() || "Zest Snap event";
  const endDay = input.endDate && isValidDate(input.endDate) && input.endDate >= input.date ? input.endDate : input.date;
  const base = { title, location: input.location?.trim() || undefined, description: input.description?.trim() || undefined, alerts };
  if (input.allDay || !input.time || !TIME.test(input.time)) {
    const tz = zone(deviceTimezone, "UTC");
    const start = Temporal.PlainDate.from(input.date).toZonedDateTime({ timeZone: tz }).epochMilliseconds;
    const end = Temporal.PlainDate.from(endDay).add({ days: 1 }).toZonedDateTime({ timeZone: tz }).epochMilliseconds;
    return { ...base, startDate: start, endDate: end, isAllDay: true };
  }
  const tz = zone(input.timezone, deviceTimezone);
  const start = Temporal.PlainDateTime.from(`${input.date}T${input.time}`).toZonedDateTime(tz, { disambiguation: "compatible" });
  let end = input.endTime && TIME.test(input.endTime)
    ? Temporal.PlainDateTime.from(`${endDay}T${input.endTime}`).toZonedDateTime(tz, { disambiguation: "compatible" })
    : start.add({ hours: 1 });
  if (Temporal.ZonedDateTime.compare(end, start) <= 0) end = start.add({ hours: 1 });
  return { ...base, startDate: start.epochMilliseconds, endDate: end.epochMilliseconds, isAllDay: false };
}

export function extractedToDeviceEvent(event: ExtractedEvent, deviceTimezone: string) {
  const description = [event.description?.trim(), event.sourceText?.trim() ? `Source: ${event.sourceText.trim()}` : ""].filter(Boolean).join("\n\n");
  return toDeviceEvent(
    { title: event.title, date: event.startDate, endDate: event.endDate, time: event.startTime, endTime: event.endTime, allDay: event.allDay, timezone: event.timezone, location: event.location, description },
    deviceTimezone,
    event.allDay || !event.startTime ? undefined : [-60],
  );
}

/** Planner events keep their span; tasks and deadlines become a point-in-time entry at the due time. */
export function plannerToDeviceEvent(item: PlannerItem, deviceTimezone: string) {
  const isDue = item.type === "task" || item.type === "deadline";
  const time = plannerReferenceTime(item);
  return toDeviceEvent(
    {
      title: isDue ? `${item.type === "deadline" ? "Deadline" : "To-do"}: ${item.title}` : item.title,
      date: plannerReferenceDate(item),
      endDate: isDue ? undefined : item.endDate,
      time,
      endTime: isDue ? undefined : item.endTime,
      allDay: item.allDay || !time,
      timezone: item.timezone,
      location: item.location,
      description: item.description,
    },
    deviceTimezone,
    item.allDay || !time ? undefined : isDue ? [-1440, -60] : [-60],
  );
}
