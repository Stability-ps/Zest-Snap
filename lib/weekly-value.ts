import { Temporal } from "@js-temporal/polyfill";

/**
 * "This week with Zest": what Zest did for the person in the last 7 days, plus a gentle activity streak. Computed
 * on the device from data the app already has (scans, Planner items, reminders); nothing new is stored or sent.
 * Minutes saved is an estimate (MINUTES_PER_ITEM per date captured from a scan instead of typed) and is labelled so.
 */
export const MINUTES_PER_ITEM = 2;

type Scan = { scannedAt: string; events: unknown[]; status?: string };
type Item = { createdAt: string; completedAt?: string; status?: string };
type Reminder = { status: string; deliveredAt?: string; scheduledAt: string };

export type WeeklyValue = {
  captured: number;
  completed: number;
  remindersSent: number;
  minutesSaved: number;
  streak: number;
};

const DAY = 86_400_000;

function dayKey(iso: string | undefined, timezone: string) {
  if (!iso) return null;
  try {
    return Temporal.Instant.from(iso).toZonedDateTimeISO(timezone || "UTC").toPlainDate().toString();
  } catch {
    return null;
  }
}

export function weeklyValue(input: { scans: Scan[]; items: Item[]; reminders: Reminder[]; timezone: string; now?: Date }): WeeklyValue {
  const now = input.now ?? new Date();
  const since = now.getTime() - 7 * DAY;
  const inWeek = (iso?: string) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= since && t <= now.getTime();
  };
  const captured = input.scans.filter((s) => s.status !== "failed" && inWeek(s.scannedAt)).reduce((n, s) => n + (Array.isArray(s.events) ? s.events.length : 0), 0);
  const completed = input.items.filter((i) => i.status === "completed" && inWeek(i.completedAt)).length;
  const remindersSent = input.reminders.filter((r) => (r.status === "sent" || r.status === "handled") && inWeek(r.deliveredAt || r.scheduledAt)).length;

  // Streak: consecutive days with any activity, ending today (or yesterday, so it doesn't reset before you've used
  // the app today).
  const tz = input.timezone || "UTC";
  const active = new Set<string>();
  for (const s of input.scans) if (s.status !== "failed") active.add(dayKey(s.scannedAt, tz) ?? "");
  for (const i of input.items) {
    active.add(dayKey(i.createdAt, tz) ?? "");
    active.add(dayKey(i.completedAt, tz) ?? "");
  }
  active.delete("");
  let day = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(tz).toPlainDate();
  if (!active.has(day.toString())) day = day.subtract({ days: 1 });
  let streak = 0;
  while (active.has(day.toString()) && streak < 366) {
    streak++;
    day = day.subtract({ days: 1 });
  }

  return { captured, completed, remindersSent, minutesSaved: captured * MINUTES_PER_ITEM, streak };
}

/** Show the card only once there's something worth celebrating. */
export function hasWeeklyValue(v: WeeklyValue) {
  return v.captured + v.completed + v.remindersSent > 0;
}
