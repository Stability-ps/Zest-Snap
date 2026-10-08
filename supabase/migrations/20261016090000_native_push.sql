-- Native push for the iOS (APNs) and Android (FCM) apps, used by the deliver-reminders edge function.
-- 1. native_push_tokens: one row per device token, written only through the RPCs below.
-- 2. complete_push_reminder records which channel delivered a reminder (web_push / native_push / device).
-- 3. notification_queue: Shared invitations and Planner updates, written by triggers and delivered by the edge
--    function alongside Shared messages and Daily Briefings.
-- Additive. The edge function deployed before this migration keeps working (complete_push_reminder's new
-- argument has a default); the new edge function must not be deployed before this migration.

-- 1. Device tokens ---------------------------------------------------------------------------------------------
create table if not exists public.native_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios','android')),
  token text not null unique check (char_length(token) between 16 and 4096),
  environment text check (environment is null or environment in ('production','sandbox')),
  app_version text check (app_version is null or char_length(app_version) <= 64),
  failure_count integer not null default 0 check (failure_count between 0 and 1000),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists native_push_tokens_user_idx on public.native_push_tokens(user_id);
alter table public.native_push_tokens enable row level security;
revoke all on public.native_push_tokens from public, anon, authenticated;
grant all on public.native_push_tokens to service_role;

