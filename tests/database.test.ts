import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { as, asService, migratedDb } from "./helpers/db";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d";
const E = "00000000-0000-0000-0000-00000000000e";
const DEVICE_1 = "device-one-0000000000000000000000";
const DEVICE_2 = "device-two-0000000000000000000000";
const req = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function users(db: PGlite, ...ids: string[]) {
  for (const id of ids) await db.exec(`insert into auth.users(id,email) values('${id}','${id.slice(-1)}@example.com')`);
}
const balance = async (db: PGlite, user: string) =>
  Number((await db.query<{ n: number }>(`select coalesce(sum(amount),0)::int n from public.reward_ledger where user_id=$1`, [user])).rows[0].n);
const usage = async (db: PGlite, user: string) =>
  Number((await db.query<{ n: number }>(`select coalesce(sum(ai_scans),0)::int n from public.usage_monthly where user_id=$1`, [user])).rows[0].n);
// Bypasses the short anti-burst windows so sequential test reservations are not treated as repeats.
const age = (db: PGlite) => db.exec(`update public.scan_requests set created_at=created_at-interval '2 hours'; update public.guest_scan_usage set created_at=created_at-interval '2 hours';`);
const reserve = (db: PGlite, user: string, id: string, hash: string, device = DEVICE_1) =>
  asService(db, `select public.reserve_scan($1,$2,$3,$4) pages`, [user, id, hash, device]);
const finish = (db: PGlite, id: string, status: "completed" | "failed", result: unknown = null) =>
  asService(db, `select public.finish_scan($1,$2,0,10,10,0.001,$3)`, [id, status, result === null ? null : JSON.stringify(result)]);

test("full migration chain reproduces production's function surface", async () => {
  const db = await migratedDb();
  const fns = (await db.query<{ f: string }>(
    `select p.proname f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`,
  )).rows.map((r) => r.f);
  for (const name of ["create_planner_reminder", "register_push_subscription", "cancel_planner_reminder", "snooze_planner_reminder",
    "mark_planner_reminder_handled", "claim_due_reminders", "submit_product_feedback", "reserve_scan", "finish_scan",
    "claim_referral_device", "qualify_referral", "reserve_guest_scan"])
    assert.ok(fns.includes(name), name);
  // Only the device-aware reservation remains.
  assert.equal(fns.filter((f) => f === "reserve_scan").length, 1);
  await db.close();
});

