-- Zest Snap admin console (2026-10-05).
-- Additive and idempotent. RLS stays enabled everywhere; every privileged body lives in the unexposed
-- private schema, checks the caller's admin role itself, and is reached through a SECURITY INVOKER
-- wrapper in public. No secrets, tokens or document contents are read or stored here.

create schema if not exists private;

------------------------------------------------------------------------------------------
-- 1. Admin roles. profiles.is_admin stays the master switch; roles narrow what an admin may do.
------------------------------------------------------------------------------------------
create table if not exists public.admin_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'support', 'analyst')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null
);
alter table public.admin_roles enable row level security;
revoke all on public.admin_roles from anon, authenticated;
grant select on public.admin_roles to authenticated;
grant all on public.admin_roles to service_role;
drop policy if exists admin_roles_admin_read on public.admin_roles;
create policy admin_roles_admin_read on public.admin_roles for select to authenticated using (private.is_admin());

-- The existing owner account keeps (and is promoted to) owner; every other existing admin becomes 'admin'.
insert into public.admin_roles(user_id, role)
select p.id, case when lower(u.email) = 'sandisops@gmail.com' then 'owner' else 'admin' end
  from public.profiles p join auth.users u on u.id = p.id
 where p.is_admin
on conflict (user_id) do nothing;

create or replace function private.current_admin_role() returns text
language sql stable security definer set search_path = '' as $$
  select case when p.is_admin then coalesce(r.role, 'admin') end
    from public.profiles p left join public.admin_roles r on r.user_id = p.id
   where p.id = (select auth.uid())
$$;
revoke all on function private.current_admin_role() from public, anon;
grant execute on function private.current_admin_role() to authenticated, service_role;

-- Permission ladder: view < support < operate < owner. 'export' is operate + analyst.
create or replace function private.require_admin(p_perm text default 'view') returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare r text := private.current_admin_role();
begin
  if r is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_perm = 'view'
     or (p_perm = 'support' and r in ('owner', 'admin', 'support'))
     or (p_perm = 'operate' and r in ('owner', 'admin'))
     or (p_perm = 'export' and r in ('owner', 'admin', 'analyst'))
     or (p_perm = 'owner' and r = 'owner') then
    return (select auth.uid());
  end if;
  raise exception 'forbidden_role' using errcode = '42501';
end $$;
revoke all on function private.require_admin(text) from public, anon, authenticated;

------------------------------------------------------------------------------------------
-- 2. Append-only audit log (written only by the functions below).
------------------------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users(id) on delete set null,
  admin_email text,
  action text not null,
  object_type text not null,
  object_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit_log(created_at desc);
create index if not exists admin_audit_object_idx on public.admin_audit_log(object_type, object_id);
create index if not exists admin_audit_admin_idx on public.admin_audit_log(admin_id);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;
grant all on public.admin_audit_log to service_role;
drop policy if exists admin_audit_read on public.admin_audit_log;
create policy admin_audit_read on public.admin_audit_log for select to authenticated using (private.is_admin());

create or replace function private.audit(p_action text, p_type text, p_id text, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.admin_audit_log(admin_id, admin_email, action, object_type, object_id, before, after)
  values ((select auth.uid()), (select email from auth.users where id = (select auth.uid())), p_action, p_type, p_id, p_before, p_after)
$$;
revoke all on function private.audit(text, text, text, jsonb, jsonb) from public, anon, authenticated;

------------------------------------------------------------------------------------------
-- 3. Commercial plan catalog: plan_rules becomes the single source for pricing and entitlements.
------------------------------------------------------------------------------------------
alter table public.plan_rules add column if not exists name text;
alter table public.plan_rules add column if not exists description text not null default '';
alter table public.plan_rules add column if not exists monthly_price numeric(10,2) not null default 0 check (monthly_price >= 0 and monthly_price <= 10000);
alter table public.plan_rules add column if not exists annual_price numeric(10,2) check (annual_price is null or (annual_price >= 0 and annual_price <= 100000));
alter table public.plan_rules add column if not exists currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$');
alter table public.plan_rules add column if not exists smart_reminders boolean not null default false;
alter table public.plan_rules add column if not exists bulk_extraction boolean not null default false;
alter table public.plan_rules add column if not exists priority_processing boolean not null default false;
alter table public.plan_rules add column if not exists rewards_multiplier numeric(4,2) not null default 1 check (rewards_multiplier between 0 and 10);
alter table public.plan_rules add column if not exists calendar_integrations boolean not null default true;
alter table public.plan_rules add column if not exists is_public boolean not null default true;
alter table public.plan_rules add column if not exists recommended boolean not null default false;
alter table public.plan_rules add column if not exists display_order integer not null default 0;
alter table public.plan_rules add column if not exists updated_at timestamptz not null default now();

-- Seed from the values the marketing site already shows (lib/product-config.ts) without overwriting edits.
update public.plan_rules set name = 'Free', monthly_price = 0, display_order = 1,
  description = 'Event review, calendar export and your upcoming agenda.'
 where id = 'free' and name is null;
update public.plan_rules set name = 'Zest Snap+', monthly_price = 4.99, display_order = 2, recommended = true,
  smart_reminders = true, bulk_extraction = true, priority_processing = true, rewards_multiplier = 1.25,
  description = 'Richer AI understanding for everything with a date.'
 where id = 'plus' and name is null;
update public.plan_rules set name = 'Business', monthly_price = 11.99, display_order = 3,
  smart_reminders = true, bulk_extraction = true, priority_processing = true, rewards_multiplier = 1.5,
  description = 'Business deadlines and advanced document workflows.'
 where id = 'business' and name is null;

-- Pricing is public information: the marketing site reads it without a session.
grant select on public.plan_rules to anon;
drop policy if exists plan_public_read on public.plan_rules;
create policy plan_public_read on public.plan_rules for select to anon using (is_public);

alter table public.reward_rules add column if not exists label text;
alter table public.reward_rules add column if not exists updated_at timestamptz not null default now();
update public.reward_rules set label = case key
  when 'first_scan' then 'First scan'
  when 'first_calendar' then 'First calendar add'
  when 'first_planner_item' then 'First Planner item'
  when 'first_reminder' then 'First reminder'
  when 'first_completed_task' then 'First completed task'
  when 'organised_5_scans' then '5 scans organised'
  when 'organised_10_scans' then '10 scans organised'
  when 'referral_qualified' then 'Qualified referral'
  when 'product_feedback' then 'Product feedback'
  when 'referral_bonus_scans' then 'Referral bonus scans (legacy)'
  else initcap(replace(key, '_', ' ')) end
 where label is null;

------------------------------------------------------------------------------------------
-- 4. Account administration, activity and scan metadata.
------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists account_status text not null default 'active' check (account_status in ('active', 'disabled'));
alter table public.profiles add column if not exists support_flag boolean not null default false;
alter table public.profiles add column if not exists support_note text check (support_note is null or char_length(support_note) <= 1000);
alter table public.profiles add column if not exists last_active_at timestamptz;

-- Daily activity is recorded from today onward. Nothing is back-filled or estimated.
create table if not exists public.user_activity_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  hits integer not null default 1,
  primary key (user_id, day)
);
create index if not exists user_activity_day_idx on public.user_activity_daily(day);
alter table public.user_activity_daily enable row level security;
revoke all on public.user_activity_daily from anon, authenticated;
grant select on public.user_activity_daily to authenticated;
grant all on public.user_activity_daily to service_role;
drop policy if exists activity_admin_read on public.user_activity_daily;
create policy activity_admin_read on public.user_activity_daily for select to authenticated using (private.is_admin());

create or replace function private.record_activity() returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then return; end if;
  insert into public.user_activity_daily(user_id, day) values (u, (now() at time zone 'UTC')::date)
  on conflict (user_id, day) do update set last_seen_at = now(), hits = least(public.user_activity_daily.hits + 1, 100000);
  update public.profiles set last_active_at = now() where id = u;
end $$;
revoke all on function private.record_activity() from public, anon;
grant execute on function private.record_activity() to authenticated;
create or replace function public.record_activity() returns void
language sql security invoker set search_path = '' as $$ select private.record_activity() $$;
revoke all on function public.record_activity() from public, anon;
grant execute on function public.record_activity() to authenticated;

-- Content-free scan metadata for operations (written by the server after each scan).
alter table public.scan_requests add column if not exists mime_type text;
alter table public.scan_requests add column if not exists page_count integer check (page_count is null or page_count >= 0);
alter table public.scan_requests add column if not exists event_count integer check (event_count is null or event_count >= 0);
alter table public.scan_requests add column if not exists warning_count integer check (warning_count is null or warning_count >= 0);
alter table public.scan_requests add column if not exists duration_ms integer check (duration_ms is null or duration_ms >= 0);
alter table public.scan_requests add column if not exists error_code text check (error_code is null or error_code ~ '^[a-z_]{1,40}$');
alter table public.scan_requests add column if not exists model text check (model is null or char_length(model) <= 80);
alter table public.guest_scan_usage add column if not exists mime_type text;
alter table public.guest_scan_usage add column if not exists event_count integer check (event_count is null or event_count >= 0);
alter table public.guest_scan_usage add column if not exists duration_ms integer check (duration_ms is null or duration_ms >= 0);
alter table public.guest_scan_usage add column if not exists error_code text check (error_code is null or error_code ~ '^[a-z_]{1,40}$');
create index if not exists scan_requests_created_idx on public.scan_requests(created_at desc);
create index if not exists guest_scan_usage_created_idx on public.guest_scan_usage(created_at desc);
create index if not exists planner_items_created_idx on public.planner_items(created_at);
create index if not exists reminders_created_idx on public.reminders(created_at);
create index if not exists reward_ledger_created_idx on public.reward_ledger(created_at);
create index if not exists profiles_created_idx on public.profiles(created_at);

alter table public.subscriptions add column if not exists created_at timestamptz not null default now();
alter table public.subscriptions add column if not exists canceled_at timestamptz;

------------------------------------------------------------------------------------------
-- 5. Payments ledger (empty until a payment provider is connected; written only by the server).
------------------------------------------------------------------------------------------
create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  provider_ref text not null,
  kind text not null check (kind in ('charge', 'refund')),
  status text not null check (status in ('succeeded', 'failed', 'pending')),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  plan public.plan_code,
  country_code text,
  failure_reason text,
  occurred_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index if not exists payment_transactions_time_idx on public.payment_transactions(occurred_at desc);
alter table public.payment_transactions enable row level security;
revoke all on public.payment_transactions from anon, authenticated;
grant select on public.payment_transactions to authenticated;
grant all on public.payment_transactions to service_role;
drop policy if exists payments_admin_read on public.payment_transactions;
create policy payments_admin_read on public.payment_transactions for select to authenticated using (private.is_admin());

