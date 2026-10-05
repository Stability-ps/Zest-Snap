import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { as, migratedDb } from "./helpers/db";
import { exportDefs } from "../lib/admin/exports";

const OWNER = "00000000-0000-0000-0000-0000000000a1";
const ADMIN = "00000000-0000-0000-0000-0000000000a2";
const SUPPORT = "00000000-0000-0000-0000-0000000000a3";
const ANALYST = "00000000-0000-0000-0000-0000000000a4";
const USER = "00000000-0000-0000-0000-0000000000b1";
const USER2 = "00000000-0000-0000-0000-0000000000b2";
const FROM = "2025-06-01T00:00:00Z";
const TO = "2027-06-01T00:00:00Z";

type Row = Record<string, any>;
const one = async (db: PGlite, who: string | null, sql: string, params: unknown[] = []) =>
  ((await as<Row>(db, who, sql, params)).rows[0] || {}) as Row;
const call = async (db: PGlite, who: string | null, fn: string, args: unknown[] = []) => {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(",");
  return (await one(db, who, `select public.${fn}(${placeholders}) r`, args)).r;
};

async function seed() {
  const db = await migratedDb();
  // The seeded owner is matched by e-mail, exactly as in production.
  await db.exec(`insert into auth.users(id,email) values
    ('${OWNER}','sandisops@gmail.com'),('${ADMIN}','admin@example.com'),('${SUPPORT}','support@example.com'),
    ('${ANALYST}','analyst@example.com'),('${USER}','user@example.com'),('${USER2}','second@example.com')
    on conflict do nothing;
    insert into public.profiles(id,display_name) values ('${OWNER}','Owner'),('${ADMIN}','Admin'),('${SUPPORT}','Support'),
      ('${ANALYST}','Analyst'),('${USER}','Regular User'),('${USER2}','Second') on conflict (id) do update set display_name = excluded.display_name;
    update public.profiles set is_admin = true where id in ('${OWNER}','${ADMIN}','${SUPPORT}','${ANALYST}');
    insert into public.admin_roles(user_id, role) values ('${OWNER}','owner'),('${ADMIN}','admin'),('${SUPPORT}','support'),('${ANALYST}','analyst')
      on conflict (user_id) do update set role = excluded.role;`);
  return db;
}

test("migration seeds the existing owner and keeps plan prices in sync with the marketing defaults", async () => {
  const db = await migratedDb();
  await db.exec(`insert into auth.users(id,email) values ('${OWNER}','SandisOps@gmail.com'),('${ADMIN}','x@example.com') on conflict do nothing;
    insert into public.profiles(id) values ('${OWNER}'),('${ADMIN}') on conflict do nothing;
    update public.profiles set is_admin = true;`);
  // Re-run the role seed exactly as written in the migration.
  await db.exec(`insert into public.admin_roles(user_id, role)
    select p.id, case when lower(u.email) = 'sandisops@gmail.com' then 'owner' else 'admin' end
      from public.profiles p join auth.users u on u.id = p.id where p.is_admin on conflict (user_id) do nothing;`);
  const roles = (await db.query<Row>(`select user_id, role from public.admin_roles order by role desc`)).rows;
  assert.deepEqual(roles.map((r) => r.role).sort(), ["admin", "owner"]);
  const plans = (await db.query<Row>(`select id, name, monthly_price::float price, monthly_scans, pdf_pages from public.plan_rules order by display_order`)).rows;
  assert.deepEqual(plans.map((p) => [p.id, p.price]), [["free", 0], ["plus", 4.99], ["business", 11.99]]);
  await db.close();
});

