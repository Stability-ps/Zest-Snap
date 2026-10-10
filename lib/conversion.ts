"use client";
import { createClient, isSupabaseConfigured } from "./supabase/client";
import { deviceId } from "./session";
import { runtime } from "./native/runtime";

/**
 * Conversion-funnel interactions (see supabase/migrations/20261017100000_premium_onboarding_and_funnel.sql).
 * Only the event name, a short context and the platform are sent; the server stores a pseudonymous subject
 * and de-duplicates. Facts the database already knows (scans, sign-ups, verification, subscriptions) are not
 * reported from here. Best effort: never throws and never delays the UI.
 */
export type ConversionEvent =
  | "guest_limit_reached"
  | "guest_paywall_viewed"
  | "premium_plan_viewed"
  | "monthly_plan_selected"
  | "annual_plan_selected"
  | "free_registration_started"
  | "verified_paywall_viewed"
  | "free_plan_selected"
  | "checkout_started"
  | "checkout_completed"
  | "checkout_failed"
  | "checkout_cancelled"
  | "subscription_restored"
  | "free_limit_reached";

export type PaywallContext = "guest_limit" | "post_verification" | "free_limit" | "settings";

export function trackConversion(event: ConversionEvent, context: PaywallContext | null = null) {
  try {
    if (!isSupabaseConfigured()) return;
    void createClient()
      .rpc("track_conversion" as never, { p_event: event, p_platform: runtime(), p_context: context, p_device_id: deviceId() } as never)
      .then(() => undefined, () => undefined);
  } catch {
    // Analytics must never affect the product.
  }
}

/** Last guest-trial balance the server reported for this device. The server still enforces the limit. */
const GUEST_TRIAL_KEY = "zest-guest-trial-v1";
export function rememberGuestTrial(remaining: number) {
  try {
    localStorage.setItem(GUEST_TRIAL_KEY, JSON.stringify({ remaining: Math.max(0, Math.floor(remaining)), at: Date.now() }));
  } catch {}
}
export function knownGuestTrialRemaining(): number | null {
  try {
    const v = JSON.parse(localStorage.getItem(GUEST_TRIAL_KEY) || "null");
    return typeof v?.remaining === "number" ? v.remaining : null;
  } catch {
    return null;
  }
}