------------------------------------------------------------------------------------------
-- 6. Support tickets, problem reports, feedback triage and announcements.
------------------------------------------------------------------------------------------
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 1001) unique,
  user_id uuid references auth.users(id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 200),
  category text not null default 'other' check (category in ('account','billing','scan','planner','reminder','calendar','app','suggestion','other')),
  status text not null default 'new' check (status in ('new','open','waiting','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_id uuid references auth.users(id) on delete set null,
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  context jsonb not null default '{}' check (octet_length(context::text) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz
);
create index if not exists support_tickets_status_idx on public.support_tickets(status, last_message_at desc);
create index if not exists support_tickets_user_idx on public.support_tickets(user_id);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  from_staff boolean not null default false,
  internal boolean not null default false,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on public.support_messages(ticket_id, created_at);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 5001) unique,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('bug','broken_feature','scan_problem','incorrect_extraction','reminder','calendar','billing','other')),
  description text not null check (char_length(description) between 1 and 4000),
  route text check (route is null or char_length(route) <= 300),
  app_version text check (app_version is null or char_length(app_version) <= 60),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  request_id text check (request_id is null or request_id ~ '^[0-9a-fA-F-]{36}$'),
  status text not null default 'new' check (status in ('new','triaged','in_progress','resolved','wont_fix')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists user_reports_status_idx on public.user_reports(status, created_at desc);

create table if not exists public.user_report_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.user_reports(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

alter table public.product_feedback add column if not exists status text not null default 'new' check (status in ('new','reviewed','planned','resolved','archived'));
alter table public.product_feedback add column if not exists admin_note text check (admin_note is null or char_length(admin_note) <= 2000);
alter table public.product_feedback add column if not exists reviewed_at timestamptz;
create index if not exists product_feedback_created_idx on public.product_feedback(created_at desc);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  audience text not null default 'all' check (audience in ('all','free','plus','business','selected')),
  user_ids uuid[] not null default '{}' check (cardinality(user_ids) <= 500),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.user_reports enable row level security;
alter table public.user_report_notes enable row level security;
alter table public.announcements enable row level security;
revoke all on public.support_tickets, public.support_messages, public.user_reports, public.user_report_notes, public.announcements from anon, authenticated;
grant select on public.support_tickets, public.support_messages, public.user_reports, public.user_report_notes, public.announcements to authenticated;
grant all on public.support_tickets, public.support_messages, public.user_reports, public.user_report_notes, public.announcements to service_role;

drop policy if exists tickets_read on public.support_tickets;
create policy tickets_read on public.support_tickets for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists messages_read on public.support_messages;
create policy messages_read on public.support_messages for select to authenticated
  using (private.is_admin() or (not internal and exists (
    select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = (select auth.uid()))));
drop policy if exists reports_read on public.user_reports;
create policy reports_read on public.user_reports for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists report_notes_read on public.user_report_notes;
create policy report_notes_read on public.user_report_notes for select to authenticated using (private.is_admin());
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select to authenticated using (
  private.is_admin() or (
    status = 'published' and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
    and (audience = 'all'
      or (audience = 'selected' and (select auth.uid()) = any(user_ids))
      or (audience in ('free','plus','business') and exists (
        select 1 from public.profiles p where p.id = (select auth.uid()) and p.plan::text = audience)))));

drop policy if exists feedback_admin_read on public.product_feedback;
create policy feedback_admin_read on public.product_feedback for select to authenticated using (private.is_admin());

------------------------------------------------------------------------------------------
-- 7. User-facing support and problem-report entry points.
------------------------------------------------------------------------------------------
create or replace function private.create_support_ticket(p_subject text, p_category text, p_body text, p_context jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); t public.support_tickets;
begin
  if u is null then raise exception 'authentication_required'; end if;
  if (select count(*) from public.support_tickets where user_id = u and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too_many_requests';
  end if;
  if nullif(trim(coalesce(p_body, '')), '') is null then raise exception 'message_required'; end if;
  insert into public.support_tickets(user_id, subject, category, context)
  values (u, left(coalesce(nullif(trim(p_subject), ''), 'Support request'), 200),
          case when p_category in ('account','billing','scan','planner','reminder','calendar','app','suggestion','other') then p_category else 'other' end,
          jsonb_strip_nulls(jsonb_build_object(
            'route', left(p_context ->> 'route', 300),
            'appVersion', left(p_context ->> 'appVersion', 60),
            'userAgent', left(p_context ->> 'userAgent', 400),
            'timezone', left(p_context ->> 'timezone', 60))))
  returning * into t;
  insert into public.support_messages(ticket_id, author_id, body) values (t.id, u, left(trim(p_body), 5000));
  return jsonb_build_object('id', t.id, 'number', t.number);
end $$;
revoke all on function private.create_support_ticket(text, text, text, jsonb) from public, anon;
grant execute on function private.create_support_ticket(text, text, text, jsonb) to authenticated;
create or replace function public.create_support_ticket(p_subject text, p_category text, p_body text, p_context jsonb default '{}')
returns jsonb language sql security invoker set search_path = '' as $$ select private.create_support_ticket(p_subject, p_category, p_body, p_context) $$;
revoke all on function public.create_support_ticket(text, text, text, jsonb) from public, anon;
grant execute on function public.create_support_ticket(text, text, text, jsonb) to authenticated;

create or replace function private.reply_support_ticket(p_ticket uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'authentication_required'; end if;
  if nullif(trim(coalesce(p_body, '')), '') is null then raise exception 'message_required'; end if;
  if not exists (select 1 from public.support_tickets where id = p_ticket and user_id = u) then raise exception 'not_found'; end if;
  insert into public.support_messages(ticket_id, author_id, body) values (p_ticket, u, left(trim(p_body), 5000));
  update public.support_tickets set last_message_at = now(), updated_at = now(),
    status = case when status in ('waiting','resolved','closed') then 'open' else status end
   where id = p_ticket;
end $$;
revoke all on function private.reply_support_ticket(uuid, text) from public, anon;
grant execute on function private.reply_support_ticket(uuid, text) to authenticated;
create or replace function public.reply_support_ticket(p_ticket uuid, p_body text)
returns void language sql security invoker set search_path = '' as $$ select private.reply_support_ticket(p_ticket, p_body) $$;
revoke all on function public.reply_support_ticket(uuid, text) from public, anon;
grant execute on function public.reply_support_ticket(uuid, text) to authenticated;

create or replace function private.submit_user_report(p_kind text, p_description text, p_context jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); r public.user_reports; rid text := p_context ->> 'requestId';
begin
  if u is null then raise exception 'authentication_required'; end if;
  if (select count(*) from public.user_reports where user_id = u and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_requests';
  end if;
  if nullif(trim(coalesce(p_description, '')), '') is null then raise exception 'message_required'; end if;
  insert into public.user_reports(user_id, kind, description, route, app_version, user_agent, request_id)
  values (u,
          case when p_kind in ('bug','broken_feature','scan_problem','incorrect_extraction','reminder','calendar','billing','other') then p_kind else 'other' end,
          left(trim(p_description), 4000), left(p_context ->> 'route', 300), left(p_context ->> 'appVersion', 60),
          left(p_context ->> 'userAgent', 400), case when rid ~ '^[0-9a-fA-F-]{36}$' then rid end)
  returning * into r;
  return jsonb_build_object('id', r.id, 'number', r.number);
end $$;
revoke all on function private.submit_user_report(text, text, jsonb) from public, anon;
grant execute on function private.submit_user_report(text, text, jsonb) to authenticated;
create or replace function public.submit_user_report(p_kind text, p_description text, p_context jsonb default '{}')
returns jsonb language sql security invoker set search_path = '' as $$ select private.submit_user_report(p_kind, p_description, p_context) $$;
revoke all on function public.submit_user_report(text, text, jsonb) from public, anon;
grant execute on function public.submit_user_report(text, text, jsonb) to authenticated;

------------------------------------------------------------------------------------------
-- 8. Admin read functions. All return jsonb and verify the caller's role first.
------------------------------------------------------------------------------------------
create or replace function private.user_email(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$ select email from auth.users where id = p_user $$;
revoke all on function private.user_email(uuid) from public, anon, authenticated;

-- Every real, recorded signal that a person used Zest Snap. Nothing is inferred.
create or replace function private.activity(p_from timestamptz, p_to timestamptz)
returns table(user_id uuid, at timestamptz) language sql stable security definer set search_path = '' as $$
  select user_id, last_seen_at from public.user_activity_daily
   where day between (p_from at time zone 'UTC')::date and (p_to at time zone 'UTC')::date
     and last_seen_at >= p_from and first_seen_at < p_to
  union all select user_id, created_at from public.scan_requests where created_at >= p_from and created_at < p_to
  union all select user_id, created_at from public.planner_items where created_at >= p_from and created_at < p_to
  union all select user_id, completed_at from public.planner_items where completed_at >= p_from and completed_at < p_to
  union all select user_id, created_at from public.product_feedback where created_at >= p_from and created_at < p_to
$$;
revoke all on function private.activity(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function private.active_users(p_from timestamptz, p_to timestamptz) returns bigint
language sql stable security definer set search_path = '' as $$ select count(distinct user_id) from private.activity(p_from, p_to) $$;
revoke all on function private.active_users(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function private.payments_connected() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.payment_transactions) or exists (select 1 from public.subscriptions where provider is not null)
$$;
revoke all on function private.payments_connected() from public, anon, authenticated;

create or replace function private.admin_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := private.require_admin('view');
begin
  return jsonb_build_object('id', u, 'role', private.current_admin_role(), 'email', private.user_email(u),
    'name', (select display_name from public.profiles where id = u));
end $$;

create or replace function private.admin_overview(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  span interval := p_to - p_from; pf timestamptz := p_from - (p_to - p_from);
  today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  month timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  res jsonb;
begin
  perform private.require_admin('view');
  if p_to <= p_from or span > interval '800 days' then raise exception 'invalid_range'; end if;
  select jsonb_build_object(
    'users_total', (select count(*) from public.profiles where created_at < p_to),
    'users_total_prev', (select count(*) from public.profiles where created_at < p_from),
    'new_users', (select count(*) from public.profiles where created_at >= p_from and created_at < p_to),
    'new_users_prev', (select count(*) from public.profiles where created_at >= pf and created_at < p_from),
    'new_users_today', (select count(*) from public.profiles where created_at >= today),
    'new_users_month', (select count(*) from public.profiles where created_at >= month),
    'active_today', private.active_users(today, now()),
    'active_7d', private.active_users(now() - interval '7 days', now()),
    'active_30d', private.active_users(now() - interval '30 days', now()),
    'active_period', private.active_users(p_from, p_to),
    'active_prev', private.active_users(pf, p_from),
    'scans_total', (select count(*) from public.scan_requests) + (select count(*) from public.guest_scan_usage),
    'scans_period', (select count(*) from public.scan_requests where created_at >= p_from and created_at < p_to)
                  + (select count(*) from public.guest_scan_usage where created_at >= p_from and created_at < p_to),
    'scans_prev', (select count(*) from public.scan_requests where created_at >= pf and created_at < p_from)
                + (select count(*) from public.guest_scan_usage where created_at >= pf and created_at < p_from),
    'account_scans_period', (select count(*) from public.scan_requests where created_at >= p_from and created_at < p_to),
    'scans_today', (select count(*) from public.scan_requests where created_at >= today) + (select count(*) from public.guest_scan_usage where created_at >= today),
    'scans_month', (select count(*) from public.scan_requests where created_at >= month) + (select count(*) from public.guest_scan_usage where created_at >= month),
    'scans_failed_period', (select count(*) from public.scan_requests where status = 'failed' and created_at >= p_from and created_at < p_to)
                         + (select count(*) from public.guest_scan_usage where status = 'failed' and created_at >= p_from and created_at < p_to),
    'saved_scans_total', (select count(*) from public.scans),
    'planner_period', (select count(*) from public.planner_items where created_at >= p_from and created_at < p_to),
    'planner_prev', (select count(*) from public.planner_items where created_at >= pf and created_at < p_from),
    'planner_total', (select count(*) from public.planner_items),
    'todos_done_period', (select count(*) from public.planner_items where type in ('task','deadline') and status = 'completed' and completed_at >= p_from and completed_at < p_to),
    'todos_done_prev', (select count(*) from public.planner_items where type in ('task','deadline') and status = 'completed' and completed_at >= pf and completed_at < p_from),
    'reminders_period', (select count(*) from public.reminders where created_at >= p_from and created_at < p_to),
    'reminders_prev', (select count(*) from public.reminders where created_at >= pf and created_at < p_from),
    'calendar_connections', (select count(*) from public.calendar_connections),
    'calendar_saves_period', (select count(*) from public.events where exported_at >= p_from and exported_at < p_to),
    'subscribers', (select count(*) from public.subscriptions where status in ('active','trialing') and plan <> 'free'),
    'paid_profiles', (select count(*) from public.profiles where plan <> 'free'),
    'payments_connected', private.payments_connected(),
    'mrr', (select jsonb_object_agg(currency, amount) from (
              select r.currency, sum(r.monthly_price) amount from public.subscriptions s join public.plan_rules r on r.id = s.plan
               where s.status in ('active','trialing') and s.plan <> 'free' and s.provider is not null group by r.currency) m),
    'revenue_month', (select jsonb_object_agg(currency, amount) from (
              select currency, sum(case when kind = 'charge' then amount_cents else -amount_cents end) / 100.0 amount
                from public.payment_transactions where status = 'succeeded' and occurred_at >= month group by currency) m),
    'revenue_period', (select jsonb_object_agg(currency, amount) from (
              select currency, sum(case when kind = 'charge' then amount_cents else -amount_cents end) / 100.0 amount
                from public.payment_transactions where status = 'succeeded' and occurred_at >= p_from and occurred_at < p_to group by currency) m),
    'ai_cost_period', (select sum(estimated_cost_usd) from public.scan_requests where created_at >= p_from and created_at < p_to),
    'ai_cost_rows', (select count(*) from public.scan_requests where estimated_cost_usd is not null and created_at >= p_from and created_at < p_to),
    'ai_tokens_period', (select sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) from public.scan_requests where created_at >= p_from and created_at < p_to),
    'referrals_total', (select count(*) from public.referrals),
    'referrals_qualified', (select count(*) from public.referrals where status in ('qualified','rewarded')),
    'rating_avg', (select round(avg(rating)::numeric, 2) from public.product_feedback where rating is not null),
    'rating_count', (select count(rating) from public.product_feedback),
    'rating_avg_period', (select round(avg(rating)::numeric, 2) from public.product_feedback where rating is not null and created_at >= p_from and created_at < p_to),
    'plan_distribution', (select jsonb_object_agg(plan, n) from (select plan::text plan, count(*) n from public.profiles group by plan) d),
    'returning_users', (select count(distinct a.user_id) from private.activity(p_from, p_to) a join public.profiles p on p.id = a.user_id where p.created_at < p_from),
    'repeat_scanners', (select count(*) from (select user_id from public.scan_requests where created_at >= p_from and created_at < p_to group by user_id having count(*) >= 2) x),
    'planner_users', (select count(distinct user_id) from public.planner_items where created_at >= p_from and created_at < p_to),
    'reminder_users', (select count(distinct user_id) from public.reminders where created_at >= p_from and created_at < p_to),
    'calendar_providers', (select jsonb_object_agg(provider, n) from (select provider::text provider, count(*) n from public.calendar_connections group by provider) c),
    'activity_tracking_since', (select min(day) from public.user_activity_daily),
    'first_signup', (select min(created_at) from public.profiles)
  ) into res;
  return res;
end $$;

create or replace function private.admin_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text default 'day') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare step interval; b text := case when p_bucket in ('day','week','month') then p_bucket else 'day' end;
begin
  perform private.require_admin('view');
  if p_to <= p_from or p_to - p_from > interval '800 days' then raise exception 'invalid_range'; end if;
  step := ('1 ' || b)::interval;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'd', to_char(s.d, 'YYYY-MM-DD'),
      'signups', (select count(*) from public.profiles where created_at >= s.d and created_at < s.d + step),
      'active', private.active_users(greatest(s.d, p_from), least(s.d + step, p_to)),
      'scans_ok', (select count(*) from public.scan_requests where status = 'completed' and created_at >= s.d and created_at < s.d + step)
                + (select count(*) from public.guest_scan_usage where status = 'completed' and created_at >= s.d and created_at < s.d + step),
      'scans_failed', (select count(*) from public.scan_requests where status = 'failed' and created_at >= s.d and created_at < s.d + step)
                    + (select count(*) from public.guest_scan_usage where status = 'failed' and created_at >= s.d and created_at < s.d + step),
      'planner', (select count(*) from public.planner_items where created_at >= s.d and created_at < s.d + step),
      'todos_done', (select count(*) from public.planner_items where type in ('task','deadline') and completed_at >= s.d and completed_at < s.d + step),
      'reminders', (select count(*) from public.reminders where created_at >= s.d and created_at < s.d + step),
      'calendar_saves', (select count(*) from public.events where exported_at >= s.d and exported_at < s.d + step),
      'feedback', (select count(*) from public.product_feedback where created_at >= s.d and created_at < s.d + step),
      'rating_avg', (select round(avg(rating)::numeric, 2) from public.product_feedback where rating is not null and created_at >= s.d and created_at < s.d + step),
      'new_subs', (select count(*) from public.subscriptions where plan <> 'free' and created_at >= s.d and created_at < s.d + step),
      'cancellations', (select count(*) from public.subscriptions where canceled_at >= s.d and canceled_at < s.d + step),
      'revenue', (select coalesce(sum(case when kind = 'charge' then amount_cents else -amount_cents end), 0) / 100.0
                    from public.payment_transactions where status = 'succeeded' and occurred_at >= s.d and occurred_at < s.d + step),
      'ai_requests', (select count(*) from public.scan_requests where created_at >= s.d and created_at < s.d + step),
      'ai_tokens', (select coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0) from public.scan_requests where created_at >= s.d and created_at < s.d + step)
    ) order by s.d)
    from generate_series(date_trunc(b, p_from at time zone 'UTC') at time zone 'UTC', p_to - interval '1 second', step) s(d)
  ), '[]'::jsonb);
end $$;

create or replace function private.admin_attention() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return jsonb_build_object(
    'tickets_new', (select count(*) from public.support_tickets where status = 'new'),
    'tickets_urgent', (select count(*) from public.support_tickets where status in ('new','open') and priority in ('high','urgent')),
    'tickets_open', (select count(*) from public.support_tickets where status in ('new','open')),
    'reports_new', (select count(*) from public.user_reports where status = 'new'),
    'feedback_new', (select count(*) from public.product_feedback where status = 'new'),
    'low_ratings_7d', (select count(*) from public.product_feedback where rating <= 2 and created_at > now() - interval '7 days'),
    'failed_scans_24h', (select count(*) from public.scan_requests where status = 'failed' and created_at > now() - interval '1 day')
                      + (select count(*) from public.guest_scan_usage where status = 'failed' and created_at > now() - interval '1 day'),
    'scans_24h', (select count(*) from public.scan_requests where created_at > now() - interval '1 day')
               + (select count(*) from public.guest_scan_usage where created_at > now() - interval '1 day'),
    'stuck_scans', (select count(*) from public.scan_requests where status = 'reserved' and created_at < now() - interval '10 minutes'),
    'reminders_failed_24h', (select count(*) from public.reminders where status = 'failed' and created_at > now() - interval '1 day'),
    'reminders_overdue', (select count(*) from public.reminders where status = 'pending' and scheduled_at < now() - interval '15 minutes'),
    'push_failing', (select count(*) from public.push_subscriptions where failure_count > 0),
    'flagged_users', (select count(*) from public.profiles where support_flag)
  );
end $$;

create or replace function private.admin_users(p_search text default null, p_filter text default null, p_sort text default 'created_desc',
  p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(trim(coalesce(p_search, '')), ''); lim integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  period date := date_trunc('month', now() at time zone 'UTC')::date; res jsonb;
begin
  perform private.require_admin('view');
  with base as (
    select p.id, p.display_name, u.email, p.created_at, p.plan::text plan, p.country_code, p.locale, p.timezone,
           p.account_status, p.support_flag, p.is_admin, u.last_sign_in_at,
           greatest(p.last_active_at, u.last_sign_in_at,
             (select max(created_at) from public.scan_requests r where r.user_id = p.id),
             (select max(created_at) from public.planner_items i where i.user_id = p.id)) last_active,
           (select s.status from public.subscriptions s where s.user_id = p.id) sub_status,
           coalesce((select ai_scans from public.usage_monthly m where m.user_id = p.id and m.period_start = period), 0) scans_month,
           (select count(*) from public.scan_requests r where r.user_id = p.id and r.created_at > now() - interval '30 days') scans_30d,
           (select count(*) from public.planner_items i where i.user_id = p.id) planner_count,
           coalesce((select sum(amount) from public.reward_ledger l where l.user_id = p.id), 0) credits,
           exists (select 1 from public.calendar_connections c where c.user_id = p.id) calendar_connected,
           exists (select 1 from public.referrals f where f.referred_user_id = p.id) referred
      from public.profiles p join auth.users u on u.id = p.id
     where q is null or u.email ilike '%' || q || '%' or p.display_name ilike '%' || q || '%' or p.id::text = lower(q)
  ), filtered as (
    select * from base b where case coalesce(p_filter, '')
      when 'free' then plan = 'free' when 'plus' then plan = 'plus' when 'business' then plan = 'business'
      when 'active' then last_active > now() - interval '30 days'
      when 'inactive' then last_active is null or last_active <= now() - interval '30 days'
      when 'today' then created_at >= date_trunc('day', now())
      when 'week' then created_at >= now() - interval '7 days'
      when 'heavy' then scans_30d >= 20
      when 'no_activity' then scans_30d = 0 and planner_count = 0
      when 'calendar' then calendar_connected
      when 'referral' then referred
      when 'disabled' then account_status = 'disabled'
      when 'flagged' then support_flag
      when 'admins' then is_admin
      else true end
  )
  select jsonb_build_object('total', (select count(*) from filtered), 'rows', coalesce((
    select jsonb_agg(to_jsonb(f) order by
      case when p_sort = 'created_asc' then f.created_at end asc,
      case when p_sort = 'active_desc' then f.last_active end desc nulls last,
      case when p_sort = 'name' then lower(coalesce(f.display_name, f.email)) end asc,
      case when p_sort = 'scans_desc' then f.scans_month end desc,
      f.created_at desc)
    from (select * from filtered order by
      case when p_sort = 'created_asc' then created_at end asc,
      case when p_sort = 'active_desc' then last_active end desc nulls last,
      case when p_sort = 'name' then lower(coalesce(display_name, email)) end asc,
      case when p_sort = 'scans_desc' then scans_month end desc,
      created_at desc
      limit lim offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb)) into res;
  return res;
end $$;

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
    'calendar', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'connected_at', connected_at, 'last_sync_at', last_sync_at))
        from public.calendar_connections where user_id = p_user), '[]'::jsonb),
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

