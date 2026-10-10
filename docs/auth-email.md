# Email verification, password reset and account emails

## How links work

Emails from Supabase Auth link to `{{ .SiteURL }}/auth/confirm?token_hash=…&type=…` (templates in
`supabase/templates`). `/auth/confirm` verifies the token in the browser with `verifyOtp`, so a link works in
any browser, mail app or the native apps (no PKCE verifier from the signing-up browser is needed), and link
scanners that prefetch the URL without running JavaScript can't use up the one-time token.

| Link | Lands on |
| --- | --- |
| Verification (`type=email`) | `/auth/confirmed?status=verified` → “Email verified successfully.” → Continue to Zest Snap |
| Password reset (`type=recovery`) | `/reset-password` (never the homepage or the app) |
| Email change (`type=email_change`) | `/auth/confirmed?status=email-changed` |
| Used / expired / unknown token | `/auth/confirmed?status=expired` with Resend verification email and Sign in |
| Malformed link | `/auth/confirmed?status=invalid` |

`/auth/callback` still handles older `?code=` (PKCE) links. Supabase redirects that fall back to the bare Site
URL (`/?code=`, `/?token_hash=`, `/?error=`) on either host are forwarded by `proxy.ts` to these routes.

Resend is limited to one email per address per minute in the app (matches Supabase's `smtp_max_frequency`);
Supabase also enforces its hourly email cap.

## Production Supabase Auth settings

`node scripts/supabase-auth-config.mjs` (needs `SUPABASE_ACCESS_TOKEN`) prints the difference between
production and the settings below; `--apply` updates them.

- Site URL `https://app.zestsnap.app`
- Redirect allowlist: `https://app.zestsnap.app/**`, `https://zestsnap.app/**`, `https://www.zestsnap.app/**`, `zestsnap://**`
- Confirmation, recovery and email-change templates and subjects from `supabase/templates`
- Email confirmations on (`mailer_autoconfirm = false`), link expiry 1 hour

Deploy the app before switching the templates: the new templates link to `/auth/confirm`.

**Custom SMTP is required for production.** Supabase's built-in mailer only delivers to members of the
Supabase organization and is capped at 2 emails per hour. Configure SMTP in Supabase → Authentication →
Emails → SMTP settings, then raise the email rate limit.

## Tests

- `tests/auth-email.test.ts` (unit, part of `npm test`)
- `tests/browser/auth-email.spec.ts` — real Supabase Auth + Mailpit. Start a local stack with
  `enable_confirmations = true`, `max_frequency = "60s"`, `site_url = "http://127.0.0.1:3100"` and the
  templates above, build and start the app against it, then run
  `AUTH_E2E_MAILPIT_URL=http://127.0.0.1:<inbucket port> AUTH_E2E_DB_CONTAINER=supabase_db_<project_id> TEST_BASE_URL=http://127.0.0.1:3100 npx playwright test auth-email`.
  Covers desktop Chromium, Android (Pixel 7) and iPhone (WebKit) emulation.

## Native apps

Android App Links and iOS Universal Links include `/auth/confirm` (iOS through the AASA file, live on deploy;
Android needs a new app build). Until the Android build ships, verification links open in the browser,
which verifies the account; the person then signs in in the app.

## iPhone Universal Link release verification

The app now checks both warm-start `appUrlOpen` and cold-start `App.getLaunchUrl()`.
For this to work on a real iPhone, install a native build containing the associated-domains entitlement,
verify that Apple Developer App ID `app.zestsnap` has Associated Domains enabled, and ensure
`https://app.zestsnap.app/.well-known/apple-app-site-association` returns HTTP 200 with
`D64PWXTUJ5.app.zestsnap` (or the configured team ID) and the `/auth/confirm*` path.
After installing the new build, tap a fresh verification email in Apple Mail and Gmail and check that
it opens Zest Snap and completes verification. If Gmail keeps the URL inside its in-app browser,
verification still works there; sign in to the installed app afterward. Do not claim universal-link
handoff is verified solely from a simulator or web test.

For recovery, verify the link opens the reset-password form, not the home page, and that a used token
cannot be reused. Never embed auth tokens in diagnostic logs or analytics.
