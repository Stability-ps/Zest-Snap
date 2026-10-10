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
/** A purchasable store package. Every price here is the store's own localised value (never computed or invented). */
export type StoreOffer = {
  id: string;
  plan: Exclude<PlanId, "free">;
  period: "monthly" | "annual" | "other";
  /** Localised store price for the whole billing period, e.g. "R 599,99". */
  price: string;
  /** Numeric store price for the whole period (used only to compare plans, never displayed on its own). */
  priceAmount: number;
  currencyCode: string;
  /** The store's localised monthly equivalent (annual packages), or null if the store didn't provide one. */
  pricePerMonth: string | null;
  title: string;
  /** A free trial the store will actually give this person (iOS: Apple-confirmed eligibility; Android: Play's eligible offer). */
  freeTrial: FreeTrial | null;
};
export type FreeTrial = { count: number; unit: "day" | "week" | "month" | "year" };

const UNITS: Record<string, FreeTrial["unit"]> = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };
/** Free introductory period from a RevenueCat product, or null when it isn't free (paid intro prices are not trials). */
export function freeTrialOf(product: {
  introPrice?: { price: number; periodUnit: string; periodNumberOfUnits: number } | null;
  defaultOption?: { freePhase?: { billingPeriod?: { unit: string; value: number } | null } | null } | null;
}): FreeTrial | null {
  const free = product.defaultOption?.freePhase?.billingPeriod;
  if (free && UNITS[free.unit] && free.value > 0) return { count: free.value, unit: UNITS[free.unit] };
  const intro = product.introPrice;
  if (intro && intro.price === 0 && UNITS[intro.periodUnit] && intro.periodNumberOfUnits > 0) return { count: intro.periodNumberOfUnits, unit: UNITS[intro.periodUnit] };
  return null;
}
export type PurchaseOutcome = { status: "purchased" | "cancelled" | "pending"; plan?: string };

const storeKey = () => (runtime() === "ios" ? revenueCatPublicKeys.ios : runtime() === "android" ? revenueCatPublicKeys.android : "");

export function billingAvailability(): BillingAvailability {
  if (!hasPlugin("Purchases")) return "web_not_connected";
  return storeKey() ? "store" : "store_not_configured";
}

export function storeName() {
  return runtime() === "ios" ? "App Store" : runtime() === "android" ? "Google Play" : "web";
}

/** The store's own subscription page, where people change or cancel a plan bought in the app. */
export function manageSubscriptionUrl() {
  if (runtime() === "ios") return "https://apps.apple.com/account/subscriptions";
  if (runtime() === "android") return "https://play.google.com/store/account/subscriptions?package=app.zestsnap";
  return null;
}

const ANONYMOUS = "\u0000anonymous";
let configuredFor: string | null = null;
// Returned wrapped: awaiting a bare Capacitor plugin proxy would call `.then()` on it.
// userId null = read-only price lookup before sign-in (RevenueCat's anonymous customer; it is merged into the
// account by logIn when the person signs in). Purchases and restores always pass the signed-in account id.
async function purchases(userId: string | null) {
  const { Purchases } = await import("@revenuecat/purchases-capacitor");
  const want = userId ?? ANONYMOUS;
  if (configuredFor === want || (userId === null && configuredFor !== null)) return { Purchases };
  const { isConfigured } = await Purchases.isConfigured();
  // The Zest Snap account id is the store customer id, so purchases follow the account (not the device).
  if (!isConfigured) await Purchases.configure(userId ? { apiKey: storeKey(), appUserID: userId } : { apiKey: storeKey() });
  else if (userId) await Purchases.logIn({ appUserID: userId });
  configuredFor = want;
  return { Purchases };
}

async function confirmWithServer(): Promise<string | undefined> {
  const res = await fetch("/api/billing/sync", { method: "POST", cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { plan?: string; error?: string };
  if (!res.ok) throw new Error(body.error === "billing_not_configured" ? "Subscriptions aren't available yet." : "We couldn't confirm your subscription yet. Try Restore purchases in a moment.");
  return body.plan;
}

/** The store's current offering. Prices are the App Store / Google Play's own localised values. */
export async function storeOffers(userId: string | null): Promise<StoreOffer[]> {
  if (billingAvailability() !== "store") return [];
  const { Purchases } = await purchases(userId);
  const offerings = await Purchases.getOfferings();
  const packages = offerings.current?.availablePackages || [];
  // iOS shows an introductory offer only to people Apple says are eligible; unknown counts as not eligible.
  let eligible: Record<string, boolean> | null = null;
  if (runtime() === "ios") {
    try {
      const map = await Purchases.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: packages.map((p) => p.product.identifier) });
      eligible = Object.fromEntries(Object.entries(map).map(([id, e]) => [id, (e as { status?: number }).status === 2]));
    } catch {
      eligible = {};
    }
  }
  return packages
    .map((p) => {
      const plan = planForProduct(p.product.identifier);
      if (!plan) return null;
      const type = String(p.packageType);
      const product = p.product as typeof p.product & { currencyCode?: string; pricePerMonthString?: string | null };
      return {
        id: p.identifier,
        plan,
        period: type === "MONTHLY" ? "monthly" : type === "ANNUAL" ? "annual" : "other",
        price: product.priceString,
        priceAmount: Number(product.price) || 0,
        currencyCode: product.currencyCode || "",
        pricePerMonth: product.pricePerMonthString ?? null,
        title: product.title,
        freeTrial: eligible && !eligible[product.identifier] ? null : freeTrialOf(product as never),
      } as StoreOffer;
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
