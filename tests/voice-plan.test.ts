import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseVoicePlanInput, voicePlanInstructions } from "../lib/voice-plan";

test("voice plan input accepts normal text and resolves today's date", () => {
  const parsed = parseVoicePlanInput({ text: "Tomorrow at 9 dentist", timezone: "Africa/Johannesburg", locale: "en-ZA" });
  assert.equal(parsed.text, "Tomorrow at 9 dentist");
  assert.equal(parsed.timezone, "Africa/Johannesburg");
  assert.match(parsed.currentDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("voice plan input rejects empty, oversized and invalid timezone input", () => {
  assert.throws(() => parseVoicePlanInput({ text: " ", timezone: "UTC" }), /invalid_text/);
  assert.throws(() => parseVoicePlanInput({ text: "x".repeat(2001), timezone: "UTC" }), /invalid_text/);
  assert.throws(() => parseVoicePlanInput({ text: "Meet Sam", timezone: "Not/AZone" }), /invalid_timezone/);
});

test("voice instructions explicitly allow live relative dates without inventing details", () => {
  const instructions = voicePlanInstructions({ timezone: "UTC", locale: "en", currentDate: "2026-10-07" });
  assert.match(instructions, /relative dates/i);
  assert.match(instructions, /Do not invent/i);
  assert.match(instructions, /2026-10-07/);
});

test("Plan with Zest is bounded per account before any AI call", () => {
  const route = readFileSync("app/api/plan/route.ts", "utf8");
  const claim = route.indexOf('rpc("claim_voice_plan"');
  assert.ok(claim > 0, "route must claim a voice-plan allowance");
  assert.ok(claim < route.indexOf("api.openai.com"), "allowance must be claimed before calling the model");
  assert.ok(route.indexOf("getUser()") < claim, "allowance is per authenticated account");
  const sql = readFileSync("supabase/migrations/20261011090000_voice_plan_rate_limit.sql", "utf8");
  assert.match(sql, /revoke all on function public\.claim_voice_plan\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /pg_advisory_xact_lock/);
});
