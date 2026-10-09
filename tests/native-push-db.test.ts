import { test } from "node:test";
import assert from "node:assert/strict";
import { as, asService, migratedDb } from "./helpers/db";

const A = "00000000-0000-0000-0000-0000000000a1";
const B = "00000000-0000-0000-0000-0000000000b2";
const C = "00000000-0000-0000-0000-0000000000c3";
const email = (id: string) => `${id.slice(-2)}@example.com`;
const TOKEN = "fcm-token-0000000000000000000000";

async function setup() {
  const db = await migratedDb();
  for (const id of [A, B, C]) await db.exec(`insert into auth.users(id,email) values('${id}','${email(id)}')`);
  return db;
}

test("device tokens are written only through the RPCs, and move to whoever signs in on the device", async () => {
  const db = await setup();
  await as(db, A, `select public.register_native_push_token($1,'android','1.0')`, [TOKEN]);
  await as(db, A, `select public.register_native_push_token($1,'android','1.0')`, [TOKEN]); // token refresh / relaunch
  const owner = async () => (await db.query<{ user_id: string }>(`select user_id from public.native_push_tokens where token=$1`, [TOKEN])).rows;
  assert.deepEqual((await owner()).map((r) => r.user_id), [A]);

  // Same device, different account: the previous account stops receiving pushes on it.
  await as(db, B, `select public.register_native_push_token($1,'android','1.0')`, [TOKEN]);
  assert.deepEqual((await owner()).map((r) => r.user_id), [B]);

  // A can't remove B's token; B can (sign-out).
  await as(db, A, `select public.unregister_native_push_token($1)`, [TOKEN]);
  assert.equal((await owner()).length, 1);
  await as(db, B, `select public.unregister_native_push_token($1)`, [TOKEN]);
  assert.equal((await owner()).length, 0);

  for (const user of [A, null]) {
    await assert.rejects(as(db, user, `select * from public.native_push_tokens`), /permission denied/);
    await assert.rejects(as(db, user, `insert into public.native_push_tokens(user_id,platform,token) values($1,'ios',$2)`, [A, TOKEN]), /permission denied/);
  }
  await assert.rejects(as(db, null, `select public.register_native_push_token($1,'ios')`, [TOKEN]), /permission denied|authentication_required/);
  await assert.rejects(as(db, A, `select public.register_native_push_token($1,'web')`, [TOKEN]), /invalid_platform/);
  await assert.rejects(as(db, A, `select public.register_native_push_token('short','ios')`), /invalid_token/);
  await db.close();
});

test("an account keeps at most 20 device tokens", async () => {
  const db = await setup();
  for (let i = 0; i < 23; i++) await as(db, A, `select public.register_native_push_token($1,'ios')`, [`apns-token-${String(i).padStart(20, "0")}`]);
  assert.equal((await db.query(`select 1 from public.native_push_tokens where user_id=$1`, [A])).rows.length, 20);
  await db.close();
});

test("reminders record which channel delivered them; the old 3-argument call still works", async () => {
  const db = await setup();
  await db.exec(`insert into public.planner_items(id,user_id,type,title,start_date) values ('20000000-0000-0000-0000-000000000001','${A}','event','Dentist','2030-01-01');
    insert into public.reminders(id,user_id,planner_item_id,kind,scheduled_at,status) values
      ('30000000-0000-0000-0000-000000000001','${A}','20000000-0000-0000-0000-000000000001','event','2026-10-07T09:00:00Z','processing'),
      ('30000000-0000-0000-0000-000000000002','${A}','20000000-0000-0000-0000-000000000001','event','2026-10-07T10:00:00Z','processing');`);
  await asService(db, `select public.complete_push_reminder('30000000-0000-0000-0000-000000000001', true, null, 'native_push')`);
  await asService(db, `select public.complete_push_reminder(p_id => '30000000-0000-0000-0000-000000000002', p_ok => true, p_error => null)`);
  const via = (await db.query<{ v: string }>(`select delivered_via v from public.reminders order by scheduled_at`)).rows.map((r) => r.v);
  assert.deepEqual(via, ["native_push", "web_push"]);
  await assert.rejects(as(db, A, `select public.complete_push_reminder('30000000-0000-0000-0000-000000000001', true, null, 'native_push')`), /permission denied/);
  await db.close();
});

