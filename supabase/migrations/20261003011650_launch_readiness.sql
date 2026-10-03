-- Dedicated Zest Snap project only. Never run against another product.
-- Restrict self-service updates: ownership RLS alone does not protect privileged columns.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update(display_name, locale, timezone, onboarding_complete) on public.profiles to authenticated;
revoke all on public.usage_monthly, public.reward_ledger, public.subscriptions from anon, authenticated;
grant select on public.usage_monthly, public.reward_ledger, public.subscriptions to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.profiles add column preferences jsonb not null default '{}';
grant update(preferences) on public.profiles to authenticated;
alter table public.scans add column payload jsonb not null default '{}';
alter table public.scans add column imported boolean not null default false;
alter table public.events add column payload jsonb not null default '{}';
alter table public.events add column fingerprint text;
create unique index events_user_fingerprint_idx on public.events(user_id, fingerprint);
create unique index events_id_user_idx on public.scans(id,user_id);
alter table public.events add constraint events_scan_owner foreign key(scan_id,user_id) references public.scans(id,user_id);
create unique index reward_milestone_once on public.reward_ledger(user_id, reason) where reference_type = 'milestone';
create index events_scan_idx on public.events(scan_id);
create index referrals_referrer_idx on public.referrals(referrer_id);
alter table public.referrals add constraint referral_not_self check(referrer_id is distinct from referred_user_id);
drop policy referrals_create_own on public.referrals;
grant select, insert, update, delete on public.scans, public.events, public.calendar_connections to authenticated;
grant select on public.referrals to authenticated;
grant select on public.feature_flags to anon, authenticated;
grant insert, update, delete on public.feature_flags to authenticated;

create table public.plan_rules (
  id public.plan_code primary key,
  monthly_scans integer not null check(monthly_scans between 0 and 100000),
  pdf_pages integer not null check(pdf_pages between 1 and 100),
  credits_per_bonus_scan integer not null default 0 check(credits_per_bonus_scan >= 0),
  active boolean not null default false
);
insert into public.plan_rules values ('free',10,3,0,true),('plus',100,20,0,false),('business',350,50,0,false);
alter table public.plan_rules enable row level security;
create policy plan_read on public.plan_rules for select to authenticated using(true);
create policy plan_admin on public.plan_rules for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant select, update on public.plan_rules to authenticated;
update public.feature_flags set enabled=false where key in ('referrals','business_plan');
insert into public.feature_flags values ('cloud_persistence','Enable cloud data',true,true,now()),('push_notifications','Push delivery configured',false,true,now());

create table public.reminders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
 event_id uuid references public.events on delete cascade, kind text not null check(kind in ('event','deadline','unexported','weekly')),
 scheduled_at timestamptz not null, status text not null default 'pending' check(status in ('pending','sent','cancelled','failed')),
 delivered_at timestamptz, created_at timestamptz not null default now()
);
create index reminders_due on public.reminders(status,scheduled_at);
create index reminders_owner on public.reminders(user_id);
alter table public.reminders enable row level security;
create policy reminders_own on public.reminders for select to authenticated using(user_id=(select auth.uid()) or public.is_admin());
grant select on public.reminders to authenticated;
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
 endpoint text not null unique, keys jsonb not null, created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy push_own on public.push_subscriptions for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select,insert,delete on public.push_subscriptions to authenticated;
create index push_owner on public.push_subscriptions(user_id);
create table public.admin_content (key text primary key, body text not null, updated_at timestamptz not null default now());
alter table public.admin_content enable row level security;
create policy content_admin on public.admin_content for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant select,insert,update,delete on public.admin_content to authenticated;
create table public.scan_requests (
 id uuid primary key, user_id uuid not null references auth.users on delete cascade,
 created_at timestamptz not null default now(), status text not null default 'reserved', content_hash text not null
);
alter table public.scan_requests enable row level security;
create index scan_requests_owner_time on public.scan_requests(user_id,created_at);
create policy requests_admin on public.scan_requests for select to authenticated using(public.is_admin());
grant select on public.scan_requests to authenticated;

