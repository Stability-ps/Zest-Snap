-- 1) One-time premium introduction for newly registered accounts.
-- 2) Privacy-conscious conversion funnel events and an admin report.
--
-- Eligibility boundary: a row in premium_onboarding is created by a trigger when an auth user is created,
-- so only accounts registered after this migration is applied are eligible. Existing accounts never get a
-- row and never see the introduction; email changes and password recovery update auth.users, they do not
-- insert, so they can't trigger it either. No hard-coded dates.

create table if not exists public.premium_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  choice text check (choice in ('free', 'paid', 'dismissed'))
);
alter table public.premium_onboarding enable row level security;
revoke all on public.premium_onboarding from public, anon, authenticated;
grant all on public.premium_onboarding to service_role;

create or replace function private.start_premium_onboarding() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.premium_onboarding(user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
exception when others then
  return new; -- never block a signup because of onboarding
end $$;
revoke all on function private.start_premium_onboarding() from public, anon, authenticated;
drop trigger if exists on_auth_user_premium_onboarding on auth.users;
create trigger on_auth_user_premium_onboarding
  after insert on auth.users
  for each row execute function private.start_premium_onboarding();

-- show = eligible account, email confirmed, not completed, and not already on a paid plan.
create or replace function public.premium_onboarding_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then return jsonb_build_object('show', false); end if;
  return jsonb_build_object('show', exists (
    select 1
      from public.premium_onboarding o
      join auth.users au on au.id = o.user_id
      left join public.profiles p on p.id = o.user_id
     where o.user_id = u
       and o.completed_at is null
       and au.email_confirmed_at is not null
       and coalesce(p.plan::text, 'free') = 'free'));
end $$;
revoke all on function public.premium_onboarding_status() from public, anon;
grant execute on function public.premium_onboarding_status() to authenticated;

-- Records the person's choice once. A no-op for accounts that were never eligible.
create or replace function public.complete_premium_onboarding(p_choice text default 'free') returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'authentication_required'; end if;
  if p_choice not in ('free', 'paid', 'dismissed') then raise exception 'invalid_choice'; end if;
  update public.premium_onboarding
     set completed_at = coalesce(completed_at, now()), choice = coalesce(choice, p_choice)
   where user_id = u;
end $$;
revoke all on function public.complete_premium_onboarding(text) from public, anon;
grant execute on function public.complete_premium_onboarding(text) to authenticated;

------------------------------------------------------------------------------------------
-- Conversion funnel events. Pseudonymous subject only: 'u:<user id>' when signed in, otherwise
-- 'd:<device hash>' (SHA-256 of the random per-install device id, as the scan quota uses). No emails, names, prices or content.
-- Facts the database already knows (guest scans completed, registrations, email verification,
-- subscriptions) are derived from their own tables in admin_conversion_funnel, never from the client.
------------------------------------------------------------------------------------------
create table if not exists public.conversion_events (
  id bigint generated always as identity primary key,
  event text not null,
  subject text not null check (char_length(subject) <= 80),
  user_id uuid references auth.users(id) on delete set null,
  platform text not null default 'web' check (platform in ('web', 'pwa', 'ios', 'android')),
  context text check (context is null or context ~ '^[a-z_]{1,40}$'),
  bucket date not null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (event, subject, context, bucket)
);
create index if not exists conversion_events_created_idx on public.conversion_events(created_at);
alter table public.conversion_events enable row level security;
revoke all on public.conversion_events from public, anon, authenticated;
grant all on public.conversion_events to service_role;

-- Client-reported interactions only. Once-per-subject events share one bucket; repeatable ones dedupe per day.
create or replace function public.track_conversion(p_event text, p_platform text default 'web', p_context text default null, p_device_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  subj text;
  once boolean := p_event in ('guest_limit_reached', 'free_registration_started', 'verified_paywall_viewed', 'free_plan_selected', 'free_limit_reached');
begin
  if p_event not in ('guest_limit_reached', 'guest_paywall_viewed', 'premium_plan_viewed', 'monthly_plan_selected', 'annual_plan_selected',
                     'free_registration_started', 'verified_paywall_viewed', 'free_plan_selected', 'checkout_started', 'checkout_completed',
                     'checkout_failed', 'checkout_cancelled', 'subscription_restored', 'free_limit_reached') then
    raise exception 'unknown_event';
  end if;
  if u is not null then
    subj := 'u:' || u::text;
  elsif p_device_id is not null and char_length(p_device_id) between 16 and 128 then
    subj := 'd:' || private.device_hash(p_device_id);
  else
    return;
  end if;
  -- Abuse ceiling: a single subject can't flood the table.
  if (select count(*) from public.conversion_events where subject = subj and created_at > now() - interval '1 day') >= 100 then return; end if;
  insert into public.conversion_events(event, subject, user_id, platform, context, bucket)
  values (p_event, subj, u,
          case when p_platform in ('web', 'pwa', 'ios', 'android') then p_platform else 'web' end,
          case when p_context ~ '^[a-z_]{1,40}$' then p_context end,
          case when once then date '1970-01-01' else current_date end)
  on conflict do nothing;
end $$;
revoke all on function public.track_conversion(text, text, text, text) from public;
grant execute on function public.track_conversion(text, text, text, text) to anon, authenticated;

-- Admin funnel report. Authoritative facts come from their own tables; interactions from conversion_events.
create or replace function private.admin_conversion_funnel(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return (
    with guest as (
      select device_hash, count(*) filter (where status = 'completed') ok
        from public.guest_scan_usage where created_at >= p_from and created_at < p_to group by device_hash),
    reg as (select id, email_confirmed_at from auth.users where created_at >= p_from and created_at < p_to),
    ev as (select event, platform, count(distinct subject) n from public.conversion_events
            where created_at >= p_from and created_at < p_to group by 1, 2),
    paid as (select s.plan::text plan, s.provider from public.subscriptions s
              where s.plan::text <> 'free' and s.status in ('active', 'trialing', 'past_due')
                and s.updated_at >= p_from and s.updated_at < p_to)
    select jsonb_build_object(
      'guest_devices', (select count(*) from guest),
      'guest_scan_1_completed', (select count(*) from guest where ok >= 1),
      'guest_scan_2_completed', (select count(*) from guest where ok >= 2),
      'guest_scan_3_completed', (select count(*) from guest where ok >= 3),
      'guest_devices_registered', (select count(distinct g.device_hash) from guest g join public.device_accounts d on d.device_hash = g.device_hash),
      'registration_completed', (select count(*) from reg),
      'email_verified', (select count(*) from reg where email_confirmed_at is not null),
      'onboarding_shown_eligible', (select count(*) from public.premium_onboarding o join reg on reg.id = o.user_id),
      'onboarding_free', (select count(*) from public.premium_onboarding o join reg on reg.id = o.user_id where o.choice = 'free'),
      'onboarding_paid', (select count(*) from public.premium_onboarding o join reg on reg.id = o.user_id where o.choice = 'paid'),
      'subscription_activated', (select count(*) from paid),
      'paid_by_plan', coalesce((select jsonb_object_agg(plan, n) from (select plan, count(*) n from paid group by 1) t), '{}'::jsonb),
      'paid_by_provider', coalesce((select jsonb_object_agg(coalesce(provider, 'unknown'), n) from (select provider, count(*) n from paid group by 1) t), '{}'::jsonb),
      'events', coalesce((select jsonb_object_agg(event, n) from (select event, sum(n) n from ev group by 1) t), '{}'::jsonb),
      'events_by_platform', coalesce((select jsonb_object_agg(event || ':' || platform, n) from ev), '{}'::jsonb)));
end $$;
revoke all on function private.admin_conversion_funnel(timestamptz, timestamptz) from public, anon;
grant execute on function private.admin_conversion_funnel(timestamptz, timestamptz) to authenticated;
create or replace function public.admin_conversion_funnel(p_from timestamptz, p_to timestamptz) returns jsonb
language sql security invoker set search_path = '' as $w$ select private.admin_conversion_funnel(p_from, p_to) $w$;
revoke all on function public.admin_conversion_funnel(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_conversion_funnel(timestamptz, timestamptz) to authenticated;

-- Rollback (no data outside these objects is touched):
--   drop function if exists public.admin_conversion_funnel(timestamptz, timestamptz);
--   drop function if exists private.admin_conversion_funnel(timestamptz, timestamptz);
--   drop function if exists public.track_conversion(text, text, text, text);
--   drop table if exists public.conversion_events;
--   drop trigger if exists on_auth_user_premium_onboarding on auth.users;
--   drop function if exists private.start_premium_onboarding();
--   drop function if exists public.complete_premium_onboarding(text);
--   drop function if exists public.premium_onboarding_status();
--   drop table if exists public.premium_onboarding;
