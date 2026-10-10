import { test } from "node:test";
import assert from "node:assert/strict";
import { annualSavingsPercent, billingTerms, cardPrice, pickProOffers } from "../lib/billing/paywall";
import type { StoreOffer } from "../lib/native/billing";

const offer = (o: Partial<StoreOffer>): StoreOffer => ({
  id: "x", plan: "plus", period: "monthly", price: "R 199,99", priceAmount: 199.99, currencyCode: "ZAR", pricePerMonth: null, title: "Pro", ...o,
});
const monthly = offer({ id: "$rc_monthly" });
const annual = offer({ id: "$rc_annual", period: "annual", price: "R 599,99", priceAmount: 599.99, pricePerMonth: "R 49,99" });

test("the recommended tier is sold when the store offers it; otherwise the first offered tier", () => {
  const business = offer({ id: "biz_m", plan: "business", price: "R 399,99", priceAmount: 399.99 });
  assert.deepEqual(pickProOffers([business, monthly, annual], "plus"), { plan: "plus", annual, monthly });
  assert.deepEqual(pickProOffers([business], "plus"), { plan: "business", annual: null, monthly: business });
  assert.deepEqual(pickProOffers([], "plus"), { plan: null, annual: null, monthly: null });
  // Lifetime/other packages never become a Pro card.
  assert.deepEqual(pickProOffers([offer({ period: "other" })], "plus"), { plan: null, annual: null, monthly: null });
});

test("annual saving is computed from store prices, rounded down, and only when comparable", () => {
  assert.equal(annualSavingsPercent(annual, monthly), 74); // 74.99% → never overstated
  assert.equal(annualSavingsPercent(annual, null), null);
  assert.equal(annualSavingsPercent(offer({ period: "annual", priceAmount: 2400 }), monthly), null); // not cheaper
  assert.equal(annualSavingsPercent(annual, offer({ currencyCode: "USD" })), null); // different currencies
  assert.equal(annualSavingsPercent(offer({ period: "annual", priceAmount: 0 }), monthly), null);
});

test("cards show the store's own strings: per-month equivalent for annual, never an invented figure", () => {
  assert.deepEqual(cardPrice(annual), { main: "R 49,99", unit: "/ month", sub: "R 599,99 billed annually" });
  assert.deepEqual(cardPrice({ ...annual, pricePerMonth: null }), { main: "R 599,99", unit: "/ year", sub: "Billed annually" });
  assert.deepEqual(cardPrice(monthly), { main: "R 199,99", unit: "/ month", sub: null });
  assert.equal(cardPrice(null), null);
});

test("billing terms name the selected price, the store account and auto-renewal", () => {
  assert.match(billingTerms(annual, "App Store"), /^R 599,99 per year, charged to your Apple ID/);
  assert.match(billingTerms(monthly, "Google Play"), /R 199,99 per month, charged to your Google Play account/);
  assert.match(billingTerms(null, "web"), /Renews automatically unless cancelled/);
});
