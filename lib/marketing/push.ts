"use client";
import { ONESIGNAL_APP_ID } from "./onesignal";
import { isNative, runtime } from "../native/runtime";

/**
 * Marketing push ("Tips and offers") on the device. Nothing from OneSignal loads, and nothing is sent to it,
 * until the person turns the setting on. Reminders are separate and unaffected (lib/reminders.ts and native
 * local notifications).
 *
 * Web/PWA: OneSignal Web SDK v16 with its own service worker at /push/onesignal/ (the app's /sw.js keeps /app).
 * iOS/Android: the onesignal-cordova-plugin, available in app builds that include it.
 */
type OneSignalNative = {
  initialize(appId: string): void;
  login(externalId: string): void;
  logout(): void;
  Notifications: { requestPermission(fallbackToSettings?: boolean): Promise<boolean>; addEventListener(e: "click", l: (ev: { notification: { additionalData?: Record<string, unknown> } }) => void): void };
  User: { pushSubscription: { optIn(): void; optOut(): void } };
};
type OneSignalWeb = {
  init(o: Record<string, unknown>): Promise<void>;
  login(id: string): Promise<void>;
  logout(): Promise<void>;
  Notifications: { permission: boolean; requestPermission(): Promise<void> };
  User: { PushSubscription: { optIn(): Promise<void>; optOut(): Promise<void>; optedIn?: boolean } };
};
type W = Window & { plugins?: { OneSignal?: OneSignalNative }; OneSignalDeferred?: ((os: OneSignalWeb) => void)[] };

export type PushSupport = "supported" | "unsupported" | "needs_home_screen" | "needs_app_update";

export function marketingPushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (isNative()) return (window as W).plugins?.OneSignal ? "supported" : "needs_app_update";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    // iPhone/iPad Safari supports web push only for apps added to the Home Screen (iOS 16.4+).
    return /iPhone|iPad|iPod/.test(navigator.userAgent) && runtime() !== "pwa" ? "needs_home_screen" : "unsupported";
  }
  return "supported";
}

let webReady: Promise<OneSignalWeb> | null = null;
function oneSignalWeb(): Promise<OneSignalWeb> {
  if (webReady) return webReady;
  webReady = new Promise<OneSignalWeb>((resolve, reject) => {
    const w = window as W;
    w.OneSignalDeferred = w.OneSignalDeferred || [];
    w.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId: ONESIGNAL_APP_ID,
          serviceWorkerPath: "push/onesignal/OneSignalSDKWorker.js",
          serviceWorkerParam: { scope: "/push/onesignal/" },
          notifyButton: { enable: false },
          promptOptions: { slidedown: { prompts: [] } },
          autoResubscribe: false,
        });
        resolve(OneSignal);
      } catch (e) {
        reject(e);
      }
    });
    const s = document.createElement("script");
    s.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    s.defer = true;
    s.onerror = () => reject(new Error("onesignal_unavailable"));
    document.head.appendChild(s);
  });
  webReady.catch(() => (webReady = null));
  return webReady;
}

let clickHandler = false;
let nativeInitialized = false;
function nativeOneSignal(onOpen?: (path: string) => void) {
  const os = (window as W).plugins?.OneSignal;
  if (!os) return null;
  if (!nativeInitialized) {
    os.initialize(ONESIGNAL_APP_ID);
    nativeInitialized = true;
  }
  if (onOpen && !clickHandler) {
    clickHandler = true;
    os.Notifications.addEventListener("click", (ev) => {
      const path = ev?.notification?.additionalData?.path;
      if (typeof path === "string" && /^\/app(\?[A-Za-z0-9=&_%-]*)?$/.test(path)) onOpen(path);
    });
  }
  return os;
}

/** Turns marketing push on for this account on this device. Resolves false when permission was not granted. */
export async function enableMarketingPush(userId: string): Promise<boolean> {
  if (isNative()) {
    const os = nativeOneSignal();
    if (!os) return false;
    os.login(userId);
    const granted = await os.Notifications.requestPermission(true);
    if (granted) os.User.pushSubscription.optIn();
    return granted;
  }
  const os = await oneSignalWeb();
  await os.login(userId);
  await os.Notifications.requestPermission();
  if (!os.Notifications.permission) return false;
  await os.User.PushSubscription.optIn();
  return true;
}

/** Turns marketing push off on this device (consent is withdrawn on the server separately). */
export async function disableMarketingPush() {
  try {
    if (isNative()) {
      const os = nativeOneSignal();
      os?.User.pushSubscription.optOut();
      os?.logout();
      return;
    }
    if (!webReady) return;
    const os = await webReady;
    await os.User.PushSubscription.optOut();
    await os.logout();
  } catch {
    // Consent is already withdrawn server-side; campaigns check it before every send.
  }
}

/**
 * On app start for someone who opted in: keep this device linked to the signed-in account (another person may
 * have signed in on it) and route taps on notifications inside the app. Never prompts.
 */
export async function resumeMarketingPush(userId: string, onOpen: (path: string) => void) {
  try {
    if (isNative()) {
      nativeOneSignal(onOpen)?.login(userId);
      return;
    }
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const os = await oneSignalWeb();
    await os.login(userId);
  } catch {}
}

/** Signing out: this device must not keep receiving the previous account's marketing notifications. */
export async function signOutMarketingPush() {
  try {
    if (isNative()) return (window as W).plugins?.OneSignal?.logout();
    if (webReady) await (await webReady).logout();
  } catch {}
}

/** This device opted in for this account (local hint only; the server's consent is authoritative for sending). */
const LOCAL_KEY = "zest-marketing-push-v1";
export function rememberMarketingPush(userId: string, on: boolean) {
  try {
    if (on) localStorage.setItem(LOCAL_KEY, userId);
    else localStorage.removeItem(LOCAL_KEY);
  } catch {}
}
export function marketingPushOnThisDevice(userId: string) {
  try {
    return localStorage.getItem(LOCAL_KEY) === userId;
  } catch {
    return false;
  }
}
