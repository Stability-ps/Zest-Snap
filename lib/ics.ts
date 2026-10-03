import { Temporal } from "@js-temporal/polyfill";
import type { ExtractedEvent } from "./extraction-types";
import { eventFingerprint, instant, validateEvent } from "./events";
const esc = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
function fold(line: string) {
  let out = "",
    length = 0;
  for (const c of line) {
    const size = new TextEncoder().encode(c).length;
    if (length + size > 75) {
      out += "\r\n ";
      length = 1;
    }
    out += c;
    length += size;
  }
  return out;
}
const stamp = (s: string) => s.replace(/[-:]/g, "").replace(/\.\d+/, "");
export async function generateIcs(events: ExtractedEvent[], now = new Date()) {
  if (!Array.isArray(events) || !events.length || events.length > 200)
    throw new Error("Select between 1 and 200 events.");
  const unique = new Map(
    events.map((e) => {
      validateEvent(e);
      return [eventFingerprint(e), e];
    }),
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zest Snap//Calendar Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const [fingerprint, e] of unique) {
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(fingerprint),
    );
    const uid = Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    let start: string, end: string;
    if (e.allDay) {
      start = "DTSTART;VALUE=DATE:" + stamp(e.startDate);
      end =
        "DTEND;VALUE=DATE:" +
        stamp(
          Temporal.PlainDate.from(e.endDate || e.startDate)
            .add({ days: 1 })
            .toString(),
        );
    } else {
      const first = instant(e.startDate, e.startTime, e.timezone);
      start = "DTSTART:" + stamp(first.toString());
      // Missing end time is represented by a one-hour calendar duration, not an extracted fact.
      end =
        "DTEND:" +
        stamp(
          (e.endTime
            ? instant(e.endDate || e.startDate, e.endTime, e.timezone)
            : first.add({ hours: 1 })
          ).toString(),
        );
    }
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@zestsnap.app`,
      "DTSTAMP:" + stamp(now.toISOString()),
      start,
      end,
      "SUMMARY:" + esc(e.title),
      "LOCATION:" + esc(e.location),
      "DESCRIPTION:" + esc(e.description),
      "END:VEVENT",
    );
  }
  return [...lines, "END:VCALENDAR", ""].map(fold).join("\r\n");
}
