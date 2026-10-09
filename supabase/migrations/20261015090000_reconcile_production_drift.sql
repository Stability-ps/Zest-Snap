-- Brings a database built from these migrations in line with production. A no-op on production itself:
-- every statement is guarded, and production already has each object in this shape (verified 2026-10-08 with
-- scripts/schema-fingerprint.sql; see supabase/MIGRATION_HISTORY.md).

-- 1. Production's advisor_performance_fixes (20261003025538) added two indexes that no repository file creates.
create index if not exists events_scan_owner_idx on public.events(scan_id, user_id);
create index if not exists reminders_event_idx on public.reminders(event_id);

-- 2. calendar_connections. Production replaced the original metadata table with the OAuth-token table before
--    20261004143000_google_calendar_connections ran; that file says "create table if not exists", so a fresh
--    database kept the original table (no token columns, so Google Calendar could not connect) and its per-user
--    policy. Replace it only when it still has the original shape, which never holds in production.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'calendar_connections' and column_name = 'access_token') then
    drop table if exists public.calendar_connections cascade;
    create table public.calendar_connections (
      user_id uuid not null references auth.users(id) on delete cascade,
      provider text not null check (provider in ('google')),
      access_token text not null,
      refresh_token text,
      expires_at timestamptz,
      scope text,
      calendar_id text default 'primary',
      calendar_email text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (user_id, provider)
    );
    create index if not exists calendar_connections_user_id_idx on public.calendar_connections (user_id);
  end if;
end $$;
alter table public.calendar_connections enable row level security;
-- Tokens are server-only: no browser policy and no browser privileges.
drop policy if exists calendar_connections_own_all on public.calendar_connections;
revoke all on table public.calendar_connections from anon, authenticated;
grant all on table public.calendar_connections to service_role;
