-- Zest Snap production hardening (2026-10-04).
-- Additive and idempotent. Preserves historical balances, ledger rows and existing users.

------------------------------------------------------------------------------------------
-- 1. Central, admin-editable product limits (no client can write these).
------------------------------------------------------------------------------------------
create table if not exists public.app_limits (
  key text primary key,
  value integer not null check (value >= 0 and value <= 1000000),
  description text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.app_limits enable row level security;
revoke all on public.app_limits from anon, authenticated;
grant select, update on public.app_limits to authenticated;
grant all on public.app_limits to service_role;
drop policy if exists app_limits_read on public.app_limits;
create policy app_limits_read on public.app_limits for select to authenticated using (true);
drop policy if exists app_limits_admin_update on public.app_limits;
create policy app_limits_admin_update on public.app_limits for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

insert into public.app_limits(key, value, description) values
  ('free_accounts_per_device', 2, 'Accounts on one device that receive free-plan allowance and reward credits. Paid plans are never limited.'),
  ('guest_trial_scans_per_device', 2, 'Lifetime AI scans for signed-out use on one device.'),
  ('guest_scans_per_network_day', 6, 'Signed-out AI scans per network per day (pseudonymous, rotating daily hash).'),
  ('device_scans_per_hour', 20, 'AI scans per device per hour across all accounts.'),
  ('referral_rewards_per_referrer_month', 5, 'Qualified referral rewards one referrer can earn per calendar month.'),
  ('scan_result_cache_hours', 24, 'Identical documents re-scanned within this window reuse the earlier result without another AI call or charge.')
on conflict (key) do nothing;

create or replace function private.app_limit(p_key text, p_default integer)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.app_limits where key = p_key), p_default)
$$;
revoke all on function private.app_limit(text, integer) from public, anon, authenticated;
grant execute on function private.app_limit(text, integer) to service_role;

insert into public.feature_flags(key, description, enabled, public_visible)
values ('guest_trial', 'Small device-limited AI trial before sign-in', true, true)
on conflict (key) do nothing;

------------------------------------------------------------------------------------------
-- 2. Device benefit claims survive account deletion.
-- device_accounts links a pseudonymous device hash to a user and is deleted with the account.
-- device_benefit_claims keeps only a per-device counter (no user link), so deleting and
-- re-creating accounts cannot reset free allowances on the same device.
------------------------------------------------------------------------------------------
create table if not exists public.device_benefit_claims (
  device_hash text primary key,
  free_accounts_claimed integer not null default 0 check (free_accounts_claimed >= 0),
  updated_at timestamptz not null default now()
);
alter table public.device_benefit_claims enable row level security;
revoke all on public.device_benefit_claims from anon, authenticated;
grant all on public.device_benefit_claims to service_role;

insert into public.device_benefit_claims(device_hash, free_accounts_claimed)
select device_hash, count(*) filter (where free_benefit_eligible)
from public.device_accounts group by device_hash
on conflict (device_hash) do update
  set free_accounts_claimed = greatest(public.device_benefit_claims.free_accounts_claimed, excluded.free_accounts_claimed);

