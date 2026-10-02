# Zest Snap backend setup

Zest Snap should use its own dedicated Supabase project; do not share the StabiFlow production database.

## Environment variables

Add these to Vercel for Development, Preview and Production after the project exists:

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

The browser key is intentionally publishable. User data is protected by Row Level Security.

## Database

Apply `supabase/migrations/20261002_initial_product_schema.sql` to the dedicated project. Then run Supabase security and performance advisors.

The schema includes profiles, scans, extracted events, monthly usage metering, rewards ledger, referrals, calendar connections, subscriptions, feature flags and a private scan-source storage bucket.

## Admin

Admin access is represented by `profiles.is_admin`. The first owner should be promoted only after their authenticated user exists. Do not expose service-role or secret keys to the browser.

## OpenAI

`OPENAI_API_KEY` remains server-side in Vercel. AI usage must be metered before public launch.