create or replace function private.admin_search(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := left(trim(coalesce(p_q, '')), 100); n bigint;
begin
  perform private.require_admin('view');
  if char_length(q) < 2 then return jsonb_build_object('users', '[]'::jsonb, 'scans', '[]'::jsonb, 'tickets', '[]'::jsonb, 'reports', '[]'::jsonb, 'referrals', '[]'::jsonb); end if;
  n := case when q ~ '^#?[0-9]{1,12}$' then ltrim(q, '#')::bigint end;
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(x) from (select p.id, p.display_name name, u.email, p.plan from public.profiles p join auth.users u on u.id = p.id
        where u.email ilike '%' || q || '%' or p.display_name ilike '%' || q || '%' or p.id::text like lower(q) || '%' order by p.created_at desc limit 8) x), '[]'::jsonb),
    'scans', coalesce((select jsonb_agg(x) from (select id, user_id, status, created_at from public.scan_requests where id::text like lower(q) || '%' limit 8) x), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(x) from (select id, number, subject, status from public.support_tickets
        where number = n or subject ilike '%' || q || '%' order by created_at desc limit 8) x), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(x) from (select id, number, kind, status, left(description, 120) description from public.user_reports
        where number = n or description ilike '%' || q || '%' or request_id = lower(q) order by created_at desc limit 8) x), '[]'::jsonb),
    'referrals', coalesce((select jsonb_agg(x) from (select i.code, i.user_id, private.user_email(i.user_id) email,
        (select count(*) from public.referrals r where r.referral_code = i.code) uses from public.referral_invites i where i.code ilike q || '%' limit 8) x), '[]'::jsonb));
