# Dedicated Zest Snap cloud activation

No existing or unrelated Supabase project may be used. No paid project was created during this implementation.

## Provision and migrate

1. Create/subscribe to the dedicated **Zest Snap** project. Choose a region based on the expected global user distribution, latency to your Vercel function region and applicable data residency requirements. The current Vercel production region is `iad1`; proximity is a latency consideration, not a statement about legal compliance. Keep the database password in a password manager.
2. In the new project's SQL editor apply, in this exact order, the complete files:
   - `supabase/migrations/20261002_initial_product_schema.sql`
   - `supabase/migrations/20261003011650_launch_readiness.sql`
   Do not stop after the first file: it contains historical broad profile grants corrected by the second. Alternatively link the Supabase CLI to this dedicated project and run `supabase db push` after checking its migration plan.
3. Confirm RLS is enabled on every public table. Run the SQL checks below and the project's Security and Performance Advisors. Resolve any project-specific findings before enabling access. The automated test suite runs these migrations in isolated PostgreSQL; it does not substitute for advisors on the actual Supabase deployment.
4. Verify `scan-sources` is a **private** bucket. Upload insert policy is intentionally absent: the product does not store original scans. Do not turn on public access or source upload policies.

## Vercel configuration

Use the project Connect dialog to retrieve the URL and **publishable** key. In Vercel project **zest-snap**, configure Preview and Production deliberately:

| Variable | Value | Exposure |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Dedicated project's HTTPS URL | Browser |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Dedicated publishable key | Browser |
| `SUPABASE_SECRET_KEY` | Dedicated server secret key (legacy service_role also accepted) | Server only |
| `NEXT_PUBLIC_CLOUD_ENABLED` | `true` | Browser |
| `OPENAI_API_KEY` | Existing Zest AI credential | Server only |

The server secret is needed for atomic usage reservations, immutable milestone credits and account deletion. Missing server configuration rejects cloud scanning safely. Never paste it into a `NEXT_PUBLIC_` variable. Do not reuse another product's credentials. All public environment values are build-time values: redeploy after changing them.

Set Auth **Site URL** to the actual canonical production origin (currently `https://zest-snap.vercel.app` until a custom domain is attached). Add these exact redirect URLs:

- `https://zest-snap.vercel.app/auth/callback`
- `https://zest-snap.vercel.app/auth/callback?next=/reset-password`
- Equivalent URLs for your verified custom domain and deliberately approved preview hostname.
- Local development only: `http://localhost:3100/auth/callback` and `http://localhost:3100/auth/callback?next=/reset-password`.

Keep email confirmation enabled. Configure your SMTP sender, delivery limits and sender domain in Supabase for public use. Leave link templates compatible with the PKCE code flow and test verification/reset in the same browser that requested the link. Set a short appropriate JWT lifetime and enable available password protections. No auth URL may point to another product.

The migration seeds `cloud_persistence=true`. To stage rollout, set it false in SQL until configuration is complete, then enable it:

```sql
update public.feature_flags set enabled = true where key = 'cloud_persistence';
```

Redeploy Vercel. Missing credentials continue to use local mode. Valid credentials plus the cloud flag enable signed-in persistence; guests keep the device experience. Cloud scanning requires a signed-in account and server allowance checks. No product-screen edits are needed.

## Admin bootstrap

After the owner signs up and verifies email, set only the verified owner's UUID as admin using the SQL editor:

```sql
update public.profiles set is_admin = true where id = '<verified-owner-auth-user-uuid>';
```

No browser or local-storage value grants this privilege. `/admin` verifies the current user and the live database authorization on every request and action. Keep administrator access limited and enable MFA in the provider where available.

## Verification

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';
select id, public, file_size_limit from storage.buckets where id = 'scan-sources';
select has_column_privilege('authenticated','public.profiles','is_admin','UPDATE') as must_be_false;
select has_column_privilege('authenticated','public.profiles','plan','UPDATE') as must_be_false;
select has_function_privilege('authenticated','public.reserve_scan(uuid,uuid,text)','EXECUTE') as must_be_false;
```

Use two test accounts. Verify sign-up, verification, sign-in, password recovery, expired callback, sign-out and restored session. Each account must see only its own records. A non-admin requesting `/admin?admin=true` must be redirected.

1. In guest mode create a scan and export two events. Sign in and select **Settings → Merge this device’s guest history & agenda**. Repeat twice; counts must not grow. Original uploads are not migrated. Local milestones are preserved as progress in profile preferences, never trusted as spendable credits.
2. Verify cloud history/agenda from a second browser. Reload, edit, delete and export. Remove scan history; agenda and external calendars remain independent. Sign out; cached cloud records must no longer be displayed.
3. Set a test account's allowance to one in a disposable test environment. Two valid scans must not both pass. Direct client writes to credits/usage/admin/plan must fail. Repeat a milestone; only one ledger entry may exist.
4. Reopen previously loaded cloud data offline, then reconnect. Queued edits are retried idempotently. Retry any displayed sync failure before changing accounts.
5. Export account data and delete the disposable account. Confirm Zest records cascade and the session is signed out. External calendar entries and downloaded files are deliberately unaffected.
6. Run Security Advisors and Performance Advisors again. Record results in `docs/qa-matrix.md` with date, project reference and tester; never store credentials.

## Rollback

For a frontend regression, restore the last verified Vercel deployment. Keep database data and migrations intact. To temporarily pause cloud operations, set `cloud_persistence=false`; authenticated cloud data remains stored and the app explains the pause. For a full return to guest mode set `NEXT_PUBLIC_CLOUD_ENABLED=false` and redeploy; original guest data and account-specific caches remain on devices. Do not reverse migrations or delete the project to roll back. Re-enable and rerun smoke tests after correcting configuration.