-- Server-only atomic allowance reservation. No browser can invoke this routine.
create function public.reserve_scan(p_user uuid,p_request uuid,p_hash text) returns integer
language plpgsql security invoker set search_path='' as $$
declare allowance integer; used integer; pages integer; period date := date_trunc('month',now() at time zone 'UTC')::date;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if not exists(select 1 from public.feature_flags where key='ai_scanning' and enabled) then raise exception 'scanning_disabled'; end if;
 if exists(select 1 from public.scan_requests where id=p_request or (user_id=p_user and (created_at>now()-interval '10 seconds' or (content_hash=p_hash and created_at>now()-interval '60 seconds')))) then raise exception 'repeat_request'; end if;
 select r.monthly_scans,r.pdf_pages into allowance,pages from public.profiles p join public.plan_rules r on p.plan=r.id where p.id=p_user;
 if allowance is null then raise exception 'account_unavailable'; end if;
 insert into public.usage_monthly(user_id,period_start) values(p_user,period) on conflict do nothing;
 select ai_scans into used from public.usage_monthly where user_id=p_user and period_start=period for update;
 if used >= allowance+(select bonus_scans from public.usage_monthly where user_id=p_user and period_start=period) then raise exception 'allowance_exhausted'; end if;
 insert into public.scan_requests(id,user_id,content_hash) values(p_request,p_user,p_hash);
 update public.usage_monthly set ai_scans=ai_scans+1 where user_id=p_user and period_start=period;
 return pages;
