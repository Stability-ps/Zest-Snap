-- The Free plan allows 3 AI scans a month. 20261003011650_launch_readiness seeded 10; production was set to 3 in
-- Admin → Plans on 2026-10-04. Bring a fresh environment in line. Only the untouched seed value is changed, so this
-- is a no-op in production and never overrides a limit an admin chose.
update public.plan_rules set monthly_scans = 3 where id = 'free' and monthly_scans = 10;
