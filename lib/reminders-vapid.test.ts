import { test } from "node:test";
import assert from "node:assert/strict";
import { boundToOtherKey } from "./reminders";

// Any valid-looking base64url P-256 public key works; these are throwaway test values, not real keys.
const KEY_A = "BAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A";
const KEY_B = "BEBAPz49PDs6OTg3NjU0MzIxMC8uLSwrKikoJyYlJCMiISAfHh0cGxoZGBcWFRQTEhEQDw4NDAsKCQgHBgUEAwI";
const raw = (v: string) => Uint8Array.from(Buffer.from(v, "base64url")).buffer;

test("a subscription made with the current VAPID key is kept", () => {
  assert.equal(boundToOtherKey({ options: { applicationServerKey: raw(KEY_A), userVisibleOnly: true } }, KEY_A), false);
});

test("a subscription bound to a rotated VAPID key is replaced", () => {
  assert.equal(boundToOtherKey({ options: { applicationServerKey: raw(KEY_B), userVisibleOnly: true } }, KEY_A), true);
});

test("a subscription without a recorded key is left alone", () => {
  assert.equal(boundToOtherKey({ options: { applicationServerKey: null, userVisibleOnly: true } }, KEY_A), false);
});
