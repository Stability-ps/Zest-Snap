import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { as, asService, migratedDb } from "./helpers/db";

const A = "00000000-0000-4000-8000-0000000000a7";
const B = "00000000-0000-4000-8000-0000000000b7";
const C = "00000000-0000-4000-8000-0000000000c7";
const ADMIN = "00000000-0000-4000-8000-0000000000d7";
const users = async (db: PGlite, ...ids: string[]) => {
  for (const id of ids) await db.exec(`insert into auth.users(id,email) values('${id}','${id.slice(-2)}@example.com')`);
};
const claim = async (db: PGlite, campaign: string) =>
  (await asService<{ user_id: string; id: string }>(db, `select * from public.claim_marketing_sends($1)`, [campaign])).rows;
/** Midday UTC, so quiet hours don't apply to UTC profiles unless a test says otherwise. */
const noon = `date_trunc('day', now()) + interval '12 hours'`;

test("consent is explicit, per person, recorded with time and platform, and not readable by others", async () => {
  const db = await migratedDb();
  await users(db, A, B);
  assert.deepEqual((await as<{ c: unknown }>(db, A, `select public.get_marketing_consent() c`)).rows[0].c, { push: false }, "off unless chosen");
  await as(db, A, `select public.set_marketing_consent(true, 'ios')`);
  const row = (await db.query<any>(`select * from public.marketing_consent where user_id='${A}'`)).rows[0];
  assert.equal(row.push_opt_in, true);
  assert.equal(row.platform, "ios");
  assert.ok(row.opted_in_at);
  await as(db, A, `select public.set_marketing_consent(false, 'ios')`);
  const off = (await db.query<any>(`select * from public.marketing_consent where user_id='${A}'`)).rows[0];
  assert.equal(off.push_opt_in, false);
  assert.ok(off.opted_out_at && off.opted_in_at, "both moments are kept for the record");
  assert.deepEqual((await as<{ c: unknown }>(db, B, `select public.get_marketing_consent() c`)).rows[0].c, { push: false });
  await assert.rejects(() => as(db, B, `select * from public.marketing_consent`), /permission denied/);
  await assert.rejects(() => as(db, null, `select public.set_marketing_consent(true)`), /permission denied/);
  await db.close();
});

test("campaigns start disabled; only consenting, active people are picked; each period once; caps and quiet hours hold", async () => {
  const db = await migratedDb();
  await db.exec(`set timezone to 'UTC'`); // as in production; the test's clock times are UTC
  await users(db, A, B, C);
  assert.equal((await db.query(`select 1 from public.marketing_campaigns where enabled`)).rows.length, 0);
  // A and C opted in, B did not. All three earned credits today.
  for (const u of [A, C]) await as(db, u, `select public.set_marketing_consent(true, 'web')`);
  await db.exec(`insert into public.reward_ledger(user_id, entry_type, amount, reason) values ('${A}','earn',5,'first_scan'),('${B}','earn',5,'first_scan'),('${C}','earn',5,'first_scan')`);
  assert.deepEqual(await claim(db, "reward_earned"), [], "nothing is sent while the campaign is disabled");
  await db.exec(`update public.marketing_campaigns set enabled = true`);
  // C is in Johannesburg at 23:00 local (quiet hours) when it is 21:00 UTC.
  await db.exec(`update public.profiles set timezone = 'Africa/Johannesburg' where id = '${C}'`);
  const q = (now: string) => db.query<{ user_id: string }>(`select user_id from private.marketing_candidates('reward_earned', 100, ${now})`);
  assert.deepEqual((await q(`date_trunc('day', now()) + interval '21 hours'`)).rows.map((r) => r.user_id), [], "21:00 UTC is quiet time for UTC and Johannesburg");
  assert.deepEqual((await q(noon)).rows.map((r) => r.user_id).sort(), [A, C].sort());

  // The scheduler uses the real clock: switch quiet hours off so this part doesn't depend on when tests run.
  await db.exec(`update public.app_limits set value = 0 where key in ('marketing_quiet_start_hour','marketing_quiet_end_hour')`);
  const first = await claim(db, "reward_earned");
  assert.deepEqual(first.map((r) => r.user_id).sort(), [A, C].sort());
  assert.deepEqual(await claim(db, "reward_earned"), [], "a second scheduler run (or overlap) sends nothing twice");
  for (const r of first) await asService(db, `select public.finish_marketing_send($1,'sent','os-${r.id.slice(0, 8)}')`, [r.id]);
  // Another reward right away: the 72-hour gap blocks a second notification.
  await db.exec(`insert into public.reward_ledger(user_id, entry_type, amount, reason) values ('${A}','earn',3,'first_calendar')`);
  assert.equal((await q(noon)).rows.filter((r) => r.user_id === A).length, 0);
  // After the gap, still at most two per week.
  await db.exec(`update public.marketing_sends set created_at = now() - interval '4 days', sent_at = now() - interval '4 days'`);
  assert.equal((await q(noon)).rows.filter((r) => r.user_id === A).length, 1);
  await db.exec(`insert into public.marketing_sends(campaign,user_id,period_key,status,created_at) values ('inactive_users','${A}','x','sent',now() - interval '80 hours')`);
  assert.equal((await q(noon)).rows.filter((r) => r.user_id === A).length, 0, "weekly maximum of 2 reached");
  // Disabled accounts are never contacted; withdrawing consent stops everything immediately.
  await db.exec(`update public.profiles set account_status = 'disabled' where id = '${C}'`);
  await as(db, A, `select public.set_marketing_consent(false, 'web')`);
  assert.deepEqual((await q(noon)).rows, []);
  await db.close();
});

