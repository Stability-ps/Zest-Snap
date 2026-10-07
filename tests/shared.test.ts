import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { as, asService, migratedDb } from "./helpers/db";

const OWNER = "00000000-0000-0000-0000-0000000000a1";
const EDITOR = "00000000-0000-0000-0000-0000000000b2";
const VIEWER = "00000000-0000-0000-0000-0000000000c3";
const STRANGER = "00000000-0000-0000-0000-0000000000d4";
const email = (id: string) => `${id.slice(-2)}@example.com`;

async function setup() {
  const db = await migratedDb();
  for (const id of [OWNER, EDITOR, VIEWER, STRANGER]) await db.exec(`insert into auth.users(id,email) values('${id}','${email(id)}')`);
  const plan = (await as<{ id: string }>(db, OWNER, `select public.create_shared_plan('Family','family') id`)).rows[0].id;
  const join = async (user: string, role: "editor" | "viewer") => {
    const token = (await as<{ t: string }>(db, OWNER, `select public.create_shared_invite($1,null,$2) t`, [plan, role])).rows[0].t;
    await as(db, user, `select public.accept_shared_invite($1)`, [token], email(user));
  };
  await join(EDITOR, "editor");
  await join(VIEWER, "viewer");
  const item = (await as<{ id: string }>(db, EDITOR,
    `insert into public.shared_plan_items(plan_id,creator_id,item_type,title,due_date) values($1,$2,'task','Buy milk','2027-01-02') returning id`,
    [plan, EDITOR])).rows[0].id;
  return { db, plan, item };
}
const title = async (db: PGlite, item: string) =>
  (await db.query<{ title: string; status: string; plan_id: string; assigned_to: string | null }>(`select title,status,plan_id,assigned_to from public.shared_plan_items where id=$1`, [item])).rows[0];

test("non-members see nothing; viewers read but cannot write; editors can", async () => {
  const { db, plan, item } = await setup();
  for (const table of ["shared_plans", "shared_plan_items", "shared_plan_members"])
    assert.equal((await as(db, STRANGER, `select * from public.${table}`)).rows.length, 0, `${table} leaked`);
  assert.equal((await as(db, STRANGER, `select * from public.shared_plan_member_directory($1)`, [plan])).rows.length, 0);
  assert.equal((await as(db, VIEWER, `select * from public.shared_plan_items`)).rows.length, 1);
  await as(db, VIEWER, `update public.shared_plan_items set title='hacked' where id=$1`, [item]);
  await as(db, VIEWER, `delete from public.shared_plan_items where id=$1`, [item]);
  await assert.rejects(as(db, VIEWER, `insert into public.shared_plan_items(plan_id,creator_id,title) values($1,$2,'x')`, [plan, VIEWER]));
  assert.equal((await title(db, item)).title, "Buy milk");
  await as(db, EDITOR, `update public.shared_plan_items set title='Buy oat milk' where id=$1`, [item]);
  assert.equal((await title(db, item)).title, "Buy oat milk");
  await db.close();
});

test("editors cannot take ownership of a plan or move items into other plans", async () => {
  const { db, plan, item } = await setup();
  await as(db, EDITOR, `update public.shared_plans set owner_id=$2 where id=$1`, [plan, EDITOR]).catch(() => undefined);
  assert.equal((await db.query<{ owner_id: string }>(`select owner_id from public.shared_plans where id=$1`, [plan])).rows[0].owner_id, OWNER);
  await as(db, EDITOR, `update public.shared_plans set name='Renamed' where id=$1`, [plan]);
  assert.equal((await db.query<{ name: string }>(`select name from public.shared_plans where id=$1`, [plan])).rows[0].name, "Renamed");
  const other = (await as<{ id: string }>(db, STRANGER, `select public.create_shared_plan('Mine','team') id`)).rows[0].id;
  await assert.rejects(as(db, EDITOR, `update public.shared_plan_items set plan_id=$2 where id=$1`, [item, other]));
  await assert.rejects(as(db, EDITOR, `update public.shared_plan_items set creator_id=$2 where id=$1`, [item, OWNER]));
  assert.equal((await title(db, item)).plan_id, plan);
  await db.close();
});

