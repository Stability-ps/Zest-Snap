"use client";
import { createClient, isSupabaseConfigured } from "./supabase/client";
import type { PlannerItem, ReminderDraft } from "./planner";
import { calculateReminderAt, reminderMinutes } from "./planner";
import { enableNativeNotifications, nativeNotificationsAvailable, nativeNotificationState } from "./native/notifications";

// Web Push delivery is handled by the Supabase deliver-reminders Edge Function (pg_cron, every minute).
export type ReminderRecord = {
  id: string;
  plannerItemId: string;
  scheduledAt: string;
  status: "pending" | "processing" | "sent" | "cancelled" | "failed" | "handled";
  offsetMinutes?: number;
  label?: string;
  deliveredAt?: string;
  snoozedUntil?: string;
  handledAt?: string;
};
const KEY = "zest-reminders-v1";
function read(s: Storage): ReminderRecord[] {
  try {
    const v = JSON.parse(s.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function write(s: Storage, r: ReminderRecord[]) {
  s.setItem(KEY, JSON.stringify(r));
  window.dispatchEvent(new Event("zest-reminders-changed"));
}
async function signedIn() {
  if (!isSupabaseConfigured()) return null;
  const db = createClient(),
    a = await db.auth.getSession();
  return a.data.session?.user ? db : null;
}
// Per-account offline copy; the zest-cloud- prefix is wiped on sign-out and account switches.
const cloudCacheKey = async () => {
  const s = await createClient().auth.getSession();
  return s.data.session?.user ? `zest-cloud-reminders-${s.data.session.user.id}` : null;
};

export async function listReminders(storage = localStorage) {
  const db = await signedIn();
  if (!db) return read(storage);
  const cacheKey = await cloudCacheKey();
  if (!navigator.onLine) {
    try {
      return JSON.parse((cacheKey && storage.getItem(cacheKey)) || "[]") as ReminderRecord[];
    } catch {
      return [];
    }
  }
  const { data, error } = await db
    .from("reminders")
    .select("id,planner_item_id,scheduled_at,status,offset_minutes,label,delivered_at,snoozed_until,handled_at")
    .not("planner_item_id", "is", null)
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error("Reminders could not be loaded.");
  const records = (data || []).map(
    (r) =>
      ({
        id: r.id,
        plannerItemId: r.planner_item_id,
        scheduledAt: r.scheduled_at,
        status: r.status,
        offsetMinutes: r.offset_minutes ?? undefined,
        label: r.label || undefined,
        deliveredAt: r.delivered_at ?? undefined,
        snoozedUntil: r.snoozed_until ?? undefined,
        handledAt: r.handled_at ?? undefined,
      }) as ReminderRecord,
  );
  if (cacheKey) storage.setItem(cacheKey, JSON.stringify(records));
  return records;
}

function friendly(message: string, fallback: string) {
  if (message.includes("planner_item_not_found")) return "Save the Planner item first, then add a reminder.";
  if (message.includes("reminder_limit_reached")) return "This item already has the maximum number of reminders.";
  if (message.includes("duplicate key")) return "That reminder is already scheduled.";
  return fallback;
}

export async function createReminder(item: PlannerItem, draft: ReminderDraft, label?: string, storage = localStorage) {
  const scheduledAt = calculateReminderAt(item, draft),
    offset = reminderMinutes(draft);
  const db = await signedIn();
  if (!db) {
    const r: ReminderRecord = { id: crypto.randomUUID(), plannerItemId: item.id, scheduledAt, status: "pending", offsetMinutes: offset, label };
    write(storage, [...read(storage), r]);
    return { reminder: r, backgroundDelivery: false };
  }
  if (!navigator.onLine) throw new Error("Connect to the internet to schedule a reminder notification.");
  const { data, error } = await db.rpc("create_planner_reminder", {
    p_item: item.id,
    p_scheduled_at: scheduledAt,
    p_offset_minutes: offset,
    p_label: label || null,
  });
  if (error) throw new Error(friendly(error.message, "Reminder could not be scheduled. Try again."));
  // Mirror Zest reminder timing into the linked Google event. Zest push remains authoritative.
  try {
    const response = await fetch("/api/calendar/google/events", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plannerItemId: item.id, event: { ...item, startDate: item.startDate || item.dueDate, startTime: item.startTime || item.dueTime, endDate: item.endDate || item.dueDate || item.startDate, allDay: item.allDay || !(item.startTime || item.dueTime), sourceText: "" }, timezone: item.timezone, reminders: offset == null ? [] : [offset] }),
    });
    if (!response.ok && response.status !== 409) throw new Error("google_sync_failed");
  } catch {
    // The Zest reminder is already safely scheduled; Google sync can retry on the next item edit.
  }
  window.dispatchEvent(new Event("zest-reminders-changed"));
  return {
    reminder: { id: String(data), plannerItemId: item.id, scheduledAt, status: "pending" as const, offsetMinutes: offset, label },
    backgroundDelivery: true,
  };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const db = await signedIn();
  if (!db) throw new Error("Sign in to manage this reminder.");
  const { error } = await db.rpc(name, args);
  if (error) throw new Error("Reminder could not be updated. Check your connection and try again.");
  window.dispatchEvent(new Event("zest-reminders-changed"));
}
export async function cancelReminder(id: string, storage = localStorage) {
  const l = read(storage);
  if (l.some((x) => x.id === id)) return write(storage, l.map((x) => (x.id === id ? { ...x, status: "cancelled" } : x)));
  await rpc("cancel_planner_reminder", { p_id: id });
}
export async function snoozeReminder(id: string, minutes: number, storage = localStorage) {
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) throw new Error("Choose a snooze between 1 minute and 1 week.");
  const l = read(storage);
  if (l.some((x) => x.id === id)) {
    const t = new Date(Date.now() + minutes * 60000).toISOString();
    return write(storage, l.map((x) => (x.id === id ? { ...x, status: "pending", scheduledAt: t, snoozedUntil: t } : x)));
  }
  await rpc("snooze_planner_reminder", { p_id: id, p_minutes: Math.round(minutes) });
}
export async function markReminderHandled(id: string, storage = localStorage) {
  const l = read(storage);
  if (l.some((x) => x.id === id))
    return write(storage, l.map((x) => (x.id === id ? { ...x, status: "handled", handledAt: new Date().toISOString() } : x)));
  await rpc("mark_planner_reminder_handled", { p_id: id });
}

