"use client";
import { createClient, isSupabaseConfigured } from "./supabase/client";
import { getSupabasePublicConfig } from "./supabase/config";

// Device identity: a random id created on first use. It is not a hardware fingerprint, can be reset
// by clearing site data, and the server only stores its SHA-256 hash. It is one anti-abuse signal.
const DEVICE_KEY = "zest-device-id-v1";
const LEGACY_DEVICE_KEY = "zest-device-id";
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY) || localStorage.getItem(LEGACY_DEVICE_KEY);
    if (!id || id.length < 16 || id.length > 128) id = crypto.randomUUID() + "-" + crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID() + "-" + crypto.randomUUID();
  }
}

// Which account the fast-startup snapshot belongs to. A mismatch means another person signed in.
const ACTIVE_USER_KEY = "zest-active-user-v1";
export const STARTUP_STATE_KEY = "zest-last-app-state-v1";
const STARTUP_KEYS = [STARTUP_STATE_KEY, "zest-planner-last-used-v1", "zest-last-display-name"];
const PER_USER_PREFIXES = ["zest-cloud-", "zest-planner-cloud-", "zest-legacy-agenda-imported-"];

function removeWhere(test: (key: string) => boolean) {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && test(key)) localStorage.removeItem(key);
  }
}

/** Clears every account-specific cache on this device. Guest data and the device id are kept. */
export function clearAccountCaches() {
  try {
    STARTUP_KEYS.forEach((k) => localStorage.removeItem(k));
    removeWhere((k) => PER_USER_PREFIXES.some((p) => k.startsWith(p)));
    localStorage.removeItem(ACTIVE_USER_KEY);
  } catch {}
}

/** Call whenever the authenticated identity is known. Wipes another account's cached state. */
export function setActiveUser(userId: string | null) {
  try {
    const next = userId || "guest";
    const previous = localStorage.getItem(ACTIVE_USER_KEY);
    if (previous && previous !== next) {
      STARTUP_KEYS.forEach((k) => localStorage.removeItem(k));
      removeWhere((k) => PER_USER_PREFIXES.some((p) => k.startsWith(p) && !(userId && k.endsWith(userId))));
    }
    localStorage.setItem(ACTIVE_USER_KEY, next);
  } catch {}
}
export function activeUser() {
  try {
    return localStorage.getItem(ACTIVE_USER_KEY);
  } catch {
    return null;
  }
}

/** Signs out, stops this device receiving the account's notifications and removes its cached data. */
export async function signOut() {
  if (isSupabaseConfigured()) {
    const db = createClient();
    try {
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
    } catch {}
    await db.auth.signOut().catch(() => undefined);
  }
  // Native apps: disarm this account's reminder notifications so the next person on the device never sees them.
  await import("./native/notifications").then((m) => m.clearNativeReminders()).catch(() => undefined);
  clearAccountCaches();
}

// Referral invites: captured from any landing URL and kept until an account claims them, so the
// code survives email verification opening in a new tab.
const REFERRAL_KEY = "zest-referral-v1";
export function captureReferral(search = window.location.search) {
  try {
    const code = new URLSearchParams(search).get("ref");
    if (code && /^[A-Za-z0-9_-]{6,64}$/.test(code))
      localStorage.setItem(REFERRAL_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {}
}
export async function claimPendingReferral() {
  if (!isSupabaseConfigured()) return;
  let pending: { code?: string; at?: number } | null = null;
  try {
    pending = JSON.parse(localStorage.getItem(REFERRAL_KEY) || "null");
    const legacy = sessionStorage.getItem("zest-referral");
    if (!pending && legacy) pending = { code: legacy, at: Date.now() };
    sessionStorage.removeItem("zest-referral");
  } catch {}
  if (!pending?.code) return;
  if (!pending.at || Date.now() - pending.at > 30 * 86400000) {
    localStorage.removeItem(REFERRAL_KEY);
    return;
  }
  const { error } = await createClient().rpc("claim_referral_device", { p_code: pending.code, p_device_id: deviceId() });
  // Retry later only for transient failures; ineligible or invalid codes are dropped.
  if (!error || !/fetch|network|timeout/i.test(error.message)) localStorage.removeItem(REFERRAL_KEY);
}

export async function registerDevice() {
  if (!isSupabaseConfigured()) return;
  await createClient().rpc("register_device", { p_device_id: deviceId() });
}

/**
 * Signed-in user id read synchronously from the Supabase auth cookie (no network), so the very first
 * render can decide whether a cached snapshot belongs to this person. Returns null when unknown.
 */
export function sessionUserIdSync(): string | null {
  try {
    const ref = new URL(getSupabasePublicConfig().url).hostname.split(".")[0];
    const name = `sb-${ref}-auth-token`;
    const jar = Object.fromEntries(
      document.cookie.split("; ").filter(Boolean).map((c) => {
        const i = c.indexOf("=");
        return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
      }),
    );
    let raw = jar[name] || "";
    if (!raw) {
      const chunks: string[] = [];
      for (let i = 0; jar[`${name}.${i}`] !== undefined; i++) chunks.push(jar[`${name}.${i}`]);
      raw = chunks.join("");
    }
    if (!raw) return null;
    if (raw.startsWith("base64-")) {
      const b64 = raw.slice(7).replace(/-/g, "+").replace(/_/g, "/");
      raw = new TextDecoder().decode(Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)));
    }
    const parsed = JSON.parse(raw);
    const id = parsed?.user?.id;
    return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}
