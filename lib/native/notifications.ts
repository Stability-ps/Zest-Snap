import { hasPlugin } from "./runtime";

/**
 * Native reminder delivery. Zest Snap reminders already live on the server (or on-device for guests);
 * in the iOS/Android apps they are mirrored as OS-scheduled local notifications, so they fire even when
 * the app is closed, after a reboot (Android re-arms them on boot) and without any push credentials.
 */
export type NativeNotificationState = "unsupported" | "blocked" | "available" | "enabled";
type Reminder = { id: string; scheduledAt: string; status: string; label?: string; plannerItemId: string };

export const REMINDER_CHANNEL = "zest-reminders";
const ACTION_TYPE = "ZEST_REMINDER";
const MAX_SCHEDULED = 60; // iOS keeps at most 64 pending local notifications per app.

export function nativeNotificationsAvailable() {
  return hasPlugin("LocalNotifications");
}

/** Stable positive 31-bit integer id derived from the reminder UUID (local notification ids must be ints). */
export function notificationId(reminderId: string) {
  let h = 2166136261;
  for (let i = 0; i < reminderId.length; i++) {
    h ^= reminderId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) || 1;
}

export function reminderUrl(reminderId: string) {
  return `/app?view=planner&tab=reminders&reminderId=${encodeURIComponent(reminderId)}`;
}

/** Which reminders should be armed on this device right now (pure, so it is unit-tested). */
export function remindersToSchedule(reminders: Reminder[], now = Date.now()) {
  return reminders
    .filter((r) => r.status === "pending" && Date.parse(r.scheduledAt) > now + 5_000)
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    .slice(0, MAX_SCHEDULED);
}

// Capacitor plugin proxies must never be returned from an async function: awaiting them calls `.then()` on the proxy.
async function load() {
  return { LocalNotifications: (await import("@capacitor/local-notifications")).LocalNotifications };
}

let prepared = false;
async function prepare() {
  if (prepared) return;
  const { LocalNotifications } = await load();
  await LocalNotifications.createChannel?.({
    id: REMINDER_CHANNEL,
    name: "Reminders",
    description: "Planner, To-do and deadline reminders you set in Zest Snap",
    importance: 4,
    visibility: 1,
    vibration: true,
  }).catch(() => undefined);
  await LocalNotifications.registerActionTypes({
    types: [{ id: ACTION_TYPE, actions: [{ id: "done", title: "Done" }, { id: "snooze", title: "Snooze 10 min" }] }],
  }).catch(() => undefined);
  prepared = true;
}

export async function nativeNotificationState(): Promise<NativeNotificationState> {
  if (!nativeNotificationsAvailable()) return "unsupported";
  try {
    const { LocalNotifications } = await load();
    const p = await LocalNotifications.checkPermissions();
    return p.display === "granted" ? "enabled" : p.display === "denied" ? "blocked" : "available";
  } catch {
    return "unsupported";
  }
}

/** Asks for permission — only call this from a user action that needs reminders (never on launch). */
export async function enableNativeNotifications() {
  const { LocalNotifications } = await load();
  const current = await LocalNotifications.checkPermissions();
  const result = current.display === "granted" ? current : await LocalNotifications.requestPermissions();
  if (result.display === "denied") throw new Error("Notifications are off for Zest Snap. Turn them on in your phone's Settings to get reminders.");
  if (result.display !== "granted") throw new Error("Notification permission was not granted.");
  await prepare();
  return true;
}

/**
 * Makes the OS schedule match the reminder list: arms new/changed reminders, cancels ones that were
 * cancelled, completed, snoozed elsewhere or deleted. Safe to call often (it diffs first).
 */
export async function syncNativeReminders(reminders: Reminder[]) {
  if (!nativeNotificationsAvailable()) return;
  const { LocalNotifications } = await load();
  if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
  await prepare();
  const wanted = remindersToSchedule(reminders);
  const wantedById = new Map(wanted.map((r) => [notificationId(r.id), r]));
  const { notifications: pending } = await LocalNotifications.getPending();
  const stale = pending.filter((p) => {
    const r = wantedById.get(p.id);
    const at = (p.schedule as { at?: string | Date } | undefined)?.at;
    return !r || (at && new Date(at).getTime() !== Date.parse(r.scheduledAt));
  });
  if (stale.length) await LocalNotifications.cancel({ notifications: stale.map((p) => ({ id: p.id })) });
  const keep = new Set(pending.filter((p) => !stale.includes(p)).map((p) => p.id));
  const fresh = wanted.filter((r) => !keep.has(notificationId(r.id)));
  if (!fresh.length) return;
  // Exact timing only when Android's "Alarms & reminders" access is already granted; otherwise inexact
  // (never bounce the person into system settings mid-flow). iOS always delivers on time.
  const exact = await preciseTimingEnabled();
  await LocalNotifications.schedule({
    notifications: fresh.map((r) => ({
      id: notificationId(r.id),
      title: r.label || "Zest Snap reminder",
      body: "Reminder from your Zest Snap Planner",
      schedule: { at: new Date(r.scheduledAt), allowWhileIdle: true },
      isExactNotification: exact,
      channelId: REMINDER_CHANNEL,
      actionTypeId: ACTION_TYPE,
      smallIcon: "ic_stat_zest",
      extra: { reminderId: r.id, url: reminderUrl(r.id) },
    })),
  });
}

/** Android 12+: whether reminders can fire at the exact minute ("Alarms & reminders" special access). */
export async function preciseTimingEnabled() {
  try {
    const { LocalNotifications } = await load();
    if (!LocalNotifications.checkExactNotificationSetting) return true;
    return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === "granted";
  } catch {
    return true; // iOS / older Android: always precise
  }
}

/** Opens Android's "Alarms & reminders" screen; only ever called from an explicit Settings tap. */
export async function requestPreciseTiming() {
  const { LocalNotifications } = await load();
  await LocalNotifications.changeExactNotificationSetting();
  window.dispatchEvent(new Event("zest-reminders-changed"));
  return preciseTimingEnabled();
}

/** Clears every armed reminder (sign-out / account switch). */
export async function clearNativeReminders() {
  if (!nativeNotificationsAvailable()) return;
  try {
    const { LocalNotifications } = await load();
    const { notifications } = await LocalNotifications.getPending();
    if (notifications.length) await LocalNotifications.cancel({ notifications: notifications.map((n) => ({ id: n.id })) });
  } catch {}
}
