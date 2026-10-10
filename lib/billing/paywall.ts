import type { PlanId } from "../product-config";
import type { StoreOffer } from "../native/billing";

/**
 * Pure helpers for the Premium page (app/upgrade). The page shows one paid tier ("Pro") as an Annual and a
 * Monthly card. Every figure comes from the App Store / Google Play via RevenueCat; nothing here invents a price.
 */
export type PaidPlanId = Exclude<PlanId, "free">;
export type ProOffers = { plan: PaidPlanId | null; annual: StoreOffer | null; monthly: StoreOffer | null };

/** The tier the page sells: the catalog's recommended plan when the store offers it, otherwise the first offered tier. */
export function pickProOffers(offers: StoreOffer[], recommended: PaidPlanId | null): ProOffers {
  const tiers = [...new Set(offers.filter((o) => o.period !== "other").map((o) => o.plan))];
  const plan = recommended && tiers.includes(recommended) ? recommended : (tiers[0] ?? null);
  if (!plan) return { plan: null, annual: null, monthly: null };
  const of = (period: StoreOffer["period"]) => offers.find((o) => o.plan === plan && o.period === period) ?? null;
  return { plan, annual: of("annual"), monthly: of("monthly") };
}

/** Whole-percent saving of paying yearly vs. twelve monthly payments, rounded down; null when it can't be compared honestly. */
export function annualSavingsPercent(annual: StoreOffer | null, monthly: StoreOffer | null): number | null {
  if (!annual || !monthly) return null;
  if (annual.currencyCode && monthly.currencyCode && annual.currencyCode !== monthly.currencyCode) return null;
  const yearOfMonthly = monthly.priceAmount * 12;
  if (!(annual.priceAmount > 0) || !(yearOfMonthly > 0) || annual.priceAmount >= yearOfMonthly) return null;
  const pct = Math.floor((1 - annual.priceAmount / yearOfMonthly) * 100);
  return pct >= 1 ? pct : null;
}

/** What the big price on a card shows: always "per month" like the design, using the store's own strings. */
export function cardPrice(offer: StoreOffer | null): { main: string; unit: string; sub: string | null } | null {
  if (!offer) return null;
  if (offer.period === "annual") {
    // The store's localised monthly equivalent when it provides one; otherwise the honest yearly price.
    return offer.pricePerMonth ? { main: offer.pricePerMonth, unit: "/ month", sub: `${offer.price} billed annually` } : { main: offer.price, unit: "/ year", sub: "Billed annually" };
  }
  return { main: offer.price, unit: "/ month", sub: null };
}

/** The billing line for the selected offer, shown above the purchase button area (store guideline: price and term are clear). */
export function billingTerms(offer: StoreOffer | null, store: string): string {
  const where = store === "App Store" ? "your Apple ID" : store === "Google Play" ? "your Google Play account" : "your store account";
  const period = offer?.period === "annual" ? `${offer.price} per year` : offer?.period === "monthly" ? `${offer.price} per month` : null;
  return (
    (period ? `${period}, charged to ${where} at confirmation. ` : `Charged to ${where} at confirmation. `) +
    "Renews automatically unless cancelled at least 24 hours before the end of the period. Manage or cancel any time in your store account settings."
  );
}
