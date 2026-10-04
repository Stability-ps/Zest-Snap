-- Recorded from production (version 20261003202050) on 2026-10-04.
update public.reward_rules set amount=1 where key in ('first_scan','first_calendar','first_planner_item','first_completed_task','first_reminder');
update public.reward_rules set amount=2 where key='organised_5_scans';
update public.reward_rules set amount=3 where key='organised_10_scans';
update public.reward_rules set amount=5 where key='referral_qualified';
insert into public.reward_rules(key,amount,enabled) values ('product_feedback',2,true)
on conflict (key) do update set amount=excluded.amount,enabled=true;

create table if not exists public.product_feedback (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references auth.users(id) on delete cascade,
 rating smallint check (rating between 1 and 5),
 feedback text,
 created_at timestamptz not null default now()
);
alter table public.product_feedback enable row level security;
drop policy if exists "feedback own insert" on public.product_feedback;
create policy "feedback own insert" on public.product_feedback for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "feedback own select" on public.product_feedback;
create policy "feedback own select" on public.product_feedback for select to authenticated using ((select auth.uid())=user_id);
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
 select amount into a from public.reward_rules where key='product_feedback' and enabled;
 if coalesce(a,0)>0 then
   insert into public.reward_ledger(user_id,entry_type,amount,reason,reference_type,reference_id)
   values(u,'earn',a,'product_feedback','feedback',u::text);
 end if;
 return coalesce(a,0);
end $$;
revoke all on function public.submit_product_feedback(integer,text) from public,anon;
grant execute on function public.submit_product_feedback(integer,text) to authenticated;
