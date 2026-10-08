import { test } from "node:test";
import assert from "node:assert/strict";
import { as, migratedDb } from "./helpers/db";

const OWNER = "00000000-0000-0000-0000-0000000000a1";
const EDITOR = "00000000-0000-0000-0000-0000000000b2";
const VIEWER = "00000000-0000-0000-0000-0000000000c3";
const STRANGER = "00000000-0000-0000-0000-0000000000d4";
const email = (id: string) => `${id.slice(-2)}@example.com`;

async function setup() {
  const db = await migratedDb();
  for (const id of [OWNER, EDITOR, VIEWER, STRANGER]) await db.exec(`insert into auth.users(id,email) values('${id}','${email(id)}')`);
  const plan = (await as<{ id: string }>(db, OWNER, `select public.create_shared_plan('Family','family') id`)).rows[0].id;
  const invite = async (role: "editor" | "viewer") =>
    (await as<{ t: string }>(db, OWNER, `select public.create_shared_invite($1,null,$2) t`, [plan, role])).rows[0].t;
  const link = await invite("viewer");
  const editorLink = await invite("editor");
  await as(db, EDITOR, `select public.accept_shared_invite($1)`, [editorLink], email(EDITOR));
  await as(db, VIEWER, `select public.accept_shared_invite($1)`, [link], email(VIEWER));
  const directory = async (user: string) =>
    (await as<{ user_id: string; role: string }>(db, user, `select user_id,role from public.shared_plan_member_directory($1)`, [plan])).rows;
  return { db, plan, link, invite, directory };
}

test("the owner can change a member's role and the new role takes effect", async () => {
  const { db, plan, directory } = await setup();
  await assert.rejects(as(db, VIEWER, `insert into public.shared_plan_items(plan_id,creator_id,title) values($1,$2,'x')`, [plan, VIEWER]));
  await as(db, OWNER, `select public.set_shared_member_role($1,$2,'editor')`, [plan, VIEWER]);
  assert.equal((await directory(OWNER)).find((m) => m.user_id === VIEWER)?.role, "editor");
  await as(db, VIEWER, `insert into public.shared_plan_items(plan_id,creator_id,title) values($1,$2,'Now I can')`, [plan, VIEWER]);
  await as(db, OWNER, `select public.set_shared_member_role($1,$2,'viewer')`, [plan, EDITOR]);
  await assert.rejects(as(db, EDITOR, `insert into public.shared_plan_items(plan_id,creator_id,title) values($1,$2,'x')`, [plan, EDITOR]));
  await db.close();
});

test("only the owner can manage members; editors, viewers and strangers are refused", async () => {
  const { db, plan, directory } = await setup();
  for (const user of [EDITOR, VIEWER, STRANGER]) {
    await assert.rejects(as(db, user, `select public.set_shared_member_role($1,$2,'editor')`, [plan, VIEWER]), /owner_only/);
    await assert.rejects(as(db, user, `select public.set_shared_member_role($1,$2,'editor')`, [plan, user]), /owner_only/);
    await assert.rejects(as(db, user, `select public.remove_shared_member($1,$2)`, [plan, VIEWER === user ? EDITOR : VIEWER]), /owner_only/);
    await assert.rejects(as(db, user, `select public.remove_shared_member($1,$2)`, [plan, OWNER]), /owner_only/);
  }
  // No role can be granted ownership, and the owner's own role is fixed.
  await assert.rejects(as(db, OWNER, `select public.set_shared_member_role($1,$2,'owner')`, [plan, EDITOR]), /invalid_role/);
  await assert.rejects(as(db, OWNER, `select public.set_shared_member_role($1,$2,'viewer')`, [plan, OWNER]), /owner_role_fixed/);
  await assert.rejects(as(db, OWNER, `select public.remove_shared_member($1,$2)`, [plan, OWNER]), /owner_cannot_leave/);
  await assert.rejects(as(db, OWNER, `select public.remove_shared_member($1,$2)`, [plan, STRANGER]), /member_not_found/);
  // Direct table writes stay impossible for every signed-in role, including the owner.
  for (const user of [OWNER, EDITOR, VIEWER]) {
    await assert.rejects(as(db, user, `update public.shared_plan_members set role='owner' where plan_id=$1`, [plan]), /permission denied/);
    await assert.rejects(as(db, user, `delete from public.shared_plan_members where plan_id=$1`, [plan]), /permission denied/);
    await assert.rejects(as(db, user, `insert into public.shared_plan_members(plan_id,user_id,role) values($1,$2,'editor')`, [plan, STRANGER]), /permission denied/);
  }
  assert.deepEqual((await directory(OWNER)).map((m) => [m.user_id, m.role]), [[OWNER, "owner"], [EDITOR, "editor"], [VIEWER, "viewer"]]);
  await db.close();
});

