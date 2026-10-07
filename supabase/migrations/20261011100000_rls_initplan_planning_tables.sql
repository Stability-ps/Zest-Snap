-- Same ownership rules, evaluated once per query instead of once per row (Supabase advisor auth_rls_initplan).
alter policy meal_plans_owner on public.meal_plans using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy meal_entries_owner on public.meal_entries using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy timetable_schedules_owner on public.timetable_schedules using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy timetable_classes_owner on public.timetable_classes using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy followup_suggestions_owner on public.followup_suggestions using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Owner lookups and account-deletion cascades on the planning tables.
create index if not exists meal_entries_user_idx on public.meal_entries (user_id);
create index if not exists timetable_classes_user_idx on public.timetable_classes (user_id);
create index if not exists followup_suggestions_planner_item_idx on public.followup_suggestions (planner_item_id);
create index if not exists followup_suggestions_event_idx on public.followup_suggestions (event_id);
