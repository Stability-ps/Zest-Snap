create table if not exists public.calendar_connections (
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

alter table public.calendar_connections enable row level security;

-- Tokens are deliberately server-only. No authenticated/browser RLS policy is created.
revoke all on table public.calendar_connections from anon, authenticated;
grant all on table public.calendar_connections to service_role;

create index if not exists calendar_connections_user_id_idx
  on public.calendar_connections (user_id);