test("RLS isolates users and protects privileged data", async () => {
  const db = await migratedDb();
  await users(db, A, B);
  await db.exec(`
    insert into public.scans(id,user_id,payload) values('${req(1)}','${B}','{}');
    insert into public.planner_items(id,user_id,type,title,start_date) values('${req(2)}','${B}','event','Secret','2027-01-01');
    insert into public.reminders(user_id,planner_item_id,kind,scheduled_at) values('${B}','${req(2)}','event',now());
    insert into public.push_subscriptions(user_id,endpoint,keys) values('${B}','https://push.example/abcdefghijklmnop','{}');
    insert into public.reward_ledger(user_id,entry_type,amount,reason) values('${B}','earn',5,'seed');
    insert into public.product_feedback(user_id,rating) values('${B}',4);`);
  for (const table of ["scans", "planner_items", "reminders", "push_subscriptions", "reward_ledger", "product_feedback", "device_accounts", "scan_requests", "guest_scan_usage"]) {
    const rows = await as(db, A, `select * from public.${table}`).catch(() => ({ rows: [] }));
    assert.equal(rows.rows.length, 0, `${table} leaked`);
  }
  await as(db, A, `update public.planner_items set title='x' where id='${req(2)}'`);
  await as(db, A, `delete from public.push_subscriptions`);
  assert.equal((await db.query(`select 1 from public.planner_items where title='Secret'`)).rows.length, 1);
  assert.equal((await db.query(`select 1 from public.push_subscriptions`)).rows.length, 1);
  await assert.rejects(() => as(db, A, `select public.cancel_planner_reminder(id) from public.reminders`).then(async () => {
    const left = await db.query(`select status from public.reminders`);
    if ((left.rows[0] as { status: string }).status !== "pending") throw new Error("foreign reminder changed");
    throw new Error("no-op as expected");
  }), /no-op as expected/);
  await assert.rejects(() => as(db, A, `update public.profiles set plan='business' where id=auth.uid()`));
  await assert.rejects(() => as(db, A, `update public.profiles set is_admin=true where id=auth.uid()`));
  await assert.rejects(() => as(db, A, `insert into public.reward_ledger(user_id,entry_type,amount,reason) values(auth.uid(),'earn',100,'fake')`));
  await assert.rejects(() => as(db, A, `insert into public.product_feedback(user_id,rating) values(auth.uid(),5)`));
  await assert.rejects(() => as(db, A, `insert into public.planner_items(user_id,type,title,start_date) values('${B}','event','foreign','2027-01-01')`));
  await assert.rejects(() => as(db, A, `update public.reward_rules set amount=1000`).then(async () => {
    if ((await db.query(`select 1 from public.reward_rules where amount=1000`)).rows.length) throw new Error("rules changed");
    throw new Error("unchanged");
  }), /unchanged/);
  for (const fn of [`public.reserve_scan('${A}','${req(9)}','h','${DEVICE_1}')`, `public.award_milestone('${A}','first_scan')`,
    `public.finish_scan('${req(9)}','failed',0,0,0,0)`, `public.claim_due_reminders(10)`, `public.qualify_referral('${A}')`,
    `public.reserve_guest_scan('${req(9)}','h','${DEVICE_1}',null)`, `public.get_push_delivery_config()`])
    await assert.rejects(() => as(db, A, `select ${fn}`), Error, fn);
  await assert.rejects(() => as(db, null, `select * from public.scans`));
  await assert.rejects(() => as(db, null, `truncate public.scans`));
  await assert.rejects(() => as(db, A, `truncate public.planner_items`));
  assert.equal((await as(db, null, `select key from public.feature_flags`)).rows.length > 0, true);
  await db.close();
});

test("AI credits: atomic reservation, idempotent ids, refunds on failure, cached retries", async () => {
  const db = await migratedDb();
  await users(db, A);
  await db.exec(`update public.plan_rules set monthly_scans=1 where id='free'; insert into public.reward_ledger(user_id,entry_type,amount,reason) values('${A}','earn',10,'seed');`);
  await reserve(db, A, req(1), "doc-1");
  await assert.rejects(() => reserve(db, A, req(1), "doc-1"), /repeat_request/); // same request id retried
  await assert.rejects(() => reserve(db, A, req(2), "doc-2"), /repeat_request/); // second tab while first is in flight
  await finish(db, req(1), "completed", { events: [] });
  await finish(db, req(1), "failed"); // late duplicate finish is ignored
  assert.equal(await usage(db, A), 1);
  assert.deepEqual((await asService<{ r: unknown }>(db, `select public.cached_scan_result($1,'doc-1',null) r`, [A])).rows[0].r, { events: [] });
  await age(db);
  // Allowance used up: the next scan spends 10 credits; a failure refunds them exactly once.
  await reserve(db, A, req(3), "doc-3");
  assert.equal(await balance(db, A), 1 /* first_scan */ + 10 - 10);
  await finish(db, req(3), "failed");
  await finish(db, req(3), "failed");
  assert.equal(await balance(db, A), 11);
  assert.equal(await usage(db, A), 1);
  await db.exec(`delete from public.reward_ledger where reason='seed'`);
  await age(db);
  await assert.rejects(() => reserve(db, A, req(4), "doc-4"), /allowance_exhausted/);
  // Milestones are once-only.
  await asService(db, `select public.award_milestone($1,'first_scan')`, [A]);
  assert.equal((await db.query(`select 1 from public.reward_ledger where reason='first_scan'`)).rows.length, 1);
  await db.close();
});

