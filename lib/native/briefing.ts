import { BRIEFING_NOTIFICATION_IDS, briefingFor, nextBriefingTimes, readBriefingSettings } from "../briefing";
import type { PlannerItem } from "../planner";
import { REMINDER_CHANNEL, nativeNotificationsAvailable } from "./notifications";

/**
 * Daily Briefing on the iPhone/Android app: the next three days' briefings as local notifications, built from the
 * Planner on this device (web push, which the server uses, doesn't reach the native apps). Re-run whenever the
 * Planner or the briefing settings change. Shared plans aren't on the device, so app briefings cover the Planner.
 */
export async function syncNativeBriefing(items: PlannerItem[], locale = "en") {
  if (!nativeNotificationsAvailable()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: BRIEFING_NOTIFICATION_IDS.map((id) => ({ id })) });
    const settings = readBriefingSettings();
    if (!settings?.enabled) return;
    if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
    const notifications = nextBriefingTimes(settings)
      .map(({ day, at }, k) => {
        const b = briefingFor(items, day, { includeTodos: settings.includeTodos, locale });
        return b
          ? {
              id: BRIEFING_NOTIFICATION_IDS[k],
              title: b.title,
              body: b.body,
              schedule: { at, allowWhileIdle: true },
              channelId: REMINDER_CHANNEL,
              smallIcon: "ic_stat_zest",
              extra: { kind: "briefing", url: "/app?view=calendar&tab=today" },
            }
          : null;
      })
      .filter((n): n is NonNullable<typeof n> => !!n);
    if (notifications.length) await LocalNotifications.schedule({ notifications });
  } catch {
    // Never block the app on a notification problem; the next Planner change retries.
  }
}