test("an email invitation to an existing account is queued for that account only", async () => {
  const db = await setup();
  const plan = (await as<{ id: string }>(db, A, `select public.create_shared_plan('Family','family') id`)).rows[0].id;
  await as(db, A, `select public.create_shared_invite($1,$2,'viewer')`, [plan, email(B).toUpperCase()]);
  await as(db, A, `select public.create_shared_invite($1,'nobody@example.com','viewer')`, [plan]);
  await as(db, A, `select public.create_shared_invite($1,null,'viewer')`, [plan]); // link invite: no recipient
  const queued = (await db.query<{ recipient_id: string; kind: string; url: string; body: string }>(`select recipient_id,kind,url,body from public.notification_queue`)).rows;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].recipient_id, B);
  assert.equal(queued[0].kind, "shared_invite");
  assert.match(queued[0].url, /^\/share\/[0-9a-f-]{36}$/);
  assert.match(queued[0].body, /Family/);
  await assert.rejects(as(db, B, `select * from public.notification_queue`), /permission denied/);
  await db.close();
});

test("Shared task changes notify the assignee only when someone else makes them", async () => {
  const db = await setup();
  const plan = (await as<{ id: string }>(db, A, `select public.create_shared_plan('Family','family') id`)).rows[0].id;
  const link = (await as<{ t: string }>(db, A, `select public.create_shared_invite($1,null,'editor') t`, [plan])).rows[0].t;
  await as(db, B, `select public.accept_shared_invite($1)`, [link], email(B));
  const bodies = async () => (await db.query<{ recipient_id: string; body: string }>(`select recipient_id,body from public.notification_queue where kind='planner_update' order by created_at, body`)).rows;

  const item = (await as<{ id: string }>(db, A,
    `insert into public.shared_plan_items(plan_id,creator_id,item_type,title,due_date,assigned_to) values($1,$2,'task','Bring cake','2026-10-20',$3) returning id`,
    [plan, A, B])).rows[0].id;
  await as(db, A, `update public.shared_plan_items set due_date='2026-10-21' where id=$1`, [item]);
  await as(db, A, `update public.shared_plan_items set title='Bring a big cake' where id=$1`, [item]); // not notified
  await as(db, B, `update public.shared_plan_items set due_date='2026-10-22' where id=$1`, [item]);    // own change
  await as(db, A, `update public.shared_plan_items set status='cancelled' where id=$1`, [item]);
  await as(db, A, `insert into public.shared_plan_items(plan_id,creator_id,item_type,title,assigned_to) values($1,$2,'task','Mine',$2)`, [plan, A]);
  await assert.rejects(as(db, A, `insert into public.shared_plan_items(plan_id,creator_id,item_type,title,assigned_to) values($1,$2,'task','Stranger',$3)`, [plan, A, C]), /member_not_found/);

  assert.deepEqual((await bodies()).map((r) => [r.recipient_id, r.body]), [
    [B, "You were assigned “Bring cake”"],
    [B, "“Bring cake” was rescheduled"],
    [B, "“Bring a big cake” was cancelled"],
  ]);
  await db.close();
});

test("the delivery job claims each notification once and prunes rows older than 30 days", async () => {
  const db = await setup();
  await db.exec(`insert into public.notification_queue(recipient_id,kind,title,body,url,created_at) values
    ('${A}','planner_update','Family','Old','/shared/x', now()-interval '31 days'),
    ('${A}','planner_update','Family','New','/shared/x', now())`);
  const first = (await asService<{ id: string; body: string }>(db, `select * from public.claim_notifications(100)`)).rows;
  assert.deepEqual(first.map((r) => r.body), ["New"]);
  assert.equal((await asService(db, `select * from public.claim_notifications(100)`)).rows.length, 0, "a claimed row is not handed out twice");
  await asService(db, `select public.complete_notification($1,true,null)`, [first[0].id]);
  assert.equal((await db.query(`select 1 from public.notification_queue where delivered_at is not null`)).rows.length, 1);
  assert.equal((await db.query(`select 1 from public.notification_queue`)).rows.length, 1);
  await assert.rejects(as(db, A, `select * from public.claim_notifications(100)`), /permission denied/);
  await assert.rejects(db.exec(`insert into public.notification_queue(recipient_id,kind,title,body,url) values ('${A}','planner_update','x','y','https://evil.example')`));
  await db.close();
});