create or replace function private.device_hash(p_device_id text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_device_id is null or length(p_device_id) < 16 or length(p_device_id) > 128 then
    raise exception 'device_required';
  end if;
  return encode(extensions.digest(p_device_id, 'sha256'), 'hex');
end $$;
revoke all on function private.device_hash(text) from public, anon, authenticated;
grant execute on function private.device_hash(text) to service_role;

-- Links user↔device and decides once, permanently, whether this account gets free benefits on it.
create or replace function private.link_device(p_user uuid, p_device_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  h text := private.device_hash(p_device_id);
  eligible boolean;
  claimed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('device:' || h, 0));
  select free_benefit_eligible into eligible from public.device_accounts where device_hash = h and user_id = p_user;
  if eligible is not null then
    update public.device_accounts set last_seen_at = now() where device_hash = h and user_id = p_user;
    return eligible;
  end if;
  insert into public.device_benefit_claims(device_hash) values (h) on conflict (device_hash) do nothing;
  select free_accounts_claimed into claimed from public.device_benefit_claims where device_hash = h for update;
  eligible := claimed < private.app_limit('free_accounts_per_device', 2);
  insert into public.device_accounts(device_hash, user_id, free_benefit_eligible) values (h, p_user, eligible)
    on conflict (device_hash, user_id) do update set last_seen_at = now();
  if eligible then
    update public.device_benefit_claims set free_accounts_claimed = free_accounts_claimed + 1, updated_at = now() where device_hash = h;
  end if;
  return eligible;
end $$;
revoke all on function private.link_device(uuid, text) from public, anon, authenticated;
grant execute on function private.link_device(uuid, text) to service_role;

-- An account is promotion-eligible unless every device it has used marked it ineligible.
create or replace function private.free_benefits_allowed(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.device_accounts where user_id = p_user)
      or exists (select 1 from public.device_accounts where user_id = p_user and free_benefit_eligible)
$$;
revoke all on function private.free_benefits_allowed(uuid) from public, anon, authenticated;
grant execute on function private.free_benefits_allowed(uuid) to service_role;

create or replace function private.register_device_for_user(p_device_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); eligible boolean;
begin
  if u is null then raise exception 'authentication_required'; end if;
  begin
    eligible := private.link_device(u, p_device_id);
  exception when raise_exception then
    raise exception 'invalid_device';
  end;
  return jsonb_build_object('freeBenefitEligible', eligible);
end $$;
revoke all on function private.register_device_for_user(text) from public, anon;
grant execute on function private.register_device_for_user(text) to authenticated;
-- Public entry point is SECURITY INVOKER; the privileged body lives in the unexposed private schema.
create or replace function public.register_device(p_device_id text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.register_device_for_user(p_device_id) $$;
revoke all on function public.register_device(text) from public, anon;
grant execute on function public.register_device(text) to authenticated;

------------------------------------------------------------------------------------------
-- 3. Scan reservation: atomic, idempotent, device-aware; credit spend refunded on failure;
--    completed results cached so identical retries never call the AI or charge again.
------------------------------------------------------------------------------------------
alter table public.scan_requests add column if not exists result jsonb;
alter table public.scan_requests add column if not exists completed_at timestamptz;
alter table public.scan_requests drop constraint if exists scan_requests_result_size;
alter table public.scan_requests add constraint scan_requests_result_size check (result is null or octet_length(result::text) <= 200000);
create index if not exists scan_requests_owner_hash_idx on public.scan_requests(user_id, content_hash, created_at desc);

create unique index if not exists reward_reference_once
  on public.reward_ledger(user_id, reference_type, reference_id) where reference_id is not null;

drop function if exists public.reserve_scan(uuid, uuid, text);

create or replace function public.reserve_scan(p_user uuid, p_request uuid, p_hash text, p_device_id text)
returns integer language plpgsql set search_path = '' as $$
declare
  allowance integer; used integer; pages integer; credit_price integer; balance integer; plan_id text; bonus integer;
  period date := date_trunc('month', now() at time zone 'UTC')::date;
  h text := private.device_hash(p_device_id);
  eligible boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  if not exists (select 1 from public.feature_flags where key = 'ai_scanning' and enabled) then raise exception 'scanning_disabled'; end if;
  perform private.expire_stale_reservations(p_user);
  eligible := private.link_device(p_user, p_device_id);

  if exists (select 1 from public.scan_requests where id = p_request) then raise exception 'repeat_request'; end if;
  if exists (select 1 from public.scan_requests where user_id = p_user and status = 'reserved' and created_at > now() - interval '90 seconds')
     or exists (select 1 from public.scan_requests where user_id = p_user and created_at > now() - interval '5 seconds') then
    raise exception 'repeat_request';
  end if;
  if (select count(*) from public.scan_requests where device_hash = h and created_at > now() - interval '1 hour')
     >= private.app_limit('device_scans_per_hour', 20) then
    raise exception 'device_rate_limited';
  end if;

  select p.plan, r.monthly_scans, r.pdf_pages, r.credits_per_bonus_scan into plan_id, allowance, pages, credit_price
  from public.profiles p join public.plan_rules r on p.plan = r.id where p.id = p_user and r.active;
  if allowance is null then raise exception 'account_unavailable'; end if;
  if plan_id = 'free' and not eligible then allowance := 0; end if;

  insert into public.usage_monthly(user_id, period_start) values (p_user, period) on conflict do nothing;
  select ai_scans, bonus_scans into used, bonus from public.usage_monthly where user_id = p_user and period_start = period for update;

  if used >= allowance + coalesce(bonus, 0) then
    select coalesce(sum(amount), 0) into balance from public.reward_ledger where user_id = p_user;
    if coalesce(credit_price, 0) <= 0 or balance < credit_price then
      if plan_id = 'free' and not eligible then raise exception 'device_free_limit'; end if;
      raise exception 'allowance_exhausted';
    end if;
    insert into public.reward_ledger(user_id, entry_type, amount, reason, reference_type, reference_id)
    values (p_user, 'spend', -credit_price, 'bonus_scan_redeem', 'scan_request', p_request::text);
  end if;

  insert into public.scan_requests(id, user_id, content_hash, device_hash) values (p_request, p_user, p_hash, h);
  update public.usage_monthly set ai_scans = ai_scans + 1 where user_id = p_user and period_start = period;
  return pages;
end $$;
revoke all on function public.reserve_scan(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_scan(uuid, uuid, text, text) to service_role;

drop function if exists public.finish_scan(uuid, text, integer, integer, integer, numeric);
create or replace function public.finish_scan(
  p_request uuid, p_status text, p_pages integer, p_input integer, p_output integer, p_cost numeric,
  p_result jsonb default null
) returns void language plpgsql set search_path = '' as $$
declare request public.scan_requests; period date; spent integer;
begin
  if p_status not in ('completed', 'failed') or p_pages < 0 or p_input < 0 or p_output < 0 or coalesce(p_cost, 0) < 0 then
    raise exception 'invalid_result';
  end if;
  update public.scan_requests
     set status = p_status, input_tokens = p_input, output_tokens = p_output, estimated_cost_usd = p_cost,
         result = case when p_status = 'completed' then p_result end,
         completed_at = now()
   where id = p_request and status = 'reserved'
  returning * into request;
  if not found then return; end if;
  period := date_trunc('month', request.created_at at time zone 'UTC')::date;

  if p_status = 'failed' then
    -- Deliberate no-charge policy: a failed AI operation returns the monthly allowance and any credits spent.
    update public.usage_monthly set ai_scans = greatest(ai_scans - 1, 0)
     where user_id = request.user_id and period_start = period;
    select -amount into spent from public.reward_ledger
     where user_id = request.user_id and reference_type = 'scan_request' and reference_id = p_request::text and entry_type = 'spend';
    if coalesce(spent, 0) > 0 then
      insert into public.reward_ledger(user_id, entry_type, amount, reason, reference_type, reference_id)
      values (request.user_id, 'adjustment', spent, 'bonus_scan_refund', 'scan_refund', p_request::text)
      on conflict do nothing;
    end if;
    return;
  end if;

  update public.usage_monthly
     set pdf_pages = pdf_pages + p_pages, estimated_cost_usd = estimated_cost_usd + coalesce(p_cost, 0)
   where user_id = request.user_id and period_start = period;
  perform public.award_milestone(request.user_id, 'first_scan');
  perform public.qualify_referral(request.user_id);
end $$;
revoke all on function public.finish_scan(uuid, text, integer, integer, integer, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.finish_scan(uuid, text, integer, integer, integer, numeric, jsonb) to service_role;

-- Reuse an identical completed scan (same user, same file content) instead of paying for another AI call.
create or replace function public.cached_scan_result(p_user uuid, p_hash text, p_request uuid default null)
returns jsonb language sql stable set search_path = '' as $$
  select result from public.scan_requests
   where user_id = p_user and status = 'completed' and result is not null
     and (id = p_request or (content_hash = p_hash
          and completed_at > now() - make_interval(hours => private.app_limit('scan_result_cache_hours', 24))))
   order by (id = p_request) desc nulls last, completed_at desc
   limit 1
$$;
revoke all on function public.cached_scan_result(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cached_scan_result(uuid, text, uuid) to service_role;

------------------------------------------------------------------------------------------
-- 4. Signed-out trial: server-enforced and device + network limited.
------------------------------------------------------------------------------------------
create table if not exists public.guest_scan_usage (
  request_id uuid primary key,
  device_hash text not null,
  network_hash text,
  content_hash text not null,
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed')),
  result jsonb check (result is null or octet_length(result::text) <= 200000),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists guest_scan_usage_device_idx on public.guest_scan_usage(device_hash, created_at desc);
create index if not exists guest_scan_usage_network_idx on public.guest_scan_usage(network_hash, created_at desc);
alter table public.guest_scan_usage enable row level security;
revoke all on public.guest_scan_usage from anon, authenticated;
grant all on public.guest_scan_usage to service_role;

create or replace function public.reserve_guest_scan(p_request uuid, p_hash text, p_device_id text, p_network_hash text)
returns jsonb language plpgsql set search_path = '' as $$
declare h text := private.device_hash(p_device_id); used integer; cached jsonb; pages integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('guest:' || h, 0));
  update public.guest_scan_usage set status = 'failed', completed_at = now()
   where device_hash = h and status = 'reserved' and created_at < now() - interval '3 minutes';
  if not exists (select 1 from public.feature_flags where key = 'ai_scanning' and enabled)
     or not exists (select 1 from public.feature_flags where key = 'guest_trial' and enabled) then
    raise exception 'sign_in_required';
  end if;
  select result into cached from public.guest_scan_usage
   where device_hash = h and content_hash = p_hash and status = 'completed' and result is not null
     and completed_at > now() - make_interval(hours => private.app_limit('scan_result_cache_hours', 24))
   order by completed_at desc limit 1;
  if cached is not null then return jsonb_build_object('cached', cached); end if;
  if exists (select 1 from public.guest_scan_usage where request_id = p_request)
     or exists (select 1 from public.guest_scan_usage where device_hash = h and created_at > now() - interval '5 seconds')
     or exists (select 1 from public.guest_scan_usage where device_hash = h and status = 'reserved' and created_at > now() - interval '90 seconds') then
    raise exception 'repeat_request';
  end if;
  select count(*) into used from public.guest_scan_usage where device_hash = h and status <> 'failed';
  if used >= private.app_limit('guest_trial_scans_per_device', 2) then raise exception 'guest_trial_exhausted'; end if;
  if p_network_hash is not null and (select count(*) from public.guest_scan_usage
       where network_hash = p_network_hash and status <> 'failed' and created_at > now() - interval '1 day')
       >= private.app_limit('guest_scans_per_network_day', 6) then
    raise exception 'guest_trial_exhausted';
  end if;
  insert into public.guest_scan_usage(request_id, device_hash, network_hash, content_hash) values (p_request, h, p_network_hash, p_hash);
  select pdf_pages into pages from public.plan_rules where id = 'free';
  return jsonb_build_object('pages', coalesce(pages, 3), 'remaining', private.app_limit('guest_trial_scans_per_device', 2) - used - 1);
end $$;
revoke all on function public.reserve_guest_scan(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_guest_scan(uuid, text, text, text) to service_role;

create or replace function public.finish_guest_scan(p_request uuid, p_status text, p_result jsonb default null)
returns void language sql set search_path = '' as $$
  update public.guest_scan_usage
     set status = p_status, result = case when p_status = 'completed' then p_result end, completed_at = now()
   where request_id = p_request and status = 'reserved' and p_status in ('completed', 'failed')
$$;
revoke all on function public.finish_guest_scan(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_guest_scan(uuid, text, jsonb) to service_role;

-- A request killed mid-flight (e.g. platform timeout) never reaches finish_scan. Expire it so the
-- allowance and any credits are refunded and the user is not blocked by an "in progress" scan.
create or replace function private.expire_stale_reservations(p_user uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id from public.scan_requests
            where status = 'reserved' and created_at < now() - interval '3 minutes'
              and (p_user is null or user_id = p_user)
            limit 500 loop
    perform public.finish_scan(r.id, 'failed', 0, 0, 0, 0);
    n := n + 1;
  end loop;
  update public.guest_scan_usage set status = 'failed', completed_at = now()
   where status = 'reserved' and created_at < now() - interval '3 minutes';
  return n;
end $$;
revoke all on function private.expire_stale_reservations(uuid) from public, anon, authenticated;
grant execute on function private.expire_stale_reservations(uuid) to service_role;

------------------------------------------------------------------------------------------
-- 5. Rewards: milestones, feedback and referrals respect device eligibility and stay once-only.
------------------------------------------------------------------------------------------
create or replace function public.award_milestone(p_user uuid, p_reason text)
returns void language plpgsql set search_path = '' as $$
declare a integer;
begin
  if not exists (select 1 from public.feature_flags where key = 'rewards' and enabled) then return; end if;
  if not private.free_benefits_allowed(p_user) then return; end if;
  select amount into a from public.reward_rules where key = p_reason and enabled;
  if a is null then raise exception 'invalid_milestone'; end if;
  insert into public.reward_ledger(user_id, entry_type, amount, reason, reference_type)
  values (p_user, 'earn', a, p_reason, 'milestone')
  on conflict do nothing;
end $$;
revoke all on function public.award_milestone(uuid, text) from public, anon, authenticated;
grant execute on function public.award_milestone(uuid, text) to service_role;

create or replace function private.submit_feedback_for_user(p_rating integer default null, p_feedback text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); a integer; inserted_rows integer;
begin
  if u is null then raise exception 'authentication_required'; end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then raise exception 'invalid_rating'; end if;
  if p_rating is null and nullif(trim(coalesce(p_feedback, '')), '') is null then raise exception 'feedback_required'; end if;
  insert into public.product_feedback(user_id, rating, feedback)
  values (u, p_rating, nullif(left(trim(coalesce(p_feedback, '')), 2000), ''))
  on conflict (user_id) do nothing;
  get diagnostics inserted_rows = row_count;
  if inserted_rows = 0 then return 0; end if;
  if not exists (select 1 from public.feature_flags where key = 'rewards' and enabled) then return 0; end if;
  if not private.free_benefits_allowed(u) then return 0; end if;
  select amount into a from public.reward_rules where key = 'product_feedback' and enabled;
  if coalesce(a, 0) <= 0 then return 0; end if;
  -- Same reward whatever the rating or sentiment.
  insert into public.reward_ledger(user_id, entry_type, amount, reason, reference_type, reference_id)
  values (u, 'earn', a, 'product_feedback', 'feedback', u::text)
  on conflict do nothing;
  return a;
end $$;
revoke all on function private.submit_feedback_for_user(integer, text) from public, anon;
grant execute on function private.submit_feedback_for_user(integer, text) to authenticated;
-- Public entry point is SECURITY INVOKER; the privileged body lives in the unexposed private schema.
create or replace function public.submit_product_feedback(p_rating integer default null, p_feedback text default null) returns integer
language sql security invoker set search_path = '' as $$ select private.submit_feedback_for_user(p_rating, p_feedback) $$;
revoke all on function public.submit_product_feedback(integer, text) from public, anon;
grant execute on function public.submit_product_feedback(integer, text) to authenticated;

-- Each referrer has one stable code, so a code must be usable by many invitees.
alter table public.referrals drop constraint if exists referrals_referral_code_key;
drop index if exists public.referrals_referral_code_key;
create index if not exists referrals_code_idx on public.referrals(referral_code);

create or replace function private.claim_referral_for_user(p_code text, p_device_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); sender uuid; h text;
begin
  if u is null or not exists (select 1 from public.feature_flags where key = 'referrals' and enabled) then raise exception 'referrals_disabled'; end if;
  begin
    h := private.device_hash(p_device_id);
  exception when raise_exception then
    raise exception 'invalid_device';
  end;
  perform private.link_device(u, p_device_id);
  select user_id into sender from public.referral_invites where code = p_code;
  if sender is null or sender = u then raise exception 'invalid_referral'; end if;
  if exists (select 1 from public.device_accounts where user_id = sender and device_hash = h) then raise exception 'same_device_referral'; end if;
  if exists (select 1 from public.referrals where referrer_id = u and referred_user_id = sender) then raise exception 'invalid_referral'; end if;
  if exists (select 1 from public.scan_requests where user_id = u) then raise exception 'existing_account_activity'; end if;
  insert into public.referrals(referrer_id, referred_user_id, referral_code, status)
  values (sender, u, p_code, 'signed_up') on conflict (referred_user_id) do nothing;
end $$;
revoke all on function private.claim_referral_for_user(text, text) from public, anon;
grant execute on function private.claim_referral_for_user(text, text) to authenticated;
-- Public entry point is SECURITY INVOKER; the privileged body lives in the unexposed private schema.
create or replace function public.claim_referral_device(p_code text, p_device_id text) returns void
language sql security invoker set search_path = '' as $$ select private.claim_referral_for_user(p_code, p_device_id) $$;
revoke all on function public.claim_referral_device(text, text) from public, anon;
grant execute on function public.claim_referral_device(text, text) to authenticated;

-- Legacy (device-less) claim path kept for cached clients; it applies the same loop protection.
create or replace function private.claim_referral_code(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare sender uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.feature_flags where key = 'referrals' and enabled) then raise exception 'referrals_disabled'; end if;
  select user_id into sender from public.referral_invites where code = p_code;
  if sender is null or sender = auth.uid() then raise exception 'invalid_referral'; end if;
  if exists (select 1 from public.referrals where referrer_id = auth.uid() and referred_user_id = sender) then raise exception 'invalid_referral'; end if;
  if exists (select 1 from public.scan_requests where user_id = auth.uid()) then raise exception 'existing_account_activity'; end if;
  insert into public.referrals(referrer_id, referred_user_id, referral_code, status)
  values (sender, auth.uid(), p_code, 'signed_up') on conflict (referred_user_id) do nothing;
end $$;

-- Qualification: the invitee completed a real (server-metered) AI scan on a device that does not
-- belong to the referrer, the invitee is free-benefit eligible, and the referrer is under the monthly cap.
create or replace function public.qualify_referral(p_user uuid)
returns void language plpgsql set search_path = '' as $$
declare r public.referrals%rowtype; a integer; this_month integer;
begin
  if not exists (select 1 from public.feature_flags where key = 'referrals' and enabled)
     or not exists (select 1 from public.scan_requests where user_id = p_user and status = 'completed') then return; end if;
  select * into r from public.referrals where referred_user_id = p_user and status = 'signed_up' for update;
  if not found then return; end if;
  if exists (select 1 from public.device_accounts a join public.device_accounts b on a.device_hash = b.device_hash
             where a.user_id = r.referrer_id and b.user_id = r.referred_user_id) then
    update public.referrals set status = 'qualified', qualified_at = now() where id = r.id;
    return;
  end if;
  if not private.free_benefits_allowed(r.referrer_id) or not private.free_benefits_allowed(r.referred_user_id) then
    update public.referrals set status = 'qualified', qualified_at = now() where id = r.id;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('referrer:' || r.referrer_id::text, 0));
  select count(*) into this_month from public.reward_ledger
   where user_id = r.referrer_id and reason = 'referral_qualified'
     and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  if this_month >= private.app_limit('referral_rewards_per_referrer_month', 5) then
    update public.referrals set status = 'qualified', qualified_at = now() where id = r.id;
    return;
  end if;
  select amount into a from public.reward_rules where key = 'referral_qualified' and enabled;
  if coalesce(a, 0) <= 0 then return; end if;
  update public.referrals set status = 'rewarded', qualified_at = now() where id = r.id;
  insert into public.reward_ledger(user_id, entry_type, amount, reason, reference_type, reference_id)
  values (r.referrer_id, 'earn', a, 'referral_qualified', 'referral', r.id::text)
  on conflict do nothing;
end $$;
revoke all on function public.qualify_referral(uuid) from public, anon, authenticated;
grant execute on function public.qualify_referral(uuid) to service_role;

------------------------------------------------------------------------------------------
-- 6. Reminders: never notify for cancelled items or completed tasks.
------------------------------------------------------------------------------------------
create or replace function public.claim_due_reminders(p_limit integer default 100)
returns table(id uuid, user_id uuid, scheduled_at timestamptz, retry_count integer)
language plpgsql set search_path = '' as $$
begin
  update public.reminders r set status = 'cancelled', claimed_at = null
    from public.planner_items p
   where p.id = r.planner_item_id and r.status = 'pending' and r.scheduled_at <= now() and p.status = 'cancelled';
  update public.reminders r set status = 'handled', handled_at = now(), claimed_at = null
    from public.planner_items p
   where p.id = r.planner_item_id and r.status = 'pending' and r.scheduled_at <= now()
     and p.status = 'completed' and p.type in ('task', 'deadline');
  return query
  with picked as (
    select r.id from public.reminders r
     where (r.status = 'pending' and r.scheduled_at <= now())
        or (r.status = 'processing' and r.claimed_at < now() - interval '10 minutes')
     order by r.scheduled_at for update skip locked
     limit least(greatest(p_limit, 1), 500)
  ), claimed as (
    update public.reminders r set status = 'processing', claimed_at = now()
      from picked p where r.id = p.id
    returning r.id, r.user_id, r.scheduled_at, r.retry_count
  )
  select * from claimed;
end $$;
revoke all on function public.claim_due_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(integer) to service_role;

------------------------------------------------------------------------------------------
-- 7. Least-privilege table grants. RLS already isolated rows; these revoke table-level rights
--    (including TRUNCATE, which RLS does not cover) that no client flow needs.
------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select on public.feature_flags to anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke insert, update, delete on public.scan_requests, public.referrals, public.referral_invites,
  public.reminders, public.reward_ledger, public.usage_monthly, public.subscriptions,
  public.product_feedback, public.device_accounts from authenticated;
revoke insert, delete on public.reward_rules, public.plan_rules from authenticated;
revoke update on public.push_subscriptions from authenticated;
drop policy if exists "feedback own insert" on public.product_feedback;

------------------------------------------------------------------------------------------
-- 8. Retention, enforced server-side even when the app is never reopened.
------------------------------------------------------------------------------------------
create or replace function private.enforce_retention()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.scans s using public.profiles p
   where s.user_id = p.id
     and case when (p.preferences ->> 'retentionDays') ~ '^\d{1,5}$' then (p.preferences ->> 'retentionDays')::integer else 90 end > 0
     and s.created_at < now() - make_interval(days =>
           case when (p.preferences ->> 'retentionDays') ~ '^\d{1,5}$' then (p.preferences ->> 'retentionDays')::integer else 90 end);
  update public.scan_requests set result = null where result is not null and completed_at < now() - interval '2 days';
  update public.guest_scan_usage set result = null where result is not null and completed_at < now() - interval '2 days';
  update public.guest_scan_usage set network_hash = null where network_hash is not null and created_at < now() - interval '2 days';
  delete from public.push_subscriptions where failure_count >= 20;
end $$;
revoke all on function private.enforce_retention() from public, anon, authenticated;

select cron.schedule('zest-enforce-retention', '17 3 * * *', $$ select private.enforce_retention() $$);
select cron.schedule('zest-expire-stale-scans', '*/10 * * * *', $$ select private.expire_stale_reservations(null) $$);