end $$;

create or replace function private.admin_scans(p_from timestamptz, p_to timestamptz, p_status text default null, p_kind text default null,
  p_source text default null, p_user uuid default null, p_limit integer default 50, p_offset integer default 0, p_request uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform private.require_admin('view');
  return (with all_scans as (
      select id, 'account' source, user_id, created_at, completed_at, status, mime_type, page_count, event_count, warning_count,
             duration_ms, error_code, model, input_tokens, output_tokens, estimated_cost_usd
        from public.scan_requests where (p_request is not null and id = p_request) or (p_request is null and created_at >= p_from and created_at < p_to)
      union all
      select request_id, 'guest', null, created_at, completed_at, status, mime_type, null, event_count, null, duration_ms, error_code, null, null, null, null
        from public.guest_scan_usage where p_user is null
         and ((p_request is not null and request_id = p_request) or (p_request is null and created_at >= p_from and created_at < p_to))
    ), f as (
      select * from all_scans where (p_status is null or status = p_status)
        and (p_kind is null or (p_kind = 'pdf' and mime_type = 'application/pdf') or (p_kind = 'image' and mime_type like 'image/%') or (p_kind = 'unknown' and mime_type is null))
        and (p_source is null or source = p_source) and (p_user is null or user_id = p_user)
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'stats', (select jsonb_build_object('completed', count(*) filter (where status = 'completed'), 'failed', count(*) filter (where status = 'failed'),
          'reserved', count(*) filter (where status = 'reserved'), 'avg_duration_ms', round(avg(duration_ms)), 'avg_events', round(avg(event_count)::numeric, 2)) from f),
      'rows', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('email', private.user_email(r.user_id)) order by r.created_at desc)
          from (select * from f order by created_at desc limit lim offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb)));
end $$;

create or replace function private.admin_usage(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return jsonb_build_object(
    'scanning', (with s as (
        select user_id, status, mime_type, event_count, error_code, 'account' source from public.scan_requests where created_at >= p_from and created_at < p_to
        union all select null, status, mime_type, event_count, error_code, 'guest' from public.guest_scan_usage where created_at >= p_from and created_at < p_to)
      select jsonb_build_object('total', count(*), 'completed', count(*) filter (where status = 'completed'),
        'failed', count(*) filter (where status = 'failed'), 'multi_event', count(*) filter (where event_count > 1),
        'account', count(*) filter (where source = 'account'), 'guest', count(*) filter (where source = 'guest'),
        'users', count(distinct user_id),
        'by_type', (select jsonb_object_agg(k, n) from (select coalesce(mime_type, 'not recorded') k, count(*) n from s group by 1) t),
        'errors', (select jsonb_object_agg(k, n) from (select error_code k, count(*) n from s where error_code is not null group by 1) t)) from s),
    'planner', (select jsonb_build_object('created', count(*) filter (where created_at >= p_from and created_at < p_to),
        'events', count(*) filter (where type = 'event' and created_at >= p_from and created_at < p_to),
        'tasks', count(*) filter (where type = 'task' and created_at >= p_from and created_at < p_to),
        'deadlines', count(*) filter (where type = 'deadline' and created_at >= p_from and created_at < p_to),
        'from_scans', count(*) filter (where source = 'scan' and created_at >= p_from and created_at < p_to),
        'completed', count(*) filter (where completed_at >= p_from and completed_at < p_to),
        'open_total', count(*) filter (where status = 'open'),
        'overdue', count(*) filter (where status = 'open' and coalesce(due_date, start_date) < current_date),
        'upcoming', count(*) filter (where status = 'open' and coalesce(due_date, start_date) >= current_date)) from public.planner_items),
    'todo', (select jsonb_build_object('created', count(*) filter (where created_at >= p_from and created_at < p_to),
        'completed', count(*) filter (where completed_at >= p_from and completed_at < p_to),
        'completed_of_created', count(*) filter (where created_at >= p_from and created_at < p_to and status = 'completed'))
      from public.planner_items where type in ('task','deadline')),
    'reminders', (select jsonb_build_object('created', count(*), 'sent', count(*) filter (where status = 'sent' or delivered_at is not null),
        'handled', count(*) filter (where status = 'handled'), 'snoozed', count(*) filter (where snoozed_until is not null),
        'failed', count(*) filter (where status = 'failed'), 'cancelled', count(*) filter (where status = 'cancelled'),
        'pending', count(*) filter (where status = 'pending'))
      from public.reminders where created_at >= p_from and created_at < p_to),
    'calendar', jsonb_build_object(
        'connections', (select count(*) from public.calendar_connections),
        'by_provider', (select jsonb_object_agg(provider, n) from (select provider::text provider, count(*) n from public.calendar_connections group by 1) c),
        'exports', (select count(*) from public.events where exported_at >= p_from and exported_at < p_to),
        'exports_by_provider', (select jsonb_object_agg(k, n) from (select coalesce(calendar_provider::text, 'file') k, count(*) n from public.events
            where exported_at >= p_from and exported_at < p_to group by 1) e)),
    'rewards', (select jsonb_build_object('issued', coalesce(sum(amount) filter (where entry_type = 'earn'), 0),
        'spent', coalesce(-sum(amount) filter (where entry_type = 'spend'), 0),
        'adjusted', coalesce(sum(amount) filter (where entry_type = 'adjustment'), 0),
        'referral', coalesce(sum(amount) filter (where reason like 'referral%'), 0),
        'by_reason', (select jsonb_object_agg(reason, n) from (select reason, sum(amount) n from public.reward_ledger
            where created_at >= p_from and created_at < p_to and entry_type = 'earn' group by 1) r))
      from public.reward_ledger where created_at >= p_from and created_at < p_to));
end $$;

create or replace function private.admin_ai(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return (select jsonb_build_object(
      'requests', count(*), 'completed', count(*) filter (where status = 'completed'), 'failed', count(*) filter (where status = 'failed'),
      'users', count(distinct user_id), 'avg_events', round(avg(event_count)::numeric, 2),
      'avg_duration_ms', round(avg(duration_ms)), 'duration_rows', count(duration_ms),
      'input_tokens', sum(input_tokens), 'output_tokens', sum(output_tokens), 'token_rows', count(input_tokens),
      'cost_usd', sum(estimated_cost_usd), 'cost_rows', count(estimated_cost_usd),
      'by_type', (select jsonb_object_agg(k, n) from (select coalesce(mime_type, 'not recorded') k, count(*) n from public.scan_requests
          where created_at >= p_from and created_at < p_to group by 1) t),
      'by_model', (select jsonb_object_agg(k, n) from (select coalesce(model, 'not recorded') k, count(*) n from public.scan_requests
          where created_at >= p_from and created_at < p_to group by 1) t),
      'errors', (select jsonb_object_agg(k, n) from (select error_code k, count(*) n from public.scan_requests
          where created_at >= p_from and created_at < p_to and error_code is not null group by 1) t),
      'top_users', coalesce((select jsonb_agg(x) from (select user_id, private.user_email(user_id) email, count(*) requests,
          sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) tokens from public.scan_requests
          where created_at >= p_from and created_at < p_to group by user_id order by count(*) desc limit 10) x), '[]'::jsonb),
      'metadata_since', (select min(created_at) from public.scan_requests where duration_ms is not null))
    from public.scan_requests where created_at >= p_from and created_at < p_to);
end $$;

create or replace function private.admin_revenue(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return jsonb_build_object(
    'connected', private.payments_connected(),
    'by_currency', coalesce((select jsonb_agg(x) from (select currency,
        sum(amount_cents) filter (where kind = 'charge' and status = 'succeeded') / 100.0 gross,
        coalesce(sum(amount_cents) filter (where kind = 'refund' and status = 'succeeded'), 0) / 100.0 refunds,
        (coalesce(sum(amount_cents) filter (where kind = 'charge' and status = 'succeeded'), 0) - coalesce(sum(amount_cents) filter (where kind = 'refund' and status = 'succeeded'), 0)) / 100.0 net,
        count(*) filter (where kind = 'charge' and status = 'failed') failed,
        count(*) filter (where kind = 'charge' and status = 'succeeded') charges,
        count(distinct user_id) filter (where kind = 'charge' and status = 'succeeded') payers
      from public.payment_transactions where occurred_at >= p_from and occurred_at < p_to group by currency) x), '[]'::jsonb),
    'by_plan', coalesce((select jsonb_agg(x) from (select coalesce(plan::text, 'unknown') plan, currency, sum(amount_cents) / 100.0 gross
      from public.payment_transactions where kind = 'charge' and status = 'succeeded' and occurred_at >= p_from and occurred_at < p_to group by 1, 2) x), '[]'::jsonb),
    'subscriptions', (select jsonb_build_object(
        'active', count(*) filter (where status in ('active','trialing') and plan <> 'free'),
        'new', count(*) filter (where plan <> 'free' and created_at >= p_from and created_at < p_to),
        'canceled', count(*) filter (where canceled_at >= p_from and canceled_at < p_to),
        'cancel_pending', count(*) filter (where cancel_at_period_end and status = 'active'),
        'past_due', count(*) filter (where status = 'past_due'),
        'by_plan', (select jsonb_object_agg(plan, n) from (select plan::text plan, count(*) n from public.subscriptions where status in ('active','trialing') group by 1) b))
      from public.subscriptions),
    'mrr', coalesce((select jsonb_agg(x) from (select r.currency, sum(r.monthly_price) amount, count(*) subs from public.subscriptions s
        join public.plan_rules r on r.id = s.plan where s.status in ('active','trialing') and s.plan <> 'free' and s.provider is not null group by r.currency) x), '[]'::jsonb));
end $$;

create or replace function private.admin_transactions(p_from timestamptz, p_to timestamptz, p_kind text default null, p_status text default null,
  p_currency text default null, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return (with f as (select * from public.payment_transactions where occurred_at >= p_from and occurred_at < p_to
      and (p_kind is null or kind = p_kind) and (p_status is null or status = p_status) and (p_currency is null or currency = p_currency))
    select jsonb_build_object('total', (select count(*) from f), 'rows', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('email', private.user_email(t.user_id)) order by t.occurred_at desc)
      from (select * from f order by occurred_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)));
end $$;

create or replace function private.admin_subscriptions(p_status text default null, p_plan text default null, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return (with f as (select s.id, s.user_id, s.provider, s.plan::text plan, s.status, s.current_period_start, s.current_period_end,
        s.cancel_at_period_end, s.created_at, s.canceled_at, s.updated_at from public.subscriptions s
      where (p_status is null or s.status = p_status) and (p_plan is null or s.plan::text = p_plan))
    select jsonb_build_object('total', (select count(*) from f), 'rows', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('email', private.user_email(t.user_id)) order by t.updated_at desc)
      from (select * from f order by updated_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)));
end $$;

create or replace function private.admin_feedback(p_from timestamptz, p_to timestamptz, p_rating integer default null, p_status text default null,
  p_plan text default null, p_q text default null, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare pf timestamptz := p_from - (p_to - p_from); q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform private.require_admin('view');
  return (with f as (select f.id, f.user_id, f.rating, f.feedback, f.status, f.admin_note, f.created_at, p.plan::text plan
        from public.product_feedback f left join public.profiles p on p.id = f.user_id
       where f.created_at >= p_from and f.created_at < p_to and (p_rating is null or f.rating = p_rating)
         and (p_status is null or f.status = p_status) and (p_plan is null or p.plan::text = p_plan)
         and (q is null or f.feedback ilike '%' || q || '%'))
    select jsonb_build_object(
      'total', (select count(*) from f),
      'all_time', (select jsonb_build_object('avg', round(avg(rating)::numeric, 2), 'count', count(rating), 'comments', count(feedback)) from public.product_feedback),
      'period', (select jsonb_build_object('avg', round(avg(rating)::numeric, 2), 'count', count(rating),
          'positive', count(*) filter (where rating >= 4), 'negative', count(*) filter (where rating <= 2)) from public.product_feedback where created_at >= p_from and created_at < p_to),
      'previous', (select jsonb_build_object('avg', round(avg(rating)::numeric, 2), 'count', count(rating),
          'positive', count(*) filter (where rating >= 4), 'negative', count(*) filter (where rating <= 2)) from public.product_feedback where created_at >= pf and created_at < p_from),
      'distribution', (select jsonb_object_agg(r, (select count(*) from public.product_feedback where rating = r and created_at >= p_from and created_at < p_to)) from generate_series(1, 5) r),
      'by_status', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.product_feedback group by status) s),
      'rows', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('email', private.user_email(t.user_id)) order by t.created_at desc)
          from (select * from f order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)));
