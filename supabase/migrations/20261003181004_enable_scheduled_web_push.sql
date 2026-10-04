-- Recorded from production (version 20261003181004) on 2026-10-04.
-- The production migration created three Vault secrets inline. Secret values are NEVER committed.
-- For a new environment create them manually in the SQL editor (values from your password manager):
--   select vault.create_secret('<VAPID public key>',  'zest_vapid_public_key');
--   select vault.create_secret('<VAPID private key>', 'zest_vapid_private_key');
--   select vault.create_secret('<random 32+ byte secret>', 'zest_push_cron_secret');
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.get_push_delivery_config()
returns table(public_key text, private_key text)
language sql security definer set search_path=''
as $$
 select
  (select decrypted_secret from vault.decrypted_secrets where name='zest_vapid_public_key' limit 1),
  (select decrypted_secret from vault.decrypted_secrets where name='zest_vapid_private_key' limit 1)
$$;
revoke all on function public.get_push_delivery_config() from public, anon, authenticated;
grant execute on function public.get_push_delivery_config() to service_role;

create or replace function public.verify_push_cron_secret(p_secret text)
returns boolean
language sql security definer set search_path=''
as $$
 select coalesce(p_secret=(select decrypted_secret from vault.decrypted_secrets where name='zest_push_cron_secret' limit 1),false)
$$;
revoke all on function public.verify_push_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_push_cron_secret(text) to service_role;

create or replace function public.complete_push_reminder(p_id uuid,p_ok boolean,p_error text default null)
returns void
language plpgsql security definer set search_path=''
as $$
begin
 if p_ok then
  update public.reminders set status='sent',delivered_at=now(),claimed_at=null,last_error=null where id=p_id and status='processing';
 else
  update public.reminders
  set retry_count=least(retry_count+1,20),
      status=case when retry_count+1>=5 then 'failed' else 'pending' end,
      scheduled_at=case when retry_count+1>=5 then scheduled_at else now()+interval '2 minutes' end,
      claimed_at=null,last_error=left(coalesce(p_error,'push_failed'),500)
  where id=p_id and status='processing';
 end if;
end $$;
revoke all on function public.complete_push_reminder(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.complete_push_reminder(uuid,boolean,text) to service_role;