test("assignment only targets active members; assignees may only tick their task", async () => {
  const { db, plan, item } = await setup();
  await assert.rejects(as(db, EDITOR, `update public.shared_plan_items set assigned_to=$2 where id=$1`, [item, STRANGER]));
  await assert.rejects(as(db, EDITOR, `insert into public.shared_plan_items(plan_id,creator_id,title,assigned_to) values($1,$2,'x',$3)`, [plan, EDITOR, STRANGER]));
  await assert.rejects(as(db, EDITOR, `select public.assign_shared_item($1,$2)`, [item, STRANGER]));
  await as(db, EDITOR, `select public.assign_shared_item($1,$2)`, [item, VIEWER]);
  // A viewer who is assigned can complete the task but not rewrite it.
  await as(db, VIEWER, `update public.shared_plan_items set status='completed' where id=$1`, [item]);
  assert.equal((await title(db, item)).status, "completed");
  await assert.rejects(as(db, VIEWER, `update public.shared_plan_items set title='mine now' where id=$1`, [item]));
  await assert.rejects(as(db, VIEWER, `update public.shared_plan_items set assigned_to=null where id=$1`, [item]));
  // Once they leave, the assignment no longer grants any write access.
  await as(db, VIEWER, `select public.leave_shared_plan($1)`, [plan]);
  await as(db, VIEWER, `update public.shared_plan_items set status='open' where id=$1`, [item]);
  assert.equal((await title(db, item)).status, "completed");
  await db.close();
});

test("link invites serve the whole group; email invites only their address; revoked or expired ones never work", async () => {
  const { db, plan } = await setup();
  const link = (await as<{ t: string }>(db, OWNER, `select public.create_shared_invite($1,null,'viewer') t`, [plan])).rows[0].t;
  // The owner opening their own link must not demote themselves.
  await as(db, OWNER, `select public.accept_shared_invite($1)`, [link], email(OWNER));
  await as(db, EDITOR, `select public.accept_shared_invite($1)`, [link], email(EDITOR));
  await as(db, STRANGER, `select public.accept_shared_invite($1)`, [link], email(STRANGER));
  const roles = Object.fromEntries((await db.query<{ user_id: string; role: string }>(`select user_id,role from public.shared_plan_members where plan_id=$1 and status='active'`, [plan])).rows.map((r) => [r.user_id, r.role]));
  assert.deepEqual(roles, { [OWNER]: "owner", [EDITOR]: "editor", [VIEWER]: "viewer", [STRANGER]: "viewer" });

  const personal = (await as<{ t: string }>(db, OWNER, `select public.create_shared_invite($1,'Someone@Example.com','editor') t`, [plan])).rows[0].t;
  await assert.rejects(as(db, STRANGER, `select public.accept_shared_invite($1)`, [personal], email(STRANGER)), /invite_for_another_account/);
  assert.equal((await as(db, STRANGER, `select * from public.shared_plan_invites where token=$1`, [personal], email(STRANGER))).rows.length, 0);

  const revokedId = (await db.query<{ id: string }>(`select id from public.shared_plan_invites where token=$1`, [link])).rows[0].id;
  await assert.rejects(as(db, VIEWER, `select public.revoke_shared_invite($1)`, [revokedId]), /not_allowed/);
  await as(db, OWNER, `select public.revoke_shared_invite($1)`, [revokedId]);
  assert.equal((await as(db, null, `select * from public.shared_invite_preview($1)`, [link])).rows.length, 0);
  await assert.rejects(as(db, VIEWER, `select public.accept_shared_invite($1)`, [link], email(VIEWER)), /invite_unavailable/);

  const again = (await as<{ t: string }>(db, EDITOR, `select public.create_shared_invite($1,null,'viewer') t`, [plan])).rows[0].t;
  await assert.rejects(as(db, VIEWER, `select public.revoke_shared_plan_invites($1)`, [plan]), /not_allowed/);
  assert.ok((await as<{ n: number }>(db, OWNER, `select public.revoke_shared_plan_invites($1) n`, [plan])).rows[0].n >= 1);
  assert.equal((await as(db, null, `select * from public.shared_invite_preview($1)`, [again])).rows.length, 0);

  const old = (await as<{ t: string }>(db, OWNER, `select public.create_shared_invite($1,null,'viewer') t`, [plan])).rows[0].t;
  await db.query(`update public.shared_plan_invites set expires_at=now()-interval '1 minute' where token=$1`, [old]);
  assert.equal((await as(db, null, `select * from public.shared_invite_preview($1)`, [old])).rows.length, 0);
  await db.close();
});