end; $$;
revoke all on function public.reserve_scan(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_scan(uuid,uuid,text) to service_role;

create function public.award_milestone(p_user uuid,p_reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare amount integer;
begin
 if not exists(select 1 from public.feature_flags where key='rewards' and enabled) then return; end if;
 amount := case p_reason when 'first_scan' then 3 when 'first_calendar' then 5 else null end;
 if amount is null then raise exception 'invalid_milestone'; end if;
 insert into public.reward_ledger(user_id,entry_type,amount,reason,reference_type) values(p_user,'earn',amount,p_reason,'milestone') on conflict do nothing;
end; $$;
revoke all on function public.award_milestone(uuid,text) from public,anon,authenticated;
grant execute on function public.award_milestone(uuid,text) to service_role;

-- Clients cannot claim qualification or choose another user's identity.
create function public.create_referral() returns text language plpgsql security definer set search_path='' as $$
declare code text;
begin
 if auth.uid() is null or not exists(select 1 from public.feature_flags where key='referrals' and enabled) then raise exception 'referrals_disabled'; end if;
 select referral_code into code from public.referrals where referrer_id=auth.uid() order by created_at limit 1;
 if code is null then
 code := replace(gen_random_uuid()::text,'-','');
 insert into public.referrals(referrer_id,referral_code) values(auth.uid(),code);
 end if;
 return code;
end; $$;
revoke all on function public.create_referral() from public,anon;
grant execute on function public.create_referral() to authenticated;
-- Original uploads are disabled. No source images are migrated or stored.
drop policy scan_sources_insert_own on storage.objects;
update storage.buckets set file_size_limit=3000000,allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'] where id='scan-sources';

-- Explicit privileges also support projects with automatic API grants disabled.
grant all on public.profiles, public.scans, public.events, public.usage_monthly,
 public.reward_ledger, public.referrals, public.calendar_connections, public.subscriptions,
 public.feature_flags, public.plan_rules, public.reminders, public.push_subscriptions,
 public.admin_content, public.scan_requests to service_role;
alter table public.scans add constraint scans_payload_size check(octet_length(payload::text)<=512000);
alter table public.events add constraint events_payload_size check(octet_length(payload::text)<=50000);
alter table public.profiles add constraint preferences_size check(octet_length(preferences::text)<=10000);
create unique index referrals_one_invite on public.referrals(referrer_id);

create table public.reward_rules(key text primary key, amount integer not null check(amount between 0 and 1000),enabled boolean not null default true);
insert into public.reward_rules values ('first_scan',3,true),('first_calendar',5,true),('referral_bonus_scans',10,false);
alter table public.reward_rules enable row level security;
create policy reward_rules_read on public.reward_rules for select to authenticated using(true);
create policy reward_rules_admin on public.reward_rules for update to authenticated using(public.is_admin()) with check(public.is_admin());
grant select,update on public.reward_rules to authenticated;
grant all on public.reward_rules to service_role;
create or replace function public.award_milestone(p_user uuid,p_reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare amount integer;
begin
 if p_reason not in ('first_scan','first_calendar') then raise exception 'invalid_milestone'; end if;
 if not exists(select 1 from public.feature_flags where key='rewards' and enabled) then return; end if;
 select r.amount into amount from public.reward_rules r where key=p_reason and enabled;
 if amount is null then return; end if;
 insert into public.reward_ledger(user_id,entry_type,amount,reason,reference_type) values(p_user,'earn',amount,p_reason,'milestone') on conflict do nothing;
end; $$;

-- Multiple invitees can redeem a single stable invite code. One redemption per recipient.
drop index public.referrals_one_invite;
alter table public.referrals drop constraint referrals_referral_code_key;
create table public.referral_invites(user_id uuid primary key references auth.users on delete cascade,code text not null unique);
alter table public.referral_invites enable row level security;
create policy invite_owner on public.referral_invites for select to authenticated using(user_id=auth.uid() or public.is_admin());
grant select on public.referral_invites to authenticated;
grant all on public.referral_invites to service_role;
create or replace function public.create_referral() returns text language plpgsql security definer set search_path='' as $$
declare code text;
begin
 if auth.uid() is null or not exists(select 1 from public.feature_flags where key='referrals' and enabled) then raise exception 'referrals_disabled'; end if;
 insert into public.referral_invites(user_id,code) values(auth.uid(),replace(gen_random_uuid()::text,'-','')) on conflict(user_id) do nothing;
 select i.code into code from public.referral_invites i where user_id=auth.uid();return code;
end; $$;
create function public.claim_referral(p_code text) returns void language plpgsql security definer set search_path='' as $$
declare sender uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.feature_flags where key='referrals' and enabled) then raise exception 'referrals_disabled'; end if;
 select user_id into sender from public.referral_invites where code=p_code;
 if sender is null or sender=auth.uid() then raise exception 'invalid_referral'; end if;
 if exists(select 1 from public.scan_requests where user_id=auth.uid()) then raise exception 'existing_account_activity'; end if;
 insert into public.referrals(referrer_id,referred_user_id,referral_code,status) values(sender,auth.uid(),p_code,'signed_up') on conflict(referred_user_id) do nothing;
end; $$;
revoke all on function public.claim_referral(text) from public,anon;
grant execute on function public.claim_referral(text) to authenticated;
create function public.qualify_referral(p_user uuid) returns void language plpgsql security invoker set search_path='' as $$
declare ref public.referrals; bonus integer; period date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
 if not exists(select 1 from public.feature_flags where key='referrals' and enabled) then return;end if;
 if not exists(select 1 from public.scan_requests where user_id=p_user and status='completed') then return;end if;
 select amount into bonus from public.reward_rules where key='referral_bonus_scans' and enabled;
 if bonus is null then return;end if;
 select * into ref from public.referrals where referred_user_id=p_user and status='signed_up' for update;
 if not found then return;end if;
 insert into public.usage_monthly(user_id,period_start,bonus_scans) values(ref.referrer_id,period,bonus),(p_user,period,bonus)
 on conflict(user_id,period_start) do update set bonus_scans=public.usage_monthly.bonus_scans+excluded.bonus_scans;
 update public.referrals set status='rewarded',qualified_at=now() where id=ref.id;
end; $$;
revoke all on function public.qualify_referral(uuid) from public,anon,authenticated;
grant execute on function public.qualify_referral(uuid) to service_role;

alter table public.scan_requests add column input_tokens integer;
alter table public.scan_requests add column output_tokens integer;
alter table public.scan_requests add column estimated_cost_usd numeric(12,6);
create function public.finish_scan(p_request uuid,p_status text,p_pages integer,p_input integer,p_output integer,p_cost numeric) returns void
language plpgsql security invoker set search_path='' as $$
declare request public.scan_requests;
begin
 if p_status not in ('completed','failed') or p_pages<0 or p_input<0 or p_output<0 or p_cost<0 then raise exception 'invalid_result';end if;
 update public.scan_requests set status=p_status,input_tokens=p_input,output_tokens=p_output,estimated_cost_usd=p_cost where id=p_request and status='reserved' returning * into request;
 if not found then return;end if;
 update public.usage_monthly set pdf_pages=pdf_pages+p_pages,estimated_cost_usd=estimated_cost_usd+coalesce(p_cost,0) where user_id=request.user_id and period_start=date_trunc('month',request.created_at at time zone 'UTC')::date;
end; $$;
revoke all on function public.finish_scan(uuid,text,integer,integer,integer,numeric) from public,anon,authenticated;
grant execute on function public.finish_scan(uuid,text,integer,integer,integer,numeric) to service_role;
