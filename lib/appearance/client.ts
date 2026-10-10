"use client";
import type { AccentId, Scheme } from "./palette";
import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  followsAppearance,
  readStoredAppearance,
  resolveScheme,
  themeColorFor,
  writeStoredAppearance,
  type StoredAppearance,
  type ThemeMode,
} from "./preferences";

/**
 * The device's live appearance. One instance per page: React reads it through useAppearance(), the
 * boot script has already applied it before first paint, and every change is applied synchronously
 * (no reload, no network) and then handed to the cloud sync.
 */
export type AppearanceState = StoredAppearance & { scheme: Scheme };

const listeners = new Set<() => void>();
let state: AppearanceState | null = null;
let media: MediaQueryList | null = null;

const systemDark = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;

function compute(stored: StoredAppearance): AppearanceState {
  return { ...stored, scheme: resolveScheme(stored.mode, systemDark()) };
}

export function getAppearance(): AppearanceState {
  if (!state) state = typeof window === "undefined" ? { ...DEFAULT_APPEARANCE, owner: null, dirty: false, scheme: "light" } : compute(readStoredAppearance(localStorage));
  return state;
}
const SERVER_STATE: AppearanceState = { ...DEFAULT_APPEARANCE, owner: null, dirty: false, scheme: "light" };
export const getServerAppearance = () => SERVER_STATE;

export function subscribeAppearance(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Writes the resolved theme onto <html>. Mirrors APPEARANCE_BOOT_SCRIPT. */
export function applyToDocument(doc: Document, value: { scheme: Scheme; mode: ThemeMode; accent: AccentId }, pathname = doc.location?.pathname || "/") {
  const root = doc.documentElement;
  if (!followsAppearance(pathname)) {
    root.dataset.theme = "light";
    root.style.colorScheme = "light";
    delete root.dataset.accent;
    return;
  }
  const changed = root.dataset.theme !== value.scheme || (root.dataset.accent || "ocean") !== value.accent;
  if (changed) {
    // Switch in one frame: without this, every element with a colour transition animates separately.
    root.classList.add("themeSwitching");
    doc.defaultView?.requestAnimationFrame?.(() => doc.defaultView?.requestAnimationFrame?.(() => root.classList.remove("themeSwitching")));
  }
  root.dataset.theme = value.scheme;
  root.dataset.themeMode = value.mode;
  // Form controls, scrollbars and the pre-CSS canvas follow the chosen scheme, not the OS one.
  root.style.colorScheme = value.scheme;
  if (value.accent === "ocean") delete root.dataset.accent;
  else root.dataset.accent = value.accent;
  doc.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", themeColorFor(value.scheme));
    m.removeAttribute("media");
  });
}

function commit(next: StoredAppearance, persist: boolean) {
  if (persist) writeStoredAppearance(localStorage, next);
  state = compute(next);
  applyToDocument(document, state);
  void applyNativeAppearance(state.scheme);
  listeners.forEach((l) => l());
}

/** A choice made on this device: applied now, uploaded later by the sync (marked dirty). */
export function setAppearance(update: Partial<Pick<StoredAppearance, "mode" | "accent">>, owner: string | null) {
  const current = getAppearance();
  commit({ mode: update.mode ?? current.mode, accent: update.accent ?? current.accent, updatedAt: Date.now(), owner, dirty: true }, true);
  window.dispatchEvent(new Event("zest-appearance-changed"));
}

export function resetAppearance(owner: string | null) {
  setAppearance({ mode: DEFAULT_APPEARANCE.mode, accent: DEFAULT_APPEARANCE.accent }, owner);
}

/** Replaces the device copy without marking it for upload (used for values that came from the account). */
export function replaceAppearance(next: StoredAppearance) {
  commit(next, true);
}

/** Starts following the OS appearance and other tabs. Returns a cleanup function. */
export function startAppearance() {
  state = compute(readStoredAppearance(localStorage));
  applyToDocument(document, state);
  void applyNativeAppearance(state.scheme);
  listeners.forEach((l) => l());
  media = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  const onSystem = () => {
    const current = getAppearance();
    if (current.mode === "system") commit(current, false);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === APPEARANCE_KEY || e.key === null) commit(readStoredAppearance(localStorage), false);
  };
  // iOS/Android can change appearance while the app is in the background without firing the media
  // query listener in a suspended WebView, so re-check on resume and when the page becomes visible.
  const recheck = () => {
    if (document.visibilityState === "visible") onSystem();
  };
  media?.addEventListener?.("change", onSystem);
  window.addEventListener("storage", onStorage);
  window.addEventListener("zest-app-resume", onSystem);
  document.addEventListener("visibilitychange", recheck);
  return () => {
    media?.removeEventListener?.("change", onSystem);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("zest-app-resume", onSystem);
    document.removeEventListener("visibilitychange", recheck);
  };
}

/** Status bar, navigation bar and keyboard follow the theme inside the iOS/Android apps. No-op on the web. */
export async function applyNativeAppearance(scheme: Scheme) {
  try {
    const { isNative, runtime } = await import("@/lib/native/runtime");
    if (!isNative()) return;
    const [{ SystemBars, SystemBarsStyle }, { StatusBar, Style }, { Keyboard, KeyboardStyle }] = await Promise.all([
      import("@capacitor/core"),
      import("@capacitor/status-bar"),
      import("@capacitor/keyboard"),
    ]);
    const dark = scheme === "dark";
    // Style.Dark = light icons for dark content; Style.Light = dark icons for light content.
    await Promise.all([
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined),
      SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined),
      runtime() === "ios" ? Keyboard.setStyle({ style: dark ? KeyboardStyle.Dark : KeyboardStyle.Light }).catch(() => undefined) : undefined,
    ]);
  } catch {
    // Older native shells without these plugins keep their default bars.
  }
}
