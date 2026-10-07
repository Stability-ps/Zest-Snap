import { Temporal } from "@js-temporal/polyfill";

/**
 * The calendar range Zest Snap supports everywhere a date is entered, extracted, stored or exported.
 * The database enforces the same range (see migration 20261010090000_shared_plan_deletion.sql).
 */
export const MIN_DATE = "1900-01-01";
export const MAX_DATE = "2100-12-31";
export const DATE_RANGE_MESSAGE = "Choose a real date between 1900 and 2100.";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True only for a strict YYYY-MM-DD string that names a real calendar day inside the supported range.
 * Never repairs input: "2026-02-30", "+100720-02-06", "2026-2-3" and "2026-02-28T10:00" are all invalid.
 */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  try {
    // Strings are parsed strictly (no overflow constraining); the round trip rejects anything normalised.
    if (Temporal.PlainDate.from(value).toString() !== value) return false;
  } catch {
    return false;
  }
  return value >= MIN_DATE && value <= MAX_DATE;
}

/** Throws a person-friendly error unless the date is valid; returns it for chaining. */
export function requireValidDate(value: unknown, message = DATE_RANGE_MESSAGE): string {
  if (!isValidDate(value)) throw new Error(message);
  return value;
}
