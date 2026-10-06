-- Finish Shared with member management, leave/revoke actions and admin/product analytics.
create or replace function public.leave_shared_plan(p_plan uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if exists(select 1 from public.shared_plans where id=p_plan and owner_id=auth.uid()) then raise exception 'owner_cannot_leave'; end if;
  update public.shared_plan_members set status='left' where plan_id=p_plan and user_id=auth.uid();
end $$;
revoke all on function public.leave_shared_plan(uuid) from public,anon;
grant execute on function public.leave_shared_plan(uuid) to authenticated;

create or replace function public.revoke_shared_invite(p_invite uuid)
returns void language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select plan_id into pid from public.shared_plan_invites where id=p_invite;
  if pid is null or not private.is_shared_plan_member(pid,array['owner','editor']) then raise exception 'not_allowed'; end if;
  update public.shared_plan_invites set status='revoked' where id=p_invite and status='pending';
end $$;
revoke all on function public.revoke_shared_invite(uuid) from public,anon;
grant execute on function public.revoke_shared_invite(uuid) to authenticated;

create or replace function private.admin_shared_usage(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_admin('view');
  return jsonb_build_object(
    'plans_created',(select count(*) from public.shared_plans where created_at>=p_from and created_at<p_to),
    'active_plans',(select count(*) from public.shared_plans),
    'members_joined',(select count(*) from public.shared_plan_members where joined_at>=p_from and joined_at<p_to and role<>'owner'),
    'invites_created',(select count(*) from public.shared_plan_invites where created_at>=p_from and created_at<p_to),
    'invites_accepted',(select count(*) from public.shared_plan_invites where accepted_at>=p_from and accepted_at<p_to),
    'items_created',(select count(*) from public.shared_plan_items where created_at>=p_from and created_at<p_to),
    'by_kind',(select coalesce(jsonb_object_agg(kind,n),'{}'::jsonb) from (select kind,count(*) n from public.shared_plans where created_at>=p_from and created_at<p_to group by kind)t)
  );
end $$;
revoke all on function private.admin_shared_usage(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function private.admin_shared_usage(timestamptz,timestamptz) to service_role;

create or replace function public.admin_shared_usage(p_from timestamptz,p_to timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_shared_usage(p_from,p_to) $$;
revoke all on function public.admin_shared_usage(timestamptz,timestamptz) from public,anon;
grant execute on function public.admin_shared_usage(timestamptz,timestamptz) to authenticated;