test("ordinary users cannot call any admin function or read admin tables", async () => {
  const db = await seed();
  const fns = (await db.query<Row>(`select p.proname, p.pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\\_%'`)).rows;
  assert.ok(fns.length >= 35, `expected the admin surface, got ${fns.length}`);
  for (const f of fns) {
    const args = Array.from({ length: f.pronargs }, () => "null").join(",");
    await assert.rejects(() => as(db, USER, `select public.${f.proname}(${args})`), /forbidden|permission/, f.proname);
    await assert.rejects(() => as(db, null, `select public.${f.proname}(${args})`), /forbidden|permission/, `anon ${f.proname}`);
  }
  for (const table of ["admin_audit_log", "admin_roles", "payment_transactions", "user_activity_daily", "user_report_notes"]) {
    assert.equal((await as(db, USER, `select * from public.${table}`)).rows.length, 0, `${table} leaked`);
  }
  // Private bodies are not reachable directly by anonymous callers, and the audit writer is unreachable for everyone.
  await assert.rejects(() => as(db, USER, `select private.audit('x','y','z',null,null)`));
  await assert.rejects(() => as(db, OWNER, `select private.audit('x','y','z',null,null)`));
  await assert.rejects(() => as(db, USER, `insert into public.admin_audit_log(action, object_type) values ('fake','x')`));
  await assert.rejects(() => as(db, USER, `update public.profiles set is_admin = true where id = auth.uid()`));
  await assert.rejects(() => as(db, USER, `insert into public.admin_roles(user_id, role) values (auth.uid(), 'owner')`));
  await db.close();
});

test("every admin read function runs for an admin and returns real (not invented) values", async () => {
  const db = await seed();
  await db.exec(`insert into public.scan_requests(id,user_id,content_hash,status,created_at,mime_type,event_count,duration_ms)
      values ('10000000-0000-0000-0000-000000000001','${USER}','h1','completed',now() - interval '1 day','application/pdf',3,1200),
             ('10000000-0000-0000-0000-000000000002','${USER}','h2','failed',now() - interval '40 days','image/jpeg',null,800);
    update public.scan_requests set error_code = 'ai_timeout' where status = 'failed';
    insert into public.planner_items(user_id,type,title,start_date) values ('${USER}','event','Dentist','2030-01-01');
    insert into public.product_feedback(user_id,rating,feedback) values ('${USER}',4,'Love it');`);
  const reads: [string, unknown[]][] = [
    ["admin_me", []], ["admin_overview", [FROM, TO]], ["admin_timeseries", ["2026-01-01", "2026-03-01", "week"]],
    ["admin_attention", []], ["admin_users", [null, null, "created_desc", 25, 0]], ["admin_user_detail", [USER]],
    ["admin_search", ["user@"]], ["admin_scans", [FROM, TO, null, null, null, null, 50, 0, null]], ["admin_usage", [FROM, TO]],
    ["admin_ai", [FROM, TO]], ["admin_revenue", [FROM, TO]], ["admin_transactions", [FROM, TO, null, null, null, 50, 0]],
    ["admin_subscriptions", [null, null, 50, 0]], ["admin_feedback", [FROM, TO, null, null, null, null, 50, 0]],
    ["admin_referrals", [FROM, TO, null, 50, 0]], ["admin_rewards", [FROM, TO]], ["admin_tickets", [null, null, null, null, false, 50, 0]],
    ["admin_reports", [null, null, null, null, 50, 0]], ["admin_audit", [null, null, null, null, 50, 0]], ["admin_admins", []],
    ["admin_health", []], ["admin_config", []],
  ];
  for (const [fn, args] of reads) {
    for (const who of [OWNER, ANALYST, SUPPORT]) await call(db, who, fn, args);
  }
  const overview = await call(db, ADMIN, "admin_overview", [FROM, TO]);
  assert.equal(Number(overview.users_total), 6);
  assert.equal(Number(overview.scans_total), 2);
  assert.equal(Number(overview.rating_count), 1);
  assert.equal(overview.payments_connected, false, "no payment provider → revenue must read as not connected");
  assert.equal(overview.mrr, null);
  assert.equal(overview.revenue_month, null);
  const me = await call(db, ANALYST, "admin_me");
  assert.equal(me.role, "analyst");
  const admins = await call(db, OWNER, "admin_admins");
  assert.equal(admins.length, 4);
  await db.close();
});

