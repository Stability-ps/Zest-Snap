-- Recorded from production (version 20261003035914) on 2026-10-04.
create table public.planner_items (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 source_scan_id uuid references public.scans(id) on delete set null,
 type text not null check(type in('event','task','deadline','reminder')), title text not null check(char_length(title) between 1 and 500),
 description text not null default '' check(char_length(description)<=10000), start_date date,end_date date,start_time time,end_time time,due_date date,due_time time,
 all_day boolean not null default false, timezone text not null default 'UTC', location text not null default '' check(char_length(location)<=2000),
 status text not null default 'open' check(status in('open','completed','cancelled')), source text not null default 'manual' check(source in('manual','scan','import')),
 completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((type in('task','deadline') and coalesce(due_date,start_date) is not null) or (type in('event','reminder') and start_date is not null)),
 check(end_date is null or start_date is null or end_date>=start_date)
);
create index planner_items_user_date_idx on public.planner_items(user_id,coalesce(due_date,start_date),status);
create index planner_items_user_updated_idx on public.planner_items(user_id,updated_at desc);
create index planner_items_scan_idx on public.planner_items(source_scan_id);
alter table public.planner_items enable row level security;
create policy planner_items_select_own on public.planner_items for select to authenticated using((select auth.uid())=user_id or private.is_admin());
create policy planner_items_insert_own on public.planner_items for insert to authenticated with check((select auth.uid())=user_id or private.is_admin());
create policy planner_items_update_own on public.planner_items for update to authenticated using((select auth.uid())=user_id or private.is_admin()) with check((select auth.uid())=user_id or private.is_admin());
create policy planner_items_delete_own on public.planner_items for delete to authenticated using((select auth.uid())=user_id or private.is_admin());
grant select,insert,update,delete on public.planner_items to authenticated; grant all on public.planner_items to service_role;

create function private.planner_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source_scan_id is not null and not exists(select 1 from public.scans where id=new.source_scan_id and user_id=new.user_id) then raise exception 'source_scan_not_owned'; end if;
 new.updated_at:=now();
 if tg_op='UPDATE' then
  if old.status is distinct from 'completed' and new.status='completed' then new.completed_at:=now(); end if;
  if old.status='completed' and new.status='open' then new.completed_at:=null; end if;
 end if;
 return new;
end $$;
revoke all on function private.planner_guard() from public,anon,authenticated;
create trigger planner_guard before insert or update on public.planner_items for each row execute function private.planner_guard();

alter table public.reminders add column planner_item_id uuid references public.planner_items(id) on delete cascade;
alter table public.reminders add column offset_minutes integer check(offset_minutes is null or offset_minutes between 0 and 525600);
alter table public.reminders add column label text, add column snoozed_until timestamptz, add column handled_at timestamptz,
 add column retry_count integer not null default 0 check(retry_count between 0 and 20), add column last_error text, add column claimed_at timestamptz;
alter table public.reminders drop constraint reminders_status_check;
alter table public.reminders add constraint reminders_status_check check(status in('pending','processing','sent','cancelled','failed','handled'));
create index reminders_planner_idx on public.reminders(planner_item_id,scheduled_at);
create unique index reminders_active_unique on public.reminders(user_id,planner_item_id,scheduled_at) where status in('pending','processing');
revoke insert,update,delete on public.reminders from authenticated; grant select on public.reminders to authenticated; grant all on public.reminders to service_role;

insert into public.reward_rules(key,amount,enabled) values
('first_planner_item',5,true),('first_reminder',2,true),('first_completed_task',3,true),('organised_5_scans',5,true),('organised_10_scans',10,true),('referral_qualified',10,true)
on conflict(key) do update set amount=excluded.amount,enabled=excluded.enabled;

create or replace function public.award_milestone(p_user uuid,p_reason text) returns void language plpgsql security invoker set search_path='' as $$
declare a integer; begin
 if not exists(select 1 from public.feature_flags where key='rewards' and enabled) then return; end if;
 select amount into a from public.reward_rules where key=p_reason and enabled;
 if a is null then raise exception 'invalid_milestone'; end if;
 insert into public.reward_ledger(user_id,entry_type,amount,reason,reference_type) values(p_user,'earn',a,p_reason,'milestone') on conflict do nothing;
end $$;
revoke all on function public.award_milestone(uuid,text) from public,anon,authenticated; grant execute on function public.award_milestone(uuid,text) to service_role;

