import type { ExtractedEvent } from "../extraction-types";
import type { PlannerItem } from "../planner";
import { hasPlugin, runtime } from "./runtime";
import { extractedToDeviceEvent, plannerToDeviceEvent, type DeviceCalendarEvent } from "./calendar-event";

export type CalendarAddResult = "added" | "cancelled";

/** Device calendar is available in the native apps only; it never depends on Google Calendar being connected. */
export function deviceCalendarAvailable() {
  return hasPlugin("CapacitorCalendar");
}

const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * Opens the system "New Event" editor pre-filled (iOS EventKit UI / Android Calendar insert screen).
 * The person picks the calendar and confirms there, so Zest Snap needs no calendar permission.
 */
async function prompt(event: DeviceCalendarEvent): Promise<CalendarAddResult> {
  const { CapacitorCalendar } = await import("@ebarooni/capacitor-calendar");
  const result = await CapacitorCalendar.createEventWithPrompt({
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate,
    isAllDay: event.isAllDay,
    location: event.location,
    description: event.description,
    alerts: event.alerts,
  });
  // iOS reports the saved event id (null when cancelled); Android's insert intent can't report the outcome.
  return runtime() === "ios" && !result?.id ? "cancelled" : "added";
}

export function addExtractedEventToDevice(event: ExtractedEvent) {
  return prompt(extractedToDeviceEvent(event, deviceTimezone()));
}

export function addPlannerItemToDevice(item: PlannerItem) {
  return prompt(plannerToDeviceEvent(item, deviceTimezone()));
}