test("analytics respect the requested date range", async () => {
  const db = await seed();
  await db.exec(`insert into public.scan_requests(id,user_id,content_hash,status,created_at) values
    ('10000000-0000-0000-0000-000000000011','${USER}','a','completed','2026-02-03T10:00:00Z'),
    ('10000000-0000-0000-0000-000000000012','${USER}','b','failed','2026-02-04T10:00:00Z'),
    ('10000000-0000-0000-0000-000000000013','${USER}','c','completed','2026-03-10T10:00:00Z');`);
  const feb = await call(db, OWNER, "admin_overview", ["2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"]);
  assert.equal(Number(feb.scans_period), 2);
  assert.equal(Number(feb.scans_failed_period), 1);
  assert.equal(Number(feb.active_period), 1);
  const march = await call(db, OWNER, "admin_overview", ["2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z"]);
  assert.equal(Number(march.scans_period), 1);
  assert.equal(Number(march.scans_prev), 2, "previous comparable period");
  const series = await call(db, OWNER, "admin_timeseries", ["2026-02-01T00:00:00Z", "2026-02-08T00:00:00Z", "day"]);
  assert.equal(series.length, 7);
  assert.deepEqual(series.map((d: Row) => Number(d.scans_ok) + Number(d.scans_failed)), [0, 0, 1, 1, 0, 0, 0]);
  const scans = await call(db, OWNER, "admin_scans", ["2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z", "failed", null, null, null, 50, 0, null]);
  assert.equal(Number(scans.total), 1);
  const single = await call(db, OWNER, "admin_scans", [FROM, TO, null, null, null, null, 50, 0, "10000000-0000-0000-0000-000000000013"]);
  assert.deepEqual(single.rows.map((r: Row) => r.id), ["10000000-0000-0000-0000-000000000013"]);
  await assert.rejects(() => call(db, OWNER, "admin_overview", ["2026-03-01T00:00:00Z", "2026-02-01T00:00:00Z"]), /invalid_range/);
  await db.close();
});

test("user search finds people by name, e-mail and id", async () => {
  const db = await seed();
  const byEmail = await call(db, OWNER, "admin_users", ["second@", null, "created_desc", 25, 0]);
  assert.equal(Number(byEmail.total), 1);
  assert.equal(byEmail.rows[0].id, USER2);
  const byName = await call(db, SUPPORT, "admin_users", ["regular", null, "created_desc", 25, 0]);
  assert.equal(byName.rows[0].email, "user@example.com");
  const byId = await call(db, OWNER, "admin_users", [USER, null, "created_desc", 25, 0]);
  assert.equal(Number(byId.total), 1);
  const admins = await call(db, OWNER, "admin_users", [null, "admins", "name", 25, 0]);
  assert.equal(Number(admins.total), 4);
  const search = await call(db, OWNER, "admin_search", ["second"]);
  assert.equal(search.users.length, 1);
  // Never exposes credentials.
  const detail = JSON.stringify(await call(db, OWNER, "admin_user_detail", [USER]));
  assert.doesNotMatch(detail, /password|access_token|refresh_token|encrypted/i);
  await db.close();
});

test("plan updates validate, enforce owner-only pricing and are audited", async () => {
  const db = await seed();
  const saved = await call(db, ADMIN, "admin_update_plan", ["plus", JSON.stringify({ monthly_scans: 150, pdf_pages: 25, name: "Zest Snap+" })]);
  assert.equal(saved.monthly_scans, 150);
  await assert.rejects(() => call(db, ADMIN, "admin_update_plan", ["plus", JSON.stringify({ monthly_price: 9.99 })]), /forbidden_role/);
  await assert.rejects(() => call(db, SUPPORT, "admin_update_plan", ["plus", JSON.stringify({ monthly_scans: 1 })]), /forbidden_role/);
  const priced = await call(db, OWNER, "admin_update_plan", ["plus", JSON.stringify({ monthly_price: 5.99, recommended: true })]);
  assert.equal(Number(priced.monthly_price), 5.99);
  await assert.rejects(() => call(db, OWNER, "admin_update_plan", ["plus", JSON.stringify({ monthly_scans: -1 })]), /invalid_plan/);
  await assert.rejects(() => call(db, OWNER, "admin_update_plan", ["plus", JSON.stringify({ is_admin: true })]), /invalid_field/);
  await assert.rejects(() => call(db, OWNER, "admin_update_plan", ["free", JSON.stringify({ monthly_price: 1 })]), /free_plan_must_stay_free/);
  // Deactivating a plan that people are on would block their scans (reserve_scan requires an active plan).
  await assert.rejects(() => call(db, OWNER, "admin_update_plan", ["free", JSON.stringify({ active: false })]), /free_plan_must_stay_free/);
  await db.exec(`update public.plan_rules set active = true where id = 'business'; update public.profiles set plan = 'business' where id = '${USER2}'`);
  await assert.rejects(() => call(db, OWNER, "admin_update_plan", ["business", JSON.stringify({ active: false })]), /plan_in_use/);
  const audit = (await db.query<Row>(`select action, before->>'monthly_scans' b, after->>'monthly_scans' a, admin_email from public.admin_audit_log where object_type = 'plan' order by id`)).rows;
  assert.equal(audit.length, 2);
  assert.deepEqual([audit[0].action, audit[0].b, audit[0].a, audit[0].admin_email], ["plan.update", "100", "150", "admin@example.com"]);
  // Only one plan can be recommended.
  assert.equal(Number((await db.query<Row>(`select count(*) n from public.plan_rules where recommended`)).rows[0].n), 1);
  // Public pricing is readable without a session; hidden plans are not.
  await call(db, OWNER, "admin_update_plan", ["business", JSON.stringify({ is_public: false })]);
  const anon = (await as<Row>(db, null, `select id from public.plan_rules order by id`)).rows.map((r) => r.id);
  assert.deepEqual(anon, ["free", "plus"]);
  await db.close();
});

