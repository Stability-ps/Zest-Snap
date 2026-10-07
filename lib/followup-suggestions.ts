import type { PlannerItem } from "./planner";

export type FollowupCandidate = {
  kind: "prepare" | "deadline";
  title: string;
  scheduledAt: string;
};

function referenceDateTime(item: PlannerItem) {
  const date = item.startDate || item.dueDate;
  if (!date) return null;
  const time = item.startTime || item.dueTime || "09:00";
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function followupCandidates(item: PlannerItem, now = new Date()): FollowupCandidate[] {
  const at = referenceDateTime(item);
  if (!at || at.getTime() <= now.getTime()) return [];
  const out: FollowupCandidate[] = [];
  const dayBefore = new Date(at.getTime() - 24 * 60 * 60 * 1000);
  if (dayBefore.getTime() > now.getTime() && item.type === "event") {
    out.push({ kind: "prepare", title: `Prepare for ${item.title}`, scheduledAt: dayBefore.toISOString() });
  }
  if ((item.type === "deadline" || item.type === "task") && at.getTime() - now.getTime() > 2 * 60 * 60 * 1000) {
    const before = new Date(at.getTime() - 60 * 60 * 1000);
    if (before.getTime() > now.getTime()) out.push({ kind: "deadline", title: `Due soon: ${item.title}`, scheduledAt: before.toISOString() });
  }
  return out;
}
