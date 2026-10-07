-- Shared plans hardening (production-readiness audit, 2026-10-07). Additive and idempotent.
-- 1. Editors could rewrite shared_plans.owner_id and take over a plan: limit updates to safe columns.
-- 2. Items: plan/creator are immutable, assignees must be active members, and an assignee who is not an
--    editor may only tick their task (previously they could rewrite or move it, even after leaving).
-- 3. Link invites are reusable by the group until revoked/expired; email invites stay single-use.
--    Accepting never demotes an existing owner/editor.
-- 4. Daily briefings scheduled late in the evening no longer get lost when the window crosses midnight.

revoke update on public.shared_plans from authenticated;
grant update (name, kind, description) on public.shared_plans to authenticated;
revoke truncate, references, trigger on public.shared_plans, public.shared_plan_members, public.shared_plan_items, public.shared_plan_invites from authenticated, anon;

create or replace function private.guard_shared_item()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'UPDATE' then
    if new.plan_id is distinct from old.plan_id then raise exception 'plan_is_immutable'; end if;
    if new.creator_id is distinct from old.creator_id then raise exception 'creator_is_immutable'; end if;
  end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists(select 1 from public.shared_plan_members m where m.plan_id=new.plan_id and m.user_id=new.assigned_to and m.status='active') then
    raise exception 'member_not_found';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and not private.is_shared_plan_member(new.plan_id, array['owner','editor'])
     and ((to_jsonb(new) - 'status' - 'updated_at') <> (to_jsonb(old) - 'status' - 'updated_at') or new.status not in ('open','completed')) then
    raise exception 'assignee_can_only_complete';
  end if;
  return new;
end $$;
revoke all on function private.guard_shared_item() from public, anon, authenticated;
drop trigger if exists shared_plan_items_guard on public.shared_plan_items;
create trigger shared_plan_items_guard before insert or update on public.shared_plan_items
for each row execute function private.guard_shared_item();

create or replace function public.accept_shared_invite(p_token uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); inv public.shared_plan_invites%rowtype;
begin
  if u is null then raise exception 'authentication_required'; end if;
  select * into inv from public.shared_plan_invites where token=p_token and status='pending' and expires_at>now() for update;
  if not found then raise exception 'invite_unavailable'; end if;
  if inv.invited_email is not null and lower(inv.invited_email)<>lower(coalesce(auth.jwt()->>'email','')) then raise exception 'invite_for_another_account'; end if;
  insert into public.shared_plan_members(plan_id,user_id,role,status)
  values(inv.plan_id,u,inv.role,'active')
  on conflict(plan_id,user_id) do update set
    role = case
      when public.shared_plan_members.status <> 'active' then excluded.role
      when public.shared_plan_members.role = 'owner' or excluded.role = 'viewer' then public.shared_plan_members.role
      else excluded.role end,
    joined_at = case when public.shared_plan_members.status <> 'active' then now() else public.shared_plan_members.joined_at end,
    status = 'active';
  -- Email invites are single-use; link invites keep working for the rest of the group.
  update public.shared_plan_invites
  set status = case when invited_email is null then 'pending' else 'accepted' end, accepted_by=u, accepted_at=now()
  where id=inv.id;
  return inv.plan_id;
end $$;
revoke all on function public.accept_shared_invite(uuid) from public,anon;
grant execute on function public.accept_shared_invite(uuid) to authenticated;

-- Returns the local date of the briefing slot that is due now (today's, or yesterday's when the
-- 20-minute window crosses midnight), or null when nothing is due or that slot was already sent.
create or replace function private.daily_briefing_slot(p_local timestamp, p_time time, p_last date)
returns date language sql immutable set search_path='' as $$
  select d from (values (p_local::date), (p_local::date - 1)) v(d)
  where p_local >= d + p_time and p_local < d + p_time + interval '20 minutes'
    and d is distinct from p_last
  limit 1
$$;
revoke all on function private.daily_briefing_slot(timestamp,time,date) from public, anon, authenticated;
grant execute on function private.daily_briefing_slot(timestamp,time,date) to service_role;

