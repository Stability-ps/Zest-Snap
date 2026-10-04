/** Date-range presets for admin analytics. All boundaries are UTC; `to` is exclusive. */
export type RangeKey = "today" | "7d" | "30d" | "90d" | "month" | "last_month" | "custom";
export type Bucket = "day" | "week" | "month";
export type DateRange = { key: RangeKey; from: Date; to: Date; label: string; bucket: Bucket };

export const rangeOptions: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "Custom range" },
];

const DAY = 86_400_000;
const MAX_DAYS = 800;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function bucketFor(from: Date, to: Date): Bucket {
  const days = (to.getTime() - from.getTime()) / DAY;
  return days > 180 ? "month" : days > 62 ? "week" : "day";
}

function parseDay(value: string | undefined) {
  if (!value || !ISO_DAY.test(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || isoDay(d) !== value ? null : d;
}

export function parseRange(params: { range?: string; from?: string; to?: string }, now = new Date()): DateRange {
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + DAY);
  const key = (rangeOptions.some((o) => o.key === params.range) ? params.range : "30d") as RangeKey;
  const make = (k: RangeKey, from: Date, to: Date, label: string): DateRange => ({ key: k, from, to, label, bucket: bucketFor(from, to) });
  switch (key) {
    case "today":
      return make(key, today, tomorrow, "Today");
    case "7d":
      return make(key, new Date(tomorrow.getTime() - 7 * DAY), tomorrow, "Last 7 days");
    case "90d":
      return make(key, new Date(tomorrow.getTime() - 90 * DAY), tomorrow, "Last 90 days");
    case "month":
      return make(key, startOfMonth(now), tomorrow, "This month");
    case "last_month": {
      const end = startOfMonth(now);
      return make(key, startOfMonth(new Date(end.getTime() - DAY)), end, "Last month");
    }
    case "custom": {
      const from = parseDay(params.from);
      const toDay = parseDay(params.to);
      if (from && toDay && toDay >= from) {
        const to = new Date(toDay.getTime() + DAY); // inclusive end day
        const clampedFrom = to.getTime() - from.getTime() > MAX_DAYS * DAY ? new Date(to.getTime() - MAX_DAYS * DAY) : from;
        return make(key, clampedFrom, to, `${isoDay(clampedFrom)} – ${isoDay(toDay)}`);
      }
      return make("30d", new Date(tomorrow.getTime() - 30 * DAY), tomorrow, "Last 30 days");
    }
    default:
      return make("30d", new Date(tomorrow.getTime() - 30 * DAY), tomorrow, "Last 30 days");
  }
}

/** Query string that preserves the selected range when linking between admin pages. */
export function rangeQuery(range: DateRange) {
  if (range.key !== "custom") return range.key === "30d" ? "" : `range=${range.key}`;
  return `range=custom&from=${isoDay(range.from)}&to=${isoDay(new Date(range.to.getTime() - DAY))}`;
}

export function rangeDays(range: DateRange) {
  return Math.round((range.to.getTime() - range.from.getTime()) / DAY);
}
