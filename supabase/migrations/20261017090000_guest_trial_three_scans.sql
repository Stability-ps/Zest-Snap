-- Guests get three successful AI scans per device before signing up (was two: the seed in
-- 20261004120000_production_hardening set guest_trial_scans_per_device = 2, which is why guests were
-- stopped after two scans). Only the untouched seed value changes, so an admin's deliberate setting is kept.
-- Counting is unchanged: completed and in-flight scans count, failed ones are refunded (status 'failed').
update public.app_limits
   set value = 3
 where key = 'guest_trial_scans_per_device' and value = 2;

-- Rollback: update public.app_limits set value = 2 where key = 'guest_trial_scans_per_device' and value = 3;
