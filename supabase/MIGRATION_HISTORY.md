# Migration history: repository ↔ production

Production (`rnlqsaaoywqrvokoysei`) was migrated with Supabase MCP `apply_migration`, which records its own timestamped version. The files here were named separately. On 2026-10-08 only 9 of 38 production versions matched a filename, so `supabase db push` would have tried to re-run almost every migration. **Do not run `supabase db push` against production until the steps below are complete.**

## What was verified (2026-10-08)

- **Applied SQL.** `supabase_migrations.schema_migrations.statements` holds the exact SQL production applied. After stripping comments and whitespace, 25 files are byte-identical to a production version. The rest are mapped in `migration-history.json`:
  - `launch_readiness` was applied as 7 parts.
  - `shared_messaging` was applied as 2 parts.
  - Production's `advisor_policy_cleanup` is in `harden_admin_rls_helper`.
  - Production's `advisor_performance_fixes` is in `20261015090000_reconcile_production_drift`.
  - `feature_flags_policy_cleanup`, `production_hardening` and `admin_console` were applied without being recorded (`[]`). Their objects are present in production.
- **Resulting schema.** `scripts/schema-fingerprint.sql` hashes every function, column, constraint, policy, RLS flag, trigger, index, table grant, function grant, cron job and storage bucket. Run it on production and on a database built from these files (`tests/helpers/db.ts`). With `20261015090000` included, the two match except:
  - a comment inside `private.admin_user_detail` (no behaviour difference);
  - PostgreSQL 18 (PGlite) also lists NOT NULL constraints. Ignore names ending `_not_null`.

## Drift that was fixed

| Drift | Effect | Fix |
|---|---|---|
| `calendar_connections`: production replaced the original table with the OAuth-token table; a fresh build kept the original (`create table if not exists`) | A new environment couldn't store Google Calendar tokens and had a per-user policy on the table | `20261015090000` (no-op in production) |
| Two indexes only in production (`advisor_performance_fixes`) | — | `20261015090000` |
| Supabase default privileges gave `anon`/`authenticated` write privileges on RPC-only tables; RLS was the only barrier | Defense in depth only; nothing reachable through the API | `20261015100000` (**changes production**), and the test database now applies Supabase's default privileges so tests see production's privilege picture |
| Free plan: seed says 10 scans/month, production is 3 (set in Admin → Plans) | A new environment would give 10 | Data, not schema: set it in Admin → Plans after creating an environment |

## Security issue found in the production history

Production's record of `20261003181004 enable_scheduled_web_push` contains the **web push private key and the cron secret** in plain text (the repository file deliberately leaves them out). Anyone with database, dashboard or backup access can read them. Before or with the reconciliation:

1. Generate a new VAPID key pair and a new cron secret, and update the Vault secrets `zest_vapid_public_key`, `zest_vapid_private_key` and `zest_push_cron_secret`. Also update the `NEXT_PUBLIC_VAPID_PUBLIC_KEY` env var in Vercel and the fallback in `lib/reminders.ts`. The cron job reads the cron secret from Vault on every run, so it needs no change.
2. Existing web push subscriptions are bound to the old public key. Browsers re-subscribe the next time someone turns on notifications (production had 1 subscription on 2026-10-08).
3. Remove the secrets from the history row:
   `update supabase_migrations.schema_migrations set statements = array['-- secrets redacted; see supabase/migrations/20261003181004_enable_scheduled_web_push.sql'] where version = '20261003181004';`

## Reconciliation steps (owner, with production access)

1. Take a backup (Dashboard → Database → Backups).
2. Rotate the secrets above.
3. Rewrite the history so it lists this repository's versions. Production's schema is not touched:
   ```sh
   node scripts/migration-repair-plan.mjs   # prints the two commands below from migration-history.json
   supabase link --project-ref rnlqsaaoywqrvokoysei
   supabase migration repair --status reverted <versions printed>
   supabase migration repair --status applied  <versions printed>
   ```
4. Check: `supabase migration list` shows local = remote for every applied file, and `supabase db push --dry-run` lists only the `"pending"` files (`20261015100000`, plus any later ones).
5. `supabase db push`, then run `scripts/schema-fingerprint.sql` on production and compare it with a fresh build.
6. In `migration-history.json`, change `"pending"` to `[]` for the files just pushed. From then on every new migration goes through `supabase db push`, so filenames and production versions stay identical.

`tests/migration-history.test.ts` fails when a new migration file isn't added to `migration-history.json`, and it guards the `calendar_connections` and privilege fixes.
