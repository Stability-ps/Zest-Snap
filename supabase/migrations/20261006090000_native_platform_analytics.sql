-- Native apps (2026-10-06): record which platform/app build people use, so Admin can tell web, PWA,
-- iOS and Android apart. Additive and idempotent; the original record_activity() keeps working.

alter table public.user_activity_daily add column if not exists platform text
  check (platform is null or platform in ('web', 'pwa', 'ios', 'android'));
alter table public.user_activity_daily add column if not exists app_version text
  check (app_version is null or char_length(app_version) <= 60);

create or replace function private.record_activity_on(p_platform text, p_app_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
  plat text := case when p_platform in ('web', 'pwa', 'ios', 'android') then p_platform end;
  ver text := left(nullif(trim(coalesce(p_app_version, '')), ''), 60);
begin
  if u is null then return; end if;
  insert into public.user_activity_daily(user_id, day, platform, app_version) values (u, (now() at time zone 'UTC')::date, plat, ver)
  on conflict (user_id, day) do update set last_seen_at = now(), hits = least(public.user_activity_daily.hits + 1, 100000),
    platform = coalesce(excluded.platform, public.user_activity_daily.platform),
    app_version = coalesce(excluded.app_version, public.user_activity_daily.app_version);
  update public.profiles set last_active_at = now() where id = u;
end $$;
revoke all on function private.record_activity_on(text, text) from public, anon;
grant execute on function private.record_activity_on(text, text) to authenticated;
create or replace function public.record_activity(p_platform text, p_app_version text) returns void
language sql security invoker set search_path = '' as $$ select private.record_activity_on(p_platform, p_app_version) $$;
revoke all on function public.record_activity(text, text) from public, anon;
grant execute on function public.record_activity(text, text) to authenticated;

-- Admin: active people per platform and subscriptions per billing source in a range.
create or replace function private.admin_platforms(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return jsonb_build_object(
    'active_by_platform', (select jsonb_object_agg(platform, n) from (
        select coalesce(platform, 'not recorded') platform, count(distinct user_id) n from public.user_activity_daily
         where last_seen_at >= p_from and first_seen_at < p_to group by 1) x),
    'versions', coalesce((select jsonb_agg(x order by x.n desc) from (
        select platform, app_version, count(distinct user_id) n from public.user_activity_daily
         where last_seen_at >= p_from and first_seen_at < p_to and app_version is not null group by 1, 2 order by 3 desc limit 10) x), '[]'::jsonb),
    'subscriptions_by_source', (select jsonb_object_agg(coalesce(provider, 'none'), n) from (
        select provider, count(*) n from public.subscriptions where status in ('active', 'trialing', 'past_due') and plan <> 'free' group by 1) s));
end $$;
revoke all on function private.admin_platforms(timestamptz, timestamptz) from public, anon;
grant execute on function private.admin_platforms(timestamptz, timestamptz) to authenticated;
create or replace function public.admin_platforms(p_from timestamptz, p_to timestamptz) returns jsonb
language sql security invoker set search_path = '' as $$ select private.admin_platforms(p_from, p_to) $$;
revoke all on function public.admin_platforms(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_platforms(timestamptz, timestamptz) to authenticated;

-- Production's calendar_connections now has the OAuth-token shape (no connected_at/last_sync_at).
-- Re-create the admin user detail so it works with either shape and never touches token columns.
create or replace function private.admin_user_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb; period date := date_trunc('month', now() at time zone 'UTC')::date;
begin
  perform private.require_admin('view');
  if not exists (select 1 from public.profiles where id = p_user) then return null; end if;
  select jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'name', p.display_name, 'email', u.email, 'created_at', p.created_at,
        'last_sign_in_at', u.last_sign_in_at, 'last_active_at', p.last_active_at, 'locale', p.locale, 'timezone', p.timezone,
        'country_code', p.country_code, 'plan', p.plan, 'account_status', p.account_status, 'support_flag', p.support_flag,
        'support_note', p.support_note, 'is_admin', p.is_admin, 'onboarding_complete', p.onboarding_complete,
        'email_confirmed', u.email_confirmed_at is not null, 'admin_role', (select role from public.admin_roles where user_id = p.id))
      from public.profiles p join auth.users u on u.id = p.id where p.id = p_user),
    'subscription', (select to_jsonb(s) - 'provider_customer_id' - 'provider_subscription_id' from public.subscriptions s where s.user_id = p_user),
    'payments', coalesce((select jsonb_agg(to_jsonb(t) - 'provider_ref' order by t.occurred_at desc) from (
        select * from public.payment_transactions where user_id = p_user order by occurred_at desc limit 25) t), '[]'::jsonb),
    'usage', coalesce((select jsonb_agg(to_jsonb(m) - 'user_id' order by m.period_start desc) from (
        select * from public.usage_monthly where user_id = p_user order by period_start desc limit 12) m), '[]'::jsonb),
    'allowance', (select r.monthly_scans from public.profiles p join public.plan_rules r on r.id = p.plan where p.id = p_user),
    'current_usage', (select to_jsonb(m) - 'user_id' from public.usage_monthly m where user_id = p_user and period_start = period),
    'ai_requests', (select count(*) from public.scan_requests where user_id = p_user),
    'planner', (select jsonb_build_object(
        'total', count(*), 'events', count(*) filter (where type = 'event'), 'tasks', count(*) filter (where type = 'task'),
        'deadlines', count(*) filter (where type = 'deadline'), 'reminder_items', count(*) filter (where type = 'reminder'),
        'completed', count(*) filter (where status = 'completed'),
        'upcoming', count(*) filter (where status = 'open' and coalesce(due_date, start_date) >= current_date),
        'overdue', count(*) filter (where status = 'open' and coalesce(due_date, start_date) < current_date))
      from public.planner_items where user_id = p_user),
    'reminders', (select jsonb_build_object('total', count(*), 'pending', count(*) filter (where status = 'pending'),
        'sent', count(*) filter (where status = 'sent'), 'handled', count(*) filter (where status = 'handled'),
        'failed', count(*) filter (where status = 'failed'), 'snoozed', count(*) filter (where snoozed_until is not null))
      from public.reminders where user_id = p_user),
    'credits', coalesce((select sum(amount) from public.reward_ledger where user_id = p_user), 0),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'type', entry_type, 'amount', amount, 'reason', reason, 'created_at', created_at) order by created_at desc)
        from (select * from public.reward_ledger where user_id = p_user order by created_at desc limit 50) l), '[]'::jsonb),
    'referrals_sent', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'created_at', created_at, 'qualified_at', qualified_at,
        'email', private.user_email(referred_user_id))) from public.referrals where referrer_id = p_user), '[]'::jsonb),
    'referred_by', (select jsonb_build_object('user_id', referrer_id, 'email', private.user_email(referrer_id), 'status', status)
        from public.referrals where referred_user_id = p_user limit 1),
    'referral_code', (select code from public.referral_invites where user_id = p_user),
    'scans', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'status', status, 'mime_type', mime_type,
        'event_count', event_count, 'warning_count', warning_count, 'duration_ms', duration_ms, 'error_code', error_code,
        'page_count', page_count, 'tokens', coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) order by created_at desc)
        from (select * from public.scan_requests where user_id = p_user order by created_at desc limit 20) r), '[]'::jsonb),
    'saved_scans', (select count(*) from public.scans where user_id = p_user),
    -- Schema-agnostic (old metadata shape or the newer OAuth-token shape); never reads token columns.
    'calendar', coalesce((select jsonb_agg(jsonb_build_object('provider', c.provider,
        'connected_at', coalesce(to_jsonb(c) ->> 'connected_at', to_jsonb(c) ->> 'created_at'),
        'last_sync_at', coalesce(to_jsonb(c) ->> 'last_sync_at', to_jsonb(c) ->> 'updated_at')))
        from public.calendar_connections c where c.user_id = p_user), '[]'::jsonb),
    'devices', (select count(*) from public.device_accounts where user_id = p_user),
    'push_devices', (select count(*) from public.push_subscriptions where user_id = p_user),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'subject', subject, 'status', status, 'created_at', created_at) order by created_at desc)
        from public.support_tickets where user_id = p_user), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'kind', kind, 'status', status, 'created_at', created_at) order by created_at desc)
        from public.user_reports where user_id = p_user), '[]'::jsonb),
    'feedback', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'rating', rating, 'feedback', feedback, 'status', status, 'created_at', created_at))
        from public.product_feedback where user_id = p_user), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('action', action, 'admin_email', admin_email, 'created_at', created_at, 'before', before, 'after', after) order by created_at desc)
        from (select * from public.admin_audit_log where object_id = p_user::text order by created_at desc limit 30) a), '[]'::jsonb)
  ) into res;
  return res;
end $$;
