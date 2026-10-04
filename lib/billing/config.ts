import type { PlanId } from "../product-config";

/**
 * Store product configuration. Fill these in once the products exist in App Store Connect / Play Console
 * and RevenueCat (see docs/mobile/README.md → Subscriptions). Nothing here is secret: product IDs and the
 * RevenueCat *public* SDK keys are designed to ship inside apps. Server secrets live only in Vercel env.
 */
export type StoreProducts = { monthly?: string; annual?: string };

export const storeProducts: Record<Exclude<PlanId, "free">, { apple: StoreProducts; google: StoreProducts }> = {
  plus: {
    apple: { monthly: process.env.NEXT_PUBLIC_IAP_APPLE_PLUS_MONTHLY || "app.zestsnap.plus.monthly", annual: process.env.NEXT_PUBLIC_IAP_APPLE_PLUS_ANNUAL || "app.zestsnap.plus.annual" },
    google: { monthly: process.env.NEXT_PUBLIC_IAP_GOOGLE_PLUS_MONTHLY || "zestsnap_plus:monthly", annual: process.env.NEXT_PUBLIC_IAP_GOOGLE_PLUS_ANNUAL || "zestsnap_plus:annual" },
  },
  business: {
    apple: { monthly: process.env.NEXT_PUBLIC_IAP_APPLE_BUSINESS_MONTHLY || "app.zestsnap.business.monthly", annual: process.env.NEXT_PUBLIC_IAP_APPLE_BUSINESS_ANNUAL || "app.zestsnap.business.annual" },
    google: { monthly: process.env.NEXT_PUBLIC_IAP_GOOGLE_BUSINESS_MONTHLY || "zestsnap_business:monthly", annual: process.env.NEXT_PUBLIC_IAP_GOOGLE_BUSINESS_ANNUAL || "zestsnap_business:annual" },
  },
};

/** RevenueCat entitlement identifiers → Zest Snap plan. Highest tier wins when several are active. */
export const entitlementPlans: { entitlement: string; plan: Exclude<PlanId, "free"> }[] = [
  { entitlement: process.env.NEXT_PUBLIC_RC_ENTITLEMENT_BUSINESS || "business", plan: "business" },
  { entitlement: process.env.NEXT_PUBLIC_RC_ENTITLEMENT_PLUS || "plus", plan: "plus" },
];

/** RevenueCat public SDK keys (per platform). Empty until store billing is configured → purchases stay disabled. */
export const revenueCatPublicKeys = {
  ios: process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY || "",
  android: process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY || "",
};

export function planForProduct(productId: string): Exclude<PlanId, "free"> | null {
  for (const [plan, stores] of Object.entries(storeProducts) as [Exclude<PlanId, "free">, { apple: StoreProducts; google: StoreProducts }][]) {
    const ids = [stores.apple.monthly, stores.apple.annual, stores.google.monthly, stores.google.annual].filter(Boolean) as string[];
    if (ids.some((id) => id === productId || productId.startsWith(id.split(":")[0] + ":") || id.startsWith(productId + ":"))) return plan;
  }
  return null;
}
