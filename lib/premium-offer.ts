import type { StoreOffer } from "./native/billing";

/**
 * The premium screen sells one tier ("Pro" = the catalogue's recommended paid plan) as an annual and a monthly
 * store package. Prices are only ever the store's own; nothing here invents or converts a price.
 */
export function proOffers(offers: StoreOffer[], plan: string) {
  const forPlan = offers.filter((o) => o.plan === plan);
  return { annual: forPlan.find((o) => o.period === "annual") ?? null, monthly: forPlan.find((o) => o.period === "monthly") ?? null };
}

/** Whole-percent saving of the annual package against twelve months, only when both come from the store in one currency. */
export function annualSavingPercent(annual: StoreOffer | null, monthly: StoreOffer | null) {
  if (!annual?.amount || !monthly?.amount || !annual.currency || annual.currency !== monthly.currency) return null;
  const pct = Math.floor((1 - annual.amount / (monthly.amount * 12)) * 100);
  return pct >= 1 && pct < 100 ? pct : null;
}
