import "server-only";
import { serviceClient } from "../supabase/admin";
import { entitlementFromSubscriber, storePlanChange, type RcSubscriber, type StoreEntitlement } from "./entitlements";

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
  const { data: rule } = entitlement.active
    ? await db.from("plan_rules").select("active").eq("id", entitlement.plan).maybeSingle()
    : { data: null };
  const change = storePlanChange(profile.plan, existing, entitlement, !!rule?.active);
  const now = new Date().toISOString();

  if (change.kind === "activate") {
    const row = { user_id: userId, provider_customer_id: userId, ...change.subscription, updated_at: now };
    const { error } = await db.from("subscriptions").upsert(row as never, { onConflict: "user_id" });
    if (error) throw new Error("subscription_write_failed");
    if (change.updateProfile) await db.from("profiles").update({ plan: change.plan, updated_at: now }).eq("id", userId);
  } else if (change.kind === "expire") {
    await db.from("subscriptions").update({ status: "expired", canceled_at: now, updated_at: now } as never).eq("user_id", userId);
    if (change.downgradeProfile) await db.from("profiles").update({ plan: "free", updated_at: now }).eq("id", userId);
  } else if (change.reason === "plan_inactive") {
    console.error(JSON.stringify({ event: "billing_plan_inactive", plan: entitlement.active ? entitlement.plan : null }));
  }
  return { plan: change.plan, entitlement };
}