test("feature flag changes are audited and high-impact flags need the owner", async () => {
  const db = await seed();
  await call(db, ADMIN, "admin_set_flag", ["referrals", false]);
  assert.equal((await db.query<Row>(`select enabled from public.feature_flags where key = 'referrals'`)).rows[0].enabled, false);
  await assert.rejects(() => call(db, ADMIN, "admin_set_flag", ["ai_scanning", false]), /forbidden_role/);
  await assert.rejects(() => call(db, ANALYST, "admin_set_flag", ["referrals", true]), /forbidden_role/);
  await call(db, OWNER, "admin_set_flag", ["ai_scanning", false]);
  await assert.rejects(() => call(db, OWNER, "admin_set_flag", ["does_not_exist", true]), /not_found/);
  const log = (await db.query<Row>(`select object_id, before, after from public.admin_audit_log where action = 'flag.update' order by id`)).rows;
  assert.deepEqual(log.map((l) => [l.object_id, l.before.enabled, l.after.enabled]), [["referrals", true, false], ["ai_scanning", true, false]]);
  await db.close();
});

test("credit adjustments, plan changes and account status are validated and audited", async () => {
  const db = await seed();
  assert.equal((await call(db, ADMIN, "admin_adjust_credits", [USER, 25, "Goodwill for outage"])).balance, 25);
  assert.equal((await call(db, ADMIN, "admin_adjust_credits", [USER, -5, "Correction"])).balance, 20);
  await assert.rejects(() => call(db, ADMIN, "admin_adjust_credits", [USER, -50, "Too much"]), /insufficient_balance/);
  await assert.rejects(() => call(db, ADMIN, "admin_adjust_credits", [USER, 5, ""]), /reason_required/);
  await assert.rejects(() => call(db, SUPPORT, "admin_adjust_credits", [USER, 5, "Nope"]), /forbidden_role/);
  // Inactive plans are refused because scanning requires an active plan.
  await assert.rejects(() => call(db, ADMIN, "admin_set_user_plan", [USER, "plus", "Comp upgrade"]), /plan_unavailable/);
  await db.exec(`update public.plan_rules set active = true where id = 'plus'`);
  assert.equal((await call(db, ADMIN, "admin_set_user_plan", [USER, "plus", "Comp upgrade"])).plan, "plus");
  await call(db, ADMIN, "admin_set_account_status", [USER, "disabled", "Abuse report"]);
  assert.equal((await db.query<Row>(`select account_status from public.profiles where id = '${USER}'`)).rows[0].account_status, "disabled");
  await assert.rejects(() => call(db, ADMIN, "admin_set_account_status", [ADMIN, "disabled", "Self"]), /cannot_change_self/);
  await assert.rejects(() => call(db, OWNER, "admin_set_account_status", [ADMIN, "disabled", "Admin"]), /cannot_disable_admin/);
  await call(db, SUPPORT, "admin_set_support_flag", [USER, true, "VIP"]);
  const actions = (await db.query<Row>(`select action from public.admin_audit_log where object_id = '${USER}' order by id`)).rows.map((r) => r.action);
  assert.deepEqual(actions, ["credits.adjust", "credits.adjust", "user.plan_change", "user.status_change", "user.support_flag"]);
  const ledger = (await db.query<Row>(`select sum(amount)::int n from public.reward_ledger where user_id = '${USER}'`)).rows[0].n;
  assert.equal(ledger, 20);
  await db.close();
});

