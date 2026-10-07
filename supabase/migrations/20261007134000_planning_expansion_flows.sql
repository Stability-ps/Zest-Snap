-- Timetable, meals and contextual follow-up foundations.
create table if not exists public.timetable_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'My timetable' check (char_length(title) between 1 and 120),
  term_start date not null,
  term_end date not null,
  timezone text not null default 'UTC',
  reminder_minutes integer not null default 15 check (reminder_minutes between 0 and 10080),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (term_end >= term_start)
);
create table if not exists public.timetable_classes (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.timetable_schedules(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 160),
  weekdays smallint[] not null check (cardinality(weekdays) between 1 and 7),
  start_time time not null,
  end_time time not null,
  location text,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  title text not null default 'Weekly meals' check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, week_start)
);
create table if not exists public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.meal_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_date date not null,
  meal_type text not null default 'dinner' check (meal_type in ('breakfast','lunch','dinner','snack','other')),
  title text not null check (char_length(title) between 1 and 160),
  start_time time,
  prep_reminder_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.followup_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  planner_item_id uuid references public.planner_items(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  kind text not null check (kind in ('travel','prepare','deadline','shopping','custom')),
  title text not null check (char_length(title) between 1 and 200),
  scheduled_at timestamptz,
  status text not null default 'suggested' check (status in ('suggested','accepted','dismissed','completed')),
  created_at timestamptz not null default now()
);
alter table public.timetable_schedules enable row level security;
alter table public.timetable_classes enable row level security;
alter table public.meal_plans enable row level security;
alter table public.meal_entries enable row level security;
alter table public.followup_suggestions enable row level security;
create policy "timetable_schedules_owner" on public.timetable_schedules for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "timetable_classes_owner" on public.timetable_classes for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "meal_plans_owner" on public.meal_plans for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "meal_entries_owner" on public.meal_entries for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "followup_suggestions_owner" on public.followup_suggestions for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
grant select,insert,update,delete on public.timetable_schedules, public.timetable_classes, public.meal_plans, public.meal_entries, public.followup_suggestions to authenticated;
create index if not exists timetable_schedules_user_idx on public.timetable_schedules(user_id,term_start);
create index if not exists timetable_classes_schedule_idx on public.timetable_classes(schedule_id);
create index if not exists meal_plans_user_week_idx on public.meal_plans(user_id,week_start);
create index if not exists meal_entries_plan_date_idx on public.meal_entries(plan_id,meal_date);
create index if not exists followup_suggestions_user_status_idx on public.followup_suggestions(user_id,status,scheduled_at);