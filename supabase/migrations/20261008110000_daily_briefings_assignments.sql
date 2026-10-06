-- Daily briefing preferences and safe shared-member directory/assignment helpers.
create table if not exists public.daily_briefing_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  local_time time not null default '07:00',
  include_todos boolean not null default true,
  include_shared boolean not null default true,
  include_meals boolean not null default true,
  last_sent_local_date date,
  last_claimed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.daily_briefing_settings enable row level security;
drop policy if exists daily_briefing_own on public.daily_briefing_settings;
create policy daily_briefing_own on public.daily_briefing_settings for all to authenticated
using (user_id=auth.uid()) with check (user_id=auth.uid());
grant select,insert,update,delete on public.daily_briefing_settings to authenticated;
grant all on public.daily_briefing_settings to service_role;

create or replace function public.save_daily_briefing_settings(
  p_enabled boolean,
  p_local_time time,
  p_include_todos boolean default true,
  p_include_shared boolean default true,
  p_include_meals boolean default true
) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  insert into public.daily_briefing_settings(user_id,enabled,local_time,include_todos,include_shared,include_meals,updated_at)
  values(auth.uid(),p_enabled,p_local_time,p_include_todos,p_include_shared,p_include_meals,now())
  on conflict(user_id) do update set enabled=excluded.enabled,local_time=excluded.local_time,
    include_todos=excluded.include_todos,include_shared=excluded.include_shared,include_meals=excluded.include_meals,updated_at=now();
end $$;
revoke all on function public.save_daily_briefing_settings(boolean,time,boolean,boolean,boolean) from public,anon;
grant execute on function public.save_daily_briefing_settings(boolean,time,boolean,boolean,boolean) to authenticated;

create or replace function public.get_daily_briefing_settings()
returns table(enabled boolean,local_time time,include_todos boolean,include_shared boolean,include_meals boolean)
language sql stable security definer set search_path='' as $$
  select coalesce(s.enabled,false),coalesce(s.local_time,'07:00'::time),coalesce(s.include_todos,true),coalesce(s.include_shared,true),coalesce(s.include_meals,true)
  from (select auth.uid() user_id) u left join public.daily_briefing_settings s on s.user_id=u.user_id
$$;
revoke all on function public.get_daily_briefing_settings() from public,anon;
grant execute on function public.get_daily_briefing_settings() to authenticated;

create or replace function public.claim_due_daily_briefings(p_limit integer default 100)
returns table(user_id uuid,timezone text,local_date date,include_todos boolean,include_shared boolean,include_meals boolean)
language plpgsql security definer set search_path='' as $$
begin
  return query
  with due as (
    select s.user_id,coalesce(nullif(p.timezone,''),'UTC') tz,
      (now() at time zone coalesce(nullif(p.timezone,''),'UTC'))::date ld,
      s.include_todos,s.include_shared,s.include_meals
    from public.daily_briefing_settings s join public.profiles p on p.id=s.user_id
    where s.enabled
      and coalesce(s.last_sent_local_date,'1900-01-01'::date) <> (now() at time zone coalesce(nullif(p.timezone,''),'UTC'))::date
      and (now() at time zone coalesce(nullif(p.timezone,''),'UTC'))::time >= s.local_time
      and (now() at time zone coalesce(nullif(p.timezone,''),'UTC'))::time < s.local_time + interval '20 minutes'
      and (s.last_claimed_at is null or s.last_claimed_at < now()-interval '10 minutes')
    order by s.local_time
    for update of s skip locked
    limit least(greatest(p_limit,1),500)
  ), marked as (
    update public.daily_briefing_settings s set last_claimed_at=now(),last_sent_local_date=due.ld
    from due where s.user_id=due.user_id
    returning s.user_id
  )
  select d.user_id,d.tz,d.ld,d.include_todos,d.include_shared,d.include_meals from due d join marked m on m.user_id=d.user_id;
end $$;
revoke all on function public.claim_due_daily_briefings(integer) from public,anon,authenticated;
grant execute on function public.claim_due_daily_briefings(integer) to service_role;

create or replace function public.complete_daily_briefing(p_user uuid,p_ok boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.daily_briefing_settings
  set last_claimed_at=null,
      last_sent_local_date=case when p_ok then last_sent_local_date else null end
  where user_id=p_user;
end $$;
revoke all on function public.complete_daily_briefing(uuid,boolean) from public,anon,authenticated;
grant execute on function public.complete_daily_briefing(uuid,boolean) to service_role;

create or replace function public.shared_plan_member_directory(p_plan uuid)
returns table(user_id uuid,display_name text,role text)
language sql stable security definer set search_path='' as $$
  select m.user_id,coalesce(nullif(p.display_name,''),'Member'),m.role
  from public.shared_plan_members m left join public.profiles p on p.id=m.user_id
  where m.plan_id=p_plan and m.status='active' and private.is_shared_plan_member(p_plan,null)
  order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end,coalesce(p.display_name,'')
$$;
revoke all on function public.shared_plan_member_directory(uuid) from public,anon;
grant execute on function public.shared_plan_member_directory(uuid) to authenticated;

create or replace function public.assign_shared_item(p_item uuid,p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select plan_id into pid from public.shared_plan_items where id=p_item;
  if pid is null or not private.is_shared_plan_member(pid,array['owner','editor']) then raise exception 'not_allowed'; end if;
  if p_user is not null and not exists(select 1 from public.shared_plan_members where plan_id=pid and user_id=p_user and status='active') then raise exception 'member_not_found'; end if;
  update public.shared_plan_items set assigned_to=p_user where id=p_item;
end $$;
revoke all on function public.assign_shared_item(uuid,uuid) from public,anon;
grant execute on function public.assign_shared_item(uuid,uuid) to authenticated;
