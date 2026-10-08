-- Qualify the row being inserted in Shared message and reaction policies.
-- Unqualified columns inside the EXISTS subqueries bound to the subquery's own
-- table, so every reply was rejected and reactions/item links were not tied to
-- the message's plan. Also pin attachment paths to the sender's folder in the
-- plan and clear the attachment when a message is deleted.

drop policy if exists shared_messages_insert on public.shared_plan_messages;
create policy shared_messages_insert on public.shared_plan_messages for insert to authenticated
with check (
  sender_id=(select auth.uid())
  and private.is_shared_plan_member(shared_plan_messages.plan_id,null)
  and (shared_plan_messages.reply_to is null or exists (
    select 1 from public.shared_plan_messages parent
    where parent.id=shared_plan_messages.reply_to and parent.plan_id=shared_plan_messages.plan_id
  ))
  and (shared_plan_messages.item_id is null or exists (
    select 1 from public.shared_plan_items i
    where i.id=shared_plan_messages.item_id and i.plan_id=shared_plan_messages.plan_id
  ))
  and (shared_plan_messages.attachment is null or starts_with(
    shared_plan_messages.attachment->>'path',
    shared_plan_messages.plan_id::text||'/'||(select auth.uid())::text||'/'
  ))
);

drop policy if exists shared_reactions_insert on public.shared_plan_message_reactions;
create policy shared_reactions_insert on public.shared_plan_message_reactions for insert to authenticated
with check (
  user_id=(select auth.uid())
  and private.is_shared_plan_member(shared_plan_message_reactions.plan_id,null)
  and exists (
    select 1 from public.shared_plan_messages m
    where m.id=shared_plan_message_reactions.message_id
      and m.plan_id=shared_plan_message_reactions.plan_id
      and m.deleted_at is null
  )
);

create or replace function public.delete_shared_message(p_message uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=(select auth.uid()); msg public.shared_plan_messages%rowtype;
begin
  if u is null then raise exception 'authentication_required'; end if;
  select * into msg from public.shared_plan_messages where id=p_message for update;
  if not found or msg.sender_id<>u or msg.deleted_at is not null
     or not private.is_shared_plan_member(msg.plan_id,null) then raise exception 'not_allowed'; end if;
  update public.shared_plan_messages
  set body='Message deleted',deleted_at=now(),edited_at=null,attachment=null
  where id=p_message;
  delete from public.shared_plan_message_reactions where message_id=p_message;
end $$;
revoke all on function public.delete_shared_message(uuid) from public,anon;
grant execute on function public.delete_shared_message(uuid) to authenticated;
