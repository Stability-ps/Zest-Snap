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