create function private.planner_rewards() returns trigger language plpgsql security definer set search_path='' as $$
declare n integer; begin
 if tg_op='INSERT' then
  perform public.award_milestone(new.user_id,'first_planner_item');
  if new.source='scan' then
   select count(distinct p.source_scan_id) into n from public.planner_items p join public.scan_requests s on s.id=p.source_scan_id and s.user_id=p.user_id and s.status='completed'
   where p.user_id=new.user_id and p.source='scan' and p.source_scan_id is not null;
   if n>=5 then perform public.award_milestone(new.user_id,'organised_5_scans'); end if;
   if n>=10 then perform public.award_milestone(new.user_id,'organised_10_scans'); end if;
  end if;
 elsif old.status is distinct from 'completed' and new.status='completed' and new.type in('task','deadline') then
  perform public.award_milestone(new.user_id,'first_completed_task');
 end if; return new;
end $$;
revoke all on function private.planner_rewards() from public,anon,authenticated;
create trigger planner_reward_insert after insert on public.planner_items for each row execute function private.planner_rewards();
create trigger planner_reward_complete after update of status on public.planner_items for each row execute function private.planner_rewards();

create function public.claim_due_reminders(p_limit integer default 100) returns table(id uuid,user_id uuid,scheduled_at timestamptz,retry_count integer)
language sql security invoker set search_path='' as $$
 with picked as(select r.id from public.reminders r where (r.status='pending' and r.scheduled_at<=now()) or (r.status='processing' and r.claimed_at<now()-interval '10 minutes')
 order by r.scheduled_at for update skip locked limit least(greatest(p_limit,1),500)),
 claimed as(update public.reminders r set status='processing',claimed_at=now() from picked p where r.id=p.id returning r.id,r.user_id,r.scheduled_at,r.retry_count)
 select * from claimed $$;
revoke all on function public.claim_due_reminders(integer) from public,anon,authenticated; grant execute on function public.claim_due_reminders(integer) to service_role;

create function private.create_planner_reminder(p_item uuid,p_at timestamptz,p_offset integer,p_label text) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); x uuid; begin
 if u is null then raise exception 'authentication_required'; end if;
 if p_offset is not null and (p_offset<0 or p_offset>525600) then raise exception 'invalid_offset'; end if;
 if not exists(select 1 from public.planner_items where id=p_item and user_id=u and status<>'cancelled') then raise exception 'planner_item_not_found'; end if;
 if (select count(*) from public.reminders where user_id=u and planner_item_id=p_item and status in('pending','processing'))>=10 then raise exception 'reminder_limit_reached'; end if;
 insert into public.reminders(user_id,planner_item_id,kind,scheduled_at,status,offset_minutes,label) values(u,p_item,'event',p_at,'pending',p_offset,left(coalesce(p_label,''),200)) returning id into x;
 perform public.award_milestone(u,'first_reminder'); return x;
end $$;
revoke all on function private.create_planner_reminder(uuid,timestamptz,integer,text) from public,anon; grant execute on function private.create_planner_reminder(uuid,timestamptz,integer,text) to authenticated;
create function public.create_planner_reminder(p_item uuid,p_scheduled_at timestamptz,p_offset_minutes integer default null,p_label text default null) returns uuid language sql security invoker set search_path='' as $$select private.create_planner_reminder(p_item,p_scheduled_at,p_offset_minutes,p_label)$$;
revoke all on function public.create_planner_reminder(uuid,timestamptz,integer,text) from public,anon; grant execute on function public.create_planner_reminder(uuid,timestamptz,integer,text) to authenticated;