test("only owners manage admins and the last owner cannot be removed", async () => {
  const db = await seed();
  await assert.rejects(() => call(db, ADMIN, "admin_grant_role", ["user@example.com", "support"]), /forbidden_role/);
  await call(db, OWNER, "admin_grant_role", ["user@example.com", "support"]);
  assert.equal((await call(db, USER, "admin_me")).role, "support");
  await call(db, OWNER, "admin_revoke_role", [USER]);
  await assert.rejects(() => call(db, USER, "admin_me"), /forbidden/);
  await assert.rejects(() => call(db, OWNER, "admin_revoke_role", [OWNER]), /cannot_change_self/);
  await assert.rejects(() => call(db, OWNER, "admin_grant_role", ["sandisops@gmail.com", "admin"]), /last_owner/);
  await assert.rejects(() => call(db, OWNER, "admin_grant_role", ["nobody@example.com", "admin"]), /user_not_found/);
  assert.equal((await db.query<Row>(`select is_admin from public.profiles where id = '${OWNER}'`)).rows[0].is_admin, true);
  await db.close();
});

test("support ticket workflow: user creates, admin replies, internal notes stay private", async () => {
  const db = await seed();
  const created = await one(db, USER, `select public.create_support_ticket('Scan failed', 'scan', 'My PDF did not scan', '{"route":"/app","appVersion":"abc"}'::jsonb) r`);
  const id = created.r.id;
  assert.ok(Number(created.r.number) >= 1001);
  await assert.rejects(() => as(db, null, `select public.create_support_ticket('x','other','y')`));
  await call(db, SUPPORT, "admin_ticket_reply", [id, "Can you send the file name?", false]);
  await call(db, SUPPORT, "admin_ticket_reply", [id, "Probably an encrypted PDF", true]);
  let t = (await call(db, OWNER, "admin_ticket", [id])).ticket;
  assert.equal(t.status, "waiting");
  assert.ok(t.first_response_at);
  // The user sees staff replies but never internal notes, and cannot see someone else's ticket.
  const visible = (await as<Row>(db, USER, `select body from public.support_messages order by created_at`)).rows.map((r) => r.body);
  assert.deepEqual(visible, ["My PDF did not scan", "Can you send the file name?"]);
  assert.equal((await as(db, USER2, `select * from public.support_tickets`)).rows.length, 0);
  await one(db, USER, `select public.reply_support_ticket($1, 'It is invoice.pdf') r`, [id]);
  t = (await call(db, OWNER, "admin_ticket", [id])).ticket;
  assert.equal(t.status, "open");
  await call(db, SUPPORT, "admin_ticket_update", [id, JSON.stringify({ status: "resolved", priority: "high", tags: ["pdf"], assignee_id: SUPPORT })]);
  t = (await call(db, OWNER, "admin_ticket", [id])).ticket;
  assert.equal(t.status, "resolved");
  assert.ok(t.resolved_at);
  await assert.rejects(() => call(db, ANALYST, "admin_ticket_reply", [id, "x", false]), /forbidden_role/);
  await assert.rejects(() => call(db, SUPPORT, "admin_ticket_update", [id, JSON.stringify({ user_id: USER2 })]), /invalid_field/);
  await assert.rejects(() => call(db, SUPPORT, "admin_ticket_update", [id, JSON.stringify({ assignee_id: USER2 })]), /invalid_assignee/);
  const list = await call(db, OWNER, "admin_tickets", [null, null, null, "pdf", false, 50, 0]);
  assert.equal(Number(list.total), 1);
  const audit = (await db.query<Row>(`select action from public.admin_audit_log where object_type = 'ticket' order by id`)).rows.map((r) => r.action);
  assert.deepEqual(audit, ["support.reply", "support.note", "support.update"]);
  // Message bodies are not copied into the audit log.
  assert.equal((await db.query(`select 1 from public.admin_audit_log where after::text like '%send the file%'`)).rows.length, 0);
  await db.close();
});