/** After sign-in: schedules this device's future guest reminders on the account, then clears them. */
export async function migrateGuestReminders(itemIds: Map<string, string>, storage = localStorage) {
  const guest = read(storage);
  if (!guest.length) return 0;
  const db = await signedIn();
  if (!db) return 0;
  let moved = 0;
  for (const r of guest) {
    const target = itemIds.get(r.plannerItemId);
    if (!target || r.status !== "pending" || Date.parse(r.scheduledAt) <= Date.now()) continue;
    const { error } = await db.rpc("create_planner_reminder", {
      p_item: target,
      p_scheduled_at: r.scheduledAt,
      p_offset_minutes: r.offsetMinutes ?? null,
      p_label: r.label || null,
    });
    if (!error) moved++;
  }
  storage.removeItem(KEY);
  return moved;
}

export type NotificationState = "unsupported" | "blocked" | "available" | "enabled";
export function notificationSupport() {
  // In the iOS/Android apps reminders are delivered as OS-scheduled local notifications (lib/native/notifications).
  if (nativeNotificationsAvailable()) return true;
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}
async function registration() {
  // navigator.serviceWorker.ready never settles when no worker is registered, so bound the wait.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000)),
  ]);
}
/** Reflects both the browser permission and whether this device actually holds a push subscription. */
export async function getNotificationState(): Promise<NotificationState> {
  if (nativeNotificationsAvailable()) return nativeNotificationState();
  if (!notificationSupport()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "available";
  try {
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    return sub ? "enabled" : "available";
  } catch {
    return "available";
  }
}
function key(v: string) {
  const p = "=".repeat((4 - (v.length % 4)) % 4),
    b = (v + p).replace(/-/g, "+").replace(/_/g, "/"),
    raw = atob(b);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BLfn6Z34FtBgi3t9IqHP9gtUjk9RXxoh7Msm7r8YDdj-_8v8V8Tv1KZJyqVAPrhRygU3MRWaKE-Zvv84JFI-Ekw";

/** True when a subscription was made with a different VAPID public key (the key was rotated). */
export function boundToOtherKey(sub: Pick<PushSubscription, "options">, publicKey = VAPID_PUBLIC_KEY) {
  const bound = sub.options?.applicationServerKey;
  if (!bound) return false;
  const a = new Uint8Array(bound), b = key(publicKey);
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}

/**
 * The device's subscription for the current VAPID key. A subscription bound to a rotated key can never receive
 * pushes again, so it is replaced; permission is already granted, so this doesn't prompt.
 */
async function currentSubscription(reg: ServiceWorkerRegistration) {
  const sub = await reg.pushManager.getSubscription();
  if (!sub || !boundToOtherKey(sub)) return sub;
  await sub.unsubscribe().catch(() => false);
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID_PUBLIC_KEY) });
}

export async function enablePushNotifications() {
  if (nativeNotificationsAvailable()) {
    await enableNativeNotifications();
    window.dispatchEvent(new Event("zest-reminders-changed"));
    return true;
  }
  if (!notificationSupport()) throw new Error("This browser can’t show background notifications. Try Chrome on Android or install Zest Snap.");
  const db = await signedIn();
  if (!db) throw new Error("Sign in to get reminder notifications on this device.");
  const permission = await Notification.requestPermission();
  if (permission === "denied") throw new Error("Notifications are blocked. Allow them for Zest Snap in your phone or browser settings.");
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const reg = await registration();
  if (!reg) throw new Error("Zest Snap is still installing. Reload and try again.");
  const sub = (await currentSubscription(reg)) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID_PUBLIC_KEY) }));
  const { error } = await db.rpc("register_push_subscription", { p_endpoint: sub.endpoint, p_keys: sub.toJSON().keys || {} });
  if (error) throw new Error("Notifications couldn’t be connected to your account. Try again.");
  return true;
}

/**
 * Keeps the server mapping current: if this device already has permission and a subscription,
 * (re)attach it to whoever is signed in now. Fixes devices shared between accounts and rotated endpoints.
 */
export async function syncPushSubscription() {
  if (nativeNotificationsAvailable()) return; // native reminders are re-armed by lib/native/bridge on every change
  if (!notificationSupport() || Notification.permission !== "granted") return;
  const db = await signedIn();
  if (!db) return;
  const reg = await registration();
  const sub = reg && (await currentSubscription(reg).catch(() => null));
  if (sub) await db.rpc("register_push_subscription", { p_endpoint: sub.endpoint, p_keys: sub.toJSON().keys || {} });
}
