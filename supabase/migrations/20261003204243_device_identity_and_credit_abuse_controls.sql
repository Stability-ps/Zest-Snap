-- Recorded from production (version 20261003204243) on 2026-10-04.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.device_accounts (
  id uuid primary key default gen_random_uuid(),
  device_hash text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  free_benefit_eligible boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(device_hash,user_id)
);
alter table public.device_accounts enable row level security;
revoke all on public.device_accounts from anon, authenticated;

alter table public.scan_requests add column if not exists device_hash text;
create index if not exists device_accounts_user_idx on public.device_accounts(user_id);
create index if not exists device_accounts_hash_idx on public.device_accounts(device_hash);
create index if not exists scan_requests_device_recent_idx on public.scan_requests(device_hash,created_at desc);

create or replace function public.register_device(p_device_id text)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  u uuid := auth.uid();
  h text;
  eligible boolean;
  accounts integer;
begin
  if u is null then raise exception 'authentication_required'; end if;
  if p_device_id is null or length(p_device_id) < 16 or length(p_device_id) > 128 then raise exception 'invalid_device'; end if;
  h := encode(extensions.digest(p_device_id,'sha256'),'hex');

  select free_benefit_eligible into eligible
  from public.device_accounts where device_hash=h and user_id=u;

  if eligible is null then
    eligible := (select count(*) from public.device_accounts where device_hash=h and free_benefit_eligible) < 2;
    insert into public.device_accounts(device_hash,user_id,free_benefit_eligible)
    values(h,u,eligible)
    on conflict(device_hash,user_id) do update set last_seen_at=now();
  else
    update public.device_accounts set last_seen_at=now() where device_hash=h and user_id=u;
  end if;

  select count(*) into accounts from public.device_accounts where device_hash=h;
  return jsonb_build_object('freeBenefitEligible',eligible,'accountCount',accounts);
end $$;
revoke all on function public.register_device(text) from public,anon;
grant execute on function public.register_device(text) to authenticated;

create or replace function public.reserve_scan(p_user uuid,p_request uuid,p_hash text,p_device_id text)
returns integer
language plpgsql set search_path=''
as $$
declare
  allowance integer;
  used integer;
  pages integer;
  credit_price integer;
  balance integer;
  plan_id text;
  period date := date_trunc('month',now() at time zone 'UTC')::date;
  h text;
  eligible boolean;
  bonus integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if not exists(select 1 from public.feature_flags where key='ai_scanning' and enabled) then raise exception 'scanning_disabled'; end if;
  if p_device_id is null or length(p_device_id)<16 or length(p_device_id)>128 then raise exception 'device_required'; end if;
  h := encode(extensions.digest(p_device_id,'sha256'),'hex');

  select free_benefit_eligible into eligible from public.device_accounts where device_hash=h and user_id=p_user;
  if eligible is null then
    eligible := (select count(*) from public.device_accounts where device_hash=h and free_benefit_eligible) < 2;
    insert into public.device_accounts(device_hash,user_id,free_benefit_eligible)
    values(h,p_user,eligible)
    on conflict(device_hash,user_id) do update set last_seen_at=now();
  else
    update public.device_accounts set last_seen_at=now() where device_hash=h and user_id=p_user;
  end if;

  if exists(select 1 from public.scan_requests where id=p_request or (user_id=p_user and (created_at>now()-interval '10 seconds' or (content_hash=p_hash and created_at>now()-interval '60 seconds')))) then raise exception 'repeat_request'; end if;
  if (select count(*) from public.scan_requests where device_hash=h and created_at>now()-interval '1 hour') >= 20 then raise exception 'device_rate_limited'; end if;

  select p.plan,r.monthly_scans,r.pdf_pages,r.credits_per_bonus_scan
    into plan_id,allowance,pages,credit_price
  from public.profiles p join public.plan_rules r on p.plan=r.id
  where p.id=p_user and r.active;
  if allowance is null then raise exception 'account_unavailable'; end if;
  if plan_id='free' and not eligible then allowance := 0; end if;

  insert into public.usage_monthly(user_id,period_start) values(p_user,period) on conflict do nothing;
  select ai_scans,bonus_scans into used,bonus from public.usage_monthly where user_id=p_user and period_start=period for update;

  if used >= allowance + coalesce(bonus,0) then
    select coalesce(sum(amount),0) into balance from public.reward_ledger where user_id=p_user;
    if coalesce(credit_price,0)<=0 or balance < credit_price then
      if plan_id='free' and not eligible then raise exception 'device_free_limit'; end if;
      raise exception 'allowance_exhausted';
    end if;
    insert into public.reward_ledger(user_id,entry_type,amount,reason,reference_type,reference_id)
    values(p_user,'spend',-credit_price,'bonus_scan_redeem','scan_request',p_request::text);
  end if;

  insert into public.scan_requests(id,user_id,content_hash,device_hash) values(p_request,p_user,p_hash,h);
  update public.usage_monthly set ai_scans=ai_scans+1 where user_id=p_user and period_start=period;
  return pages;
