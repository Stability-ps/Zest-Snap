const nf = new Intl.NumberFormat("en-US");

export function fmtNumber(value: unknown, digits = 0) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return "—";
  return digits ? n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : nf.format(Math.round(n));
}

export function fmtMoney(value: unknown, currency = "USD") {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function fmtPercent(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

/** Ratio or null when the denominator is zero, so a missing base never renders as 0%. */
export function ratio(part: unknown, whole: unknown) {
  const p = Number(part), w = Number(whole);
  return Number.isFinite(p) && Number.isFinite(w) && w > 0 ? p / w : null;
}

/** Percentage change vs the previous comparable period, or null when there is no base to compare with. */
export function pctChange(current: unknown, previous: unknown) {
  const c = Number(current), p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return (c - p) / p;
}

export function fmtDate(value: unknown) {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtDateTime(value: unknown) {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function fmtRelative(value: unknown, now = Date.now()) {
  if (!value) return "Never";
  const t = new Date(String(value)).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.round((now - t) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(value);
}

export function fmtDuration(ms: unknown) {
  const n = Number(ms);
  if (ms === null || ms === undefined || !Number.isFinite(n)) return "—";
  return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`;
}

export const humanize = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value).replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

export function sumObject(obj: Record<string, unknown> | null | undefined) {
  return Object.values(obj || {}).reduce<number>((a, b) => a + (Number(b) || 0), 0);
}
