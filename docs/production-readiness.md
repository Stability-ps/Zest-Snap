# Production release runbook

Production Supabase project: `rnlqsaaoywqrvokoysei`. Vercel project: `zest-snap` (team `acapolite`).
Vercel build quota is limited: batch work on a branch, and make **one** intentional production deployment.

## State on 2026-10-04 (before this release)

- Production served commit `6a05747`. `186d0b4`, `9c1c989` and `5852c7d` were never deployed (Vercel build-rate limit).
- The repository migrations did not match production. Production's history is now recorded in
  `supabase/migrations/20261003032148…20261003204243` (Vault secret values deliberately omitted).
  Production versions `20261003025156–025545` correspond to the repository's
  `20261002_initial_product_schema.sql` + `20261003011650_launch_readiness.sql`, and
  `20261003090500_feature_flags_policy_cleanup.sql` was applied by hand. **Do not run `supabase db push`
  against production** without first reconciling history with `supabase migration repair`.

## Release order (status verified 2026-10-04)

1. **Database — DONE.** Every object in `20261004120000_production_hardening.sql` exists in production and all 42
   public/private function definitions are byte-identical to the repository chain (verified by hash). It was applied
   outside migration history, so it is *not* listed in `supabase_migrations`. **Do not re-run it.** (It is idempotent,
   but there is no reason to.) Before ever using `supabase db push`, record it with
   `supabase migration repair --status applied 20261004120000`.
2. **Edge Function — live v2 works.** v2 is the original plus the `failure_count` select fix. The repository copy
   includes that fix plus relation-shape handling, a reminder deep link and structured logs. Deploying it is optional
   and can happen after the frontend release. Never deploy anything older than the repository file.
3. **Auth** — Leaked password protection: **DEFERRED — requires Supabase Pro.** On the free plan, set *Minimum password
   length = 8* (Authentication → Providers → Email) so the server matches the app, which enforces 8 on sign-up and reset.
4. **Vercel env (Production)** — required: `OPENAI_API_KEY` (verified present via a live probe), `SUPABASE_SECRET_KEY`
   or `SUPABASE_SERVICE_ROLE_KEY` (server-only; required for every AI reservation, guest trial, rewards and account
   deletion). Recommended: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the code falls back to the
   Zest project's public values). Optional: `NEXT_PUBLIC_SITE_URL` (canonical/OG, defaults to `https://zestsnap.app`),
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (default equals Vault `zest_vapid_public_key`), `OPENAI_MODEL`, cost-rate vars,
   `UPSTASH_*` (only used if cloud is disabled), `AI_SCANNING_ENABLED=false` (kill switch).
5. **Gates** — `npm run lint && npm run typecheck && npm test && npm run build`, then
   `npx next start -p 3100 & npx playwright test`.
6. **One deployment** — fast-forward `main` to the release branch (no preview build). Confirm the deployed SHA.

## Product limits (admin-editable, `public.app_limits`)

| key | default | meaning |
| --- | --- | --- |
| `free_accounts_per_device` | 2 | Accounts on one device that get free-plan scans and reward credits. Paid plans are never limited. Survives account deletion (`device_benefit_claims`). |
| `guest_trial_scans_per_device` | 2 | Lifetime signed-out AI scans per device. |
| `guest_scans_per_network_day` | 6 | Signed-out scans per network per day (daily-rotating hash, nulled after 2 days). |
| `device_scans_per_hour` | 20 | AI scans per device per hour, all accounts. |
| `referral_rewards_per_referrer_month` | 5 | Qualified referral rewards per referrer per month. |
| `scan_result_cache_hours` | 24 | Identical file re-scanned within this window reuses the result: no AI call, no charge. |

Feature flag `guest_trial` turns the signed-out trial off without a deploy.

Anti-abuse is heuristic: the device id is a random value in browser storage (hashed server-side) and can be
reset by clearing site data. The network cap, per-device hourly cap and the "existing activity / same device"
referral rules bound what that buys. Suspicious patterns lose promotional value; accounts are never locked.

## Credits policy

- AI usage is authorised only by `reserve_scan` (service role) with an advisory lock; one in-flight scan per account.
- Monthly allowance first, then bonus credits (`plan_rules.credits_per_bonus_scan`).
- Failed AI calls, PDF page-limit rejections and requests killed mid-flight (expired after 3 minutes) refund
  the allowance and any credits exactly once (`reward_reference_once` unique index).
- Client request ids make retries idempotent; refresh, reopen, share-cancel and repeated sign-in never award credits.
- Guest milestones are never converted into cloud credits. Cloud milestones come only from server actions.
- Historical balances earned under earlier reward amounts are kept; the UI shows such milestones as "Completed".

## MANUAL PRODUCTION VERIFICATION REQUIRED

Automated tests cannot cover these. Use a real Android/Samsung phone with the PWA installed from the final origin.

- [ ] Install from Chrome → home-screen icon fills the adaptive shape (maskable), navy splash, standalone, opens `/app`.
- [ ] Sign up (name required) → verify email → lands in app signed in; close from recents → reopen: name, credits and Today appear immediately, no guest flash.
- [ ] Sign out → sign in as a different account on the same phone: no previous name, credits, Planner, history or reminders.
- [ ] Capture with camera, upload JPG/PNG/screenshot/PDF (1 page and over the page limit), unsupported file, airplane mode mid-scan.
- [ ] Credits: exhaust allowance on a test account → next scan spends credits → force a failure → credits refunded.
- [ ] Review → Save to Planner → Home Today; edit, complete, uncomplete, delete; Calendar → Plan something / Set a reminder / View day.
- [ ] Reminders → Enable notifications → status shows "Notifications on". Deny, then allow in Android settings → return → status updates.
- [ ] Push: reminder 2 minutes ahead with the app open, backgrounded, screen locked, removed from recents, and after a reboot.
- [ ] Notification actions: Snooze 15 min and Done work without opening the app; tapping opens Reminders without a reload.
- [ ] Add to device calendar (single and multiple) → opens Google/Samsung Calendar with correct date, time and timezone; all-day correct.
- [ ] Rewards: feedback once (+2), second attempt earns nothing; invite link from a second device → invitee's first scan → +5 once.
- [ ] Offline: open installed app in airplane mode → shell and cached data; reconnect → refreshes, no duplicates.
- [ ] Update: deploy → reopen PWA → "A new version is ready" → Update now → new version active.
- [ ] Settings: export data (signed in), Clear device data (cloud data intact after signing back in), Delete account (test account).
- [ ] Production logs: no unexpected errors in Vercel runtime logs or the `deliver-reminders` function logs.

## Domain (zestsnap.app) — NOT CONFIGURED

On 2026-10-04 `zestsnap.app` and `www.zestsnap.app` have no DNS records. The app runs on `https://zest-snap.vercel.app`.

Push subscriptions are origin-bound: after moving to the final domain every device must re-enable notifications.
Before announcing the domain: attach `zestsnap.app` (+ `www` redirect) in Vercel; set Supabase Auth Site URL to
`https://zestsnap.app` and add `https://zestsnap.app/auth/callback` (with and without `?next=…`) to redirect URLs;
keep the `zest-snap.vercel.app` URLs until no clients use them.
