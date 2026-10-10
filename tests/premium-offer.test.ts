import { test } from "node:test";
import assert from "node:assert/strict";
import { annualSavingPercent, proOffers } from "../lib/premium-offer";
import type { StoreOffer } from "../lib/native/billing";

const offer = (o: Partial<StoreOffer>): StoreOffer => ({ id: "x", plan: "plus", period: "monthly", price: "$4.99", title: "Zest Snap+", ...o });

test("Pro offers: the recommended plan's annual and monthly store packages only", () => {
  const offers = [
    offer({ id: "m", period: "monthly" }),
    offer({ id: "a", period: "annual" }),
    offer({ id: "b", plan: "business", period: "annual" }),
    offer({ id: "o", period: "other" }),
  ];
  assert.deepEqual(proOffers(offers, "plus"), { annual: offers[1], monthly: offers[0] });
  assert.deepEqual(proOffers(offers.slice(0, 1), "plus"), { annual: null, monthly: offers[0] });
  assert.deepEqual(proOffers([], "plus"), { annual: null, monthly: null });
});

test("annual saving: only from two real store prices in one currency", () => {
  const monthly = offer({ amount: 4.99, currency: "USD" });
  assert.equal(annualSavingPercent(offer({ period: "annual", amount: 39.99, currency: "USD" }), monthly), 33);
  assert.equal(annualSavingPercent(offer({ period: "annual", amount: 799, currency: "ZAR" }), monthly), null, "different currencies");
  assert.equal(annualSavingPercent(offer({ period: "annual" }), monthly), null, "no numeric price");
  assert.equal(annualSavingPercent(null, monthly), null);
  assert.equal(annualSavingPercent(offer({ period: "annual", amount: 70, currency: "USD" }), monthly), null, "no saving: no claim");
});
