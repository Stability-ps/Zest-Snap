import { Temporal } from "@js-temporal/polyfill";
import type { PlannerItem } from "./planner";
import { plannerReferenceDate, plannerReferenceTime } from "./planner";

/**
 * Daily Briefing content and the on-device copy of its settings. The server sends the briefing as a web push
 * (supabase/functions/deliver-reminders); the iPhone and Android apps have no web push, so they schedule the same
 * briefing as a local notification from the Planner on the device (lib/native/briefing.ts).
 */
export type BriefingSettings = { enabled: boolean; localTime: string; includeTodos: boolean; timezone: string };
export const BRIEFING_KEY = "zest-briefing-v1";

export function readBriefingSettings(storage: Pick<Storage, "getItem"> = localStorage): BriefingSettings | null {
  try {
    const s = JSON.parse(storage.getItem(BRIEFING_KEY) || "null");
    if (!s || typeof s !== "object" || !/^\d{2}:\d{2}$/.test(s.localTime)) return null;
    return { enabled: s.enabled === true, localTime: s.localTime, includeTodos: s.includeTodos !== false, timezone: typeof s.timezone === "string" ? s.timezone : "UTC" };
  } catch {
    return null;
  }
}

export function writeBriefingSettings(next: BriefingSettings, storage: Pick<Storage, "setItem"> = localStorage) {
  try {
    storage.setItem(BRIEFING_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("zest-briefing-changed"));
  } catch {}
}

function shortTime(time: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" }).format(new Date(`1970-01-01T${time}:00Z`));
}

/** Title and body for one day, timed items first: "8:30 AM Dentist · 10:00 AM Science Fair · +1 more". */
export function briefingFor(items: PlannerItem[], day: string, opts: { includeTodos: boolean; locale?: string }) {
  const todays = items
    .filter((i) => i.status === "open" && plannerReferenceDate(i) === day && (opts.includeTodos || i.type === "event"))
    .sort((a, b) => (plannerReferenceTime(a) || "99:99").localeCompare(plannerReferenceTime(b) || "99:99"));
  if (!todays.length) return null;
  const parts = todays.slice(0, 3).map((i) => {
    const t = plannerReferenceTime(i);
    return t ? `${shortTime(t, opts.locale || "en")} ${i.title}` : i.title;
  });
  return {
    title: `Today · ${todays.length} ${todays.length === 1 ? "item" : "items"}`,
    body: parts.join(" · ") + (todays.length > 3 ? ` · +${todays.length - 3} more` : ""),
  };
}

/** The next `days` briefing moments (today too if its time hasn't passed), as instants in the person's timezone. */
export function nextBriefingTimes(settings: Pick<BriefingSettings, "localTime" | "timezone">, now = new Date(), days = 3) {
  const tz = settings.timezone || "UTC";
  const today = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(tz).toPlainDate();
  const out: { day: string; at: Date }[] = [];
  for (let k = 0; out.length < days && k <= days; k++) {
    const day = today.add({ days: k });
    const at = Temporal.PlainDateTime.from(`${day}T${settings.localTime}`).toZonedDateTime(tz, { disambiguation: "later" }).toInstant();
    if (at.epochMilliseconds > now.getTime() + 60_000) out.push({ day: day.toString(), at: new Date(at.epochMilliseconds) });
  }
  return out;
}

/** Local-notification ids reserved for briefings, so reminder syncing never cancels them. */
export const BRIEFING_NOTIFICATION_IDS = [2_000_000_001, 2_000_000_002, 2_000_000_003];
