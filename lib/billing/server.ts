import "server-only";
import { serviceClient } from "../supabase/admin";
import { entitlementFromSubscriber, type RcSubscriber, type StoreEntitlement } from "./entitlements";

const STORE_PROVIDERS = ["app_store", "play_store"];

export class BillingNotConfigured extends Error {}

/** Server-to-server read of RevenueCat's verified subscriber record. Uses a secret key that never leaves the server. */
async function fetchSubscriber(appUserId: string): Promise<RcSubscriber> {
  const key = process.env.REVENUECAT_SECRET_API_KEY;
  if (!key) throw new BillingNotConfigured("billing_not_configured");
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`revenuecat_${res.status}`);
  const body = (await res.json()) as { subscriber?: RcSubscriber };
  return body.subscriber || {};
}

/**
 * Re-derives a user's store entitlement from the verified source and writes it to the same
 * subscriptions/profiles model the web uses. Idempotent: safe for webhooks, purchases and restores.
 * A store purchase never overrides a plan that is not active in plan_rules (scanning requires an active plan).
 */
export async function syncStoreEntitlement(userId: string): Promise<{ plan: string; entitlement: StoreEntitlement }> {
  const entitlement = entitlementFromSubscriber(await fetchSubscriber(userId));
  const db = serviceClient();
  const { data: profile } = await db.from("profiles").select("plan").eq("id", userId).maybeSingle();
  if (!profile) throw new Error("account_not_found");
  const { data: existing } = await db.from("subscriptions").select("provider,plan,status").eq("user_id", userId).maybeSingle();
  const now = new Date().toISOString();

  if (entitlement.active) {
    const { data: rule } = await db.from("plan_rules").select("active").eq("id", entitlement.plan).maybeSingle();
    if (!rule?.active) {
      console.error(JSON.stringify({ event: "billing_plan_inactive", plan: entitlement.plan }));
      return { plan: profile.plan, entitlement };
    }
    const row = {
      user_id: userId,
      provider: entitlement.source,
      provider_customer_id: userId,
      provider_subscription_id: entitlement.productId,
      plan: entitlement.plan,
      status: entitlement.billingIssue ? "past_due" : entitlement.trial ? "trialing" : "active",
      current_period_end: entitlement.expiresAt,
      cancel_at_period_end: !entitlement.willRenew,
      updated_at: now,
    };
    const { error } = await db.from("subscriptions").upsert(row as never, { onConflict: "user_id" });
    if (error) throw new Error("subscription_write_failed");
    if (profile.plan !== entitlement.plan) await db.from("profiles").update({ plan: entitlement.plan, updated_at: now }).eq("id", userId);
    return { plan: entitlement.plan, entitlement };
  }

  // Lapsed store subscription: only downgrade plans that a store subscription granted (never admin or web plans).
  if (existing && STORE_PROVIDERS.includes(existing.provider || "") && existing.status !== "expired") {
    await db.from("subscriptions").update({ status: "expired", canceled_at: now, updated_at: now } as never).eq("user_id", userId);
    if (profile.plan === existing.plan) await db.from("profiles").update({ plan: "free", updated_at: now }).eq("id", userId);
    return { plan: "free", entitlement };
  }
  return { plan: profile.plan, entitlement };
}
