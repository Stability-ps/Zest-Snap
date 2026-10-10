import { test } from "node:test";
import assert from "node:assert/strict";
import { storePriceLabel } from "../lib/plan-catalog";

test("in-app plan prices come only from the store offer, never the catalog", () => {
  assert.equal(storePriceLabel([{ period: "annual", price: "R 799,99" }, { period: "monthly", price: "R 89,99" }]), "R 89,99/month");
  assert.equal(storePriceLabel([{ period: "annual", price: "€39.99" }]), "€39.99/year");
  assert.equal(storePriceLabel([{ period: "other", price: "$1" }]), "");
  assert.equal(storePriceLabel([]), "", "web, or the store hasn't answered: no price");
});