test("one device: two free accounts, then no free value; deletion cannot reset it; paid unaffected", async () => {
  const db = await migratedDb();
  await users(db, A, B, C, D);
  await reserve(db, A, req(1), "a"); await age(db);
  await reserve(db, B, req(2), "b"); await age(db);
  await assert.rejects(() => reserve(db, C, req(3), "c"), /device_free_limit/);
  // The third account can still sign in and use Zest; it is simply not free-benefit eligible here.
  await as(db, C, `select public.register_device('${DEVICE_1}')`);
  assert.equal((await db.query<{ e: boolean }>(`select free_benefit_eligible e from public.device_accounts where user_id='${C}'`)).rows[0]?.e, false);
  // Ineligible accounts do not earn promotional credits.
  await asService(db, `select public.award_milestone($1,'first_planner_item')`, [C]);
  assert.equal(await balance(db, C), 0);
  // Deleting an eligible account does not free a slot.
  await db.exec(`delete from auth.users where id='${A}'`);
  await age(db);
  await assert.rejects(() => reserve(db, D, req(4), "d"), /device_free_limit/);
  // A paying customer sharing the device keeps their plan allowance.
  await db.exec(`update public.plan_rules set active=true where id='plus'; update public.profiles set plan='plus' where id='${C}'`);
  await reserve(db, C, req(5), "c2");
  // Per-device hourly cap protects AI spend across accounts.
  await db.exec(`update public.app_limits set value=1 where key='device_scans_per_hour'`);
  await db.exec(`update public.scan_requests set created_at=now()-interval '30 minutes'`);
  await assert.rejects(() => reserve(db, C, req(6), "c3"), /device_rate_limited/);
  await db.close();
});

test("honest feedback earns the same reward once, whatever the rating", async () => {
  const db = await migratedDb();
  await users(db, A, B, C, D);
  assert.equal(Number((await as(db, A, `select public.submit_product_feedback(1,'Too slow') r`)).rows[0].r), 2);
  assert.equal(Number((await as(db, A, `select public.submit_product_feedback(5,'Love it') r`)).rows[0].r), 0);
  assert.equal(Number((await as(db, B, `select public.submit_product_feedback(5,null) r`)).rows[0].r), 2);
  assert.equal(await balance(db, A), 2);
  await assert.rejects(() => as(db, C, `select public.submit_product_feedback(null,'   ')`), /feedback_required/);
  await assert.rejects(() => as(db, C, `select public.submit_product_feedback(9,'x')`), /invalid_rating/);
  await assert.rejects(() => as(db, null, `select public.submit_product_feedback(3,'x')`));
  // Third account on an exhausted device: feedback is stored but earns nothing.
  for (const u of [A, B, D]) await as(db, u, `select public.register_device('${DEVICE_1}')`);
  assert.equal(Number((await as(db, D, `select public.submit_product_feedback(3,'ok') r`)).rows[0].r), 0);
  await db.close();
});

test("referrals: qualified, once, no self/same-device/loops, many invitees per code, monthly cap", async () => {
  const db = await migratedDb();
  await users(db, A, B, C, D, E);
  const code = String((await as(db, A, `select public.create_referral() c`)).rows[0].c);
  await as(db, A, `select public.register_device('${DEVICE_1}')`);
  await assert.rejects(() => as(db, A, `select public.claim_referral_device($1,'${DEVICE_2}')`, [code]), /invalid_referral/);
  await assert.rejects(() => as(db, B, `select public.claim_referral_device($1,'${DEVICE_1}')`, [code]), /same_device_referral/);
  await as(db, C, `select public.claim_referral_device($1,'${DEVICE_2}')`, [code]);
  await as(db, D, `select public.claim_referral_device($1,'${DEVICE_2}-d')`, [code]); // same code, second invitee
  await as(db, C, `select public.claim_referral_device($1,'${DEVICE_2}')`, [code]); // repeat is a no-op
  assert.equal((await db.query(`select 1 from public.referrals where referrer_id='${A}'`)).rows.length, 2);
  // A referrer cannot then be "referred" by their own invitee.
  const codeC = String((await as(db, C, `select public.create_referral() c`)).rows[0].c);
  await assert.rejects(() => as(db, A, `select public.claim_referral_device($1,'${DEVICE_1}')`, [codeC]), /invalid_referral/);
  // Opening a link or signing up earns nothing; a completed metered scan qualifies once.
  assert.equal(await balance(db, A), 0);
  await reserve(db, C, req(1), "c", `${DEVICE_2}`); await finish(db, req(1), "completed");
  await age(db);
  await reserve(db, C, req(2), "c2", `${DEVICE_2}`); await finish(db, req(2), "completed");
  assert.equal((await db.query(`select 1 from public.reward_ledger where user_id='${A}' and reason='referral_qualified'`)).rows.length, 1);
  await db.exec(`update public.app_limits set value=1 where key='referral_rewards_per_referrer_month'`);
  await reserve(db, D, req(3), "d", `${DEVICE_2}-d`); await finish(db, req(3), "completed");
  assert.equal((await db.query(`select 1 from public.reward_ledger where user_id='${A}' and reason='referral_qualified'`)).rows.length, 1);
  // Accounts with prior activity cannot be retro-referred.
  await assert.rejects(() => as(db, C, `select public.claim_referral_device($1,'${DEVICE_2}')`, [code]).then(() =>
    as(db, E, `select 1`)).then(() => reserve(db, E, req(4), "e", "device-e-000000000000000000")).then(() =>
    as(db, E, `select public.claim_referral_device($1,'device-e-000000000000000000')`, [code])), /existing_account_activity/);
  await db.close();
});

