-- Marketing push notifications through OneSignal (app 6cc98d02-4051-47bf-948a-5d515d3896a6).
--
-- Separate from reminders: reminders keep using push_subscriptions / local notifications and never depend on
-- anything here. Marketing needs an explicit, recorded opt-in (marketing_consent); campaigns start disabled;
-- every send is logged once per campaign period (idempotent) and capped per person (frequency + quiet hours).
-- Only the Supabase user id is shared with OneSignal (as its external_id), and only after opt-in.

------------------------------------------------------------------------------------------
-- Consent
------------------------------------------------------------------------------------------
create table if not exists public.marketing_consent (
  user_id uuid primary key references auth.users(id) on delete cascade,
  push_opt_in boolean not null default false,
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  source text check (source in ('settings')),
  platform text check (platform in ('web', 'pwa', 'ios', 'android')),
  updated_at timestamptz not null default now()
);
alter table public.marketing_consent enable row level security;
revoke all on public.marketing_consent from public, anon, authenticated;
grant all on public.marketing_consent to service_role;

create or replace function public.get_marketing_consent() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('push', coalesce((select push_opt_in from public.marketing_consent where user_id = auth.uid()), false))
$$;
revoke all on function public.get_marketing_consent() from public, anon;
grant execute on function public.get_marketing_consent() to authenticated;

create or replace function public.set_marketing_consent(p_push boolean, p_platform text default 'web') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'authentication_required'; end if;
  if p_platform not in ('web', 'pwa', 'ios', 'android') then p_platform := 'web'; end if;
  insert into public.marketing_consent(user_id, push_opt_in, opted_in_at, opted_out_at, source, platform, updated_at)
  values (u, p_push, case when p_push then now() end, case when not p_push then now() end, 'settings', p_platform, now())
  on conflict (user_id) do update set
    push_opt_in = excluded.push_opt_in,
    opted_in_at = case when excluded.push_opt_in then now() else public.marketing_consent.opted_in_at end,
    opted_out_at = case when not excluded.push_opt_in then now() else public.marketing_consent.opted_out_at end,
    platform = excluded.platform,
    updated_at = now();
  return jsonb_build_object('push', p_push);
end $$;
revoke all on function public.set_marketing_consent(boolean, text) from public, anon;
grant execute on function public.set_marketing_consent(boolean, text) to authenticated;

