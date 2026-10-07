-- Owner-only deletion of a shared plan (post-production hardening, 2026-10-07). Additive and idempotent.
-- Members, invites (including group links), items and their assignments are removed by the existing
-- ON DELETE CASCADE foreign keys from shared_plans; nothing else references these tables.
-- Direct DELETEs on shared_plans stay impossible (there is no delete policy); this function is the only path.
create or replace function public.delete_shared_plan(p_plan uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  -- Ownership is the plan's owner_id, never a member role, so editors and viewers cannot delete.
  delete from public.shared_plans where id=p_plan and owner_id=auth.uid();
  if not found then raise exception 'not_allowed'; end if;
end $$;
revoke all on function public.delete_shared_plan(uuid) from public, anon;
grant execute on function public.delete_shared_plan(uuid) to authenticated;

-- Global date sanity (production QA stored a shared item dated year 100720). The app validates every date
-- against 1900-01-01..2100-12-31 (lib/dates.ts); the database now refuses anything outside that range too.
-- NOT VALID: enforced for every new insert/update without failing on legacy rows; VALIDATE later once clean.
do $$
declare t text; c text;
begin
  foreach t in array array['planner_items','shared_plan_items'] loop
    foreach c in array array['start_date','end_date','due_date'] loop
      if not exists (select 1 from pg_constraint where conname = t||'_'||c||'_range') then
        execute format('alter table public.%I add constraint %I check (%I is null or %I between date %L and date %L) not valid',
          t, t||'_'||c||'_range', c, c, '1900-01-01', '2100-12-31');
      end if;
    end loop;
  end loop;
end $$;
