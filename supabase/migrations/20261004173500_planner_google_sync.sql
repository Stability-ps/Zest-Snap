-- Track the Google event created for each Zest Planner item so edits, reminders and deletes stay in sync.
alter table public.planner_items
  add column if not exists google_event_id text,
  add column if not exists google_synced_at timestamptz;

create index if not exists planner_items_google_event_idx
  on public.planner_items(user_id, google_event_id)
  where google_event_id is not null;