-- Registration is also how token refresh arrives, so it runs on every launch, resume and sign-in. A token moves
-- to whoever is signed in on that device now: a device never receives a previous account's notifications.
create or replace function public.register_native_push_token(p_token text, p_platform text, p_app_version text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := (select auth.uid());
begin
  if u is null then raise exception 'authentication_required'; end if;
  if p_platform not in ('ios','android') then raise exception 'invalid_platform'; end if;
  if p_token is null or char_length(p_token) not between 16 and 4096 then raise exception 'invalid_token'; end if;
  insert into public.native_push_tokens(user_id, platform, token, app_version)
  values (u, p_platform, p_token, left(p_app_version, 64))
  on conflict (token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    app_version = excluded.app_version,
    failure_count = case when public.native_push_tokens.user_id = excluded.user_id then public.native_push_tokens.failure_count else 0 end,
    environment = case when public.native_push_tokens.user_id = excluded.user_id then public.native_push_tokens.environment end,
    updated_at = now();
  -- Bound the number of devices per account; the least recently registered go first.
  delete from public.native_push_tokens t
   where t.user_id = u
     and t.id not in (select id from public.native_push_tokens where user_id = u order by updated_at desc limit 20);
  -- Tokens no device has re-registered for 270 days belong to uninstalled apps.
  delete from public.native_push_tokens where updated_at < now() - interval '270 days';
end $$;
revoke all on function public.register_native_push_token(text, text, text) from public, anon;
grant execute on function public.register_native_push_token(text, text, text) to authenticated;

create or replace function public.unregister_native_push_token(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := (select auth.uid());
begin
  if u is null then raise exception 'authentication_required'; end if;
  delete from public.native_push_tokens where token = p_token and user_id = u;
end $$;
revoke all on function public.unregister_native_push_token(text) from public, anon;
grant execute on function public.unregister_native_push_token(text) to authenticated;

-- 2. Reminder delivery channel --------------------------------------------------------------------------------
alter table public.reminders drop constraint if exists reminders_delivered_via_check;
alter table public.reminders add constraint reminders_delivered_via_check
  check (delivered_via is null or delivered_via in ('web_push', 'native_push', 'device'));

-- Replaces the 3-argument version (an overload next to it would make the named 3-argument call ambiguous).
-- Otherwise unchanged from 20261007090000_native_reminder_delivery.
drop function if exists public.complete_push_reminder(uuid, boolean, text);
create or replace function public.complete_push_reminder(p_id uuid, p_ok boolean, p_error text default null, p_via text default 'web_push')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update public.reminders
       set status = 'sent', delivered_at = now(),
           delivered_via = case when p_via = 'native_push' then 'native_push' else 'web_push' end,
           claimed_at = null, last_error = null
     where id = p_id and status = 'processing';
  elsif exists (select 1 from public.reminders where id = p_id and status = 'processing' and device_armed_for = scheduled_at) then
    update public.reminders set status = 'sent', delivered_at = now(), delivered_via = 'device', claimed_at = null, last_error = null
     where id = p_id and status = 'processing';
  else
    update public.reminders
       set retry_count = least(retry_count + 1, 20),
           status = case when retry_count + 1 >= 5 then 'failed' else 'pending' end,
           scheduled_at = case when retry_count + 1 >= 5 then scheduled_at else now() + interval '2 minutes' end,
           claimed_at = null, last_error = left(coalesce(p_error, 'push_failed'), 500)
     where id = p_id and status = 'processing';
  end if;
end $$;
revoke all on function public.complete_push_reminder(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.complete_push_reminder(uuid, boolean, text, text) to service_role;

-- 3. Notification queue ---------------------------------------------------------------------------------------
create table if not exists public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('shared_invite','planner_update')),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 500),
  url text not null check (url like '/%' and url not like '//%' and char_length(url) <= 500),
  dedupe_key text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error text,
  unique (recipient_id, dedupe_key)
);
create index if not exists notification_queue_due_idx on public.notification_queue(created_at) where delivered_at is null;
create index if not exists notification_queue_recipient_idx on public.notification_queue(recipient_id, created_at desc);
alter table public.notification_queue enable row level security;
revoke all on public.notification_queue from public, anon, authenticated;
grant all on public.notification_queue to service_role;

create or replace function public.claim_notifications(p_limit integer default 100)
returns table(id uuid, recipient_id uuid, kind text, title text, body text, url text, attempts integer)
language plpgsql security invoker set search_path = '' as $$
begin
  -- Keep 30 days: enough to inspect delivery, not a second copy of people's activity.
  delete from public.notification_queue q where q.created_at < now() - interval '30 days';
  return query
  with picked as (
    select q.id from public.notification_queue q
     where q.delivered_at is null and q.attempts < 20
       and (q.claimed_at is null or q.claimed_at < now() - interval '10 minutes')
     order by q.created_at for update skip locked
     limit least(greatest(p_limit, 1), 500)
  ), claimed as (
    update public.notification_queue q
       set claimed_at = now(), attempts = q.attempts + 1
      from picked p where q.id = p.id
    returning q.id, q.recipient_id, q.kind, q.title, q.body, q.url, q.attempts
  )
  select * from claimed;
end $$;
revoke all on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;

create or replace function public.complete_notification(p_id uuid, p_ok boolean, p_error text default null)
returns void language sql security invoker set search_path = '' as $$
  update public.notification_queue
     set delivered_at = case when p_ok then now() else delivered_at end,
         claimed_at = null,
         last_error = case when p_ok then null else left(coalesce(p_error, 'push_failed'), 500) end
   where id = p_id
$$;
revoke all on function public.complete_notification(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.complete_notification(uuid, boolean, text) to service_role;

-- An email invitation to someone who already has an account.
create or replace function private.enqueue_shared_invite_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient uuid; plan_name text; inviter text;
begin
  if new.invited_email is null or new.status <> 'pending' then return new; end if;
  select u.id into recipient from auth.users u where lower(u.email) = lower(new.invited_email) limit 1;
  if recipient is null or recipient = new.created_by then return new; end if;
  if exists (select 1 from public.shared_plan_members m where m.plan_id = new.plan_id and m.user_id = recipient and m.status = 'active') then
    return new;
  end if;
  select p.name into plan_name from public.shared_plans p where p.id = new.plan_id;
  select coalesce(nullif(pr.display_name, ''), 'Someone') into inviter from public.profiles pr where pr.id = new.created_by;
  insert into public.notification_queue(recipient_id, kind, title, body, url, dedupe_key)
  values (recipient, 'shared_invite', 'Shared plan invitation',
          left(coalesce(inviter, 'Someone') || ' invited you to “' || coalesce(plan_name, 'a shared plan') || '”', 500),
          '/share/' || new.token::text, 'invite:' || new.id::text)
  on conflict (recipient_id, dedupe_key) do nothing;
  return new;
end $$;
revoke all on function private.enqueue_shared_invite_notification() from public, anon, authenticated;
drop trigger if exists shared_invite_notify on public.shared_plan_invites;
create trigger shared_invite_notify after insert on public.shared_plan_invites
for each row execute function private.enqueue_shared_invite_notification();

-- Someone else assigns you a Shared task, or reschedules or cancels one assigned to you. Changes made without a
-- signed-in actor (server jobs, member removal) and changes you make yourself are not notified. Dates are not
-- put in the text: the recipient's language and date format aren't known here.
create or replace function private.enqueue_planner_update_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); msg text; plan_name text;
begin
  if actor is null or new.assigned_to is null or new.assigned_to = actor then return new; end if;
  if tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
    msg := 'You were assigned “' || new.title || '”';
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    msg := '“' || new.title || '” was cancelled';
  elsif new.status <> 'cancelled' and (new.start_date, new.start_time, new.due_date, new.due_time)
        is distinct from (old.start_date, old.start_time, old.due_date, old.due_time) then
    msg := '“' || new.title || '” was rescheduled';
  else
    return new;
  end if;
  if not exists (select 1 from public.shared_plan_members m where m.plan_id = new.plan_id and m.user_id = new.assigned_to and m.status = 'active')
     and not exists (select 1 from public.shared_plans p where p.id = new.plan_id and p.owner_id = new.assigned_to) then
    return new;
  end if;
  select p.name into plan_name from public.shared_plans p where p.id = new.plan_id;
  insert into public.notification_queue(recipient_id, kind, title, body, url)
  values (new.assigned_to, 'planner_update', left(coalesce(plan_name, 'Shared plan'), 200), left(msg, 500), '/shared/' || new.plan_id::text);
  return new;
end $$;
revoke all on function private.enqueue_planner_update_notification() from public, anon, authenticated;
drop trigger if exists shared_item_notify on public.shared_plan_items;
create trigger shared_item_notify after insert or update of assigned_to, status, start_date, start_time, due_date, due_time
on public.shared_plan_items for each row execute function private.enqueue_planner_update_notification();
