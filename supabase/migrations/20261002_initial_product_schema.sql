-- Zest Snap initial product schema
-- Prepared for a dedicated Zest Snap Supabase project.
-- Apply only after the dedicated project is created.

create extension if not exists pgcrypto;

create type public.plan_code as enum ('free','plus','business');
create type public.scan_status as enum ('processing','review','completed','failed');
create type public.calendar_provider as enum ('ics','google','apple','outlook');
create type public.reward_entry_type as enum ('earn','spend','adjustment','expiry');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale text not null default 'en',
  timezone text not null default 'UTC',
  country_code text,
  plan public.plan_code not null default 'free',
  onboarding_complete boolean not null default false,
  is_admin boolean not null default false,
  reward_balance integer not null default 0 check (reward_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text,
  mime_type text,
  source_object_path text,
  document_type text,
  summary text,
  status public.scan_status not null default 'processing',
  warning_count integer not null default 0,
  model text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12,6),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid references public.scans(id) on delete set null,
  title text not null,
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  timezone text,
  location text,
  description text,
  all_day boolean not null default false,
  category text,
  confidence numeric(4,3) check (confidence between 0 and 1),
  confidence_reason text,
  source_text text,
  reviewed boolean not null default false,
  calendar_provider public.calendar_provider,
  calendar_external_id text,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.usage_monthly (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  ai_scans integer not null default 0 check (ai_scans >= 0),
  pdf_pages integer not null default 0 check (pdf_pages >= 0),
  bonus_scans integer not null default 0 check (bonus_scans >= 0),
  estimated_cost_usd numeric(12,6) not null default 0,
  primary key (user_id, period_start)
);

create table public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_type public.reward_entry_type not null,
  amount integer not null,
  reason text not null,
  reference_type text,
  reference_id text,
  created_at timestamptz not null default now()
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid unique references auth.users(id) on delete set null,
  referral_code text not null unique,
  status text not null default 'invited' check (status in ('invited','signed_up','qualified','rewarded')),
  created_at timestamptz not null default now(),
  qualified_at timestamptz
);

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.calendar_provider not null,
  provider_account text,
  is_primary boolean not null default false,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  unique(user_id, provider, provider_account)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  plan public.plan_code not null default 'free',
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.feature_flags (
  key text primary key,
  description text,
  enabled boolean not null default false,
  public_visible boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.feature_flags(key,description,enabled,public_visible) values
 ('ai_scanning','Master switch for AI extraction',true,true),
 ('rewards','Zest Credits and milestone rewards',true,true),
 ('referrals','Referral programme',true,true),
 ('direct_google_calendar','Google Calendar OAuth sync',false,true),
 ('direct_outlook_calendar','Outlook Calendar OAuth sync',false,true),
 ('business_plan','Business subscription availability',true,true)
on conflict (key) do nothing;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, locale, timezone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'locale', 'en'),
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_admin = true
  );
$$;

alter table public.profiles enable row level security;
alter table public.scans enable row level security;
alter table public.events enable row level security;
alter table public.usage_monthly enable row level security;
alter table public.reward_ledger enable row level security;
alter table public.referrals enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.subscriptions enable row level security;
alter table public.feature_flags enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated
using ((select auth.uid()) = id or public.is_admin());
create policy "profiles_update_own" on public.profiles for update to authenticated
using ((select auth.uid()) = id or public.is_admin())
with check ((select auth.uid()) = id or public.is_admin());

create policy "scans_own_all" on public.scans for all to authenticated
using ((select auth.uid()) = user_id or public.is_admin())
with check ((select auth.uid()) = user_id or public.is_admin());

create policy "events_own_all" on public.events for all to authenticated
using ((select auth.uid()) = user_id or public.is_admin())
with check ((select auth.uid()) = user_id or public.is_admin());

create policy "usage_select_own" on public.usage_monthly for select to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

create policy "rewards_select_own" on public.reward_ledger for select to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

create policy "referrals_own_select" on public.referrals for select to authenticated
using ((select auth.uid()) = referrer_id or (select auth.uid()) = referred_user_id or public.is_admin());
create policy "referrals_create_own" on public.referrals for insert to authenticated
with check ((select auth.uid()) = referrer_id);

create policy "calendar_connections_own_all" on public.calendar_connections for all to authenticated
using ((select auth.uid()) = user_id or public.is_admin())
with check ((select auth.uid()) = user_id or public.is_admin());

create policy "subscriptions_select_own" on public.subscriptions for select to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

create policy "feature_flags_public_read" on public.feature_flags for select to anon, authenticated
using (public_visible = true or public.is_admin());
create policy "feature_flags_admin_write" on public.feature_flags for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create index scans_user_created_idx on public.scans(user_id, created_at desc);
create index events_user_start_idx on public.events(user_id, start_date, start_time);
create index reward_ledger_user_created_idx on public.reward_ledger(user_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('scan-sources','scan-sources',false)
on conflict (id) do nothing;

create policy "scan_sources_select_own" on storage.objects for select to authenticated
using (bucket_id = 'scan-sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "scan_sources_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'scan-sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "scan_sources_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'scan-sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