test("inactive and free-limit campaigns pick the right people, once per stretch / month", async () => {
  const db = await migratedDb();
  await db.exec(`set timezone to 'UTC'`);
  await users(db, A, B, C);
  for (const u of [A, B, C]) await as(db, u, `select public.set_marketing_consent(true, 'android')`);
  await db.exec(`
    update public.marketing_campaigns set enabled = true;
    update public.profiles set last_active_at = now() - interval '10 days' where id = '${A}';
    update public.profiles set last_active_at = now() - interval '1 day' where id = '${B}';
    update public.profiles set last_active_at = now() - interval '90 days' where id = '${C}';`);
  const inactive = await db.query<{ user_id: string }>(`select user_id from private.marketing_candidates('inactive_users', 100, ${noon})`);
  assert.deepEqual(inactive.rows.map((r) => r.user_id), [A], "quiet for 7+ days but not long gone");
  await db.exec(`
    insert into public.usage_monthly(user_id, period_start, ai_scans) values
      ('${B}', date_trunc('month', now() at time zone 'UTC')::date, 3),
      ('${C}', date_trunc('month', now() at time zone 'UTC')::date, 1);`);
  const exhausted = await db.query<{ user_id: string; period_key: string }>(`select * from private.marketing_candidates('free_scans_exhausted', 100, ${noon})`);
  assert.deepEqual(exhausted.rows.map((r) => r.user_id), [B]);
  assert.match(exhausted.rows[0].period_key, /^month:\d{4}-\d{2}$/);
  // Paid plans never get the free-limit message.
  await db.exec(`update public.profiles set plan = 'plus' where id = '${B}'`);
  assert.equal((await db.query(`select * from private.marketing_candidates('free_scans_exhausted', 100, ${noon})`)).rows.length, 0);
  await db.close();
});

test("opens are recorded only by the recipient; admin reporting and editing are admin-only and audited", async () => {
  const db = await migratedDb();
  await users(db, A, B, ADMIN);
  await db.exec(`update public.profiles set is_admin = true where id = '${ADMIN}'`);
  await as(db, A, `select public.set_marketing_consent(true, 'web')`);
  await db.exec(`insert into public.marketing_sends(id,campaign,user_id,period_key,status,sent_at) values ('11111111-1111-4111-8111-111111111111','reward_earned','${A}','reward:x','sent',now())`);
  await as(db, B, `select public.record_marketing_open('11111111-1111-4111-8111-111111111111')`);
  assert.equal((await db.query<any>(`select opened_at from public.marketing_sends`)).rows[0].opened_at, null, "someone else can't mark it opened");
  await as(db, A, `select public.record_marketing_open('11111111-1111-4111-8111-111111111111')`);
  assert.ok((await db.query<any>(`select opened_at from public.marketing_sends`)).rows[0].opened_at);

  await assert.rejects(() => as(db, A, `select public.admin_marketing(now() - interval '1 day', now() + interval '1 day')`), /forbidden/);
  await assert.rejects(() => as(db, A, `select public.admin_set_marketing_campaign('reward_earned', true, 't', 'b', '/app')`), /forbidden/);
  const report = (await as<{ r: any }>(db, ADMIN, `select public.admin_marketing(now() - interval '1 day', now() + interval '1 day') r`)).rows[0].r;
  const reward = report.campaigns.find((c: any) => c.key === "reward_earned");
  assert.equal(reward.sent, 1);
  assert.equal(reward.opened, 1);
  assert.equal(report.consent.opted_in, 1);
  assert.equal(report.limits.marketing_max_per_week, 2);
  await as(db, ADMIN, `select public.admin_set_marketing_campaign('reward_earned', true, 'Credits ready', 'Use them for extra scans.', '/app?view=rewards')`);
  assert.equal((await db.query<any>(`select enabled from public.marketing_campaigns where key='reward_earned'`)).rows[0].enabled, true);
  assert.equal((await db.query(`select 1 from public.admin_audit_log where action='marketing_campaign_updated'`)).rows.length, 1);
  // Deep links stay inside the app.
  await assert.rejects(() => as(db, ADMIN, `select public.admin_set_marketing_campaign('reward_earned', true, 't', 'b', 'https://evil.example')`), /check constraint/);
  await db.close();
});