test("problem reports and feedback triage", async () => {
  const db = await seed();
  const r = (await one(db, USER, `select public.submit_user_report('incorrect_extraction', 'Wrong date', jsonb_build_object('requestId','10000000-0000-0000-0000-000000000001','route','/app')) r`)).r;
  await call(db, SUPPORT, "admin_report_note", [r.id, "Reproduced"]);
  const detail = await call(db, OWNER, "admin_report", [r.id]);
  assert.equal(detail.report.status, "triaged");
  assert.equal(detail.notes.length, 1);
  assert.equal((await as(db, USER, `select * from public.user_report_notes`)).rows.length, 0);
  await call(db, SUPPORT, "admin_report_update", [r.id, JSON.stringify({ status: "resolved" })]);
  assert.ok((await call(db, OWNER, "admin_report", [r.id])).report.resolved_at);

  await db.exec(`insert into public.product_feedback(user_id,rating,feedback) values ('${USER}',2,'Too slow'),('${USER2}',5,'Great')`);
  const fb = await call(db, OWNER, "admin_feedback", [FROM, TO, null, null, null, null, 50, 0]);
  assert.equal(Number(fb.period.count), 2);
  assert.equal(Number(fb.period.avg), 3.5);
  assert.equal(Number(fb.distribution["2"]), 1);
  const low = await call(db, OWNER, "admin_feedback", [FROM, TO, 2, null, null, null, 50, 0]);
  assert.equal(low.rows[0].feedback, "Too slow");
  await call(db, SUPPORT, "admin_feedback_update", [low.rows[0].id, "planned", "Speed work queued"]);
  assert.equal((await call(db, OWNER, "admin_feedback", [FROM, TO, null, "planned", null, null, 50, 0])).rows.length, 1);
  await db.close();
});

test("CSV export rows are paged by keyset, gated by role and audited", async () => {
  const db = await seed();
  for (let i = 0; i < 5; i++)
    await db.exec(`insert into public.reward_ledger(user_id,entry_type,amount,reason,created_at) values ('${USER}','earn',${i + 1},'seed${i}', now() - interval '${i} hours')`);
  const page1 = await call(db, ANALYST, "admin_export", ["rewards", FROM, TO, null, null, 2]);
  assert.equal(page1.length, 2);
  const last = page1[1];
  const page2 = await call(db, ANALYST, "admin_export", ["rewards", FROM, TO, last.at_, last.id_, 2]);
  const page3 = await call(db, ANALYST, "admin_export", ["rewards", FROM, TO, page2[1].at_, page2[1].id_, 2]);
  const ids = [...page1, ...page2, ...page3].map((r: Row) => r.id_);
  assert.equal(new Set(ids).size, 5);
  assert.equal((await db.query<Row>(`select count(*)::int n from public.admin_audit_log where action = 'export.download'`)).rows[0].n, 1, "later pages are not re-audited");
  for (const dataset of ["users", "activity", "scans", "usage", "revenue", "transactions", "failed_payments", "refunds", "subscriptions",
    "referrals", "ratings", "tickets", "reports", "audit"])
    assert.ok(Array.isArray(await call(db, OWNER, "admin_export", [dataset, FROM, TO, null, null, 10])), dataset);
  await assert.rejects(() => call(db, OWNER, "admin_export", ["passwords", FROM, TO, null, null, 10]), /invalid_dataset/);
  // Every CSV column the export page promises exists on the rows the database returns.
  await db.exec(`insert into public.scan_requests(id,user_id,content_hash,status) values ('10000000-0000-0000-0000-000000000099','${USER}','x','completed');
    insert into public.referrals(referrer_id,referred_user_id,referral_code,status) values ('${USER}','${USER2}','CODE1','signed_up');
    insert into public.product_feedback(user_id,rating,feedback) values ('${USER2}',5,'Nice');
    insert into public.user_activity_daily(user_id,day) values ('${USER}', current_date);
    insert into public.usage_monthly(user_id,period_start,ai_scans) values ('${USER}', date_trunc('month', now())::date, 1);
    insert into public.subscriptions(user_id,plan,status,provider) values ('${USER2}','plus','active','test');
    insert into public.payment_transactions(user_id,provider,provider_ref,kind,status,amount_cents,currency) values
      ('${USER2}','test','ch_1','charge','succeeded',499,'USD'),('${USER2}','test','ch_2','charge','failed',499,'USD'),('${USER2}','test','re_1','refund','succeeded',100,'USD');`);
  await one(db, USER, `select public.create_support_ticket('Hi','other','Help') r`);
  await one(db, USER, `select public.submit_user_report('bug','Broken') r`);
  for (const def of exportDefs.filter((d) => d.key !== "revenue_summary")) {
    const rows = await call(db, OWNER, "admin_export", [def.key, FROM, TO, null, null, 10]);
    assert.ok(rows.length > 0, `${def.key} returned no rows`);
    for (const col of def.columns) assert.ok(col in rows[0], `${def.key} is missing column ${col}`);
  }
  await assert.rejects(() => call(db, SUPPORT, "admin_export", ["users", FROM, TO, null, null, 10]), /forbidden_role/);
  const audited = (await db.query<Row>(`select count(*)::int n from public.admin_audit_log where action = 'export.download'`)).rows[0].n;
  assert.ok(audited >= 15, "first page of each export is audited");

  await db.close();
});

