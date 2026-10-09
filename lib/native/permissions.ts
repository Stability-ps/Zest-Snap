import { registerPlugin } from "@capacitor/core";
import { isNative, runtime } from "./runtime";

/** Small first-party native plugin (ios/App/App/ZestNativePlugin.swift, android/.../ZestNativePlugin.kt). */
interface ZestNativePlugin {
  openAppSettings(): Promise<void>;
  getSystemInsets(): Promise<{ top: number; right: number; bottom: number; left: number }>;
  /** Android only. */
  getPushConfiguration(): Promise<{ firebase: boolean }>;
}
const ZestNative = registerPlugin<ZestNativePlugin>("ZestNative");

export type PermissionName = "camera" | "photos" | "notifications" | "calendar" | "microphone";
export type PermissionStatus = "granted" | "denied" | "prompt" | "unsupported";

/** Opens this app's page in the system Settings so a blocked permission can be re-enabled. */
export async function openAppSettings() {
  if (!isNative()) return false;
  try {
    await ZestNative.openAppSettings();
    return true;
  } catch {
    return false;
  }
}

/** Human, platform-specific recovery copy for a blocked permission. */
export function blockedPermissionHelp(name: PermissionName) {
  const what = { camera: "Camera", photos: "Photos", notifications: "Notifications", calendar: "Calendars", microphone: "Microphone" }[name];
  return runtime() === "ios"
    ? `${what} access is off for Zest Snap. Open Settings › Zest Snap and turn on ${name === "microphone" ? "Microphone and Speech Recognition" : what}.`
    : runtime() === "android"
      ? `${what} permission is blocked for Zest Snap. Open Settings › Apps › Zest Snap › Permissions to allow it.`
      : `${what} is blocked in your browser settings for this site.`;
}

export async function permissionStatus(name: PermissionName): Promise<PermissionStatus> {
  if (!isNative()) return "unsupported";
  try {
    if (name === "camera" || name === "photos") {
      const { Camera } = await import("@capacitor/camera");
      const p = await Camera.checkPermissions();
      const v = name === "camera" ? p.camera : p.photos;
      return v === "granted" || v === "limited" ? "granted" : v === "denied" ? "denied" : "prompt";
    }
    if (name === "notifications") {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const p = await LocalNotifications.checkPermissions();
      return p.display === "granted" ? "granted" : p.display === "denied" ? "denied" : "prompt";
    }
    // Calendar uses the system event editor, which needs no calendar permission.
    return "granted";
  } catch {
    return "unsupported";
  }
}


/** Real native system-bar insets. Used on Android when WebView safe-area env vars report zero. */
export async function nativeSystemInsets() {
  if (!isNative() || runtime() !== "android") return null;
  try {
    return await ZestNative.getSystemInsets();
  } catch {
    return null;
  }
}

/**
 * Android builds without google-services.json crash in PushNotifications.register(), so push is only registered
 * when Firebase was configured at build time. iOS needs no check: missing APNs setup reports a registration error.
 */
export async function nativePushConfigured() {
  if (!isNative()) return false;
  if (runtime() !== "android") return true;
  try {
    return (await ZestNative.getPushConfiguration()).firebase === true;
  } catch {
    return false;
  }
}