end $$;

create or replace function private.admin_referrals(p_from timestamptz, p_to timestamptz, p_status text default null, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return (with f as (select * from public.referrals where created_at >= p_from and created_at < p_to and (p_status is null or status = p_status))
    select jsonb_build_object(
      'invite_codes', (select count(*) from public.referral_invites),
      'total', (select count(*) from f),
      'by_status', (select jsonb_object_agg(status, n) from (select status, count(*) n from f group by status) s),
      'qualified', (select count(*) from f where status in ('qualified','rewarded')),
      'credits', (select coalesce(sum(amount), 0) from public.reward_ledger where reason like 'referral%' and created_at >= p_from and created_at < p_to),
      'top', coalesce((select jsonb_agg(x) from (select referrer_id user_id, private.user_email(referrer_id) email, count(*) total,
          count(*) filter (where status in ('qualified','rewarded')) qualified from f group by referrer_id order by count(*) desc limit 10) x), '[]'::jsonb),
      -- Signals only: shared devices between referrer and invitee, or many sign-ups within a day. Nothing is punished automatically.
      'signals', coalesce((select jsonb_agg(x) from (
          select r.referrer_id user_id, private.user_email(r.referrer_id) email, 'shared_device' signal, count(*) n
            from public.referrals r join public.device_accounts a on a.user_id = r.referred_user_id
            join public.device_accounts b on b.device_hash = a.device_hash and b.user_id <> r.referred_user_id
           where r.created_at >= p_from and r.created_at < p_to group by r.referrer_id
          union all
          select referrer_id, private.user_email(referrer_id), 'burst_24h', count(*) from public.referrals
           where created_at >= p_from and created_at < p_to group by referrer_id, date_trunc('day', created_at) having count(*) >= 5) x), '[]'::jsonb),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'referrer_id', t.referrer_id, 'referrer_email', private.user_email(t.referrer_id),
          'referred_user_id', t.referred_user_id, 'referred_email', private.user_email(t.referred_user_id), 'code', t.referral_code,
          'status', t.status, 'created_at', t.created_at, 'qualified_at', t.qualified_at) order by t.created_at desc)
          from (select * from f order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)));
end $$;

create or replace function private.admin_rewards(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return jsonb_build_object(
    'period', (select jsonb_build_object('issued', coalesce(sum(amount) filter (where entry_type = 'earn'), 0),
        'spent', coalesce(-sum(amount) filter (where entry_type = 'spend'), 0),
        'adjusted', coalesce(sum(amount) filter (where entry_type = 'adjustment'), 0),
        'users', count(distinct user_id) filter (where entry_type = 'earn'))
      from public.reward_ledger where created_at >= p_from and created_at < p_to),
    'outstanding', (select coalesce(sum(amount), 0) from public.reward_ledger),
    'holders', (select count(*) from (select user_id from public.reward_ledger group by user_id having sum(amount) > 0) h),
    'by_reason', coalesce((select jsonb_agg(x order by x.credits desc) from (select reason, count(*) times, sum(amount) credits from public.reward_ledger
        where created_at >= p_from and created_at < p_to group by reason) x), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(to_jsonb(r) order by r.key) from public.reward_rules r), '[]'::jsonb),
    'top_balances', coalesce((select jsonb_agg(x) from (select user_id, private.user_email(user_id) email, sum(amount) balance
        from public.reward_ledger group by user_id having sum(amount) > 0 order by sum(amount) desc limit 10) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x) from (select id, user_id, private.user_email(user_id) email, entry_type, amount, reason, created_at
        from public.reward_ledger order by created_at desc limit 25) x), '[]'::jsonb));
end $$;

create or replace function private.admin_tickets(p_status text default null, p_priority text default null, p_category text default null,
  p_q text default null, p_mine boolean default false, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := private.require_admin('view'); q text := nullif(trim(coalesce(p_q, '')), '');
begin
  return (with f as (select t.*, private.user_email(t.user_id) email,
        (select left(body, 160) from public.support_messages m where m.ticket_id = t.id and not m.internal order by created_at desc limit 1) preview
      from public.support_tickets t
     where (p_status is null or (p_status = 'active' and t.status in ('new','open','waiting')) or t.status = p_status)
       and (p_priority is null or t.priority = p_priority) and (p_category is null or t.category = p_category)
       and (not coalesce(p_mine, false) or t.assignee_id = me)
       and (q is null or t.subject ilike '%' || q || '%' or t.number::text = ltrim(q, '#') or q = any(t.tags)
            or private.user_email(t.user_id) ilike '%' || q || '%'))
    select jsonb_build_object('total', (select count(*) from f),
      'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.support_tickets group by status) c),
      'rows', coalesce((select jsonb_agg(to_jsonb(t) - 'context' order by
          case t.priority when 'urgent' then 0 when 'high' then 1 else 2 end, t.last_message_at desc)
        from (select * from f order by case priority when 'urgent' then 0 when 'high' then 1 else 2 end, last_message_at desc
          limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)));
end $$;

create or replace function private.admin_ticket(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.support_tickets;
begin
  perform private.require_admin('view');
  select * into t from public.support_tickets where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object('ticket', to_jsonb(t) || jsonb_build_object('email', private.user_email(t.user_id), 'assignee_email', private.user_email(t.assignee_id)),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'internal', m.internal, 'from_staff', m.from_staff,
        'created_at', m.created_at, 'author_email', private.user_email(m.author_id)) order by m.created_at) from public.support_messages m where m.ticket_id = p_id), '[]'::jsonb),
    'user', (select jsonb_build_object('id', p.id, 'name', p.display_name, 'plan', p.plan, 'created_at', p.created_at, 'account_status', p.account_status,
        'support_flag', p.support_flag, 'scans', (select count(*) from public.scan_requests r where r.user_id = p.id),
        'tickets', (select count(*) from public.support_tickets x where x.user_id = p.id),
        'last_scan_failed', (select status = 'failed' from public.scan_requests r where r.user_id = p.id order by created_at desc limit 1))
      from public.profiles p where p.id = t.user_id));
end $$;

create or replace function private.admin_reports(p_status text default null, p_kind text default null, p_priority text default null,
  p_q text default null, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform private.require_admin('view');
  return (with f as (select r.*, private.user_email(r.user_id) email from public.user_reports r
     where (p_status is null or (p_status = 'active' and r.status in ('new','triaged','in_progress')) or r.status = p_status)
       and (p_kind is null or r.kind = p_kind) and (p_priority is null or r.priority = p_priority)
       and (q is null or r.description ilike '%' || q || '%' or r.number::text = ltrim(q, '#') or r.request_id = lower(q)))
    select jsonb_build_object('total', (select count(*) from f),
      'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.user_reports group by status) c),
      'by_kind', (select jsonb_object_agg(kind, n) from (select kind, count(*) n from public.user_reports where status in ('new','triaged','in_progress') group by kind) c),
      'rows', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc)
        from (select * from f order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)));
end $$;