test("signed-out trial is device- and network-limited and failures do not count", async () => {
  const db = await migratedDb();
  const guest = (id: string, hash: string, device = DEVICE_1, net: string | null = "net-1") =>
    asService<{ r: Record<string, unknown> }>(db, `select public.reserve_guest_scan($1,$2,$3,$4) r`, [id, hash, device, net]);
  await guest(req(1), "g1");
  await asService(db, `select public.finish_guest_scan($1,'failed')`, [req(1)]);
  await age(db);
  await guest(req(2), "g2"); await asService(db, `select public.finish_guest_scan($1,'completed','{"events":[]}')`, [req(2)]);
  await age(db);
  assert.deepEqual((await guest(req(3), "g2")).rows[0].r, { cached: { events: [] } }); // identical file: no new AI call
  await guest(req(4), "g4"); await asService(db, `select public.finish_guest_scan($1,'completed')`, [req(4)]);
  await age(db);
  await assert.rejects(() => guest(req(5), "g5"), /guest_trial_exhausted/);
  await db.exec(`update public.app_limits set value=1 where key='guest_scans_per_network_day'; update public.guest_scan_usage set created_at=now()-interval '1 hour'`);
  await assert.rejects(() => guest(req(6), "g6", DEVICE_2, "net-1"), /guest_trial_exhausted/);
  await guest(req(7), "g7", DEVICE_2, "net-2");
  await db.exec(`update public.feature_flags set enabled=false where key='guest_trial'`);
  await assert.rejects(() => guest(req(8), "g8", "device-three-000000000000000"), /sign_in_required/);
  await db.close();
});

test("reminder claiming skips cancelled items and completed tasks; retention runs server-side", async () => {
  const db = await migratedDb();
  await users(db, A);
  await db.exec(`
    insert into public.planner_items(id,user_id,type,title,start_date,due_date,status) values
      ('${req(1)}','${A}','event','Live','2027-01-01',null,'open'),
      ('${req(2)}','${A}','event','Gone','2027-01-01',null,'cancelled'),
      ('${req(3)}','${A}','task','Done',null,'2027-01-01','completed');
    insert into public.reminders(user_id,planner_item_id,kind,scheduled_at) values
      ('${A}','${req(1)}','event',now()-interval '1 minute'),('${A}','${req(2)}','event',now()-interval '1 minute'),('${A}','${req(3)}','event',now()-interval '1 minute');`);
  const claimed = await asService(db, `select * from public.claim_due_reminders(10)`);
  assert.equal(claimed.rows.length, 1);
  assert.deepEqual((await db.query(`select status from public.reminders order by status`)).rows.map((r) => (r as { status: string }).status), ["cancelled", "handled", "processing"]);
  await db.exec(`
    update public.profiles set preferences='{"retentionDays":30}' where id='${A}';
    insert into public.scans(id,user_id,payload,created_at) values('${req(8)}','${A}','{}',now()-interval '40 days'),('${req(9)}','${A}','{}',now()-interval '5 days');
    select private.enforce_retention();`);
  assert.deepEqual((await db.query(`select id from public.scans`)).rows.map((r) => (r as { id: string }).id), [req(9)]);
  await db.close();
});
