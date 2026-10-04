-- Recorded from production (version 20261003032148) on 2026-10-04. Extra "drop policy if exists"
-- lines make it apply cleanly on top of the repository base migrations; the resulting state matches production.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_admin = true
  );
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated, service_role;

drop policy if exists content_admin on public.admin_content;
create policy content_admin on public.admin_content
for all to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists calendar_connections_own_all on public.calendar_connections;
create policy calendar_connections_own_all on public.calendar_connections
for all to authenticated
using ((select auth.uid()) = user_id or private.is_admin())
with check ((select auth.uid()) = user_id or private.is_admin());

drop policy if exists events_own_all on public.events;
create policy events_own_all on public.events
for all to authenticated
using ((select auth.uid()) = user_id or private.is_admin())
with check ((select auth.uid()) = user_id or private.is_admin());

drop policy if exists feature_flags_public_read on public.feature_flags;
drop policy if exists feature_flags_admin_write on public.feature_flags;
drop policy if exists feature_flags_admin_insert on public.feature_flags;
drop policy if exists feature_flags_admin_update on public.feature_flags;
drop policy if exists feature_flags_admin_delete on public.feature_flags;
create policy feature_flags_public_read on public.feature_flags
for select to anon, authenticated
using (public_visible = true);
create policy feature_flags_admin_read on public.feature_flags
for select to authenticated
using (private.is_admin());
create policy feature_flags_admin_insert on public.feature_flags
for insert to authenticated
with check (private.is_admin());
create policy feature_flags_admin_update on public.feature_flags
for update to authenticated
using (private.is_admin())
with check (private.is_admin());
create policy feature_flags_admin_delete on public.feature_flags
for delete to authenticated
using (private.is_admin());

drop policy if exists plan_admin on public.plan_rules;
drop policy if exists plan_admin_update on public.plan_rules;
create policy plan_admin_update on public.plan_rules
for update to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated
using ((select auth.uid()) = id or private.is_admin());
create policy profiles_update_own on public.profiles
for update to authenticated
using ((select auth.uid()) = id or private.is_admin())
with check ((select auth.uid()) = id or private.is_admin());

drop policy if exists invite_owner on public.referral_invites;
create policy invite_owner on public.referral_invites
for select to authenticated
using (user_id = (select auth.uid()) or private.is_admin());

drop policy if exists referrals_own_select on public.referrals;
create policy referrals_own_select on public.referrals
for select to authenticated
using (
  (select auth.uid()) = referrer_id
  or (select auth.uid()) = referred_user_id
  or private.is_admin()
);

drop policy if exists reminders_own on public.reminders;
create policy reminders_own on public.reminders
for select to authenticated
using (user_id = (select auth.uid()) or private.is_admin());

drop policy if exists rewards_select_own on public.reward_ledger;
create policy rewards_select_own on public.reward_ledger
for select to authenticated
using ((select auth.uid()) = user_id or private.is_admin());

drop policy if exists reward_rules_admin on public.reward_rules;
create policy reward_rules_admin on public.reward_rules
for update to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists requests_admin on public.scan_requests;
create policy requests_admin on public.scan_requests
for select to authenticated
using (private.is_admin());

drop policy if exists scans_own_all on public.scans;
create policy scans_own_all on public.scans
for all to authenticated
using ((select auth.uid()) = user_id or private.is_admin())
with check ((select auth.uid()) = user_id or private.is_admin());

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
for select to authenticated
using ((select auth.uid()) = user_id or private.is_admin());

drop policy if exists usage_select_own on public.usage_monthly;
create policy usage_select_own on public.usage_monthly
for select to authenticated
using ((select auth.uid()) = user_id or private.is_admin());

drop function if exists public.is_admin();