create or replace function private.admin_report(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.user_reports;
begin
  perform private.require_admin('view');
  select * into r from public.user_reports where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object('report', to_jsonb(r) || jsonb_build_object('email', private.user_email(r.user_id), 'assignee_email', private.user_email(r.assignee_id)),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at, 'author_email', private.user_email(n.author_id)) order by n.created_at)
       from public.user_report_notes n where n.report_id = p_id), '[]'::jsonb),
    'scan', (select jsonb_build_object('id', s.id, 'status', s.status, 'error_code', s.error_code, 'mime_type', s.mime_type, 'event_count', s.event_count,
       'duration_ms', s.duration_ms, 'created_at', s.created_at) from public.scan_requests s where s.id::text = r.request_id));
end $$;

create or replace function private.admin_audit(p_q text default null, p_type text default null, p_from timestamptz default null,
  p_to timestamptz default null, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform private.require_admin('view');
  return (with f as (select * from public.admin_audit_log where (p_type is null or object_type = p_type)
      and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
      and (q is null or action ilike '%' || q || '%' or admin_email ilike '%' || q || '%' or object_id = q))
    select jsonb_build_object('total', (select count(*) from f),
      'types', (select jsonb_agg(distinct object_type) from public.admin_audit_log),
      'rows', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc)
        from (select * from f order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)));
end $$;

create or replace function private.admin_admins() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'email', u.email, 'role', coalesce(r.role, 'admin'),
      'granted_at', r.granted_at, 'granted_by', private.user_email(r.granted_by), 'last_active', greatest(p.last_active_at, u.last_sign_in_at)) order by r.granted_at nulls first)
    from public.profiles p join auth.users u on u.id = p.id left join public.admin_roles r on r.user_id = p.id where p.is_admin), '[]'::jsonb);
end $$;

create or replace function private.admin_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return jsonb_build_object(
    'database_time', now(),
    'failed_scans_24h', (select count(*) from public.scan_requests where status = 'failed' and created_at > now() - interval '1 day'),
    'scans_24h', (select count(*) from public.scan_requests where created_at > now() - interval '1 day'),
    'guest_failed_24h', (select count(*) from public.guest_scan_usage where status = 'failed' and created_at > now() - interval '1 day'),
    'guest_scans_24h', (select count(*) from public.guest_scan_usage where created_at > now() - interval '1 day'),
    'stuck_scans', (select count(*) from public.scan_requests where status = 'reserved' and created_at < now() - interval '10 minutes'),
    'recent_errors', coalesce((select jsonb_agg(x) from (select error_code, count(*) n, max(created_at) last from public.scan_requests
        where error_code is not null and created_at > now() - interval '7 days' group by error_code order by count(*) desc limit 10) x), '[]'::jsonb),
    'reminders_failed_24h', (select count(*) from public.reminders where status = 'failed' and created_at > now() - interval '1 day'),
    'reminders_overdue', (select count(*) from public.reminders where status = 'pending' and scheduled_at < now() - interval '15 minutes'),
    'reminders_last_sent', (select max(delivered_at) from public.reminders),
    'reminder_errors', coalesce((select jsonb_agg(x) from (select left(last_error, 80) error, count(*) n from public.reminders
        where last_error is not null and created_at > now() - interval '7 days' group by 1 order by 2 desc limit 5) x), '[]'::jsonb),
    'push_subscriptions', (select count(*) from public.push_subscriptions),
    'push_failing', (select count(*) from public.push_subscriptions where failure_count > 0),
    'calendar_connections', (select count(*) from public.calendar_connections),
    'cron_jobs', coalesce((select jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active)) from cron.job), '[]'::jsonb),
    'flags', (select jsonb_object_agg(key, enabled) from public.feature_flags));
end $$;

create or replace function private.admin_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin('view');
  return jsonb_build_object(
    'plans', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('users', (select count(*) from public.profiles p where p.plan = r.id)) order by r.display_order, r.id) from public.plan_rules r), '[]'::jsonb),
    'flags', coalesce((select jsonb_agg(to_jsonb(f) order by f.key) from public.feature_flags f), '[]'::jsonb),
    'limits', coalesce((select jsonb_agg(to_jsonb(l) order by l.key) from public.app_limits l), '[]'::jsonb),
    'content', coalesce((select jsonb_agg(to_jsonb(c) order by c.updated_at desc) from public.admin_content c), '[]'::jsonb),
    'announcements', coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at desc) from public.announcements a), '[]'::jsonb));
end $$;

-- Keyset-paged rows for server-side CSV generation. Never returns tokens, secrets or document text.
create or replace function private.admin_export(p_dataset text, p_from timestamptz, p_to timestamptz,
  p_after_at timestamptz default null, p_after_id text default null, p_limit integer default 1000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare lim integer := least(greatest(coalesce(p_limit, 1000), 1), 5000); rows jsonb;
  aa timestamptz := coalesce(p_after_at, 'infinity'::timestamptz); ai text := coalesce(p_after_id, '');
begin
  perform private.require_admin('export');
  if p_after_at is null then
    perform private.audit('export.download', 'export', p_dataset, null, jsonb_build_object('from', p_from, 'to', p_to));
  end if;
  rows := case
    when p_dataset = 'users' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select p.created_at at_, p.id::text id_, p.id user_id, p.created_at, u.email, p.display_name name, p.plan,
        p.account_status status, p.locale, p.timezone, p.country_code, p.last_active_at, u.last_sign_in_at,
        coalesce((select sum(amount) from public.reward_ledger l where l.user_id = p.id), 0) credits,
        (select count(*) from public.planner_items i where i.user_id = p.id) planner_items,
        (select count(*) from public.scan_requests r where r.user_id = p.id) ai_scans
      from public.profiles p join auth.users u on u.id = p.id
      where p.created_at >= p_from and p.created_at < p_to        and (p_after_at is null or (p.created_at, p.id::text) < (aa, ai))
      order by p.created_at desc, p.id::text desc limit lim) x)
    when p_dataset = 'activity' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select a.last_seen_at at_, a.user_id::text || a.day id_, a.day, a.user_id, private.user_email(a.user_id) email,
        a.first_seen_at, a.last_seen_at, a.hits from public.user_activity_daily a
      where a.last_seen_at >= p_from and a.last_seen_at < p_to and (p_after_at is null or (a.last_seen_at, a.user_id::text || a.day) < (aa, ai))
      order by a.last_seen_at desc, a.user_id::text || a.day desc limit lim) x)
    when p_dataset = 'scans' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select s.created_at at_, s.id::text id_, s.id request_id, s.created_at, s.user_id, private.user_email(s.user_id) email,
        s.status, s.mime_type, s.page_count, s.event_count, s.warning_count, s.duration_ms, s.error_code, s.model, s.input_tokens, s.output_tokens,
        s.estimated_cost_usd, s.completed_at from public.scan_requests s
      where s.created_at >= p_from and s.created_at < p_to and (p_after_at is null or (s.created_at, s.id::text) < (aa, ai))
      order by s.created_at desc, s.id::text desc limit lim) x)
    when p_dataset = 'usage' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select m.period_start::timestamptz at_, m.user_id::text || m.period_start id_, m.period_start, m.user_id,
        private.user_email(m.user_id) email, m.ai_scans, m.pdf_pages, m.bonus_scans, m.estimated_cost_usd from public.usage_monthly m
      where m.period_start >= date_trunc('month', p_from)::date and m.period_start < p_to
        and (p_after_at is null or (m.period_start::timestamptz, m.user_id::text || m.period_start) < (aa, ai))
      order by m.period_start desc, m.user_id::text || m.period_start desc limit lim) x)
    when p_dataset in ('revenue', 'transactions') then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select t.occurred_at at_, t.id::text id_, t.id, t.occurred_at, t.user_id,
        private.user_email(t.user_id) email, t.provider, t.kind, t.status, t.amount_cents / 100.0 amount, t.currency, t.plan, t.country_code, t.failure_reason
      from public.payment_transactions t where t.occurred_at >= p_from and t.occurred_at < p_to
        and (p_dataset <> 'revenue' or t.status = 'succeeded') and (p_after_at is null or (t.occurred_at, t.id::text) < (aa, ai))
      order by t.occurred_at desc, t.id::text desc limit lim) x)
    when p_dataset = 'failed_payments' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select t.occurred_at at_, t.id::text id_, t.id, t.occurred_at, t.user_id,
        private.user_email(t.user_id) email, t.provider, t.amount_cents / 100.0 amount, t.currency, t.plan, t.failure_reason
      from public.payment_transactions t where t.kind = 'charge' and t.status = 'failed' and t.occurred_at >= p_from and t.occurred_at < p_to
        and (p_after_at is null or (t.occurred_at, t.id::text) < (aa, ai)) order by t.occurred_at desc, t.id::text desc limit lim) x)
    when p_dataset = 'refunds' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select t.occurred_at at_, t.id::text id_, t.id, t.occurred_at, t.user_id,
        private.user_email(t.user_id) email, t.provider, t.status, t.amount_cents / 100.0 amount, t.currency, t.plan
      from public.payment_transactions t where t.kind = 'refund' and t.occurred_at >= p_from and t.occurred_at < p_to
        and (p_after_at is null or (t.occurred_at, t.id::text) < (aa, ai)) order by t.occurred_at desc, t.id::text desc limit lim) x)
    when p_dataset = 'subscriptions' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select s.updated_at at_, s.id::text id_, s.id, s.user_id, private.user_email(s.user_id) email,
        s.provider, s.plan, s.status, s.current_period_start, s.current_period_end, s.cancel_at_period_end, s.created_at, s.canceled_at, s.updated_at
      from public.subscriptions s where s.updated_at >= p_from and s.updated_at < p_to and (p_after_at is null or (s.updated_at, s.id::text) < (aa, ai))
      order by s.updated_at desc, s.id::text desc limit lim) x)
    when p_dataset = 'rewards' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select l.created_at at_, l.id::text id_, l.id, l.created_at, l.user_id, private.user_email(l.user_id) email,
        l.entry_type, l.amount, l.reason, l.reference_type from public.reward_ledger l
      where l.created_at >= p_from and l.created_at < p_to and (p_after_at is null or (l.created_at, l.id::text) < (aa, ai))
      order by l.created_at desc, l.id::text desc limit lim) x)
    when p_dataset = 'referrals' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select r.created_at at_, r.id::text id_, r.id, r.created_at, r.referrer_id, private.user_email(r.referrer_id) referrer_email,
        r.referred_user_id, private.user_email(r.referred_user_id) referred_email, r.referral_code, r.status, r.qualified_at from public.referrals r
      where r.created_at >= p_from and r.created_at < p_to and (p_after_at is null or (r.created_at, r.id::text) < (aa, ai))
      order by r.created_at desc, r.id::text desc limit lim) x)
    when p_dataset = 'ratings' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select f.created_at at_, f.id::text id_, f.id, f.created_at, f.user_id, private.user_email(f.user_id) email,
        (select plan from public.profiles p where p.id = f.user_id) plan, f.rating, f.feedback, f.status, f.admin_note from public.product_feedback f
      where f.created_at >= p_from and f.created_at < p_to and (p_after_at is null or (f.created_at, f.id::text) < (aa, ai))
      order by f.created_at desc, f.id::text desc limit lim) x)
    when p_dataset = 'tickets' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select t.created_at at_, t.id::text id_, t.number, t.created_at, t.user_id, private.user_email(t.user_id) email,
        t.subject, t.category, t.status, t.priority, private.user_email(t.assignee_id) assignee, array_to_string(t.tags, ';') tags,
        t.first_response_at, t.resolved_at, t.last_message_at from public.support_tickets t
      where t.created_at >= p_from and t.created_at < p_to and (p_after_at is null or (t.created_at, t.id::text) < (aa, ai))
      order by t.created_at desc, t.id::text desc limit lim) x)
    when p_dataset = 'reports' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select r.created_at at_, r.id::text id_, r.number, r.created_at, r.user_id, private.user_email(r.user_id) email,
        r.kind, r.status, r.priority, r.description, r.route, r.app_version, r.user_agent, r.request_id, r.resolved_at from public.user_reports r
      where r.created_at >= p_from and r.created_at < p_to and (p_after_at is null or (r.created_at, r.id::text) < (aa, ai))
      order by r.created_at desc, r.id::text desc limit lim) x)
    when p_dataset = 'audit' then (select jsonb_agg(x order by x.at_ desc, x.id_ desc) from (select a.created_at at_, a.id::text id_, a.id, a.created_at, a.admin_email, a.action, a.object_type,
        a.object_id, a.before, a.after from public.admin_audit_log a
      where a.created_at >= p_from and a.created_at < p_to and (p_after_at is null or (a.created_at, a.id::text) < (aa, ai))
      order by a.created_at desc, a.id::text desc limit lim) x)
    else null end;
  if rows is null and p_dataset not in ('users','activity','scans','usage','revenue','transactions','failed_payments','refunds','subscriptions',
      'rewards','referrals','ratings','tickets','reports','audit') then
    raise exception 'invalid_dataset';
  end if;
  return coalesce(rows, '[]'::jsonb);