create or replace function public.claim_due_daily_briefings(p_limit integer default 100)
returns table(user_id uuid,timezone text,local_date date,include_todos boolean,include_shared boolean,include_meals boolean)
language plpgsql security definer set search_path='' as $$
begin
  return query
  with candidates as (
    select s.user_id, coalesce(nullif(p.timezone,''),'UTC') tz, s.include_todos, s.include_shared, s.include_meals,
      private.daily_briefing_slot((now() at time zone coalesce(nullif(p.timezone,''),'UTC')), s.local_time, s.last_sent_local_date) ld
    from public.daily_briefing_settings s join public.profiles p on p.id=s.user_id
    where s.enabled and (s.last_claimed_at is null or s.last_claimed_at < now()-interval '10 minutes')
  ), due as (
    select c.* from candidates c join public.daily_briefing_settings s on s.user_id=c.user_id
    where c.ld is not null
    order by s.local_time
    for update of s skip locked
    limit least(greatest(p_limit,1),500)
  ), marked as (
    update public.daily_briefing_settings s set last_claimed_at=now(), last_sent_local_date=due.ld
    from due where s.user_id=due.user_id
    returning s.user_id
  )
  select d.user_id,d.tz,d.ld,d.include_todos,d.include_shared,d.include_meals from due d join marked m on m.user_id=d.user_id;
end $$;
revoke all on function public.claim_due_daily_briefings(integer) from public,anon,authenticated;
grant execute on function public.claim_due_daily_briefings(integer) to service_role;

-- Reusable links need an off switch: owners/editors can revoke every open invite for a plan at once.
create or replace function public.revoke_shared_plan_invites(p_plan uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_shared_plan_member(p_plan,array['owner','editor']) then raise exception 'not_allowed'; end if;
  update public.shared_plan_invites set status='revoked' where plan_id=p_plan and status='pending';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.revoke_shared_plan_invites(uuid) from public,anon;
grant execute on function public.revoke_shared_plan_invites(uuid) to authenticated;

-- Performance advisors: evaluate auth.uid()/auth.jwt() once per statement and index the Shared foreign keys.
create index if not exists shared_plans_owner_idx on public.shared_plans(owner_id);
create index if not exists shared_plan_invites_plan_idx on public.shared_plan_invites(plan_id, status);
create index if not exists shared_plan_items_assignee_idx on public.shared_plan_items(assigned_to) where assigned_to is not null;

drop policy if exists shared_plans_read on public.shared_plans;
create policy shared_plans_read on public.shared_plans for select to authenticated
using (owner_id=(select auth.uid()) or private.is_shared_plan_member(id,null));
drop policy if exists shared_plans_insert on public.shared_plans;
create policy shared_plans_insert on public.shared_plans for insert to authenticated
with check (owner_id=(select auth.uid()));
drop policy if exists shared_plans_update on public.shared_plans;
create policy shared_plans_update on public.shared_plans for update to authenticated
using (owner_id=(select auth.uid()) or private.is_shared_plan_member(id,array['owner','editor']))
with check (owner_id=(select auth.uid()) or private.is_shared_plan_member(id,array['owner','editor']));
drop policy if exists shared_members_read on public.shared_plan_members;
create policy shared_members_read on public.shared_plan_members for select to authenticated
using (user_id=(select auth.uid()) or private.is_shared_plan_member(plan_id,null));
drop policy if exists shared_items_insert on public.shared_plan_items;
create policy shared_items_insert on public.shared_plan_items for insert to authenticated
with check (creator_id=(select auth.uid()) and private.is_shared_plan_member(plan_id,array['owner','editor']));
drop policy if exists shared_items_update on public.shared_plan_items;
create policy shared_items_update on public.shared_plan_items for update to authenticated
using (private.is_shared_plan_member(plan_id,array['owner','editor']) or (assigned_to=(select auth.uid()) and private.is_shared_plan_member(plan_id,null)))
with check (private.is_shared_plan_member(plan_id,array['owner','editor']) or (assigned_to=(select auth.uid()) and private.is_shared_plan_member(plan_id,null)));
drop policy if exists shared_invites_read on public.shared_plan_invites;
create policy shared_invites_read on public.shared_plan_invites for select to authenticated
using (created_by=(select auth.uid()) or (invited_email is not null and lower(invited_email)=lower(coalesce((select auth.jwt())->>'email',''))));
drop policy if exists daily_briefing_own on public.daily_briefing_settings;
create policy daily_briefing_own on public.daily_briefing_settings for all to authenticated
using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
