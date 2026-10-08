-- Owner-controlled Shared member management: remove members and change their role.
-- Authenticated users keep SELECT-only access to shared_plan_members; these owner-only functions are the
-- only way to change another member. Ownership is shared_plans.owner_id, never a member role.

alter table public.shared_plan_members add column if not exists removed_at timestamptz;
alter table public.shared_plan_members add column if not exists removed_by uuid references auth.users(id) on delete set null;
alter table public.shared_plan_members drop constraint if exists shared_plan_members_status_check;
alter table public.shared_plan_members add constraint shared_plan_members_status_check
  check (status in ('active','left','removed'));
create index if not exists shared_plan_members_removed_by_idx on public.shared_plan_members(removed_by) where removed_by is not null;

create or replace function public.remove_shared_member(p_plan uuid, p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=(select auth.uid());
begin
  if u is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.shared_plans where id=p_plan and owner_id=u) then raise exception 'owner_only'; end if;
  if p_user=u then raise exception 'owner_cannot_leave'; end if;
  update public.shared_plan_members set status='removed',removed_at=now(),removed_by=u
  where plan_id=p_plan and user_id=p_user and status='active';
  if not found then raise exception 'member_not_found'; end if;
  -- Their tasks go back to the group and they stop receiving this plan's message notifications.
  update public.shared_plan_items set assigned_to=null where plan_id=p_plan and assigned_to=p_user;
  delete from public.shared_message_push_queue where plan_id=p_plan and recipient_id=p_user and delivered_at is null;
end $$;
revoke all on function public.remove_shared_member(uuid,uuid) from public,anon;
grant execute on function public.remove_shared_member(uuid,uuid) to authenticated;

create or replace function public.set_shared_member_role(p_plan uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=(select auth.uid());
begin
  if u is null then raise exception 'authentication_required'; end if;
  if p_role not in ('editor','viewer') then raise exception 'invalid_role'; end if;
  if not exists(select 1 from public.shared_plans where id=p_plan and owner_id=u) then raise exception 'owner_only'; end if;
  if p_user=u then raise exception 'owner_role_fixed'; end if;
  update public.shared_plan_members set role=p_role
  where plan_id=p_plan and user_id=p_user and status='active' and role<>'owner';
  if not found then raise exception 'member_not_found'; end if;
end $$;
revoke all on function public.set_shared_member_role(uuid,uuid,text) from public,anon;
grant execute on function public.set_shared_member_role(uuid,uuid,text) to authenticated;

-- A removed member cannot rejoin through an invitation that existed before their removal;
-- the owner has to send a new one. Otherwise unchanged from 20261009090000_shared_security_hardening.
create or replace function public.accept_shared_invite(p_token uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); inv public.shared_plan_invites%rowtype;
begin
  if u is null then raise exception 'authentication_required'; end if;
  select * into inv from public.shared_plan_invites where token=p_token and status='pending' and expires_at>now() for update;
  if not found then raise exception 'invite_unavailable'; end if;
  if inv.invited_email is not null and lower(inv.invited_email)<>lower(coalesce(auth.jwt()->>'email','')) then raise exception 'invite_for_another_account'; end if;
  if exists(select 1 from public.shared_plan_members where plan_id=inv.plan_id and user_id=u and status='removed' and removed_at>=inv.created_at) then
    raise exception 'removed_from_plan';
  end if;
  insert into public.shared_plan_members(plan_id,user_id,role,status)
  values(inv.plan_id,u,inv.role,'active')
  on conflict(plan_id,user_id) do update set
    role = case
      when public.shared_plan_members.status <> 'active' then excluded.role
      when public.shared_plan_members.role = 'owner' or excluded.role = 'viewer' then public.shared_plan_members.role
      else excluded.role end,
    joined_at = case when public.shared_plan_members.status <> 'active' then now() else public.shared_plan_members.joined_at end,
    status = 'active',
    removed_at = null,
    removed_by = null;
  -- Email invites are single-use; link invites keep working for the rest of the group.
  update public.shared_plan_invites
  set status = case when invited_email is null then 'pending' else 'accepted' end, accepted_by=u, accepted_at=now()
  where id=inv.id;
  return inv.plan_id;
end $$;
revoke all on function public.accept_shared_invite(uuid) from public,anon;
grant execute on function public.accept_shared_invite(uuid) to authenticated;