end $$;

------------------------------------------------------------------------------------------
-- 9. Admin write functions. Each validates input, checks the role, and audits before/after.
------------------------------------------------------------------------------------------
create or replace function private.admin_set_flag(p_key text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old public.feature_flags;
begin
  perform private.require_admin(case when p_key in ('ai_scanning','cloud_persistence') then 'owner' else 'operate' end);
  select * into old from public.feature_flags where key = p_key for update;
  if not found then raise exception 'not_found'; end if;
  if old.enabled = p_enabled then return to_jsonb(old); end if;
  update public.feature_flags set enabled = p_enabled, updated_at = now() where key = p_key;
  perform private.audit('flag.update', 'feature_flag', p_key, jsonb_build_object('enabled', old.enabled), jsonb_build_object('enabled', p_enabled));
  return (select to_jsonb(f) from public.feature_flags f where key = p_key);
end $$;

create or replace function private.admin_update_plan(p_id text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old public.plan_rules; nxt public.plan_rules; users bigint;
  commercial text[] := array['monthly_price','annual_price','currency','active','is_public'];
  allowed text[] := array['name','description','monthly_price','annual_price','currency','monthly_scans','pdf_pages','smart_reminders',
    'bulk_extraction','priority_processing','rewards_multiplier','calendar_integrations','active','is_public','recommended','display_order','credits_per_bonus_scan'];
  k text;
begin
  perform private.require_admin('operate');
  for k in select jsonb_object_keys(p_patch) loop
    if not k = any(allowed) then raise exception 'invalid_field'; end if;
  end loop;
  select * into old from public.plan_rules where id::text = p_id for update;
  if not found then raise exception 'not_found'; end if;
  nxt := jsonb_populate_record(old, p_patch);
  -- Pricing and availability are owner decisions.
  if exists (select 1 from unnest(commercial) c where (to_jsonb(nxt) -> c) is distinct from (to_jsonb(old) -> c)) then
    perform private.require_admin('owner');
  end if;
  if nxt.name is null or char_length(trim(nxt.name)) not between 1 and 40 or char_length(nxt.description) > 300
     or nxt.monthly_scans not between 0 and 100000 or nxt.pdf_pages not between 1 and 100
     or nxt.credits_per_bonus_scan not between 0 and 10000 or nxt.display_order not between 0 and 100 then
    raise exception 'invalid_plan';
  end if;
  if old.id = 'free' and (nxt.monthly_price <> 0 or coalesce(nxt.annual_price, 0) <> 0 or not nxt.active) then raise exception 'free_plan_must_stay_free'; end if;
  if old.active and not nxt.active then
    select count(*) into users from public.profiles where plan = old.id;
    if users > 0 then raise exception 'plan_in_use'; end if;
  end if;
  update public.plan_rules set name = trim(nxt.name), description = nxt.description, monthly_price = nxt.monthly_price,
    annual_price = nxt.annual_price, currency = upper(nxt.currency), monthly_scans = nxt.monthly_scans, pdf_pages = nxt.pdf_pages,
    smart_reminders = nxt.smart_reminders, bulk_extraction = nxt.bulk_extraction, priority_processing = nxt.priority_processing,
    rewards_multiplier = nxt.rewards_multiplier, calendar_integrations = nxt.calendar_integrations, active = nxt.active,
    is_public = nxt.is_public, recommended = nxt.recommended, display_order = nxt.display_order,
    credits_per_bonus_scan = nxt.credits_per_bonus_scan, updated_at = now()
   where id = old.id;
  if nxt.recommended then update public.plan_rules set recommended = false where id <> old.id and recommended; end if;
  perform private.audit('plan.update', 'plan', p_id, to_jsonb(old) - 'updated_at', (select to_jsonb(r) - 'updated_at' from public.plan_rules r where r.id = old.id));
  return (select to_jsonb(r) from public.plan_rules r where r.id = old.id);
end $$;

create or replace function private.admin_update_reward_rule(p_key text, p_amount integer, p_enabled boolean, p_label text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old public.reward_rules;
begin
  perform private.require_admin('operate');
  select * into old from public.reward_rules where key = p_key for update;
  if not found then raise exception 'not_found'; end if;
  if p_amount is null or p_amount not between 0 and 1000 or char_length(coalesce(p_label, '')) > 60 then raise exception 'invalid_rule'; end if;
  update public.reward_rules set amount = p_amount, enabled = coalesce(p_enabled, enabled),
    label = coalesce(nullif(trim(p_label), ''), label), updated_at = now() where key = p_key;
  perform private.audit('reward_rule.update', 'reward_rule', p_key, to_jsonb(old) - 'updated_at', (select to_jsonb(r) - 'updated_at' from public.reward_rules r where key = p_key));
  return (select to_jsonb(r) from public.reward_rules r where key = p_key);
end $$;

create or replace function private.admin_adjust_credits(p_user uuid, p_amount integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare bal integer; ref text := gen_random_uuid()::text;
begin
  perform private.require_admin('operate');
  if p_amount is null or p_amount = 0 or p_amount not between -1000 and 1000 then raise exception 'invalid_amount'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 200 then raise exception 'reason_required'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select coalesce(sum(amount), 0) into bal from public.reward_ledger where user_id = p_user;
  if bal + p_amount < 0 then raise exception 'insufficient_balance'; end if;
  insert into public.reward_ledger(user_id, entry_type, amount, reason, reference_type, reference_id)
  values (p_user, 'adjustment', p_amount, 'admin_adjustment', 'admin_adjustment', ref);
  perform private.audit('credits.adjust', 'user', p_user::text, jsonb_build_object('balance', bal),
    jsonb_build_object('balance', bal + p_amount, 'amount', p_amount, 'reason', left(trim(p_reason), 200)));
  return jsonb_build_object('balance', bal + p_amount);
end $$;

create or replace function private.admin_set_user_plan(p_user uuid, p_plan text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old text;
begin
  perform private.require_admin('operate');
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 200 then raise exception 'reason_required'; end if;
  if not exists (select 1 from public.plan_rules where id::text = p_plan and active) then raise exception 'plan_unavailable'; end if;
  select plan::text into old from public.profiles where id = p_user for update;
  if not found then raise exception 'not_found'; end if;
  if old = p_plan then return jsonb_build_object('plan', old); end if;
  update public.profiles set plan = p_plan::public.plan_code, updated_at = now() where id = p_user;
  perform private.audit('user.plan_change', 'user', p_user::text, jsonb_build_object('plan', old),
    jsonb_build_object('plan', p_plan, 'reason', left(trim(p_reason), 200)));
  return jsonb_build_object('plan', p_plan);
end $$;

create or replace function private.admin_set_account_status(p_user uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old text; me uuid := private.require_admin('operate');
begin
  if p_status not in ('active','disabled') then raise exception 'invalid_status'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 200 then raise exception 'reason_required'; end if;
  if p_user = me then raise exception 'cannot_change_self'; end if;
  if p_status = 'disabled' and exists (select 1 from public.profiles where id = p_user and is_admin) then raise exception 'cannot_disable_admin'; end if;
  select account_status into old from public.profiles where id = p_user for update;
  if not found then raise exception 'not_found'; end if;
  update public.profiles set account_status = p_status, updated_at = now() where id = p_user;
  perform private.audit('user.status_change', 'user', p_user::text, jsonb_build_object('status', old),
    jsonb_build_object('status', p_status, 'reason', left(trim(p_reason), 200)));
  return jsonb_build_object('status', p_status, 'previous', old);
end $$;

create or replace function private.admin_set_support_flag(p_user uuid, p_flag boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old public.profiles;
begin
  perform private.require_admin('support');
  select * into old from public.profiles where id = p_user for update;
  if not found then raise exception 'not_found'; end if;
  update public.profiles set support_flag = p_flag, support_note = nullif(left(trim(coalesce(p_note, '')), 1000), '') where id = p_user;
  perform private.audit('user.support_flag', 'user', p_user::text, jsonb_build_object('flag', old.support_flag, 'note', old.support_note),
    jsonb_build_object('flag', p_flag, 'note', nullif(left(trim(coalesce(p_note, '')), 1000), '')));
  return jsonb_build_object('flag', p_flag);
end $$;

create or replace function private.admin_grant_role(p_email text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin('owner'); target uuid; old text;
begin
  if p_role not in ('owner','admin','support','analyst') then raise exception 'invalid_role'; end if;
  select u.id into target from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = lower(trim(p_email));
  if target is null then raise exception 'user_not_found'; end if;
  select case when p.is_admin then coalesce(r.role, 'admin') end into old from public.profiles p left join public.admin_roles r on r.user_id = p.id where p.id = target;
  if target = me and p_role <> 'owner' and (select count(*) from public.admin_roles where role = 'owner') <= 1 then raise exception 'last_owner'; end if;
  update public.profiles set is_admin = true where id = target;
  insert into public.admin_roles(user_id, role, granted_by) values (target, p_role, me)
  on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by, granted_at = now();
  perform private.audit('admin.grant', 'admin', target::text, jsonb_build_object('role', old), jsonb_build_object('role', p_role));
  return jsonb_build_object('id', target, 'role', p_role);
end $$;

create or replace function private.admin_revoke_role(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin('owner'); old text;
begin
  if p_user = me then raise exception 'cannot_change_self'; end if;
  select case when p.is_admin then coalesce(r.role, 'admin') end into old from public.profiles p left join public.admin_roles r on r.user_id = p.id where p.id = p_user;
  if old is null then raise exception 'not_found'; end if;
  if old = 'owner' and (select count(*) from public.admin_roles where role = 'owner') <= 1 then raise exception 'last_owner'; end if;
  update public.profiles set is_admin = false where id = p_user;
  delete from public.admin_roles where user_id = p_user;
  perform private.audit('admin.revoke', 'admin', p_user::text, jsonb_build_object('role', old), jsonb_build_object('role', null));
  return jsonb_build_object('id', p_user);
end $$;

create or replace function private.admin_ticket_update(p_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old public.support_tickets; nxt public.support_tickets; k text;
begin
  perform private.require_admin('support');
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('status','priority','category','assignee_id','tags') then raise exception 'invalid_field'; end if;
  end loop;
  select * into old from public.support_tickets where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  nxt := jsonb_populate_record(old, p_patch);
  if nxt.assignee_id is not null and not exists (select 1 from public.profiles where id = nxt.assignee_id and is_admin) then raise exception 'invalid_assignee'; end if;
  if exists (select 1 from unnest(nxt.tags) t where char_length(t) not between 1 and 30) then raise exception 'invalid_tag'; end if;
  update public.support_tickets set status = nxt.status, priority = nxt.priority, category = nxt.category, assignee_id = nxt.assignee_id,
    tags = nxt.tags, updated_at = now(),
    resolved_at = case when nxt.status in ('resolved','closed') and old.status not in ('resolved','closed') then now()
                       when nxt.status not in ('resolved','closed') then null else old.resolved_at end
   where id = p_id;
  perform private.audit('support.update', 'ticket', p_id::text,
    jsonb_build_object('status', old.status, 'priority', old.priority, 'category', old.category, 'assignee_id', old.assignee_id, 'tags', old.tags),
    jsonb_build_object('status', nxt.status, 'priority', nxt.priority, 'category', nxt.category, 'assignee_id', nxt.assignee_id, 'tags', nxt.tags));
  return (select to_jsonb(t) from public.support_tickets t where id = p_id);
end $$;

create or replace function private.admin_ticket_reply(p_id uuid, p_body text, p_internal boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin('support'); old public.support_tickets; msg uuid;
begin
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 5000 then raise exception 'message_required'; end if;
  select * into old from public.support_tickets where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  insert into public.support_messages(ticket_id, author_id, from_staff, internal, body) values (p_id, me, true, coalesce(p_internal, false), trim(p_body))
  returning id into msg;
  if not coalesce(p_internal, false) then
    update public.support_tickets set last_message_at = now(), updated_at = now(), first_response_at = coalesce(first_response_at, now()),
      status = case when status in ('new','open') then 'waiting' else status end,
      assignee_id = coalesce(assignee_id, me)
     where id = p_id;
  end if;
  perform private.audit(case when coalesce(p_internal, false) then 'support.note' else 'support.reply' end, 'ticket', p_id::text,
    jsonb_build_object('status', old.status),
    jsonb_build_object('status', case when not coalesce(p_internal, false) and old.status in ('new','open') then 'waiting' else old.status end,
      'message_id', msg, 'length', char_length(trim(p_body))));
  return jsonb_build_object('id', msg);
end $$;

create or replace function private.admin_report_update(p_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old public.user_reports; nxt public.user_reports; k text;
begin
  perform private.require_admin('support');
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('status','priority','assignee_id') then raise exception 'invalid_field'; end if;
  end loop;
  select * into old from public.user_reports where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  nxt := jsonb_populate_record(old, p_patch);
  if nxt.assignee_id is not null and not exists (select 1 from public.profiles where id = nxt.assignee_id and is_admin) then raise exception 'invalid_assignee'; end if;
  update public.user_reports set status = nxt.status, priority = nxt.priority, assignee_id = nxt.assignee_id, updated_at = now(),
    resolved_at = case when nxt.status in ('resolved','wont_fix') then coalesce(old.resolved_at, now()) else null end
   where id = p_id;
  perform private.audit('report.update', 'report', p_id::text,
    jsonb_build_object('status', old.status, 'priority', old.priority, 'assignee_id', old.assignee_id),
    jsonb_build_object('status', nxt.status, 'priority', nxt.priority, 'assignee_id', nxt.assignee_id));
  return (select to_jsonb(r) from public.user_reports r where id = p_id);
end $$;

create or replace function private.admin_report_note(p_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin('support'); n uuid;
begin
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'message_required'; end if;
  if not exists (select 1 from public.user_reports where id = p_id) then raise exception 'not_found'; end if;
  insert into public.user_report_notes(report_id, author_id, body) values (p_id, me, trim(p_body)) returning id into n;
  update public.user_reports set updated_at = now(), status = case when status = 'new' then 'triaged' else status end where id = p_id;
  perform private.audit('report.note', 'report', p_id::text, null, jsonb_build_object('note_id', n));
  return jsonb_build_object('id', n);
end $$;

create or replace function private.admin_feedback_update(p_id uuid, p_status text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old public.product_feedback;
begin
  perform private.require_admin('support');
  if p_status not in ('new','reviewed','planned','resolved','archived') then raise exception 'invalid_status'; end if;
  select * into old from public.product_feedback where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update public.product_feedback set status = p_status, admin_note = nullif(left(trim(coalesce(p_note, '')), 2000), ''),
    reviewed_at = case when p_status = 'new' then null else coalesce(reviewed_at, now()) end where id = p_id;
  perform private.audit('feedback.update', 'feedback', p_id::text, jsonb_build_object('status', old.status, 'note', old.admin_note),
    jsonb_build_object('status', p_status, 'note', nullif(left(trim(coalesce(p_note, '')), 2000), '')));
  return jsonb_build_object('status', p_status);
end $$;

create or replace function private.admin_save_content(p_key text, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old text;
begin
  perform private.require_admin('operate');
  if p_key !~ '^[a-z0-9_-]{1,60}$' or char_length(coalesce(p_body, '')) not between 1 and 10000 then raise exception 'invalid_content'; end if;
  select body into old from public.admin_content where key = p_key;
  insert into public.admin_content(key, body, updated_at) values (p_key, p_body, now())
  on conflict (key) do update set body = excluded.body, updated_at = now();
  perform private.audit('content.save', 'content', p_key, case when old is null then null else jsonb_build_object('length', char_length(old)) end,
    jsonb_build_object('length', char_length(p_body)));
  return jsonb_build_object('key', p_key);
end $$;

create or replace function private.admin_delete_content(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin('operate');
  delete from public.admin_content where key = p_key;
  if not found then raise exception 'not_found'; end if;
  perform private.audit('content.delete', 'content', p_key, null, null);
  return jsonb_build_object('key', p_key);
end $$;

create or replace function private.admin_save_announcement(p_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_admin('operate'); old public.announcements; rid uuid; ids uuid[];
begin
  ids := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_data -> 'user_ids', '[]'::jsonb)) x), '{}');
  if p_id is null then
    insert into public.announcements(title, body, audience, user_ids, starts_at, ends_at, created_by)
    values (trim(p_data ->> 'title'), trim(p_data ->> 'body'), coalesce(p_data ->> 'audience', 'all'), ids,
            nullif(p_data ->> 'starts_at', '')::timestamptz, nullif(p_data ->> 'ends_at', '')::timestamptz, me)
    returning id into rid;
    perform private.audit('announcement.create', 'announcement', rid::text, null, p_data);
  else
    select * into old from public.announcements where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    if old.status = 'archived' then raise exception 'archived'; end if;
    update public.announcements set title = trim(p_data ->> 'title'), body = trim(p_data ->> 'body'), audience = coalesce(p_data ->> 'audience', 'all'),
      user_ids = ids, starts_at = nullif(p_data ->> 'starts_at', '')::timestamptz, ends_at = nullif(p_data ->> 'ends_at', '')::timestamptz, updated_at = now()
     where id = p_id returning id into rid;
    perform private.audit('announcement.update', 'announcement', rid::text, to_jsonb(old) - 'updated_at', p_data);
  end if;
  return (select to_jsonb(a) from public.announcements a where id = rid);
end $$;

create or replace function private.admin_set_announcement_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old public.announcements;
begin
  perform private.require_admin('operate');
  if p_status not in ('draft','published','archived') then raise exception 'invalid_status'; end if;
  select * into old from public.announcements where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update public.announcements set status = p_status, updated_at = now(),
    published_at = case when p_status = 'published' then now() else published_at end where id = p_id;
  perform private.audit('announcement.' || p_status, 'announcement', p_id::text, jsonb_build_object('status', old.status), jsonb_build_object('status', p_status));
  return jsonb_build_object('status', p_status);
end $$;

create or replace function private.admin_update_limit(p_key text, p_value integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old integer;
begin
  perform private.require_admin('owner');
  select value into old from public.app_limits where key = p_key for update;
  if not found then raise exception 'not_found'; end if;
  if p_value is null or p_value not between 0 and 1000000 then raise exception 'invalid_value'; end if;
  update public.app_limits set value = p_value, updated_at = now() where key = p_key;
  perform private.audit('limit.update', 'app_limit', p_key, jsonb_build_object('value', old), jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

-- Records a server-side admin action (e.g. the auth-level account block) in the same audit trail.
create or replace function private.admin_log(p_action text, p_type text, p_id text, p_after jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin('operate');
  if p_action !~ '^[a-z_.]{3,60}$' or p_type !~ '^[a-z_]{2,30}$' then raise exception 'invalid_action'; end if;
  perform private.audit(p_action, p_type, p_id, null, p_after);
  return '{}'::jsonb;
end $$;

------------------------------------------------------------------------------------------
-- 10. Expose admin_* functions through SECURITY INVOKER wrappers; lock down the private bodies.
------------------------------------------------------------------------------------------
do $$
declare f record; call_args text;
begin
  for f in
    select p.oid, p.proname, pg_get_function_arguments(p.oid) args, pg_get_function_identity_arguments(p.oid) iargs, p.proargnames, p.pronargs
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname like 'admin\_%'
  loop
    select coalesce(string_agg(format('%I', a), ', ' order by i), '') into call_args
      from unnest(f.proargnames) with ordinality as t(a, i) where i <= f.pronargs;
    execute format('create or replace function public.%I(%s) returns jsonb language sql security invoker set search_path = '''' as $w$ select private.%I(%s) $w$',
      f.proname, f.args, f.proname, call_args);
    execute format('revoke all on function private.%I(%s) from public, anon', f.proname, f.iargs);
    execute format('grant execute on function private.%I(%s) to authenticated', f.proname, f.iargs);
    execute format('revoke all on function public.%I(%s) from public, anon', f.proname, f.iargs);
    execute format('grant execute on function public.%I(%s) to authenticated', f.proname, f.iargs);
  end loop;
end $$;

-- Re-assert existing flag descriptions so the admin console can show human-readable copy.
update public.feature_flags set description = coalesce(description, initcap(replace(key, '_', ' ')));
