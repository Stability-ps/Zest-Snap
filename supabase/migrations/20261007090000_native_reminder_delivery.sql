-- Native apps (2026-10-07): reminders delivered as OS-scheduled local notifications on iOS/Android must not
-- be recorded as failed / no_push_subscription. Additive and idempotent; the deliver-reminders edge function
-- is unchanged (it keeps calling complete_push_reminder).

alter table public.reminders add column if not exists device_armed_for timestamptz;
alter table public.reminders add column if not exists delivered_via text
  check (delivered_via is null or delivered_via in ('web_push', 'device'));

-- Called by the iOS/Android app after it arms local notifications. Each entry records the exact time it armed,
-- so a reminder snoozed or rescheduled elsewhere is not credited to a stale device schedule.
create or replace function private.mark_reminders_device_armed(p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); n integer;
begin
  if u is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 100 then raise exception 'invalid_items'; end if;
  update public.reminders r set device_armed_for = r.scheduled_at
    from jsonb_to_recordset(p_items) as x(id uuid, at timestamptz)
   where r.id = x.id and r.user_id = u and r.status = 'pending' and r.scheduled_at = x.at;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.mark_reminders_device_armed(jsonb) from public, anon;
grant execute on function private.mark_reminders_device_armed(jsonb) to authenticated;
create or replace function public.mark_reminders_device_armed(p_items jsonb) returns integer
language sql security invoker set search_path = '' as $$ select private.mark_reminders_device_armed(p_items) $$;
revoke all on function public.mark_reminders_device_armed(jsonb) from public, anon;
grant execute on function public.mark_reminders_device_armed(jsonb) to authenticated;

-- Same contract as before for web push; a reminder armed on a device at its current time counts as delivered
-- on that device instead of entering the retry → failed path.
create or replace function public.complete_push_reminder(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update public.reminders set status = 'sent', delivered_at = now(), delivered_via = 'web_push', claimed_at = null, last_error = null
     where id = p_id and status = 'processing';
  elsif exists (select 1 from public.reminders where id = p_id and status = 'processing' and device_armed_for = scheduled_at) then
    update public.reminders set status = 'sent', delivered_at = now(), delivered_via = 'device', claimed_at = null, last_error = null
     where id = p_id and status = 'processing';
  else
    update public.reminders
       set retry_count = least(retry_count + 1, 20),
           status = case when retry_count + 1 >= 5 then 'failed' else 'pending' end,
           scheduled_at = case when retry_count + 1 >= 5 then scheduled_at else now() + interval '2 minutes' end,
           claimed_at = null, last_error = left(coalesce(p_error, 'push_failed'), 500)
     where id = p_id and status = 'processing';
  end if;
end $$;
revoke all on function public.complete_push_reminder(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.complete_push_reminder(uuid, boolean, text) to service_role;