end $$;
revoke all on function public.reserve_scan(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_scan(uuid,uuid,text,text) to service_role;

create or replace function public.claim_referral_device(p_code text,p_device_id text)
returns void
language plpgsql security definer set search_path=''
as $$
declare
  u uuid := auth.uid();
  sender uuid;
  h text;
begin
  if u is null or not exists(select 1 from public.feature_flags where key='referrals' and enabled) then raise exception 'referrals_disabled'; end if;
  if p_device_id is null or length(p_device_id)<16 or length(p_device_id)>128 then raise exception 'invalid_device'; end if;
  perform public.register_device(p_device_id);
  h := encode(extensions.digest(p_device_id,'sha256'),'hex');
  select user_id into sender from public.referral_invites where code=p_code;
  if sender is null or sender=u then raise exception 'invalid_referral'; end if;
  if exists(select 1 from public.device_accounts where user_id=sender and device_hash=h) then raise exception 'same_device_referral'; end if;
  if exists(select 1 from public.scan_requests where user_id=u) then raise exception 'existing_account_activity'; end if;
  insert into public.referrals(referrer_id,referred_user_id,referral_code,status)
  values(sender,u,p_code,'signed_up') on conflict(referred_user_id) do nothing;
end $$;
revoke all on function public.claim_referral_device(text,text) from public,anon;
grant execute on function public.claim_referral_device(text,text) to authenticated;

create or replace function public.qualify_referral(p_user uuid)
returns void
language plpgsql set search_path=''
as $$
declare r public.referrals%rowtype; a integer;
begin
 if not exists(select 1 from public.feature_flags where key='referrals' and enabled)
    or not exists(select 1 from public.scan_requests where user_id=p_user and status='completed') then return; end if;
 select * into r from public.referrals where referred_user_id=p_user and status='signed_up' for update;
 if not found then return; end if;
 if exists(
   select 1 from public.device_accounts a
   join public.device_accounts b on a.device_hash=b.device_hash
   where a.user_id=r.referrer_id and b.user_id=r.referred_user_id
 ) then return; end if;
 if exists(select 1 from public.device_accounts where user_id=r.referrer_id)
    and not exists(select 1 from public.device_accounts where user_id=r.referrer_id and free_benefit_eligible) then return; end if;
 select amount into a from public.reward_rules where key='referral_qualified' and enabled;
 if coalesce(a,0)<=0 then return; end if;
 update public.referrals set status='rewarded',qualified_at=now() where id=r.id;
 insert into public.reward_ledger(user_id,entry_type,amount,reason,reference_type,reference_id)
 values(r.referrer_id,'earn',a,'referral_qualified','referral',r.id::text);
end $$;

create or replace function public.award_milestone(p_user uuid,p_reason text)
returns void
language plpgsql set search_path=''
as $$
declare a integer;
begin
 if not exists(select 1 from public.feature_flags where key='rewards' and enabled) then return; end if;
 if exists(select 1 from public.device_accounts where user_id=p_user)
    and not exists(select 1 from public.device_accounts where user_id=p_user and free_benefit_eligible) then return; end if;
 select amount into a from public.reward_rules where key=p_reason and enabled;
 if a is null then raise exception 'invalid_milestone'; end if;
 if exists(select 1 from public.reward_ledger where user_id=p_user and reason=p_reason and reference_type='milestone') then return; end if;
 insert into public.reward_ledger(user_id,entry_type,amount,reason,reference_type)
 values(p_user,'earn',a,p_reason,'milestone');
end $$;

create or replace function public.submit_product_feedback(p_rating integer default null,p_feedback text default null)
returns integer language plpgsql security definer set search_path=''
as $$
declare u uuid := auth.uid(); a integer; inserted boolean;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if p_rating is not null and (p_rating<1 or p_rating>5) then raise exception 'invalid_rating'; end if;
 insert into public.product_feedback(user_id,rating,feedback)
 values(u,p_rating,nullif(left(trim(coalesce(p_feedback,'')),2000),''))
 on conflict(user_id) do nothing;
 get diagnostics inserted = row_count;
 if not inserted then return 0; end if;
 if exists(select 1 from public.device_accounts where user_id=u)
    and not exists(select 1 from public.device_accounts where user_id=u and free_benefit_eligible) then return 0; end if;
 select amount into a from public.reward_rules where key='product_feedback' and enabled;
 if coalesce(a,0)>0 then
   insert into public.reward_ledger(user_id,entry_type,amount,reason,reference_type,reference_id)
   values(u,'earn',a,'product_feedback','feedback',u::text);
 end if;
 return coalesce(a,0);
end $$;
