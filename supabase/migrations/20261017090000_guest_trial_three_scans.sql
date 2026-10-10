-- Guests get three successful AI scans per device before signing up (was two: the seed in
-- 20261004120000_production_hardening set guest_trial_scans_per_device = 2, which is why guests were
-- stopped after two scans). Only the untouched seed value changes, so an admin's deliberate setting is kept.
-- Counting is unchanged: completed and in-flight scans count, failed ones are refunded (status 'failed').
update public.app_limits
   set value = 3
 where key = 'guest_trial_scans_per_device' and value = 2;

-- A failed scan must not block an immediate retry. The 5-second anti-burst check in reserve_guest_scan and
-- reserve_scan also counted failed attempts, so retrying right after "Nothing was charged — please try again"
-- returned "A scan is already running". Only that clause changes (patched in the live definition so nothing
-- else in the functions can be reverted); the 90-second in-flight check still blocks parallel scans.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.reserve_guest_scan(uuid, text, text, text)'::regprocedure);
  if position('where device_hash = h and created_at > now() - interval ''5 seconds'')' in d) = 0 then
    raise exception 'reserve_guest_scan no longer has the expected burst clause; review this migration';
  end if;
  execute replace(d, 'where device_hash = h and created_at > now() - interval ''5 seconds'')',
                     'where device_hash = h and status <> ''failed'' and created_at > now() - interval ''5 seconds'')');

  d := pg_get_functiondef('public.reserve_scan(uuid, uuid, text, text)'::regprocedure);
  if position('where user_id = p_user and created_at > now() - interval ''5 seconds'')' in d) = 0 then
    raise exception 'reserve_scan no longer has the expected burst clause; review this migration';
  end if;
  execute replace(d, 'where user_id = p_user and created_at > now() - interval ''5 seconds'')',
                     'where user_id = p_user and status <> ''failed'' and created_at > now() - interval ''5 seconds'')');
end $$;

-- Rollback: update public.app_limits set value = 2 where key = 'guest_trial_scans_per_device' and value = 3;
-- and re-run the two replace() calls above with the arguments swapped.
