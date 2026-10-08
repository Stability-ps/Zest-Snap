-- Supabase's default privileges give anon and authenticated full table privileges on every new public table.
-- These migrations then grant what the app needs, but never revoked the defaults on the tables below, so
-- production held write privileges that RLS (no matching policy) was the only thing blocking. Remove them so
-- privileges match what the migrations intend. No behaviour change: every revoked privilege was unusable
-- through the API. Found with scripts/schema-fingerprint.sql on 2026-10-08 (supabase/MIGRATION_HISTORY.md).

-- Signed-out visitors never read or write these tables directly.
revoke all on public.daily_briefing_settings, public.followup_suggestions, public.meal_entries, public.meal_plans,
  public.timetable_classes, public.timetable_schedules, public.shared_plans, public.shared_plan_members,
  public.shared_plan_items, public.shared_plan_invites, public.shared_plan_messages, public.shared_plan_message_reactions,
  public.shared_plan_reads
  from anon;

-- Signed-in people only ever need DML on their planning tables.
revoke truncate, references, trigger on public.daily_briefing_settings, public.followup_suggestions, public.meal_entries,
  public.meal_plans, public.timetable_classes, public.timetable_schedules
  from authenticated;

-- Membership and invitations change only through the Shared RPCs; plans are deleted only by delete_shared_plan.
revoke insert, update, delete on public.shared_plan_members, public.shared_plan_invites from authenticated;
revoke delete on public.shared_plans from authenticated;

-- People read back their own feedback (data export); production already allows this.
grant select on public.product_feedback to authenticated;