test("invite preview is anonymous but exposes only the plan name, role and a first item", async () => {
  const { db, plan } = await setup();
  const token = (await as<{ t: string }>(db, OWNER, `select public.create_shared_invite($1,null,'viewer') t`, [plan])).rows[0].t;
  const row = (await as<Record<string, unknown>>(db, null, `select * from public.shared_invite_preview($1)`, [token])).rows[0];
  assert.deepEqual(Object.keys(row).sort(), ["expires_at", "item", "plan_kind", "plan_name", "role"]);
  const item = row.item as Record<string, unknown>;
  for (const key of ["creator_id", "assigned_to", "id", "plan_id"]) assert.equal(key in item, false, key);
  await assert.rejects(as(db, null, `select * from public.shared_plan_invites`));
  await db.close();
});

test("daily briefings claim one slot per local day, including slots that cross midnight", async () => {
  const db = await migratedDb();
  const slot = async (local: string, time: string, last: string | null = null) =>
    (await asService<{ d: string | null }>(db, `select private.daily_briefing_slot($1::timestamp,$2::time,$3::date)::text d`, [local, time, last])).rows[0].d;
  assert.equal(await slot("2027-03-01 07:05", "07:00"), "2027-03-01");
  assert.equal(await slot("2027-03-01 06:59", "07:00"), null);
  assert.equal(await slot("2027-03-01 07:20", "07:00"), null);
  assert.equal(await slot("2027-03-01 07:05", "07:00", "2027-03-01"), null);
  // 23:50 briefing still fires at 00:05 and is recorded against the day it was due.
  assert.equal(await slot("2027-03-01 23:55", "23:50"), "2027-03-01");
  assert.equal(await slot("2027-03-02 00:05", "23:50"), "2027-03-01");
  assert.equal(await slot("2027-03-02 00:05", "23:50", "2027-03-01"), null);

  const U = OWNER;
  await db.exec(`insert into auth.users(id,email) values('${U}','u@example.com')`);
  await db.exec(`insert into public.profiles(id) values('${U}') on conflict do nothing; update public.profiles set timezone='UTC' where id='${U}';`);
  await db.exec(`insert into public.daily_briefing_settings(user_id,enabled,local_time) values('${U}',true,((now() at time zone 'UTC') - interval '1 minute')::time)`);
  assert.equal((await asService(db, `select * from public.claim_due_daily_briefings(10)`)).rows.length, 1);
  assert.equal((await asService(db, `select * from public.claim_due_daily_briefings(10)`)).rows.length, 0, "claimed twice");
  // A failed delivery may be retried; a successful one is never re-sent the same day.
  await asService(db, `select public.complete_daily_briefing($1,false)`, [U]);
  assert.equal((await asService(db, `select * from public.claim_due_daily_briefings(10)`)).rows.length, 1);
  await asService(db, `select public.complete_daily_briefing($1,true)`, [U]);
  assert.equal((await asService(db, `select * from public.claim_due_daily_briefings(10)`)).rows.length, 0);
  await assert.rejects(as(db, U, `select * from public.claim_due_daily_briefings(10)`));
  await db.close();
});