test("a removed member loses access, their tasks are unassigned and queued notifications are dropped", async () => {
  const { db, plan, directory } = await setup();
  const item = (await as<{ id: string }>(db, OWNER,
    `insert into public.shared_plan_items(plan_id,creator_id,item_type,title,assigned_to) values($1,$2,'task','Bring cake',$3) returning id`,
    [plan, OWNER, EDITOR])).rows[0].id;
  await as(db, OWNER, `insert into public.shared_plan_messages(plan_id,sender_id,body) values($1,$2,'Hello')`, [plan, OWNER]);
  assert.equal((await db.query(`select 1 from public.shared_message_push_queue where recipient_id=$1`, [EDITOR])).rows.length, 1);

  await as(db, OWNER, `select public.remove_shared_member($1,$2)`, [plan, EDITOR]);

  for (const table of ["shared_plans", "shared_plan_items", "shared_plan_messages"])
    assert.equal((await as(db, EDITOR, `select * from public.${table}`)).rows.length, 0, `${table} still visible`);
  await assert.rejects(as(db, EDITOR, `insert into public.shared_plan_messages(plan_id,sender_id,body) values($1,$2,'still here?')`, [plan, EDITOR]));
  await assert.rejects(as(db, EDITOR, `select public.remove_shared_member($1,$2)`, [plan, VIEWER]), /owner_only/);
  assert.equal((await db.query<{ assigned_to: string | null }>(`select assigned_to from public.shared_plan_items where id=$1`, [item])).rows[0].assigned_to, null);
  assert.equal((await db.query(`select 1 from public.shared_message_push_queue where recipient_id=$1`, [EDITOR])).rows.length, 0);
  assert.deepEqual((await directory(VIEWER)).map((m) => m.user_id), [OWNER, VIEWER]);
  await as(db, OWNER, `insert into public.shared_plan_messages(plan_id,sender_id,body) values($1,$2,'After removal')`, [plan, OWNER]);
  assert.equal((await db.query(`select 1 from public.shared_message_push_queue where recipient_id=$1`, [EDITOR])).rows.length, 0);
  await db.close();
});

test("a removed member cannot rejoin with an earlier invitation but can with a new one", async () => {
  const { db, plan, link, invite, directory } = await setup();
  await as(db, OWNER, `select public.remove_shared_member($1,$2)`, [plan, VIEWER]);
  await assert.rejects(as(db, VIEWER, `select public.accept_shared_invite($1)`, [link], email(VIEWER)), /removed_from_plan/);
  // The same group link still works for people who were never removed.
  await as(db, STRANGER, `select public.accept_shared_invite($1)`, [link], email(STRANGER));
  await db.exec(`select pg_sleep(0.01)`);
  const fresh = await invite("viewer");
  await as(db, VIEWER, `select public.accept_shared_invite($1)`, [fresh], email(VIEWER));
  assert.ok((await directory(OWNER)).some((m) => m.user_id === VIEWER));
  assert.equal((await as(db, VIEWER, `select * from public.shared_plans`)).rows.length, 1);
  await db.close();
});

test("a member who left can still rejoin with the group link", async () => {
  const { db, plan, link, directory } = await setup();
  await as(db, VIEWER, `select public.leave_shared_plan($1)`, [plan]);
  assert.equal((await as(db, VIEWER, `select * from public.shared_plans`)).rows.length, 0);
  await as(db, VIEWER, `select public.accept_shared_invite($1)`, [link], email(VIEWER));
  assert.ok((await directory(OWNER)).some((m) => m.user_id === VIEWER));
  await db.close();
});