test("activity is recorded per day and announcements reach only their audience", async () => {
  const db = await seed();
  await one(db, USER, `select public.record_activity() r`);
  await one(db, USER, `select public.record_activity() r`);
  const act = (await db.query<Row>(`select hits from public.user_activity_daily where user_id = '${USER}'`)).rows;
  assert.deepEqual(act.map((a) => a.hits), [2]);
  assert.equal((await call(db, OWNER, "admin_overview", [FROM, TO])).active_today, 1);

  const a = await call(db, ADMIN, "admin_save_announcement", [null, JSON.stringify({ title: "Plus is here", body: "Try it", audience: "plus" })]);
  assert.equal((await as(db, USER, `select * from public.announcements`)).rows.length, 0, "drafts are never visible");
  await call(db, ADMIN, "admin_set_announcement_status", [a.id, "published"]);
  assert.equal((await as(db, USER, `select * from public.announcements`)).rows.length, 0, "free user is outside the plus audience");
  await db.exec(`update public.profiles set plan = 'plus' where id = '${USER}'`);
  assert.equal((await as(db, USER, `select * from public.announcements`)).rows.length, 1);
  await assert.rejects(() => as(db, USER, `insert into public.announcements(title, body) values ('x','y')`));
  await db.close();
});

test("content, limits and reward rules are editable only through audited functions", async () => {
  const db = await seed();
  await call(db, ADMIN, "admin_save_content", ["welcome_email", "Hello"]);
  await assert.rejects(() => call(db, ADMIN, "admin_save_content", ["Bad Key", "x"]), /invalid_content/);
  await call(db, ADMIN, "admin_delete_content", ["welcome_email"]);
  await assert.rejects(() => call(db, ADMIN, "admin_update_limit", ["device_scans_per_hour", 30]), /forbidden_role/);
  await call(db, OWNER, "admin_update_limit", ["device_scans_per_hour", 30]);
  const rule = await call(db, ADMIN, "admin_update_reward_rule", ["first_scan", 2, true, "First scan bonus"]);
  assert.equal(rule.amount, 2);
  assert.equal(rule.label, "First scan bonus");
  await assert.rejects(() => call(db, ADMIN, "admin_update_reward_rule", ["first_scan", 5000, true, null]), /invalid_rule/);
  const actions = (await db.query<Row>(`select action from public.admin_audit_log order by id`)).rows.map((r) => r.action);
  assert.deepEqual(actions, ["content.save", "content.delete", "limit.update", "reward_rule.update"]);
  await db.close();
});

test("native platform analytics: activity carries platform and version; admins see the breakdown", async () => {
  const db = await seed();
  await one(db, USER, `select public.record_activity('ios', 'ios 1.0.0 (1) · web abc1234') r`);
  await one(db, USER2, `select public.record_activity('android', 'android 1.0.0 (1)') r`);
  await one(db, USER2, `select public.record_activity() r`);
  await one(db, USER, `select public.record_activity('toaster', 'x') r`);
  const rows = (await db.query<Row>(`select user_id, platform, app_version from public.user_activity_daily order by platform`)).rows;
  assert.deepEqual(rows.map((r) => r.platform), ["android", "ios"], "unknown platforms never overwrite a recorded one");
  const out = await call(db, ANALYST, "admin_platforms", [FROM, TO]);
  assert.deepEqual(out.active_by_platform, { android: 1, ios: 1 });
  await assert.rejects(() => call(db, USER, "admin_platforms", [FROM, TO]), /forbidden/);
  await db.close();
});

