import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { as, asService, migratedDb } from "./helpers/db";

const EXISTING = "00000000-0000-4000-8000-0000000000e1";
const NEW = "00000000-0000-4000-8000-0000000000n1".replace("n", "a");
const PAID = "00000000-0000-4000-8000-0000000000b2";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const DEVICE = "device-onboard-000000000000000000";
const req = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const status = async (db: PGlite, u: string) => (await as<{ s: { show: boolean } }>(db, u, `select public.premium_onboarding_status() s`)).rows[0].s.show;
const newUser = (db: PGlite, id: string, confirmed = true) =>
  db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${id}','${id.slice(-2)}@example.com',${confirmed ? "now()" : "null"})`);

/** Everything up to (not including) this feature, so "existing accounts" really predate it. */
async function beforeFeature() {
  return migratedDb("20261017000000");
}
async function applyFeature(db: PGlite) {
  for (const f of ["20261017090000_guest_trial_three_scans.sql", "20261017100000_premium_onboarding_and_funnel.sql"])
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
}

test("guests get exactly three successful scans; failures are refunded; repeats and the fourth are refused", async () => {
  const db = await beforeFeature();
  await applyFeature(db);
  const reserve = (n: number, device = DEVICE) =>
    asService<{ r: { remaining?: number } }>(db, `select public.reserve_guest_scan($1,$2,$3,$4) r`, [req(n), `hash-${n}`, device, `net-${n}`]);
  const finish = (n: number, s: "completed" | "failed") => asService(db, `select public.finish_guest_scan($1,$2,$3)`, [req(n), s, s === "completed" ? "{}" : null]);
  const age = () => db.exec(`update public.guest_scan_usage set created_at = created_at - interval '2 hours'`);

  assert.equal((await reserve(1)).rows[0].r.remaining, 2);
  await finish(1, "completed"); await age();
  // A failed scan costs nothing.
  assert.equal((await reserve(2)).rows[0].r.remaining, 1);
  await finish(2, "failed"); await age();
  assert.equal((await reserve(3)).rows[0].r.remaining, 1);
  await finish(3, "completed"); await age();
  // The same request id twice (network retry) is refused, and while one scan is in flight a second is refused.
  const third = await reserve(4);
  assert.equal(third.rows[0].r.remaining, 0);
  await assert.rejects(() => reserve(4), /repeat_request/);
  await assert.rejects(() => reserve(5), /repeat_request/);
  await finish(4, "completed"); await age();
  await assert.rejects(() => reserve(6), /guest_trial_exhausted/);
  assert.equal(Number((await db.query<{ n: number }>(`select count(*)::int n from public.guest_scan_usage where status='completed'`)).rows[0].n), 3);
  // An admin's deliberate setting is not overwritten by the migration.
  const other = await beforeFeature();
  await other.exec(`update public.app_limits set value = 5 where key = 'guest_trial_scans_per_device'`);
  await applyFeature(other);
  assert.equal((await other.query<{ v: number }>(`select value v from public.app_limits where key='guest_trial_scans_per_device'`)).rows[0].v, 5);
  await other.close();
  await db.close();
});

