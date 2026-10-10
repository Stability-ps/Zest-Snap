-- One-time verified-signup premium introduction. Server-owned state, never an entitlement.
-- Existing accounts are deliberately excluded to avoid showing onboarding to old users.
create table if not exists public.premium_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.premium_onboarding enable row level security;
revoke all on public.premium_onboarding from public, anon, authenticated;
create or replace function public.premium_onboarding_status()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  u uuid := auth.uid();
  signed_up_at timestamptz;
  finished timestamptz;
begin
  if u is null then raise exception 'authentication_required'; end if;
  select created_at into signed_up_at from auth.users
    where id=u and email_confirmed_at is not null;
  if signed_up_at is null then return jsonb_build_object('show',false); end if;
  -- Only accounts registered after this feature is released should see it.
  if signed_up_at < '2026-10-10 00:00:00+00'::timestamptz
     then return jsonb_build_object('show',false); end if;
  insert into public.premium_onboarding(user_id) values(u)
    on conflict(user_id) do nothing;
  select completed_at into finished from public.premium_onboarding where user_id=u;
  return jsonb_build_object('show',finished is null);
end $$;
revoke all on function public.premium_onboarding_status() from public,anon;
grant execute on function public.premium_onboarding_status() to authenticated;

create or replace function public.complete_premium_onboarding()
returns void language plpgsql security definer set search_path=''
as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'authentication_required'; end if;
  insert into public.premium_onboarding(user_id,completed_at)
  values(u,now()) on conflict(user_id) do update
  set completed_at=coalesce(public.premium_onboarding.completed_at,excluded.completed_at);
end $$;
revoke all on function public.complete_premium_onboarding() from public,anon;
grant execute on function public.complete_premium_onboarding() to authenticated;
