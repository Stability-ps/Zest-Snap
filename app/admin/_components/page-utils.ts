import { parseRange, rangeQuery, type DateRange } from "@/lib/admin/range";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function readParams(searchParams: SearchParams) {
  const raw = await searchParams;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") params[k] = v.slice(0, 200);
  return params;
}

export function pageOf(params: Record<string, string>) {
  const n = Number(params.page);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 0;
}

/** Builds a link to the same page that keeps the date range and current filters, overriding some. */
export function linkWith(base: string, params: Record<string, string>, overrides: Record<string, string | number | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...overrides })) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  if (!("page" in overrides)) q.delete("page");
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export function rangeFrom(params: Record<string, string>): DateRange {
  return parseRange(params);
}

export { rangeQuery };
