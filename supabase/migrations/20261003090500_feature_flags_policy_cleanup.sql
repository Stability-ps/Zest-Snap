-- Keep feature flag reads to one permissive SELECT policy per role.
-- Authenticated admins can still read private flags; anonymous users see public flags only.
drop policy if exists feature_flags_admin_read on public.feature_flags;
drop policy if exists feature_flags_public_read on public.feature_flags;
drop policy if exists feature_flags_authenticated_read on public.feature_flags;

create policy feature_flags_public_read
on public.feature_flags
for select
to anon
using (public_visible = true);

create policy feature_flags_authenticated_read
on public.feature_flags
for select
to authenticated
using (public_visible = true or private.is_admin());
