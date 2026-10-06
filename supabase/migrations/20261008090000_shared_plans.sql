-- Zest Snap shared plans, invitations, shared items, assignments and lightweight plan types.
create table if not exists public.shared_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  kind text not null default 'shared' check (kind in ('shared','family','class','team','trip','timetable','meals')),
  description text not null default '' check (char_length(description) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_plan_members (
  plan_id uuid not null references public.shared_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','editor','viewer')),
  status text not null default 'active' check (status in ('active','left')),
  joined_at timestamptz not null default now(),
  primary key (plan_id,user_id)
);

create table if not exists public.shared_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.shared_plans(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null default 'event' check (item_type in ('event','task','deadline','meal')),
  title text not null check (char_length(title) between 1 and 500),
  description text not null default '' check (char_length(description) <= 10000),
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  due_date date,
  due_time time,
  all_day boolean not null default false,
  timezone text not null default 'UTC',
  location text not null default '' check (char_length(location) <= 2000),
  assigned_to uuid references auth.users(id) on delete set null,
  recurrence jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  source text not null default 'manual' check (source in ('manual','scan','import','ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_plan_invites (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.shared_plans(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  invited_email text,
  role text not null default 'viewer' check (role in ('editor','viewer')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz
);

create index if not exists shared_plan_members_user_idx on public.shared_plan_members(user_id,status);
create index if not exists shared_plan_items_plan_date_idx on public.shared_plan_items(plan_id,coalesce(due_date,start_date),status);
create index if not exists shared_plan_invites_email_idx on public.shared_plan_invites(lower(invited_email),status) where invited_email is not null;

alter table public.shared_plans enable row level security;
alter table public.shared_plan_members enable row level security;
alter table public.shared_plan_items enable row level security;
alter table public.shared_plan_invites enable row level security;

create or replace function private.is_shared_plan_member(p_plan uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.shared_plan_members m
    where m.plan_id=p_plan and m.user_id=auth.uid() and m.status='active'
      and (p_roles is null or m.role=any(p_roles))
  ) or exists(select 1 from public.shared_plans p where p.id=p_plan and p.owner_id=auth.uid())
$$;
revoke all on function private.is_shared_plan_member(uuid,text[]) from public,anon;
grant execute on function private.is_shared_plan_member(uuid,text[]) to authenticated;

drop policy if exists shared_plans_read on public.shared_plans;
create policy shared_plans_read on public.shared_plans for select to authenticated
using (owner_id=auth.uid() or private.is_shared_plan_member(id,null));

drop policy if exists shared_plans_insert on public.shared_plans;
create policy shared_plans_insert on public.shared_plans for insert to authenticated
with check (owner_id=auth.uid());

drop policy if exists shared_plans_update on public.shared_plans;
create policy shared_plans_update on public.shared_plans for update to authenticated
using (owner_id=auth.uid() or private.is_shared_plan_member(id,array['owner','editor']))
with check (owner_id=auth.uid() or private.is_shared_plan_member(id,array['owner','editor']));

drop policy if exists shared_members_read on public.shared_plan_members;
create policy shared_members_read on public.shared_plan_members for select to authenticated
using (user_id=auth.uid() or private.is_shared_plan_member(plan_id,null));

drop policy if exists shared_items_read on public.shared_plan_items;
create policy shared_items_read on public.shared_plan_items for select to authenticated
using (private.is_shared_plan_member(plan_id,null));

drop policy if exists shared_items_insert on public.shared_plan_items;
create policy shared_items_insert on public.shared_plan_items for insert to authenticated
with check (creator_id=auth.uid() and private.is_shared_plan_member(plan_id,array['owner','editor']));

drop policy if exists shared_items_update on public.shared_plan_items;
create policy shared_items_update on public.shared_plan_items for update to authenticated
using (private.is_shared_plan_member(plan_id,array['owner','editor']) or assigned_to=auth.uid())
with check (private.is_shared_plan_member(plan_id,array['owner','editor']) or assigned_to=auth.uid());

drop policy if exists shared_items_delete on public.shared_plan_items;
create policy shared_items_delete on public.shared_plan_items for delete to authenticated
using (private.is_shared_plan_member(plan_id,array['owner','editor']));

drop policy if exists shared_invites_read on public.shared_plan_invites;
create policy shared_invites_read on public.shared_plan_invites for select to authenticated
using (
  created_by=auth.uid()
  or (invited_email is not null and lower(invited_email)=lower(coalesce(auth.jwt()->>'email','')))
);

grant select,insert,update on public.shared_plans to authenticated;
grant select on public.shared_plan_members to authenticated;
grant select,insert,update,delete on public.shared_plan_items to authenticated;
grant select on public.shared_plan_invites to authenticated;
grant all on public.shared_plans,public.shared_plan_members,public.shared_plan_items,public.shared_plan_invites to service_role;

create or replace function public.create_shared_plan(p_name text,p_kind text default 'shared')
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); pid uuid;
begin
  if u is null then raise exception 'authentication_required'; end if;
  if length(trim(coalesce(p_name,'')))<1 or length(p_name)>160 then raise exception 'invalid_name'; end if;
  if p_kind not in ('shared','family','class','team','trip','timetable','meals') then raise exception 'invalid_kind'; end if;
  insert into public.shared_plans(owner_id,name,kind) values(u,trim(p_name),p_kind) returning id into pid;
  insert into public.shared_plan_members(plan_id,user_id,role,status) values(pid,u,'owner','active');
  return pid;
end $$;
revoke all on function public.create_shared_plan(text,text) from public,anon;
grant execute on function public.create_shared_plan(text,text) to authenticated;

create or replace function public.create_shared_invite(p_plan uuid,p_email text default null,p_role text default 'viewer')
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); tok uuid;
begin
  if u is null then raise exception 'authentication_required'; end if;
  if p_role not in ('viewer','editor') then raise exception 'invalid_role'; end if;
  if not private.is_shared_plan_member(p_plan,array['owner','editor']) then raise exception 'not_allowed'; end if;
  insert into public.shared_plan_invites(plan_id,invited_email,role,created_by)
  values(p_plan,nullif(lower(trim(coalesce(p_email,''))),''),p_role,u)
  returning token into tok;
  return tok;
end $$;
revoke all on function public.create_shared_invite(uuid,text,text) from public,anon;
grant execute on function public.create_shared_invite(uuid,text,text) to authenticated;

create or replace function public.create_public_event_share(p_event jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); pid uuid; tok uuid; title text:=left(coalesce(p_event->>'title','Shared event'),500);
begin
  if u is null then raise exception 'authentication_required'; end if;
  insert into public.shared_plans(owner_id,name,kind) values(u,title,'shared') returning id into pid;
  insert into public.shared_plan_members(plan_id,user_id,role,status) values(pid,u,'owner','active');
  insert into public.shared_plan_items(
    plan_id,creator_id,item_type,title,description,start_date,end_date,start_time,end_time,all_day,timezone,location,source
  ) values(
    pid,u,'event',title,left(coalesce(p_event->>'description',''),10000),
    nullif(p_event->>'startDate','')::date,nullif(p_event->>'endDate','')::date,
    nullif(p_event->>'startTime','')::time,nullif(p_event->>'endTime','')::time,
    coalesce((p_event->>'allDay')::boolean,false),coalesce(nullif(p_event->>'timezone',''),'UTC'),
    left(coalesce(p_event->>'location',''),2000),'scan'
  );
  insert into public.shared_plan_invites(plan_id,role,created_by) values(pid,'viewer',u) returning token into tok;
  return tok;
end $$;
revoke all on function public.create_public_event_share(jsonb) from public,anon;
grant execute on function public.create_public_event_share(jsonb) to authenticated;

create or replace function public.shared_invite_preview(p_token uuid)
returns table(plan_name text,plan_kind text,role text,expires_at timestamptz,item jsonb)
language sql stable security definer set search_path='' as $$
  select p.name,p.kind,i.role,i.expires_at,
    (select to_jsonb(x) - 'creator_id' from (
      select si.item_type,si.title,si.description,si.start_date,si.end_date,
             si.start_time,si.end_time,si.due_date,si.due_time,si.all_day,
             si.timezone,si.location,si.recurrence
      from public.shared_plan_items si where si.plan_id=p.id and si.status<>'cancelled'
      order by coalesce(si.start_date,si.due_date),si.created_at limit 1
    ) x)
  from public.shared_plan_invites i join public.shared_plans p on p.id=i.plan_id
  where i.token=p_token and i.status='pending' and i.expires_at>now()
$$;
revoke all on function public.shared_invite_preview(uuid) from public;
grant execute on function public.shared_invite_preview(uuid) to anon,authenticated;

create or replace function public.accept_shared_invite(p_token uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); inv public.shared_plan_invites%rowtype;
begin
  if u is null then raise exception 'authentication_required'; end if;
  select * into inv from public.shared_plan_invites where token=p_token and status='pending' and expires_at>now() for update;
  if not found then raise exception 'invite_unavailable'; end if;
  if inv.invited_email is not null and lower(inv.invited_email)<>lower(coalesce(auth.jwt()->>'email','')) then raise exception 'invite_for_another_account'; end if;
  insert into public.shared_plan_members(plan_id,user_id,role,status)
  values(inv.plan_id,u,inv.role,'active')
  on conflict(plan_id,user_id) do update set role=excluded.role,status='active',joined_at=now();
  update public.shared_plan_invites set status='accepted',accepted_by=u,accepted_at=now() where id=inv.id;
  return inv.plan_id;
end $$;
revoke all on function public.accept_shared_invite(uuid) from public,anon;
grant execute on function public.accept_shared_invite(uuid) to authenticated;

create or replace function private.touch_shared_updated()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.updated_at=now();
  return new;
end $$;
revoke all on function private.touch_shared_updated() from public,anon,authenticated;
drop trigger if exists shared_plans_touch on public.shared_plans;
create trigger shared_plans_touch before update on public.shared_plans for each row execute function private.touch_shared_updated();
drop trigger if exists shared_plan_items_touch on public.shared_plan_items;
create trigger shared_plan_items_touch before update on public.shared_plan_items for each row execute function private.touch_shared_updated();
