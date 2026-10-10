import { test } from "node:test";
import assert from "node:assert/strict";
import { itemCategory } from "../lib/item-category";

const cases: [string, ReturnType<typeof itemCategory>, { description?: string; location?: string }?][] = [
  ["Dentist check-up", "health"],
  ["Dr Naidoo", "health"],
  ["Parent evening", "school"],
  ["Science Fair", "school", { location: "School hall" }],
  ["Pay school trip", "school"],
  ["Car licence renewal", "bills"],
  ["Pay electricity", "bills"],
  ["Flight to Cape Town", "travel"],
  ["Hotel check-in", "travel"],
  ["Team meeting", "work"],
  ["Project deadline", "work"],
  ["Lerato's birthday party", "social"],
  ["Concert tickets", "social"],
  ["Call mom", "personal"],
  ["Buy groceries", "personal"],
];

for (const [title, expected, extra] of cases)
  test(`category: ${title} → ${expected}`, () => assert.equal(itemCategory({ title, ...extra }), expected));

test("category: words inside other words don't match (payroll, testament)", () => {
  assert.equal(itemCategory({ title: "Payroll export" }), "personal");
});
