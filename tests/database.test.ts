import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("migrations enforce owner isolation, privileged columns, atomic allowances and once-only rewards", async () => {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema extensions;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 grant usage on schema public,auth to authenticated,anon,service_role;
 grant execute on function auth.uid() to authenticated,anon,service_role;`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261002_initial_product_schema.sql",
      "utf8",
    ).replace("create extension if not exists pgcrypto;", ""),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261003011650_launch_readiness.sql",
      "utf8",
    ),
  );
  await db.exec(`grant all on all tables in schema public to service_role;grant usage on schema public to service_role;
 insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000001','one@example.com'),('00000000-0000-0000-0000-000000000002','two@example.com');
 set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';`);
  await assert.rejects(() =>
    db.exec(`update public.profiles set is_admin=true where id=auth.uid()`),
  );
  await assert.rejects(() =>
    db.exec(`update public.profiles set plan='business' where id=auth.uid()`),
  );
  await db.exec(
    `update public.profiles set display_name='Owner' where id=auth.uid()`,
  );
  assert.equal(
    (await db.query("select * from public.profiles")).rows.length,
    1,
  );
  await assert.rejects(() =>
    db.exec(
      `insert into public.events(user_id,title) values('00000000-0000-0000-0000-000000000002','foreign')`,
    ),
  );
  await assert.rejects(() =>
    db.exec(`select public.reserve_scan(auth.uid(),gen_random_uuid(),'hash')`),
  );
  await assert.rejects(() =>
    db.exec(
      `insert into public.reward_ledger(user_id,entry_type,amount,reason) values(auth.uid(),'earn',100,'fake')`,
    ),
  );
  await db.exec("reset role;set role service_role;");
  await db.exec(
    `select public.award_milestone('00000000-0000-0000-0000-000000000001','first_scan');select public.award_milestone('00000000-0000-0000-0000-000000000001','first_scan');`,
  );
  assert.equal(
    (await db.query("select amount from public.reward_ledger")).rows.length,
    1,
  );
  await db.exec(
    `select public.reserve_scan('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','hash');`,
  );
  await assert.rejects(() =>
    db.exec(
      `select public.reserve_scan('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','hash');`,
    ),
  );
  await db.exec(
    `update public.scan_requests set created_at=now()-interval '1 hour';update public.usage_monthly set ai_scans=10;`,
  );
  await assert.rejects(() =>
    db.exec(
      `select public.reserve_scan('00000000-0000-0000-0000-000000000001',gen_random_uuid(),'new');`,
    ),
  );
  await db.close();
});
