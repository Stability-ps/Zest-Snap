-- Advanced Shared messaging for Zest Snap.
-- Additive: existing plans, members, items and invites are untouched.

create table if not exists public.shared_plan_messages (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.shared_plans(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  reply_to uuid references public.shared_plan_messages(id) on delete set null,
  item_id uuid references public.shared_plan_items(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.shared_plan_message_reactions (
  message_id uuid not null references public.shared_plan_messages(id) on delete cascade,
  plan_id uuid not null references public.shared_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id,user_id,emoji)
);

create table if not exists public.shared_plan_reads (
  plan_id uuid not null references public.shared_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id,user_id)
);

create index if not exists shared_messages_plan_created_idx
  on public.shared_plan_messages(plan_id,created_at desc);
create index if not exists shared_messages_sender_idx
  on public.shared_plan_messages(sender_id,created_at desc);
create index if not exists shared_messages_reply_idx on public.shared_plan_messages(reply_to) where reply_to is not null;
create index if not exists shared_messages_item_idx on public.shared_plan_messages(item_id) where item_id is not null;
create index if not exists shared_message_reactions_plan_idx
  on public.shared_plan_message_reactions(plan_id,message_id);
create index if not exists shared_message_reactions_user_idx on public.shared_plan_message_reactions(user_id);
create index if not exists shared_plan_reads_user_idx
  on public.shared_plan_reads(user_id,plan_id);

alter table public.shared_plan_messages enable row level security;
alter table public.shared_plan_message_reactions enable row level security;
alter table public.shared_plan_reads enable row level security;

drop policy if exists shared_messages_read on public.shared_plan_messages;
create policy shared_messages_read on public.shared_plan_messages for select to authenticated
using (private.is_shared_plan_member(plan_id,null));

drop policy if exists shared_messages_insert on public.shared_plan_messages;
create policy shared_messages_insert on public.shared_plan_messages for insert to authenticated
with check (
  sender_id=(select auth.uid())
  and private.is_shared_plan_member(plan_id,null)
  and (reply_to is null or exists (
    select 1 from public.shared_plan_messages parent
    where parent.id=reply_to and parent.plan_id=plan_id
  ))
  and (item_id is null or exists (
    select 1 from public.shared_plan_items i
    where i.id=item_id and i.plan_id=plan_id
  ))
);

drop policy if exists shared_reactions_read on public.shared_plan_message_reactions;
create policy shared_reactions_read on public.shared_plan_message_reactions for select to authenticated
using (private.is_shared_plan_member(plan_id,null));

drop policy if exists shared_reactions_insert on public.shared_plan_message_reactions;
create policy shared_reactions_insert on public.shared_plan_message_reactions for insert to authenticated
with check (
  user_id=(select auth.uid())
  and private.is_shared_plan_member(plan_id,null)
  and exists (
    select 1 from public.shared_plan_messages m
    where m.id=message_id and m.plan_id=plan_id and m.deleted_at is null
  )
);

drop policy if exists shared_reactions_delete on public.shared_plan_message_reactions;
create policy shared_reactions_delete on public.shared_plan_message_reactions for delete to authenticated
using (user_id=(select auth.uid()) and private.is_shared_plan_member(plan_id,null));

drop policy if exists shared_reads_read on public.shared_plan_reads;
create policy shared_reads_read on public.shared_plan_reads for select to authenticated
using (user_id=(select auth.uid()) and private.is_shared_plan_member(plan_id,null));

grant select,insert on public.shared_plan_messages to authenticated;
grant select,insert,delete on public.shared_plan_message_reactions to authenticated;
grant select on public.shared_plan_reads to authenticated;
grant all on public.shared_plan_messages,public.shared_plan_message_reactions,public.shared_plan_reads to service_role;
revoke update,delete,truncate,references,trigger on public.shared_plan_messages from authenticated,anon;
revoke update,truncate,references,trigger on public.shared_plan_message_reactions from authenticated,anon;
revoke insert,update,delete,truncate,references,trigger on public.shared_plan_reads from authenticated,anon;

create or replace function public.edit_shared_message(p_message uuid,p_body text)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=(select auth.uid()); msg public.shared_plan_messages%rowtype;
begin
  if u is null then raise exception 'authentication_required'; end if;
  if length(trim(coalesce(p_body,'')))<1 or length(p_body)>4000 then raise exception 'invalid_message'; end if;
  select * into msg from public.shared_plan_messages where id=p_message for update;
  if not found or msg.sender_id<>u or msg.deleted_at is not null
     or not private.is_shared_plan_member(msg.plan_id,null) then raise exception 'not_allowed'; end if;
  update public.shared_plan_messages set body=trim(p_body),edited_at=now() where id=p_message;
end $$;
revoke all on function public.edit_shared_message(uuid,text) from public,anon;
grant execute on function public.edit_shared_message(uuid,text) to authenticated;

create or replace function public.delete_shared_message(p_message uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=(select auth.uid()); msg public.shared_plan_messages%rowtype;
begin
  if u is null then raise exception 'authentication_required'; end if;
  select * into msg from public.shared_plan_messages where id=p_message for update;
  if not found or msg.sender_id<>u or msg.deleted_at is not null
     or not private.is_shared_plan_member(msg.plan_id,null) then raise exception 'not_allowed'; end if;
  update public.shared_plan_messages set body='Message deleted',deleted_at=now(),edited_at=null where id=p_message;
  delete from public.shared_plan_message_reactions where message_id=p_message;
end $$;
revoke all on function public.delete_shared_message(uuid) from public,anon;
grant execute on function public.delete_shared_message(uuid) to authenticated;

create or replace function public.mark_shared_plan_read(p_plan uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=(select auth.uid());
begin
  if u is null then raise exception 'authentication_required'; end if;
  if not private.is_shared_plan_member(p_plan,null) then raise exception 'not_allowed'; end if;
  insert into public.shared_plan_reads(plan_id,user_id,last_read_at,updated_at)
  values(p_plan,u,now(),now())
  on conflict(plan_id,user_id) do update set last_read_at=excluded.last_read_at,updated_at=excluded.updated_at;
end $$;
revoke all on function public.mark_shared_plan_read(uuid) from public,anon;
grant execute on function public.mark_shared_plan_read(uuid) to authenticated;

create or replace function public.shared_plan_unread_counts()
returns table(plan_id uuid,unread_count bigint,last_message_at timestamptz,last_message_preview text)
language sql stable security invoker set search_path='' as $$
  select p.id,
    count(m.id) filter (
      where m.sender_id<>(select auth.uid())
        and m.deleted_at is null
        and m.created_at>coalesce(r.last_read_at,'epoch'::timestamptz)
    )::bigint,
    max(m.created_at),
    (array_agg(
      case when m.deleted_at is null then left(m.body,120) else null end
      order by m.created_at desc
    ) filter (where m.id is not null))[1]
  from public.shared_plans p
  left join public.shared_plan_reads r
    on r.plan_id=p.id and r.user_id=(select auth.uid())
  left join public.shared_plan_messages m on m.plan_id=p.id
  where private.is_shared_plan_member(p.id,null)
  group by p.id,r.last_read_at
$$;
revoke all on function public.shared_plan_unread_counts() from public,anon;
grant execute on function public.shared_plan_unread_counts() to authenticated;

-- Realtime Broadcast + Presence authorization. Dynamic DDL keeps local PGlite
-- migration tests compatible because Supabase owns the realtime schema.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "zest shared realtime read" on realtime.messages';
    execute $p$
      create policy "zest shared realtime read" on realtime.messages
      for select to authenticated using (
        realtime.messages.extension in ('broadcast','presence')
        and exists (
          select 1 from public.shared_plan_members m
          where m.user_id=(select auth.uid()) and m.status='active'
            and ('shared-plan:'||m.plan_id::text)=(select realtime.topic())
        )
      )
    $p$;
    execute 'drop policy if exists "zest shared realtime write" on realtime.messages';
    execute $p$
      create policy "zest shared realtime write" on realtime.messages
      for insert to authenticated with check (
        realtime.messages.extension in ('broadcast','presence')
        and exists (
          select 1 from public.shared_plan_members m
          where m.user_id=(select auth.uid()) and m.status='active'
            and ('shared-plan:'||m.plan_id::text)=(select realtime.topic())
        )
      )
    $p$;
  end if;
end $$;
