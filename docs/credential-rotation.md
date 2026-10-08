# Rotating the web push and cron credentials

Production's migration history row `20261003181004 enable_scheduled_web_push` stored the VAPID key pair and the
cron secret in plain text. Verified on 2026-10-08 (by comparing SHA-256 hashes, never the values):

- In production the values appear **only** in that history row (not in `cron.job`, `cron.job_run_details`,
  function bodies or `net.http_request_queue`).
- The VAPID private key and the cron secret appear in **no** git blob on any branch, and not in the production
  Vercel build log. Only the VAPID public key is in git, which is expected (it is public).

Treat the private key and cron secret as compromised. They are read in these places:

| Secret (Vault name) | Read by | Change needed |
|---|---|---|
| `zest_push_cron_secret` | pg_cron job `zest-deliver-reminders` (reads Vault every run) and `public.verify_push_cron_secret` (called by the `deliver-reminders` edge function) | None — both read Vault at call time, so updating Vault switches both atomically |
| `zest_vapid_private_key` | `public.get_push_delivery_config` → `deliver-reminders` | None |
| `zest_vapid_public_key` | `get_push_delivery_config`, and browsers via `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (fallback in `lib/reminders.ts`) | Vercel env + fallback |

## Steps (owner)

Never paste the values into chat, a PR or a terminal that is being recorded.

1. On your own machine: `npx web-push generate-vapid-keys`. Keep both values in your password manager.
2. Supabase Dashboard → SQL editor (project `rnlqsaaoywqrvokoysei`). The cron secret is generated inside the
   database, so it never exists anywhere else:
   ```sql
   select vault.update_secret((select id from vault.secrets where name = 'zest_vapid_public_key'),  '<NEW PUBLIC KEY>');
   select vault.update_secret((select id from vault.secrets where name = 'zest_vapid_private_key'), '<NEW PRIVATE KEY>');
   select vault.update_secret((select id from vault.secrets where name = 'zest_push_cron_secret'),
                              encode(extensions.gen_random_bytes(32), 'hex'));
   update supabase_migrations.schema_migrations
      set statements = array['-- secrets redacted; see supabase/migrations/20261003181004_enable_scheduled_web_push.sql']
    where version = '20261003181004';
   ```
3. Vercel → zest-snap → Settings → Environment Variables: set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the new
   public key for Production and Preview, then redeploy production. Replace the fallback public key in
   `lib/reminders.ts` with the new one (it is public, so it can go in a normal PR).
4. Check (any SQL client):
   ```sql
   -- every row should be 200 within two minutes of step 2
   select status_code, count(*) from net._http_response where created > now() - interval '5 minutes' group by 1;
   -- must return no rows
   select version from supabase_migrations.schema_migrations
    where array_to_string(statements, ' ') like '%' || (select decrypted_secret from vault.decrypted_secrets
                                                         where name = 'zest_vapid_private_key') || '%';
   ```
5. Turn on notifications in a browser, schedule a reminder two minutes ahead and confirm it arrives.

The old values are invalid as soon as step 2 runs; there is nothing else to revoke. Database backups taken
before step 2 still contain the old values, which no longer work.

Browsers that subscribed with the old public key are re-subscribed automatically on their next visit
(`syncPushSubscription` in `lib/reminders.ts` replaces a subscription bound to a different key). Once a browser
has unsubscribed its old endpoint, the push service answers 410 and `deliver-reminders` deletes that row; endpoints
of browsers that never come back only accumulate `failure_count`.
