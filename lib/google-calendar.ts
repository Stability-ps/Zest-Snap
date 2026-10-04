import type { ExtractedEvent } from "@/lib/extraction-types";

function ymd(value: string) {
  return value.replaceAll("-", "");
}

function addDays(value: string, days: number) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function localStamp(date: string, time: string) {
  return ymd(date) + "T" + time.replace(":", "") + "00";
}

function plusMinutes(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor((total % 1440) / 60).toString().padStart(2, "0");
  const mm = (total % 60).toString().padStart(2, "0");
  return { time: `${hh}:${mm}`, dayOffset: Math.floor(total / 1440) };
}

/**
 * Browser-safe Google Calendar handoff. It opens a pre-filled event directly
 * in Google Calendar without creating or downloading an .ics file.
 */
export function googleCalendarUrl(event: ExtractedEvent, fallbackTimezone = "UTC") {
  if (!event.startDate) throw new Error("A date is required before adding this event to a calendar.");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title.trim() || "Zest Snap event",
  });

  const allDay = event.allDay || !event.startTime;
  if (allDay) {
    const start = event.startDate;
    const statedEnd = event.endDate && event.endDate >= start ? event.endDate : start;
    params.set("dates", `${ymd(start)}/${ymd(addDays(statedEnd, 1))}`);
  } else {
    const startDate = event.startDate;
    const startTime = event.startTime;
    let endDate = event.endDate && event.endDate >= startDate ? event.endDate : startDate;
    let endTime = event.endTime;

    if (!endTime) {
      const fallback = plusMinutes(startTime, 60);
      endTime = fallback.time;
      if (fallback.dayOffset) endDate = addDays(endDate, fallback.dayOffset);
    }

    params.set("dates", `${localStamp(startDate, startTime)}/${localStamp(endDate, endTime)}`);
    params.set("ctz", event.timezone || fallbackTimezone);
  }

  const details = [event.description?.trim(), event.sourceText?.trim() ? `Source: ${event.sourceText.trim()}` : ""]
    .filter(Boolean)
    .join("\n\n");
  if (details) params.set("details", details);
  if (event.location?.trim()) params.set("location", event.location.trim());

  return "https://calendar.google.com/calendar/render?" + params.toString();
}
