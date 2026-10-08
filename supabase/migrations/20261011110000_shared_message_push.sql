-- Queue push notifications for new Shared-plan messages.
create table if not exists public.shared_message_push_queue (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.shared_plan_messages(id) on delete cascade,
  plan_id uuid not null references public.shared_plans(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error text,
  unique(message_id,recipient_id)
);
create index if not exists shared_message_push_due_idx on public.shared_message_push_queue(delivered_at,claimed_at,created_at) where delivered_at is null;
create index if not exists shared_message_push_recipient_idx on public.shared_message_push_queue(recipient_id,created_at desc);
alter table public.shared_message_push_queue enable row level security;
revoke all on public.shared_message_push_queue from anon,authenticated;
grant all on public.shared_message_push_queue to service_role;

create or replace function private.enqueue_shared_message_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.shared_message_push_queue(message_id,plan_id,recipient_id)
 select new.id,new.plan_id,m.user_id
 from public.shared_plan_members m
 where m.plan_id=new.plan_id and m.status='active' and m.user_id<>new.sender_id
 on conflict(message_id,recipient_id) do nothing;
 return new;
end $$;
revoke all on function private.enqueue_shared_message_push() from public,anon,authenticated;

drop trigger if exists shared_message_push_enqueue on public.shared_plan_messages;
create trigger shared_message_push_enqueue after insert on public.shared_plan_messages
for each row execute function private.enqueue_shared_message_push();

create or replace function public.claim_shared_message_push(p_limit integer default 100)
returns table(id uuid,message_id uuid,plan_id uuid,recipient_id uuid,attempts integer)
language sql security invoker set search_path='' as $$
 with picked as (
   select q.id from public.shared_message_push_queue q
   where q.delivered_at is null and q.attempts<20
     and (q.claimed_at is null or q.claimed_at<now()-interval '10 minutes')
   order by q.created_at for update skip locked
   limit least(greatest(p_limit,1),500)
 ), claimed as (
   update public.shared_message_push_queue q
   set claimed_at=now(),attempts=q.attempts+1
   from picked p where q.id=p.id
   returning q.id,q.message_id,q.plan_id,q.recipient_id,q.attempts
 )
 select * from claimed
$$;
revoke all on function public.claim_shared_message_push(integer) from public,anon,authenticated;
grant execute on function public.claim_shared_message_push(integer) to service_role;

create or replace function public.complete_shared_message_push(p_id uuid,p_ok boolean,p_error text default null)
returns void language sql security invoker set search_path='' as $$
 update public.shared_message_push_queue
 set delivered_at=case when p_ok then now() else delivered_at end,
     claimed_at=null,
     last_error=case when p_ok then null else left(coalesce(p_error,'push_failed'),500) end
 where id=p_id
$$;
revoke all on function public.complete_shared_message_push(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.complete_shared_message_push(uuid,boolean,text) to service_role;