import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, migratedDb, migrationFiles } from "./helpers/db";
// @ts-expect-error -- plain ESM script without type declarations
import { repairPlan } from "../scripts/migration-repair-plan.mjs";

const mapping = JSON.parse(readFileSync("supabase/migration-history.json", "utf8")) as { files: Record<string, string[] | "pending"> };

test("every migration file is mapped to production history, and every production version exactly once", () => {
  assert.deepEqual(Object.keys(mapping.files).sort(), migrationFiles(),
    "add new migration files to supabase/migration-history.json (\"pending\" until applied to production)");
  const prod = Object.values(mapping.files).flatMap((v) => (Array.isArray(v) ? v : []));
  assert.equal(new Set(prod).size, prod.length, "a production version is mapped twice");
  assert.equal(prod.length, 40, "production history had 40 versions on 2026-10-09");
  for (const v of prod) assert.match(v, /^\d{14}$/);
});

test("the repair plan only renames history: it never marks a pending migration as applied", () => {
  const plan = repairPlan(mapping) as { revert: string[]; apply: string[] };
  const pending = Object.entries(mapping.files).filter(([, v]) => v === "pending").map(([f]) => f.split("_")[0]);
  for (const v of pending) assert.ok(!plan.apply.includes(v), `${v} is pending and must run through db push`);
  assert.equal(plan.revert.length + 9, 40, "versions shared by a file and production stay as they are");
  assert.ok(plan.revert.every((v: string) => !plan.apply.includes(v)));
});

test("a fresh database has production's calendar_connections: OAuth token columns, server-only", async () => {
  const db = await migratedDb();
  const cols = (await db.query<{ c: string }>(`select column_name c from information_schema.columns where table_schema='public' and table_name='calendar_connections' order by 1`)).rows.map((r) => r.c);
  assert.deepEqual(cols, ["access_token", "calendar_email", "calendar_id", "created_at", "expires_at", "provider", "refresh_token", "scope", "updated_at", "user_id"]);
  assert.equal((await db.query(`select 1 from pg_policies where tablename='calendar_connections'`)).rows.length, 0);
  for (const role of ["anon", "authenticated"])
    assert.equal((await db.query(`select 1 from information_schema.role_table_grants where table_name='calendar_connections' and grantee=$1`, [role])).rows.length, 0, role);
  await assert.rejects(as(db, "00000000-0000-0000-0000-0000000000a1", `select access_token from public.calendar_connections`), /permission denied/);
  for (const idx of ["events_scan_owner_idx", "reminders_event_idx"])
    assert.equal((await db.query(`select 1 from pg_indexes where indexname=$1`, [idx])).rows.length, 1, idx);
  await db.close();
});

test("with Supabase's default privileges, browser roles keep only the privileges the app needs", async () => {
  const db = await migratedDb();
  const privs = async (table: string, role: string) =>
    (await db.query<{ p: string }>(`select privilege_type p from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee=$2 order by 1`, [table, role])).rows.map((r) => r.p);
  for (const t of ["shared_plans", "shared_plan_members", "shared_plan_items", "shared_plan_invites", "shared_plan_messages",
    "shared_plan_message_reactions", "shared_plan_reads", "daily_briefing_settings", "meal_plans", "meal_entries",
    "timetable_schedules", "timetable_classes", "followup_suggestions"])
    assert.deepEqual(await privs(t, "anon"), [], `anon on ${t}`);
  assert.deepEqual(await privs("shared_plan_members", "authenticated"), ["SELECT"]);
  assert.deepEqual(await privs("shared_plan_invites", "authenticated"), ["SELECT"]);
  assert.deepEqual(await privs("shared_plans", "authenticated"), ["INSERT", "SELECT"]);
  assert.deepEqual(await privs("meal_plans", "authenticated"), ["DELETE", "INSERT", "SELECT", "UPDATE"]);
  assert.deepEqual(await privs("product_feedback", "authenticated"), ["SELECT"]);
  await db.close();
});

test("a fresh database gives the Free plan 3 AI scans a month, as production does", async () => {
  const db = await migratedDb();
  const free = (await db.query<{ n: number }>(`select monthly_scans n from public.plan_rules where id='free'`)).rows[0];
  assert.equal(free.n, 3);
  await db.close();
});
