import { itemCategory, type ItemCategory } from "./item-category";
import type { PlannerItem, ReminderDraft } from "./planner";

/**
 * The reminder Zest pre-selects when you tap Reminder on an item, by kind of item: school things the evening
 * before, appointments a day ahead, bills three days before they're due, meetings 15 minutes before. Only a
 * starting choice in the Reminder sheet; the person can pick anything else.
 */
export type SmartReminder = { preset: ReminderDraft["preset"]; customDays?: number; allDayTime?: string; why: string };

const BY_CATEGORY: Partial<Record<ItemCategory, SmartReminder>> = {
  school: { preset: "1d", allDayTime: "18:00", why: "School items: the evening before" },
  health: { preset: "1d", allDayTime: "18:00", why: "Appointments: a day ahead" },
  bills: { preset: "custom", customDays: 3, allDayTime: "09:00", why: "Bills: 3 days before they’re due" },
  travel: { preset: "1d", allDayTime: "18:00", why: "Travel: the day before" },
  social: { preset: "1d", allDayTime: "10:00", why: "Plans with people: a day ahead" },
  work: { preset: "15m", why: "Meetings: 15 minutes before" },
};

export function smartReminder(item: Pick<PlannerItem, "type" | "title" | "description" | "location" | "allDay" | "startTime" | "dueTime">): SmartReminder {
  const fallback: SmartReminder = item.type === "task" || item.type === "deadline" ? { preset: "1d", why: "" } : { preset: "1h", why: "" };
  const pick = BY_CATEGORY[itemCategory(item)];
  if (!pick) return fallback;
  // "15 minutes before" only makes sense for something with a time; all-day work items get a day's notice.
  if (pick.preset === "15m" && (item.allDay || !(item.startTime || item.dueTime))) return { preset: "1d", allDayTime: "09:00", why: "Work: a day ahead" };
  return pick;
}
