# Marketing notifications (OneSignal)

Existing OneSignal app **6cc98d02-4051-47bf-948a-5d515d3896a6** — no other OneSignal app or account is used.

## What it does
- **Opt-in only.** Settings › Preferences › *Tips and offers* (shown when `NEXT_PUBLIC_MARKETING_PUSH=on`).
  Nothing from OneSignal loads, and no data is sent to it, until someone turns it on. Consent is recorded in
  `marketing_consent` (time, platform); turning it off withdraws consent before anything else.
- **Separate from reminders.** Reminders keep using `push_subscriptions`/VAPID on the web and local notifications in
  the apps; nothing here changes them. OneSignal's web worker has its own scope (`/push/onesignal/`); the app's
  `/sw.js` keeps `/app`.
- **Shared with OneSignal:** the Zest user id (as `external_id`) and the device's push subscription. No email, name
  or content. Notifications are addressed by `external_id`.
- **Campaigns** (Admin › Campaigns, all start off): credits earned · free scans used up this month · inactive for N
  days (active within 45). Copy and in-app destination are editable; changes are audited.
- **Frequency limits** (`app_limits`, editable): ≥72 h apart, ≤2 per 7 days, none 21:00–09:00 in the person's
  timezone. Each person gets a campaign at most once per period (reward / month / quiet stretch).
- **Delivery:** hourly Vercel cron → `/api/cron/marketing` (CRON_SECRET) → `claim_marketing_sends` (eligibility,
  consent, caps, quiet hours; atomic) → OneSignal REST API with `idempotency_key` = send id → `finish_marketing_send`.
- **Deep links:** `/app?…&mc=<send id>`; opening records `opened_at` (`record_marketing_open`, recipient only).
  Apps route taps in-app (`data.path`); web opens `web_url`.
- **Reporting:** sent, not delivered (no device), failed, opened, came back within 3 days; opt-ins by platform.

## Setup (owner) — in this order
1. **Supabase:** apply `supabase/migrations/20261018090000_marketing_notifications.sql` (registered "pending";
   follow `supabase/MIGRATION_HISTORY.md`).
2. **OneSignal › Settings › Push & In-App › Web:** Typical site, Site URL `https://app.zestsnap.app`, default icon;
   *Advanced*: service worker path `push/onesignal/OneSignalSDKWorker.js`, scope `/push/onesignal/`, "Customize
   service worker paths" on. (Today the app reports "This app is not configured for web push".)
3. **OneSignal › Apple iOS (APNs):** upload an APNs Auth Key (.p8, Key ID, Team ID `D64PWXTUJ5`, bundle `app.zestsnap`).
   In Apple Developer, enable **Push Notifications** on the `app.zestsnap` App ID.
4. **OneSignal › Google Android (FCM):** upload a Firebase service-account JSON for a Firebase project with the
   Android app `app.zestsnap`.
5. **Vercel › zest-snap › Environment Variables (Production, Sensitive):**
   `ONESIGNAL_REST_API_KEY` = OneSignal › Settings › Keys & IDs › an **App API key** (never the Organization key),
   `CRON_SECRET` = a long random value, `NEXT_PUBLIC_MARKETING_PUSH` = `on` (after steps 2–4).
6. **New native builds** (the apps need the OneSignal plugin and the push entitlement): TestFlight / Play internal
   testing — only with explicit approval.
7. Admin › Campaigns: check "Delivery setup" is all green, then switch on one campaign at a time.

## Decisions for the owner
- **Privacy policy:** add OneSignal as a processor for people who opt in to *Tips and offers* (user id and push
  token; opt-out in Settings). Draft wording for legal review:
  > *Optional marketing notifications.* If you turn on Tips and offers, we use OneSignal (OneSignal, Inc.) to send
  > occasional notifications about rewards and your plan. We share your Zest user id and your device's notification
  > token with OneSignal for this purpose only. Turn it off any time in Settings › Tips and offers.
- **PR #73 (native push with APNs/FCM directly):** two remote-push SDKs in one app conflict over the device token and
  notification delegate. Recommendation: deliver all native remote push (Daily Briefing, Shared messages) through
  OneSignal and close #73's native-SDK part.