test("premium introduction: once for new verified accounts; never for existing, unverified, paid, recovery or email change", async () => {
  const db = await beforeFeature();
  await newUser(db, EXISTING);
  await applyFeature(db);
  await newUser(db, NEW, false);
  await newUser(db, PAID);
  await db.exec(`update public.profiles set plan='plus' where id='${PAID}'`);

  assert.equal(await status(db, EXISTING), false, "accounts created before the feature are never interrupted");
  assert.equal(await status(db, NEW), false, "not before the email is verified");
  assert.equal(await status(db, PAID), false, "already paying");
  await db.exec(`update auth.users set email_confirmed_at=now() where id='${NEW}'`);
  assert.equal(await status(db, NEW), true);
  // Password recovery / email change touch auth.users with updates, never inserts: still exactly one row.
  await db.exec(`update auth.users set email='changed@example.com' where id='${EXISTING}'`);
  assert.equal(await status(db, EXISTING), false);
  // Choosing Free records completion once; it does not show again (any device, any login).
  await as(db, NEW, `select public.complete_premium_onboarding('free')`);
  assert.equal(await status(db, NEW), false);
  await as(db, NEW, `select public.complete_premium_onboarding('paid')`);
  assert.equal((await db.query<{ c: string }>(`select choice c from public.premium_onboarding where user_id='${NEW}'`)).rows[0].c, "free", "first choice is kept");
  // Never-eligible accounts calling complete is a harmless no-op; invalid input is rejected.
  await as(db, EXISTING, `select public.complete_premium_onboarding('free')`);
  assert.equal((await db.query(`select 1 from public.premium_onboarding where user_id='${EXISTING}'`)).rows.length, 0);
  await assert.rejects(() => as(db, NEW, `select public.complete_premium_onboarding('hacked')`), /invalid_choice/);
  // The table is not readable or writable by clients; signed-out callers can't call the status function.
  await assert.rejects(() => as(db, NEW, `select * from public.premium_onboarding`), /permission denied/);
  await assert.rejects(() => as(db, NEW, `update public.premium_onboarding set completed_at=null`), /permission denied/);
  await assert.rejects(() => as(db, null, `select public.premium_onboarding_status() s`), /permission denied/);
  await db.close();
});

test("funnel events: allow-listed, pseudonymous, de-duplicated; the report is admin-only and derives facts from source tables", async () => {
  const db = await beforeFeature();
  await applyFeature(db);
  await newUser(db, NEW);
  const track = (u: string | null, event: string, ctx: string | null = null, device: string | null = DEVICE) =>
    as(db, u, `select public.track_conversion($1,'ios',$2,$3)`, [event, ctx, device]);
  await track(null, "guest_paywall_viewed", "guest_limit");
  await track(null, "guest_paywall_viewed", "guest_limit"); // same day: counted once
  await track(null, "guest_limit_reached");
  await track(null, "guest_limit_reached"); // once ever
  await track(NEW, "free_plan_selected", "post_verification");
  await track(NEW, "free_plan_selected", "post_verification");
  await track(null, "checkout_started", null, null); // no subject at all: ignored
  await assert.rejects(() => track(NEW, "made_up_event"), /unknown_event/);
  const rows = (await db.query<{ event: string; subject: string; platform: string }>(`select event, subject, platform from public.conversion_events order by id`)).rows;
  assert.deepEqual(rows.map((r) => r.event), ["guest_paywall_viewed", "guest_limit_reached", "free_plan_selected"]);
  assert.ok(rows[0].subject.startsWith("d:") && !rows[0].subject.includes(DEVICE), "device id is stored only as its hash");
  assert.equal(rows[2].subject, `u:${NEW}`);
  assert.equal(rows[0].platform, "ios");
  await assert.rejects(() => as(db, NEW, `select * from public.conversion_events`), /permission denied/);
  await assert.rejects(() => as(db, NEW, `select public.admin_conversion_funnel(now()-interval '1 day', now()+interval '1 day')`), /forbidden/);

  // Admin view: real counts from guest_scan_usage, auth.users and conversion_events.
  await newUser(db, ADMIN);
  await db.exec(`insert into public.admin_users(user_id, role) values('${ADMIN}','owner') on conflict do nothing`).catch(() =>
    db.exec(`update public.profiles set is_admin = true where id = '${ADMIN}'`));
  await asService(db, `insert into public.guest_scan_usage(request_id, device_hash, content_hash, status) values ($1,'dev-a','h1','completed'),($2,'dev-a','h2','completed'),($3,'dev-a','h3','completed'),($4,'dev-b','h4','completed')`, [req(11), req(12), req(13), req(14)]);
  const report = (await as<{ r: Record<string, any> }>(db, ADMIN, `select public.admin_conversion_funnel(now()-interval '1 day', now()+interval '1 day') r`)).rows[0].r;
  assert.equal(report.guest_scan_1_completed, 2);
  assert.equal(report.guest_scan_3_completed, 1);
  assert.equal(report.registration_completed, 2);
  assert.equal(report.email_verified, 2);
  assert.equal(report.events.guest_paywall_viewed, 1);
  assert.equal(report.events.free_plan_selected, 1);
  await db.close();
});
