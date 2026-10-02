import { NextRequest, NextResponse } from "next/server";

function esc(value: string) {
  return (value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function compactDate(date: string) { return date.replace(/-/g, ""); }
function compactDateTime(date: string, time: string) {
  return (date + "T" + (time || "00:00") + ":00").replace(/[-:]/g, "");
}

export async function POST(req: NextRequest) {
  const event = await req.json();
  if (!event?.title || !event?.startDate) {
    return NextResponse.json({ error: "Missing event title or date." }, { status: 400 });
  }

  const uid = crypto.randomUUID() + "@zestsnap.app";
  const allDay = Boolean(event.allDay || !event.startTime);
  const dtStart = allDay
    ? "DTSTART;VALUE=DATE:" + compactDate(event.startDate)
    : "DTSTART:" + compactDateTime(event.startDate, event.startTime);
  const dtEnd = allDay
    ? "DTEND;VALUE=DATE:" + compactDate(event.endDate || event.startDate)
    : "DTEND:" + compactDateTime(event.endDate || event.startDate, event.endTime || event.startTime);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zest Snap//Calendar Export//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""),
    dtStart,
    dtEnd,
    "SUMMARY:" + esc(event.title),
    event.location ? "LOCATION:" + esc(event.location) : "",
    event.description ? "DESCRIPTION:" + esc(event.description) : "",
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean);

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="zest-snap-event.ics"'
    }
  });
}
