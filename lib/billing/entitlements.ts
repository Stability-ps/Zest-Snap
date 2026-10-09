import type { PlanId } from "../product-config";
import { entitlementPlans } from "./config";

/** Where a subscription was bought. Web billing isn't connected yet; it maps onto the same model. */
export type BillingSource = "app_store" | "play_store" | "web";

export type StoreEntitlement =
  | { active: true; plan: Exclude<PlanId, "free">; source: BillingSource; productId: string; expiresAt: string | null; willRenew: boolean; billingIssue: boolean; trial: boolean }
  | { active: false; lastSource: BillingSource | null; expiredAt: string | null };

type RcEntitlement = { expires_date: string | null; product_identifier: string; grace_period_expires_date?: string | null };
type RcSubscription = {
  store?: string;
  expires_date: string | null;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  period_type?: string;
  grace_period_expires_date?: string | null;
};
export type RcSubscriber = { entitlements?: Record<string, RcEntitlement>; subscriptions?: Record<string, RcSubscription> };

function source(store?: string): BillingSource | null {
  if (store === "app_store" || store === "mac_app_store") return "app_store";
  if (store === "play_store") return "play_store";
  if (store === "stripe" || store === "rc_billing") return "web";
  return null;
}

const activeUntil = (expires: string | null | undefined, grace: string | null | undefined, now: number) =>
  expires === null || expires === undefined ? true : Math.max(Date.parse(expires), grace ? Date.parse(grace) : 0) > now;

/**
 * Turns RevenueCat's server-verified subscriber record (RevenueCat validates every receipt with Apple/Google)
 * into Zest Snap's single entitlement model. Pure and unit-tested; the client never decides entitlements.
 */
export function entitlementFromSubscriber(sub: RcSubscriber, now = Date.now()): StoreEntitlement {
  for (const { entitlement, plan } of entitlementPlans) {
    const e = sub.entitlements?.[entitlement];
    if (!e || !activeUntil(e.expires_date, e.grace_period_expires_date, now)) continue;
    const s = sub.subscriptions?.[e.product_identifier];
    const src = source(s?.store);
    if (!src) continue;
    return {
      active: true,
      plan,
      source: src,
      productId: e.product_identifier,
      expiresAt: e.expires_date,
      willRenew: !s?.unsubscribe_detected_at,
      billingIssue: !!s?.billing_issues_detected_at,
      trial: s?.period_type === "trial",
    };
  }
  const last = Object.values(sub.subscriptions || {}).sort((a, b) => Date.parse(b.expires_date || "0") - Date.parse(a.expires_date || "0"))[0];
  return { active: false, lastSource: source(last?.store), expiredAt: last?.expires_date ?? null };
}

const STORE_SOURCES: BillingSource[] = ["app_store", "play_store"];
type ExistingSubscription = { provider: string | null; plan: string | null; status: string | null } | null;

/** What a store sync does to the account. Pure, so purchase, renewal, cancellation, billing issues, expiry and
 *  restore are unit-tested without RevenueCat. syncStoreEntitlement applies the result. */
export type StorePlanChange =
  | { kind: "keep"; plan: string; reason: "plan_inactive" | "no_store_subscription" | "already_expired" }
  | {
      kind: "activate";
      plan: Exclude<PlanId, "free">;
      updateProfile: boolean;
      subscription: {
        provider: BillingSource;
        provider_subscription_id: string;
        plan: Exclude<PlanId, "free">;
        status: "active" | "trialing" | "past_due";
        current_period_end: string | null;
        cancel_at_period_end: boolean;
      };
    }
  | { kind: "expire"; plan: string; downgradeProfile: boolean };

export function storePlanChange(profilePlan: string, existing: ExistingSubscription, entitlement: StoreEntitlement, planActive: boolean): StorePlanChange {
  if (entitlement.active) {
    // A store purchase never overrides a plan that is not active in plan_rules (scanning requires an active plan).
    if (!planActive) return { kind: "keep", plan: profilePlan, reason: "plan_inactive" };
    return {
      kind: "activate",
      plan: entitlement.plan,
      updateProfile: profilePlan !== entitlement.plan,
      subscription: {
        provider: entitlement.source,
        provider_subscription_id: entitlement.productId,
        plan: entitlement.plan,
        status: entitlement.billingIssue ? "past_due" : entitlement.trial ? "trialing" : "active",
        current_period_end: entitlement.expiresAt,
        cancel_at_period_end: !entitlement.willRenew,
      },
    };
  }
  // Lapsed store subscription: only downgrade plans that a store subscription granted (never admin or web plans).
  if (!existing || !STORE_SOURCES.includes(existing.provider as BillingSource)) return { kind: "keep", plan: profilePlan, reason: "no_store_subscription" };
  if (existing.status === "expired") return { kind: "keep", plan: profilePlan, reason: "already_expired" };
  const downgradeProfile = profilePlan === existing.plan;
  return { kind: "expire", plan: downgradeProfile ? "free" : profilePlan, downgradeProfile };
}
