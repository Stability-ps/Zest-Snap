import { test } from "node:test";
import assert from "node:assert/strict";
import { entitlementFromSubscriber, storePlanChange, type RcSubscriber } from "../lib/billing/entitlements";
import { asService, migratedDb } from "./helpers/db";

const NOW = Date.parse("2026-10-08T00:00:00Z");
const PLUS = "app.zestsnap.plus.monthly";
const sub = (store: string, s: Partial<NonNullable<RcSubscriber["subscriptions"]>[string]> = {}, expires = "2026-11-08T00:00:00Z"): RcSubscriber => ({
  entitlements: { plus: { expires_date: expires, product_identifier: PLUS } },
  subscriptions: { [PLUS]: { store, expires_date: expires, ...s } },
});
const ent = (r: RcSubscriber) => entitlementFromSubscriber(r, NOW);

test("purchase and restore activate the store plan; a repeat sync changes nothing on the profile", () => {
  const first = storePlanChange("free", null, ent(sub("app_store")), true);
  assert.equal(first.kind, "activate");
  if (first.kind !== "activate") return;
  assert.deepEqual(first.subscription, { provider: "app_store", provider_subscription_id: PLUS, plan: "plus", status: "active", current_period_end: "2026-11-08T00:00:00Z", cancel_at_period_end: false });
  assert.equal(first.updateProfile, true);
  // Restoring on a new device, or a webhook for the same purchase, is idempotent.
  const again = storePlanChange("plus", { provider: "app_store", plan: "plus", status: "active" }, ent(sub("app_store")), true);
  assert.equal(again.kind === "activate" && again.updateProfile, false);
});

test("renewal moves the period end; cancellation keeps access until it, then expires", () => {
  const renewed = storePlanChange("plus", { provider: "play_store", plan: "plus", status: "active" }, ent(sub("play_store", {}, "2026-12-08T00:00:00Z")), true);
  assert.equal(renewed.kind === "activate" && renewed.subscription.current_period_end, "2026-12-08T00:00:00Z");
  const cancelled = storePlanChange("plus", { provider: "play_store", plan: "plus", status: "active" }, ent(sub("play_store", { unsubscribe_detected_at: "2026-10-07T00:00:00Z" })), true);
  assert.equal(cancelled.kind, "activate", "a cancelled subscription keeps its plan until the period ends");
  assert.equal(cancelled.kind === "activate" && cancelled.subscription.cancel_at_period_end, true);
  const lapsed = storePlanChange("plus", { provider: "play_store", plan: "plus", status: "active" }, ent(sub("play_store", {}, "2026-10-01T00:00:00Z")), true);
  assert.deepEqual(lapsed, { kind: "expire", plan: "free", downgradeProfile: true });
  // A second lapse event does nothing more.
  assert.deepEqual(storePlanChange("free", { provider: "play_store", plan: "plus", status: "expired" }, ent(sub("play_store", {}, "2026-10-01T00:00:00Z")), true),
    { kind: "keep", plan: "free", reason: "already_expired" });
});

test("billing issues and trials are recorded without removing access", () => {
  const issue = storePlanChange("plus", null, ent({
    entitlements: { plus: { expires_date: "2026-10-07T00:00:00Z", grace_period_expires_date: "2026-10-14T00:00:00Z", product_identifier: PLUS } },
    subscriptions: { [PLUS]: { store: "app_store", expires_date: "2026-10-07T00:00:00Z", billing_issues_detected_at: "2026-10-07T00:00:00Z" } },
  }), true);
  assert.equal(issue.kind === "activate" && issue.subscription.status, "past_due");
  const trial = storePlanChange("free", null, ent(sub("app_store", { period_type: "trial" })), true);
  assert.equal(trial.kind === "activate" && trial.subscription.status, "trialing");
});

test("store sync never grants an inactive plan and never downgrades admin or web plans", () => {
  assert.deepEqual(storePlanChange("free", null, ent(sub("app_store")), false), { kind: "keep", plan: "free", reason: "plan_inactive" });
  const expired = ent(sub("app_store", {}, "2026-10-01T00:00:00Z"));
  assert.deepEqual(storePlanChange("business", { provider: "admin", plan: "business", status: "active" }, expired, true), { kind: "keep", plan: "business", reason: "no_store_subscription" });
  assert.deepEqual(storePlanChange("business", { provider: "web", plan: "business", status: "active" }, expired, true), { kind: "keep", plan: "business", reason: "no_store_subscription" });
  assert.deepEqual(storePlanChange("free", null, expired, true), { kind: "keep", plan: "free", reason: "no_store_subscription" });
  // The store plan lapsed but an admin has since moved the account to another plan: that plan stays.
  assert.deepEqual(storePlanChange("business", { provider: "app_store", plan: "plus", status: "active" }, expired, true), { kind: "expire", plan: "business", downgradeProfile: false });
});

test("a free account gets exactly three AI scans a month; failed scans don't count", async () => {
  const db = await migratedDb();
  const U = "00000000-0000-0000-0000-0000000000f1";
  await db.exec(`insert into auth.users(id,email) values('${U}','f1@example.com')`);
  // Production's Free plan allows 3 scans a month (set in Admin → Plans; the seed in the migrations still says 10).
  await db.exec(`update public.plan_rules set monthly_scans=3 where id='free'`);
  const req = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const age = () => db.exec(`update public.scan_requests set created_at=created_at-interval '2 hours'`);
  const reserve = (n: number) => asService(db, `select public.reserve_scan($1,$2,$3,$4)`, [U, req(n), "doc-" + n, "device-free-000000000000000000"]);
  const finish = (n: number, status: "completed" | "failed") => asService(db, `select public.finish_scan($1,$2,0,10,10,0.001,null)`, [req(n), status]);
  await reserve(1); await finish(1, "failed"); await age();
  for (const n of [2, 3, 4]) { await reserve(n); await finish(n, "completed"); await age(); }
  // Rewards earned from those scans are not enough for a credit-paid scan.
  await assert.rejects(() => reserve(5), /allowance_exhausted/);
  // Moving the account to an active paid plan lifts the limit.
  await db.exec(`update public.plan_rules set active=true where id='plus'; update public.profiles set plan='plus' where id='${U}'`);
  await reserve(6);
  await db.close();
});