test("admin user detail works with the OAuth-token calendar table and never exposes tokens", async () => {
  const db = await seed();
  await db.exec(`drop table public.calendar_connections cascade;
    create table public.calendar_connections (user_id uuid not null references auth.users(id) on delete cascade, provider text not null,
      access_token text not null, refresh_token text, expires_at timestamptz, scope text, calendar_id text default 'primary', calendar_email text,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id, provider));
    insert into public.calendar_connections(user_id, provider, access_token, refresh_token) values ('${USER}', 'google', 'SECRET-ACCESS', 'SECRET-REFRESH');`);
  const detail = await call(db, OWNER, "admin_user_detail", [USER]);
  assert.equal(detail.calendar.length, 1);
  assert.equal(detail.calendar[0].provider, "google");
  assert.ok(detail.calendar[0].connected_at);
  assert.doesNotMatch(JSON.stringify(detail), /SECRET-/);
  for (const fn of ["admin_overview", "admin_usage"]) await call(db, OWNER, fn, [FROM, TO]);
  await call(db, OWNER, "admin_users", [null, "calendar", "created_desc", 25, 0]);
  await db.close();
});

test("reminders armed on a native device are recorded as delivered on the device, not failed", async () => {
  const db = await seed();
  await db.exec(`insert into public.planner_items(id,user_id,type,title,start_date) values ('20000000-0000-0000-0000-000000000001','${USER}','event','Dentist','2030-01-01');
    insert into public.reminders(id,user_id,planner_item_id,kind,scheduled_at,status) values
      ('30000000-0000-0000-0000-000000000001','${USER}','20000000-0000-0000-0000-000000000001','event','2026-10-07T09:00:00Z','pending'),
      ('30000000-0000-0000-0000-000000000002','${USER}','20000000-0000-0000-0000-000000000001','event','2026-10-07T10:00:00Z','pending'),
      ('30000000-0000-0000-0000-000000000003','${USER}','20000000-0000-0000-0000-000000000001','event','2026-10-07T11:00:00Z','pending');`);
  const armed = await one(db, USER, `select public.mark_reminders_device_armed($1::jsonb) r`, [JSON.stringify([
    { id: "30000000-0000-0000-0000-000000000001", at: "2026-10-07T09:00:00Z" },
    { id: "30000000-0000-0000-0000-000000000002", at: "2026-10-07T09:30:00Z" }, // stale time → not credited
  ])]);
  assert.equal(armed.r, 1);
  // Another account can't arm (or learn about) someone else's reminders.
  assert.equal((await one(db, USER2, `select public.mark_reminders_device_armed($1::jsonb) r`, [JSON.stringify([{ id: "30000000-0000-0000-0000-000000000003", at: "2026-10-07T11:00:00Z" }])])).r, 0);
  await assert.rejects(() => as(db, null, `select public.mark_reminders_device_armed('[]'::jsonb)`));
  await assert.rejects(() => as(db, USER, `select public.complete_push_reminder('30000000-0000-0000-0000-000000000001', true, null)`), "only the delivery job may complete");
  await db.exec(`update public.reminders set status = 'processing', claimed_at = now()`);
  await db.exec(`set role service_role;
    select public.complete_push_reminder('30000000-0000-0000-0000-000000000001', false, 'no_push_subscription');
    select public.complete_push_reminder('30000000-0000-0000-0000-000000000002', false, 'no_push_subscription');
    select public.complete_push_reminder('30000000-0000-0000-0000-000000000003', true, null);
    reset role;`);
  const rows = (await db.query<Row>(`select id, status, delivered_via, last_error from public.reminders order by id`)).rows;
  assert.deepEqual(rows.map((r) => [r.status, r.delivered_via, r.last_error]), [
    ["sent", "device", null],
    ["pending", null, "no_push_subscription"], // not armed at this time → existing retry path, eventually failed
    ["sent", "web_push", null],
  ]);
  await db.close();
});
