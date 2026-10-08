import { test } from "node:test";
import assert from "node:assert/strict";
import { as, migratedDb } from "./helpers/db";

const OWNER = "00000000-0000-0000-0000-0000000000a1";
const VIEWER = "00000000-0000-0000-0000-0000000000b2";
const STRANGER = "00000000-0000-0000-0000-0000000000c3";
const email = (id:string)=>`${id.slice(-2)}@example.com`;

async function setup(){
  const db=await migratedDb();
  for(const id of [OWNER,VIEWER,STRANGER]) await db.exec(`insert into auth.users(id,email) values('${id}','${email(id)}')`);
  const plan=(await as<{id:string}>(db,OWNER,`select public.create_shared_plan('Family','family') id`)).rows[0].id;
  const token=(await as<{t:string}>(db,OWNER,`select public.create_shared_invite($1,null,'viewer') t`,[plan])).rows[0].t;
  await as(db,VIEWER,`select public.accept_shared_invite($1)`,[token],email(VIEWER));
  return {db,plan};
}

test("shared messages are member-only and viewers may chat",async()=>{
  const {db,plan}=await setup();
  const msg=(await as<{id:string}>(db,VIEWER,
    `insert into public.shared_plan_messages(plan_id,sender_id,body) values($1,$2,'Hello team') returning id`,
    [plan,VIEWER])).rows[0].id;
  assert.equal((await as(db,OWNER,`select body from public.shared_plan_messages where id=$1`,[msg])).rows.length,1);
  assert.equal((await as(db,STRANGER,`select body from public.shared_plan_messages where id=$1`,[msg])).rows.length,0);
  await assert.rejects(as(db,STRANGER,
    `insert into public.shared_plan_messages(plan_id,sender_id,body) values($1,$2,'Nope')`,
    [plan,STRANGER]));
  await db.close();
});

test("replies and item discussions cannot point outside their plan",async()=>{
  const {db,plan}=await setup();
  const other=(await as<{id:string}>(db,STRANGER,`select public.create_shared_plan('Other','team') id`)).rows[0].id;
  const foreign=(await as<{id:string}>(db,STRANGER,
    `insert into public.shared_plan_messages(plan_id,sender_id,body) values($1,$2,'foreign') returning id`,
    [other,STRANGER])).rows[0].id;
  await assert.rejects(as(db,OWNER,
    `insert into public.shared_plan_messages(plan_id,sender_id,body,reply_to) values($1,$2,'bad',$3)`,
    [plan,OWNER,foreign]));
  await db.close();
});

test("only a sender can edit or delete their message",async()=>{
  const {db,plan}=await setup();
  const msg=(await as<{id:string}>(db,OWNER,
    `insert into public.shared_plan_messages(plan_id,sender_id,body) values($1,$2,'Draft') returning id`,
    [plan,OWNER])).rows[0].id;
  await assert.rejects(as(db,VIEWER,`select public.edit_shared_message($1,'Taken over')`,[msg]),/not_allowed/);
  await as(db,OWNER,`select public.edit_shared_message($1,'Final')`,[msg]);
  assert.equal((await as<{body:string}>(db,OWNER,`select body from public.shared_plan_messages where id=$1`,[msg])).rows[0].body,"Final");
  await assert.rejects(as(db,VIEWER,`select public.delete_shared_message($1)`,[msg]),/not_allowed/);
  await as(db,OWNER,`select public.delete_shared_message($1)`,[msg]);
  const deleted=(await as<{body:string;deleted_at:string|null}>(db,OWNER,`select body,deleted_at from public.shared_plan_messages where id=$1`,[msg])).rows[0];
  assert.equal(deleted.body,"Message deleted");
  assert.ok(deleted.deleted_at);
  await db.close();
});

test("read markers drive unread counts without leaking other plans",async()=>{
  const {db,plan}=await setup();
  await as(db,OWNER,`select public.mark_shared_plan_read($1)`,[plan]);
  await as(db,VIEWER,`insert into public.shared_plan_messages(plan_id,sender_id,body) values($1,$2,'New message')`,[plan,VIEWER]);
  const counts=(await as<{plan_id:string;unread_count:bigint}>(db,OWNER,`select * from public.shared_plan_unread_counts()`)).rows;
  assert.equal(Number(counts.find(r=>r.plan_id===plan)?.unread_count),1);
  await as(db,OWNER,`select public.mark_shared_plan_read($1)`,[plan]);
  const after=(await as<{plan_id:string;unread_count:bigint}>(db,OWNER,`select * from public.shared_plan_unread_counts()`)).rows;
  assert.equal(Number(after.find(r=>r.plan_id===plan)?.unread_count),0);
  await assert.rejects(as(db,STRANGER,`select public.mark_shared_plan_read($1)`,[plan]),/not_allowed/);
  await db.close();
});

test("a member can reply to a message in the same plan",async()=>{
  const {db,plan}=await setup();
  const parent=(await as<{id:string}>(db,OWNER,
    `insert into public.shared_plan_messages(plan_id,sender_id,body) values($1,$2,'Who brings snacks?') returning id`,
    [plan,OWNER])).rows[0].id;
  const reply=(await as<{reply_to:string}>(db,VIEWER,
    `insert into public.shared_plan_messages(plan_id,sender_id,body,reply_to) values($1,$2,'Me',$3) returning reply_to`,
    [plan,VIEWER,parent])).rows[0];
  assert.equal(reply.reply_to,parent);
  await db.close();
});

test("reactions and item links must belong to the message's own plan",async()=>{
  const {db,plan}=await setup();
  const other=(await as<{id:string}>(db,OWNER,`select public.create_shared_plan('Work','team') id`)).rows[0].id;
  const foreign=(await as<{id:string}>(db,OWNER,
    `insert into public.shared_plan_messages(plan_id,sender_id,body) values($1,$2,'work only') returning id`,
    [other,OWNER])).rows[0].id;
  await assert.rejects(as(db,OWNER,
    `insert into public.shared_plan_message_reactions(message_id,plan_id,user_id,emoji) values($1,$2,$3,'👍')`,
    [foreign,plan,OWNER]));
  await as(db,OWNER,
    `insert into public.shared_plan_message_reactions(message_id,plan_id,user_id,emoji) values($1,$2,$3,'👍')`,
    [foreign,other,OWNER]);
  await db.close();
});

test("attachments must live in the sender's folder for that plan and are cleared on delete",async()=>{
  const {db,plan}=await setup();
  const bad={path:`${plan}/${VIEWER}/x.png`,kind:"photo",name:"x.png"};
  await assert.rejects(as(db,OWNER,
    `insert into public.shared_plan_messages(plan_id,sender_id,body,attachment) values($1,$2,'Photo',$3)`,
    [plan,OWNER,JSON.stringify(bad)]));
  const good={path:`${plan}/${OWNER}/x.png`,kind:"photo",name:"x.png"};
  const msg=(await as<{id:string}>(db,OWNER,
    `insert into public.shared_plan_messages(plan_id,sender_id,body,attachment) values($1,$2,'Photo',$3) returning id`,
    [plan,OWNER,JSON.stringify(good)])).rows[0].id;
  await as(db,OWNER,`select public.delete_shared_message($1)`,[msg]);
  const row=(await as<{attachment:unknown}>(db,OWNER,`select attachment from public.shared_plan_messages where id=$1`,[msg])).rows[0];
  assert.equal(row.attachment,null);
  await db.close();
});
