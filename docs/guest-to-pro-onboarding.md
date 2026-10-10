# Zest Snap guest-to-account-to-paid onboarding (implementation contract)

Status: DESIGN APPROVED; implementation pending. Do not merge until all tests pass.

## Customer journey
1. Guest may perform exactly three **successful** AI scans per device. Failed, cancelled, or abandoned scans do not count. Server is the authority. Never unlock scans solely by editing local storage.
2. After the third successful guest scan, allow the result and saving to finish. On the next scan attempt, present the premium upgrade screen; optionally show a dismissible invitation after scan three. No interruption before saving.
3. Guest offer: primary action opens available paid tiers and genuine store prices; secondary action says **Create a free account — get 3 scans**. Existing guest history remains available.
4. After new account email verification and authenticated sign-in, show the approved premium pricing page **once per newly registered account**, even if verification completes on another device. Secondary action **Continue with Free plan**.
5. Choosing Free grants the existing configured registered Free allowance independently of guest scans; current database migration describes **3 scans per month**, not lifetime. Do not grant an extra three every login. Transfer guest history once, idempotently.
6. Choosing paid uses existing Plus/Business plan IDs, native RevenueCat/Apple/Google billing, restore purchases, and server-verified entitlements. Do not label plans as Pro in the database or hardcode mockup ZAR prices.
7. Existing accounts, paid subscribers, email changes, password recovery and previously verified users must not see a new-account onboarding paywall. Store onboarding completion server-side per user, not only localStorage. The paywall must be dismissible.
8. Keep Home, bottom navigation and other existing UI unchanged. Paywall only in onboarding and limit reached flow, and upgrade entry point in Settings.
9. Native store availability and country-specific billing disclosures must be accurate; on web with no checkout configured, don't show a broken buy button. Annual plan should display billed yearly total and effective monthly amount only if calculated from actual store offers.
10. Terms, Privacy and Restore Purchases links work; support dark/light appearance and small screens; no layout overflow.

## Security and correctness
- Diagnose guest off-by-one bug at reserve_guest_scan, finish_guest_scan, device identity, UI counter and concurrency boundaries. Test three success and fourth refusal, including parallel requests and failed reservations.
- Preserve abuse protections and per-device quotas; don't allow guest-to-account credit farming through repeated signups.
- Never infer successful verification from query parameters alone; use Supabase verified session.
- Persist onboarding state on server with RLS and idempotent migration. Do not trust client-only flags for entitlements.
- Check production plan_rules before changing allowance; migration 20261015120000_free_plan_three_scans.sql only updates untouched seed.
- Existing profiles, guest scan data and subscriptions must not be overwritten.

## Conversion analytics (privacy-conscious)
Events: guest_scan_completed (number 1/2/3), guest_limit_reached, paywall_viewed (context guest_limit/post_verification/free_limit/settings), paywall_plan_selected, free_account_started, signup_verified, free_continued, checkout_started, checkout_completed, checkout_failed, purchase_restored. Deduplicate and avoid PII in event properties. Track account and paid conversion cohorts separately.

## Acceptance tests
- 3 successful guest scans; 4th blocked; failed scan refunded.
- Guest history and credits survive sign-up, including cross-browser verification.
- New verified account sees paywall once, free option works and remains usable.
- Existing login and reset password never trigger first-time paywall.
- Returning paid user bypasses onboarding; restores entitlements correctly.
- Monthly and annual offers reflect live local prices; unavailable checkout gracefully disabled.
- Free plan uses configured monthly allowance, independent of guest usage.
- iOS, Android, PWA, light/dark, offline and narrow viewport smoke tests.
- Unit, integration, CI and production authenticated smoke tests required before merge/deploy.

Design reference: https://www.figma.com/design/1p18VLiAyNAZQJ8Kn2ydJT
