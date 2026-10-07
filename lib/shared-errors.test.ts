import { test } from "node:test";
import assert from "node:assert/strict";
import { sharedErrorMessage } from "./shared-errors";

test("shared database error codes become actionable messages and unknown errors never leak", () => {
  assert.match(sharedErrorMessage({ message: "invite_for_another_account" }, "x"), /different email/);
  assert.match(sharedErrorMessage(new Error("invite_unavailable"), "x"), /expired or was revoked/);
  assert.equal(sharedErrorMessage(new Error('relation "public.secret" does not exist'), "Could not load."), "Could not load.");
});
