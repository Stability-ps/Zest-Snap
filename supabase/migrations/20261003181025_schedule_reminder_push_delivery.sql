-- Recorded from production (version 20261003181025) on 2026-10-04.
-- The project URL is environment-specific; replace it when provisioning a different project.
select cron.schedule(
  'zest-deliver-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rnlqsaaoywqrvokoysei.supabase.co/functions/v1/deliver-reminders',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-zest-cron',(select decrypted_secret from vault.decrypted_secrets where name='zest_push_cron_secret' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
