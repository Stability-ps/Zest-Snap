import { Temporal } from "@js-temporal/polyfill";
import { plannerReferenceDate, plannerReferenceTime, type PlannerItem } from "../planner";
import { hasPlugin, isNative } from "./runtime";
import { ZestNative } from "./permissions";

/**
 * Home-screen widget data: the next three days of open Planner items, handed to native code (Android SharedPreferences
 * / iOS App Group) so the "Today" widget can draw without opening the app and stays right past midnight.
 * Titles only, never descriptions or locations.
 */
export type WidgetItem = { time: string; title: string; type: PlannerItem["type"] };
export type WidgetSnapshot = { v: 1; updatedAt: string; days: Record<string, { count: number; items: WidgetItem[] }> };

export function widgetSnapshot(items: PlannerItem[], timezone: string, now = new Date(), perDay = 4): WidgetSnapshot {
  const today = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timezone || "UTC").toPlainDate();
  const days: WidgetSnapshot["days"] = {};
  for (let k = 0; k < 3; k++) {
    const day = today.add({ days: k }).toString();
    const todays = items
      .filter((i) => i.status === "open" && plannerReferenceDate(i) === day)
      .sort((a, b) => (plannerReferenceTime(a) || "99:99").localeCompare(plannerReferenceTime(b) || "99:99"));
    days[day] = { count: todays.length, items: todays.slice(0, perDay).map((i) => ({ time: plannerReferenceTime(i), title: i.title.slice(0, 80), type: i.type })) };
  }
  return { v: 1, updatedAt: now.toISOString(), days };
}


let last = "";
/** Sends the snapshot to the native widget when it changed. Never throws (older app builds lack the method). */
export async function updateNativeWidget(items: PlannerItem[], timezone: string) {
  if (!isNative() || !hasPlugin("ZestNative")) return;
  const snapshot = widgetSnapshot(items, timezone);
  const json = JSON.stringify({ ...snapshot, updatedAt: "" });
  if (json === last) return;
  last = json;
  try {
    await ZestNative.setWidgetData({ json: JSON.stringify(snapshot) });
  } catch {
    last = "";
  }
}
