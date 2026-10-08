-- Plan with Zest calls the AI model on every request. Bound it per account (admin-editable in app_limits).
-- Server-only: the API route calls claim_voice_plan with the service role after authenticating the user.

create table if not exists public.plan_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists plan_requests_user_time on public.plan_requests (user_id, created_at desc);
alter table public.plan_requests enable row level security;
-- No policies on purpose: only the service role reads or writes this table.
revoke all on public.plan_requests from anon, authenticated;

insert into public.app_limits (key, value, description)
values ('voice_plans_per_user_hour', 30, 'Plan with Zest requests per account per hour.')
on conflict (key) do nothing;

create or replace function public.claim_voice_plan(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap integer;
  used integer;
begin
  if p_user is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('voice_plan:' || p_user::text, 0));
  select value into cap from public.app_limits where key = 'voice_plans_per_user_hour';
  select count(*) into used from public.plan_requests where user_id = p_user and created_at > now() - interval '1 hour';
  if used >= coalesce(cap, 30) then return false; end if;
  insert into public.plan_requests (user_id) values (p_user);
  delete from public.plan_requests where user_id = p_user and created_at < now() - interval '1 day';
  return true;
end $$;

revoke all on function public.claim_voice_plan(uuid) from public, anon, authenticated;
grant execute on function public.claim_voice_plan(uuid) to service_role;
