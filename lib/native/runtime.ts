import { Capacitor } from "@capacitor/core";

/** The one place that decides which runtime Zest Snap is in. Never sniff user agents elsewhere. */
export type Runtime = "web" | "pwa" | "ios" | "android";

export function isNative() {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

export function runtime(): Runtime {
  if (typeof window === "undefined") return "web";
  const platform = Capacitor.getPlatform();
  if (platform === "ios" || platform === "android") return platform;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? "pwa" : "web";
}

/** Plugins are only reachable inside the native shell; on the web every caller falls back to browser behaviour. */
export function hasPlugin(name: string) {
  return isNative() && Capacitor.isPluginAvailable(name);
}

/** Web build identifier, reported with support tickets and analytics. */
export function webVersion() {
  return process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev";
}

/** "ios 1.0.0 (3)" style string for support context; native version comes from the store build. */
export async function appVersionLabel() {
  if (!isNative()) return `${runtime()} ${webVersion()}`;
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    return `${runtime()} ${info.version} (${info.build}) · web ${webVersion()}`;
  } catch {
    return `${runtime()} · web ${webVersion()}`;
  }
}

/**
 * Whether saving a generated file should go through the system share sheet: the native apps, the installed
 * PWA and touch-first devices. Desktop browsers get a normal download.
 */
export function prefersShareSheet() {
  if (typeof window === "undefined") return false;
  const r = runtime();
  return r === "ios" || r === "android" || r === "pwa" || !!window.matchMedia?.("(pointer: coarse)").matches;
}
