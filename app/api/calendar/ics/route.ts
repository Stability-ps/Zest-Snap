import { NextRequest, NextResponse } from "next/server";

function esc(value: string) {
  return (value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function compactDate(date: string) { return date.replace(/-/g, ""); }
function compactDateTime(date: string, time: string) {
  return (date + "T" + (time || "00:00") + ":00").replace(/[-:]/g, "");
}
function nextDay(date: string) {
  const [y,m,d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

function eventLines(event: any) {
  const uid = crypto.randomUUID() + "@zestsnap.app";
  const allDay = Boolean(event.allDay || !event.startTime);
  const endDate = event.endDate || event.startDate;

  const dtStart = allDay
    ? "DTSTART;VALUE=DATE:" + compactDate(event.startDate)
    : "DTSTART:" + compactDateTime(event.startDate, event.startTime);

  // RFC 5545 all-day DTEND is exclusive, so a one-day event ends next day.
  const dtEnd = allDay
    ? "DTEND;VALUE=DATE:" + compactDate(nextDay(endDate))
    : "DTEND:" + compactDateTime(endDate, event.endTime || event.startTime);

  return [
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""),
    dtStart,
    dtEnd,
    "SUMMARY:" + esc(event.title),
    event.location ? "LOCATION:" + esc(event.location) : "",
    event.description ? "DESCRIPTION:" + esc(event.description) : "",
    "END:VEVENT"
  ].filter(Boolean);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const events = Array.isArray(body?.events) ? body.events : body?.title ? [body] : [];

  if (!events.length || events.some((event: any) => !event?.title || !event?.startDate)) {
    return NextResponse.json({ error: "Missing event title or date." }, { status: 400 });
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zest Snap//Calendar Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events.flatMap(eventLines),
    "END:VCALENDAR"
  ];

  const filename = events.length > 1 ? "zest-snap-events.ics" : "zest-snap-event.ics";
  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="' + filename + '"'
    }
  });
}
