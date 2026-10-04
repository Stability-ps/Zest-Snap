import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Minimal stand-ins for the Supabase-managed schemas so the full migration chain can run in-process.
const SUPABASE_STUBS = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage; create schema extensions; create schema vault; create schema cron; create schema net;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1, '/') $$;
create function extensions.digest(text, text) returns bytea language sql immutable as $$ select sha256(convert_to($1, 'UTF8')) $$;
create table vault.decrypted_secrets(name text primary key, decrypted_secret text);
create function vault.create_secret(text, text) returns uuid language sql as $$ insert into vault.decrypted_secrets values ($2, $1) returning gen_random_uuid() $$;
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
create function cron.schedule(text, text, text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values ($1, $2, $3)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid::bigint $$;
create function cron.unschedule(text) returns boolean language sql as $$ delete from cron.job where jobname = $1 returning true $$;
grant usage on schema public, auth, extensions to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
grant all on schema public to service_role;
`;

export function migrationFiles() {
  return readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
}

export async function migratedDb(upTo?: string) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const file of migrationFiles()) {
    if (upTo && file > upTo) break;
    const sql = readFileSync(`supabase/migrations/${file}`, "utf8")
      .replace(/create extension if not exists [^;]+;/g, "");
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  await db.exec(`grant all on all tables in schema public to service_role;`);
  return db;
}

export async function as<T = Record<string, any>>(db: PGlite, user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(user ? `set role authenticated; set request.jwt.claim.sub='${user}';` : `set role anon; set request.jwt.claim.sub='';`);
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec(`reset role; set request.jwt.claim.sub='';`);
  }
}

export async function asService<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) {
  await db.exec(`set role service_role;`);
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec(`reset role;`);
  }
}
