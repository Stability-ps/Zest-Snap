-- Existing rows are clean after production QA cleanup; make the date guarantees fully validated.
alter table public.planner_items validate constraint planner_items_start_date_range;
alter table public.planner_items validate constraint planner_items_end_date_range;
alter table public.planner_items validate constraint planner_items_due_date_range;
alter table public.shared_plan_items validate constraint shared_plan_items_start_date_range;
alter table public.shared_plan_items validate constraint shared_plan_items_end_date_range;
alter table public.shared_plan_items validate constraint shared_plan_items_due_date_range;
