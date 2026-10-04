import type { PlanId } from "../product-config";
import { planForProduct, revenueCatPublicKeys } from "../billing/config";
import { hasPlugin, runtime } from "./runtime";

/**
 * BillingService: one interface for every platform.
 *  - iOS     → Apple In-App Purchase (StoreKit) via RevenueCat
 *  - Android → Google Play Billing via RevenueCat
 *  - Web     → web checkout (not connected yet → reported honestly)
 * Purchases only *start* on the device. Entitlements are granted by the server (/api/billing/sync and the
 * RevenueCat webhook) from receipts RevenueCat verified with Apple/Google — never from the client's word.
 */
export type BillingAvailability = "store" | "store_not_configured" | "web_not_connected";
export type StoreOffer = { id: string; plan: Exclude<PlanId, "free">; period: "monthly" | "annual" | "other"; price: string; title: string };
export type PurchaseOutcome = { status: "purchased" | "cancelled" | "pending"; plan?: string };

const storeKey = () => (runtime() === "ios" ? revenueCatPublicKeys.ios : runtime() === "android" ? revenueCatPublicKeys.android : "");

export function billingAvailability(): BillingAvailability {
  if (!hasPlugin("Purchases")) return "web_not_connected";
  return storeKey() ? "store" : "store_not_configured";
}

export function storeName() {
  return runtime() === "ios" ? "App Store" : runtime() === "android" ? "Google Play" : "web";
}

let configuredFor: string | null = null;
// Returned wrapped: awaiting a bare Capacitor plugin proxy would call `.then()` on it.
async function purchases(userId: string) {
  const { Purchases } = await import("@revenuecat/purchases-capacitor");
  if (configuredFor === userId) return { Purchases };
  const { isConfigured } = await Purchases.isConfigured();
  // The Zest Snap account id is the store customer id, so purchases follow the account (not the device).
  if (!isConfigured) await Purchases.configure({ apiKey: storeKey(), appUserID: userId });
  else await Purchases.logIn({ appUserID: userId });
  configuredFor = userId;
  return { Purchases };
}

async function confirmWithServer(): Promise<string | undefined> {
  const res = await fetch("/api/billing/sync", { method: "POST", cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { plan?: string; error?: string };
  if (!res.ok) throw new Error(body.error === "billing_not_configured" ? "Subscriptions aren't available yet." : "We couldn't confirm your subscription yet. Try Restore purchases in a moment.");
  return body.plan;
}

export async function storeOffers(userId: string): Promise<StoreOffer[]> {
  if (billingAvailability() !== "store") return [];
  const { Purchases } = await purchases(userId);
  const offerings = await Purchases.getOfferings();
  return (offerings.current?.availablePackages || [])
    .map((p) => {
      const plan = planForProduct(p.product.identifier);
      if (!plan) return null;
      const type = String(p.packageType);
      return { id: p.identifier, plan, period: type === "MONTHLY" ? "monthly" : type === "ANNUAL" ? "annual" : "other", price: p.product.priceString, title: p.product.title } as StoreOffer;
    })
    .filter((x): x is StoreOffer => !!x);
}

export async function purchaseOffer(userId: string, offerId: string): Promise<PurchaseOutcome> {
  const { Purchases } = await purchases(userId);
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.availablePackages.find((p) => p.identifier === offerId);
  if (!pkg) throw new Error("That plan isn't available in the store right now.");
  try {
    await Purchases.purchasePackage({ aPackage: pkg });
  } catch (e) {
    const err = e as { userCancelled?: boolean; code?: string | number };
    if (err?.userCancelled || String(err?.code) === "1") return { status: "cancelled" };
    if (String(err?.code) === "20") return { status: "pending" }; // payment pending (e.g. Ask to Buy, slow card)
    throw new Error("The purchase didn't complete. You haven't been charged.");
  }
  return { status: "purchased", plan: await confirmWithServer() };
}

/** "Restore Purchases" (iOS) / entitlement recovery (Android): re-reads store purchases, then the server decides. */
export async function restorePurchases(userId: string) {
  const { Purchases } = await purchases(userId);
  await Purchases.restorePurchases();
  return confirmWithServer();
}