------------------------------------------------------------------------------------------
-- Campaigns (definitions are edited in Admin › Campaigns; all start disabled)
------------------------------------------------------------------------------------------
create table if not exists public.marketing_campaigns (
  key text primary key check (key in ('inactive_users', 'reward_earned', 'free_scans_exhausted')),
  enabled boolean not null default false,
  title text not null check (char_length(title) between 1 and 65),
  body text not null check (char_length(body) between 1 and 180),
  path text not null check (path ~ '^/app(\?[A-Za-z0-9=&_-]*)?$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.marketing_campaigns enable row level security;
revoke all on public.marketing_campaigns from public, anon, authenticated;
grant all on public.marketing_campaigns to service_role;
insert into public.marketing_campaigns(key, title, body, path) values
  ('inactive_users', 'Anything new to plan?', 'Snap a notice, invite or timetable and Zest will turn the dates into your plan.', '/app'),
  ('reward_earned', 'You earned Zest credits', 'Your new credits are ready to use for extra AI scans.', '/app?view=rewards'),
  ('free_scans_exhausted', 'Your free scans reset soon', 'Need more this month? See what Zest Snap Premium adds — or keep planning for free.', '/app?view=planner')
on conflict (key) do nothing;

-- Frequency limits (Admin-tunable through app_limits).
insert into public.app_limits(key, value, description) values
  ('marketing_min_hours_between', 72, 'Minimum hours between two marketing notifications to one person.'),
  ('marketing_max_per_week', 2, 'Maximum marketing notifications per person in any 7 days.'),
  ('marketing_quiet_start_hour', 21, 'Local hour (person''s timezone) from which no marketing notifications are sent.'),
  ('marketing_quiet_end_hour', 9, 'Local hour until which no marketing notifications are sent.'),
  ('marketing_inactive_days', 7, 'Days without activity before the inactive-user campaign applies.'),
  ('marketing_batch_size', 200, 'People notified per campaign per scheduler run.')
on conflict (key) do nothing;

------------------------------------------------------------------------------------------
-- Send log: one row per person, campaign and period (the period makes each send idempotent).
------------------------------------------------------------------------------------------
create table if not exists public.marketing_sends (
  id uuid primary key default gen_random_uuid(),
  campaign text not null references public.marketing_campaigns(key),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_key text not null check (char_length(period_key) <= 80),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  provider_id text check (char_length(provider_id) <= 100),
  error text check (char_length(error) <= 200),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  opened_at timestamptz,
  unique (campaign, user_id, period_key)
);
create index if not exists marketing_sends_user_idx on public.marketing_sends(user_id, created_at desc);
create index if not exists marketing_sends_created_idx on public.marketing_sends(created_at);
alter table public.marketing_sends enable row level security;
revoke all on public.marketing_sends from public, anon, authenticated;
grant all on public.marketing_sends to service_role;

-- Who is due for a campaign right now. Consent, account status, frequency caps and quiet hours are applied here.
create or replace function private.marketing_candidates(p_campaign text, p_limit integer, p_now timestamptz default now())
returns table(user_id uuid, period_key text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  gap interval := make_interval(hours => private.app_limit('marketing_min_hours_between', 72));
  per_week integer := private.app_limit('marketing_max_per_week', 2);
  q_start integer := private.app_limit('marketing_quiet_start_hour', 21);
  q_end integer := private.app_limit('marketing_quiet_end_hour', 9);
  idle interval := make_interval(days => private.app_limit('marketing_inactive_days', 7));
begin
  return query
  with eligible as (
    select p.id, p.timezone
      from public.profiles p
      join public.marketing_consent c on c.user_id = p.id and c.push_opt_in
     where coalesce(p.account_status, 'active') = 'active'
       -- Quiet hours in the person's own timezone (an unknown timezone counts as UTC).
       and (case when q_start > q_end
                 then extract(hour from p_now at time zone coalesce(nullif(p.timezone, ''), 'UTC'))::int not between q_end and q_start - 1
                 else extract(hour from p_now at time zone coalesce(nullif(p.timezone, ''), 'UTC'))::int between q_start and q_end - 1 end) = false
       and not exists (select 1 from public.marketing_sends s where s.user_id = p.id and s.status in ('queued', 'sent') and s.created_at > p_now - gap)
       and (select count(*) from public.marketing_sends s where s.user_id = p.id and s.status in ('queued', 'sent') and s.created_at > p_now - interval '7 days') < per_week
  ),
  due as (
    -- Came back recently enough to care, quiet long enough to nudge; once per stretch of inactivity.
    select e.id, 'idle:' || to_char(p.last_active_at at time zone 'UTC', 'YYYY-MM-DD') pk
      from eligible e join public.profiles p on p.id = e.id
     where p_campaign = 'inactive_users'
       and p.last_active_at < p_now - idle and p.last_active_at > p_now - interval '45 days'
    union all
    -- Credits earned in the last two days; one notification per earning.
    select distinct on (e.id) e.id, 'reward:' || r.id::text
      from eligible e join public.reward_ledger r on r.user_id = e.id
     where p_campaign = 'reward_earned' and r.entry_type::text = 'earn' and r.amount > 0
       and r.created_at > p_now - interval '2 days'
    union all
    -- Free plan with this month's allowance used up; once per month.
    select e.id, 'month:' || to_char(p_now at time zone 'UTC', 'YYYY-MM')
      from eligible e
      join public.profiles p on p.id = e.id
      join public.plan_rules pr on pr.id = 'free'
      join public.usage_monthly m on m.user_id = e.id and m.period_start = date_trunc('month', p_now at time zone 'UTC')::date
     where p_campaign = 'free_scans_exhausted' and p.plan::text = 'free' and m.ai_scans >= pr.monthly_scans
  )
  select d.id, d.pk from due d
   where not exists (select 1 from public.marketing_sends s where s.campaign = p_campaign and s.user_id = d.id and s.period_key = d.pk)
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;
revoke all on function private.marketing_candidates(text, integer, timestamptz) from public, anon, authenticated;

-- Scheduler (service role): reserves due sends atomically, so overlapping runs never notify anyone twice.
create or replace function public.claim_marketing_sends(p_campaign text) returns table(id uuid, user_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.marketing_campaigns where key = p_campaign and enabled) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('marketing:' || p_campaign, 0));
  return query
  insert into public.marketing_sends(campaign, user_id, period_key)
  select p_campaign, c.user_id, c.period_key
    from private.marketing_candidates(p_campaign, private.app_limit('marketing_batch_size', 200)) c
  on conflict (campaign, user_id, period_key) do nothing
  returning marketing_sends.id, marketing_sends.user_id;
end $$;
revoke all on function public.claim_marketing_sends(text) from public, anon, authenticated;
grant execute on function public.claim_marketing_sends(text) to service_role;

create or replace function public.finish_marketing_send(p_id uuid, p_status text, p_provider_id text default null, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.marketing_sends
     set status = p_status, provider_id = left(p_provider_id, 100), error = left(p_error, 200),
         sent_at = case when p_status = 'sent' then now() end
   where id = p_id and status = 'queued' and p_status in ('sent', 'failed', 'skipped')
$$;
revoke all on function public.finish_marketing_send(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_marketing_send(uuid, text, text, text) to service_role;

-- Opening a notification (?mc=<send id>) — only the recipient can record it, once.
create or replace function public.record_marketing_open(p_send uuid) returns void
language sql security definer set search_path = '' as $$
  update public.marketing_sends set opened_at = now()
   where id = p_send and user_id = auth.uid() and opened_at is null and status = 'sent'
$$;
revoke all on function public.record_marketing_open(uuid) from public, anon;
grant execute on function public.record_marketing_open(uuid) to authenticated;

------------------------------------------------------------------------------------------
-- Admin
------------------------------------------------------------------------------------------
create or replace function private.admin_marketing(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return jsonb_build_object(
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object(
        'key', c.key, 'enabled', c.enabled, 'title', c.title, 'body', c.body, 'path', c.path, 'updated_at', c.updated_at,
        'queued', (select count(*) from public.marketing_sends s where s.campaign = c.key and s.status = 'queued' and s.created_at >= p_from and s.created_at < p_to),
        'sent', (select count(*) from public.marketing_sends s where s.campaign = c.key and s.status = 'sent' and s.created_at >= p_from and s.created_at < p_to),
        'failed', (select count(*) from public.marketing_sends s where s.campaign = c.key and s.status = 'failed' and s.created_at >= p_from and s.created_at < p_to),
        'skipped', (select count(*) from public.marketing_sends s where s.campaign = c.key and s.status = 'skipped' and s.created_at >= p_from and s.created_at < p_to),
        'opened', (select count(*) from public.marketing_sends s where s.campaign = c.key and s.opened_at is not null and s.created_at >= p_from and s.created_at < p_to),
        -- Came back to Zest within 3 days of the notification (whether or not they tapped it).
        'returned', (select count(*) from public.marketing_sends s join public.profiles p on p.id = s.user_id
                      where s.campaign = c.key and s.status = 'sent' and s.created_at >= p_from and s.created_at < p_to
                        and p.last_active_at > s.sent_at and p.last_active_at < s.sent_at + interval '3 days')
      ) order by c.key) from public.marketing_campaigns c), '[]'::jsonb),
    'consent', (select jsonb_build_object('opted_in', count(*) filter (where push_opt_in), 'opted_out', count(*) filter (where not push_opt_in),
        'by_platform', coalesce((select jsonb_object_agg(platform, n) from (select coalesce(platform, 'web') platform, count(*) n from public.marketing_consent where push_opt_in group by 1) t), '{}'::jsonb))
      from public.marketing_consent),
    'limits', (select jsonb_object_agg(key, value) from public.app_limits where key like 'marketing\_%'));
end $$;

create or replace function private.admin_set_marketing_campaign(p_key text, p_enabled boolean, p_title text, p_body text, p_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin('operate'); before jsonb; after jsonb;
begin
  select to_jsonb(c) into before from public.marketing_campaigns c where key = p_key;
  if before is null then raise exception 'not_found'; end if;
  update public.marketing_campaigns
     set enabled = p_enabled, title = trim(p_title), body = trim(p_body), path = trim(p_path), updated_at = now(), updated_by = me
   where key = p_key;
  select to_jsonb(c) into after from public.marketing_campaigns c where key = p_key;
  insert into public.admin_audit_log(admin_id, action, object_type, object_id, before, after)
  values (me, 'marketing_campaign_updated', 'marketing_campaign', p_key, before, after);
  return after;
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_marketing(p_from timestamptz, p_to timestamptz)|p_from, p_to|timestamptz, timestamptz',
                           'admin_set_marketing_campaign(p_key text, p_enabled boolean, p_title text, p_body text, p_path text)|p_key, p_enabled, p_title, p_body, p_path|text, boolean, text, text, text'] loop
    execute format('create or replace function public.%s returns jsonb language sql security invoker set search_path = '''' as $w$ select private.%s(%s) $w$',
      split_part(f, '|', 1), split_part(split_part(f, '|', 1), '(', 1), split_part(f, '|', 2));
    execute format('revoke all on function private.%s(%s) from public, anon', split_part(split_part(f, '|', 1), '(', 1), split_part(f, '|', 3));
    execute format('grant execute on function private.%s(%s) to authenticated', split_part(split_part(f, '|', 1), '(', 1), split_part(f, '|', 3));
    execute format('revoke all on function public.%s(%s) from public, anon', split_part(split_part(f, '|', 1), '(', 1), split_part(f, '|', 3));
    execute format('grant execute on function public.%s(%s) to authenticated', split_part(split_part(f, '|', 1), '(', 1), split_part(f, '|', 3));
  end loop;
end $$;

-- Rollback (reminders are untouched):
--   drop function if exists public.admin_set_marketing_campaign(text, boolean, text, text, text), private.admin_set_marketing_campaign(text, boolean, text, text, text),
--     public.admin_marketing(timestamptz, timestamptz), private.admin_marketing(timestamptz, timestamptz), public.record_marketing_open(uuid),
--     public.finish_marketing_send(uuid, text, text, text), public.claim_marketing_sends(text), private.marketing_candidates(text, integer, timestamptz),
--     public.set_marketing_consent(boolean, text), public.get_marketing_consent();
--   drop table if exists public.marketing_sends, public.marketing_campaigns, public.marketing_consent;
--   delete from public.app_limits where key like 'marketing\_%';