create function private.update_planner_reminder(p_id uuid,p_action text,p_minutes integer default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if p_action='cancel' then update public.reminders set status='cancelled',claimed_at=null where id=p_id and user_id=auth.uid() and status in('pending','failed');
 elsif p_action='handle' then update public.reminders set status='handled',handled_at=now(),claimed_at=null where id=p_id and user_id=auth.uid() and status in('pending','sent','failed');
 elsif p_action='snooze' then
  if p_minutes<1 or p_minutes>10080 then raise exception 'invalid_snooze'; end if;
  update public.reminders set scheduled_at=now()+make_interval(mins=>p_minutes),snoozed_until=now()+make_interval(mins=>p_minutes),status='pending',last_error=null,claimed_at=null where id=p_id and user_id=auth.uid() and status in('pending','sent','failed');
 end if;
end $$;
revoke all on function private.update_planner_reminder(uuid,text,integer) from public,anon; grant execute on function private.update_planner_reminder(uuid,text,integer) to authenticated;
create function public.cancel_planner_reminder(p_id uuid) returns void language sql security invoker set search_path='' as $$select private.update_planner_reminder(p_id,'cancel',null)$$;
create function public.mark_planner_reminder_handled(p_id uuid) returns void language sql security invoker set search_path='' as $$select private.update_planner_reminder(p_id,'handle',null)$$;
create function public.snooze_planner_reminder(p_id uuid,p_minutes integer) returns void language sql security invoker set search_path='' as $$select private.update_planner_reminder(p_id,'snooze',p_minutes)$$;
revoke all on function public.cancel_planner_reminder(uuid),public.mark_planner_reminder_handled(uuid),public.snooze_planner_reminder(uuid,integer) from public,anon;
grant execute on function public.cancel_planner_reminder(uuid),public.mark_planner_reminder_handled(uuid),public.snooze_planner_reminder(uuid,integer) to authenticated;

alter table public.push_subscriptions add column updated_at timestamptz not null default now(), add column last_success_at timestamptz, add column failure_count integer not null default 0 check(failure_count between 0 and 1000);
grant all on public.push_subscriptions to service_role;
create function private.register_push(p_endpoint text,p_keys jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); x uuid; begin
 if u is null or length(coalesce(p_endpoint,''))<20 or jsonb_typeof(p_keys)<>'object' then raise exception 'invalid_subscription'; end if;
 delete from public.push_subscriptions where endpoint=p_endpoint and user_id<>u;
 insert into public.push_subscriptions(user_id,endpoint,keys,updated_at) values(u,p_endpoint,p_keys,now())
 on conflict(endpoint) do update set user_id=u,keys=excluded.keys,updated_at=now(),failure_count=0 returning id into x; return x;
end $$;
revoke all on function private.register_push(text,jsonb) from public,anon; grant execute on function private.register_push(text,jsonb) to authenticated;
create function public.register_push_subscription(p_endpoint text,p_keys jsonb) returns uuid language sql security invoker set search_path='' as $$select private.register_push(p_endpoint,p_keys)$$;
revoke all on function public.register_push_subscription(text,jsonb) from public,anon; grant execute on function public.register_push_subscription(text,jsonb) to authenticated;

update public.plan_rules set credits_per_bonus_scan=10 where credits_per_bonus_scan=0;
create function private.redeem_bonus() returns integer language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c integer;b integer;p date:=date_trunc('month',now() at time zone 'UTC')::date; begin
 if u is null then raise exception 'authentication_required'; end if; perform pg_advisory_xact_lock(hashtextextended(u::text,1));
 select r.credits_per_bonus_scan into c from public.profiles x join public.plan_rules r on r.id=x.plan where x.id=u;
 select coalesce(sum(amount),0) into b from public.reward_ledger where user_id=u; if b<c then raise exception 'insufficient_credits'; end if;
 insert into public.reward_ledger(user_id,entry_type,amount,reason,reference_type,reference_id) values(u,'spend',-c,'bonus_scan_redemption','usage',gen_random_uuid()::text);
 insert into public.usage_monthly(user_id,period_start,bonus_scans) values(u,p,1) on conflict(user_id,period_start) do update set bonus_scans=public.usage_monthly.bonus_scans+1; return 1;
end $$;
revoke all on function private.redeem_bonus() from public,anon; grant execute on function private.redeem_bonus() to authenticated;
create function public.redeem_credits_for_bonus_scan() returns integer language sql security invoker set search_path='' as $$select private.redeem_bonus()$$;
revoke all on function public.redeem_credits_for_bonus_scan() from public,anon; grant execute on function public.redeem_credits_for_bonus_scan() to authenticated;

update public.reward_rules set enabled=false where key='referral_bonus_scans';
update public.feature_flags set enabled=true where key='referrals';
create or replace function public.qualify_referral(p_user uuid) returns void language plpgsql security invoker set search_path='' as $$
declare r public.referrals%rowtype;a integer; begin
 if not exists(select 1 from public.feature_flags where key='referrals' and enabled) or not exists(select 1 from public.scan_requests where user_id=p_user and status='completed') then return; end if;
 select * into r from public.referrals where referred_user_id=p_user and status='signed_up' for update; if not found then return; end if;
 select amount into a from public.reward_rules where key='referral_qualified' and enabled; if coalesce(a,0)<=0 then return; end if;
 update public.referrals set status='rewarded',qualified_at=now() where id=r.id;
 insert into public.reward_ledger(user_id,entry_type,amount,reason,reference_type,reference_id) values(r.referrer_id,'earn',a,'referral_qualified','referral',r.id::text);
end $$;
revoke all on function public.qualify_referral(uuid) from public,anon,authenticated; grant execute on function public.qualify_referral(uuid) to service_role;
