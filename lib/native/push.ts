import { hasPlugin, runtime } from "./runtime";
import { inAppPath } from "./deep-links";

/**
 * Native push (APNs on iOS, Firebase Cloud Messaging on Android) for Shared messages, invitations,
 * Planner updates, Daily Briefings and reminders no device has armed locally. Reminders a device arms
 * itself stay local notifications (lib/native/notifications.ts), so they work offline and never double up.
 *
 * The OS permission is the same one local reminders use, so enabling reminders also enables push; this
 * module never prompts on launch.
 */
export const PUSH_CHANNELS = [
  { id: "zest-shared", name: "Shared plans", description: "Messages, invitations and updates in your Shared plans", importance: 4 },
  { id: "zest-briefing", name: "Daily Briefing", description: "Your optional morning summary", importance: 3 },
] as const;

const TOKEN_KEY = "zest-native-push-token";

/** Where a tapped push should open; anything outside the app's own routes falls back to the app home. */
export function pushTarget(data: unknown): string {
  const url = typeof (data as { url?: unknown })?.url === "string" ? (data as { url: string }).url : "";
  if (!url.startsWith("/")) return "/app";
  return inAppPath(new URL(url, "https://app.zestsnap.app").href) || "/app";
}

/** Android does not show FCM notifications while the app is open; repeat them as a local notification
 *  unless the person is already looking at the screen the notification points to. */
export function shouldShowInForeground(target: string, currentPath: string, currentSearch: string) {
  const url = new URL(target, "https://app.zestsnap.app");
  if (url.pathname.startsWith("/shared/") && url.pathname === currentPath) return false;
  return !(url.pathname === currentPath && url.search === currentSearch);
}

export function nativePushAvailable() {
  return hasPlugin("PushNotifications");
}

// Capacitor plugin proxies must never be returned from an async function: awaiting them calls `.then()` on the proxy.
async function load() {
  return { PushNotifications: (await import("@capacitor/push-notifications")).PushNotifications };
}

function storedToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

async function signedInClient() {
  const { createClient, isSupabaseConfigured } = await import("@/lib/supabase/client");
  if (!isSupabaseConfigured()) return null;
  const db = createClient();
  const { data } = await db.auth.getSession();
  return data.session ? db : null;
}

/** Saves this device's token for the signed-in account. Called on every registration, which is also how token refresh arrives. */
export async function saveNativePushToken(token: string) {
  storeToken(token);
  const db = await signedInClient();
  if (!db) return false;
  const platform = runtime();
  if (platform !== "ios" && platform !== "android") return false;
  const { error } = await db.rpc("register_native_push_token" as never, {
    p_token: token,
    p_platform: platform,
    p_app_version: process.env.NEXT_PUBLIC_ZEST_BUILD || null,
  } as never);
  return !error;
}

/**
 * Registers with APNs/FCM when notifications are already allowed (or when `prompt` is true and the person
 * just asked for them). Returns false when push isn't available, e.g. a build without Firebase configured.
 */
export async function registerNativePush({ prompt = false } = {}) {
  if (!nativePushAvailable()) return false;
  try {
    const { PushNotifications } = await load();
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === "prompt" && prompt) permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") return false;
    if (runtime() === "android") {
      for (const channel of PUSH_CHANNELS) await PushNotifications.createChannel({ ...channel, visibility: 1, vibration: true }).catch(() => undefined);
    }
    await PushNotifications.register();
    return true;
  } catch {
    return false;
  }
}

/** Stops this device receiving the signed-in account's pushes. Call before signing out. */
export async function unregisterNativePush() {
  const token = storedToken();
  if (!token) return;
  try {
    const db = await signedInClient();
    if (db) await db.rpc("unregister_native_push_token" as never, { p_token: token } as never);
  } catch {}
  storeToken(null);
  try {
    if (nativePushAvailable()) {
      const { PushNotifications } = await load();
      await PushNotifications.removeAllDeliveredNotifications();
    }
  } catch {}
}

type Remove = Promise<{ remove: () => Promise<void> }>;

/** Wires token registration, foreground display and taps. Returns listener handles for NativeBridge to dispose. */
export async function attachNativePushListeners(open: (path: string) => void): Promise<Remove[]> {
  if (!nativePushAvailable()) return [];
  const { PushNotifications } = await load();
  return [
    PushNotifications.addListener("registration", ({ value }) => void saveNativePushToken(value)),
    PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => open(pushTarget(notification.data))),
    PushNotifications.addListener("pushNotificationReceived", async (notification) => {
      if (runtime() !== "android") return; // iOS presents it itself (presentationOptions in capacitor.config).
      const target = pushTarget(notification.data);
      if (!shouldShowInForeground(target, window.location.pathname, window.location.search)) return;
      try {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        await LocalNotifications.schedule({
          notifications: [{
            id: Math.floor(Math.random() * 2_000_000_000) + 1,
            title: notification.title || "Zest Snap",
            body: notification.body || "",
            channelId: PUSH_CHANNELS[0].id,
            extra: { url: target },
          }],
        });
      } catch {}
    }),
  ];
}
