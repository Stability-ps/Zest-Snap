# Zest Snap — iOS & Android apps (Capacitor)

One product, one codebase: the existing Next.js app + Supabase backend, wrapped by a Capacitor 8 native shell.

| Output | Where it comes from |
| --- | --- |
| Web / PWA | `app/` deployed on Vercel (`zestsnap.app`, `app.zestsnap.app`) |
| iOS app | `ios/` Xcode project, bundle id **`app.zestsnap`** |
| Android app | `android/` Gradle project, application id **`app.zestsnap`** |

## Architecture — why the apps load the live site

Zest Snap depends on server-side Next.js: AI extraction (`/api/extract`), auth callbacks, billing/webhooks, Google Calendar
OAuth and the admin console. A static export would remove all of that, so the native shell loads
`https://app.zestsnap.app/app` (`server.url` in `capacitor.config.ts`) and adds native capabilities on top.

```
Native shell (Swift/Kotlin + Capacitor plugins)
  └─ WKWebView / Android WebView → https://app.zestsnap.app   (same code as web/PWA)
        └─ lib/native/*  ── calls plugins only when runtime() is "ios" | "android"
```

Consequences to keep in mind:
- **Web changes ship to the apps instantly** with the next Vercel production deploy — no store review for UI fixes.
- **Native changes** (plugins, permissions, icons, Swift/Kotlin) need a new store build.
- The bundled `mobile/www/` holds only a boot page and a branded **offline/retry page** (`server.errorPath`), so people never see
  a raw WebView error when the server is unreachable.

### Platform code is isolated

| Service | File | Web / PWA | iOS / Android |
| --- | --- | --- | --- |
| Runtime detection | `lib/native/runtime.ts` | `web` / `pwa` | `ios` / `android` |
| Bridge (lifecycle, back, deep links, splash, status bar, keyboard) | `app/native-bridge.tsx` | no-op | active |
| Camera / photos | `lib/native/camera.ts` | `<input capture>` | `@capacitor/camera` (quality 90, ≤3000px, EXIF-corrected) |
| Calendar | `lib/native/calendar.ts`, `calendar-event.ts` | Google Calendar handoff (unchanged) | system “New event” editor (`@ebarooni/capacitor-calendar` prompt) — **no calendar permission** |
| Notifications | `lib/native/notifications.ts` (+ `lib/reminders.ts` seam) | Web Push (unchanged) | OS-scheduled local notifications mirrored from server reminders |
| Share / files | `lib/native/share.ts` | Web Share / download | Filesystem cache + native share sheet (preview, Save to Files/Drive, Print) |
| Billing | `lib/native/billing.ts`, `lib/billing/*`, `/api/billing/*` | not connected (honest copy) | App Store / Google Play via RevenueCat, verified server-side |
| Permissions | `lib/native/permissions.ts` + first-party `ZestNative` plugin | — | status, recovery copy, “Open Settings” |
| Haptics | `lib/native/haptics.ts` | — | scan done, to-do completed, calendar add, purchase |
| Voice (Plan with Zest) | `lib/native/speech.ts` | Web Speech API where the browser has it; typing otherwise | system recogniser via `@capgo/capacitor-speech-recognition` (mic + speech permission on first use) |

Never sniff user agents — always use `runtime()` / `isNative()` / `hasPlugin()`.

## Setup

Requirements: Node 24, Xcode 16+ (iOS 15+ deployment target), Android Studio with SDK 36, JDK 21.

```bash
npm install
npm run mobile:sync            # writes the server URL into mobile/www and runs `cap sync`
npm run mobile:open:ios        # opens ios/App/App.xcodeproj
npm run mobile:open:android    # opens android/ in Android Studio
npm run mobile:android         # sync + run on a connected device/emulator
npm run mobile:ios             # sync + run on a simulator/device
```

### Testing web changes on a device before deploying

```bash
npm run dev -- -p 3100
CAP_SERVER_URL=http://localhost:3100/app npm run mobile:sync android
adb reverse tcp:3100 tcp:3100          # Android emulator/device → this Mac
npm run mobile:android
# iOS simulator shares the Mac network: CAP_SERVER_URL=http://localhost:3100/app npm run mobile:sync ios
npm run mobile:sync                    # ALWAYS re-sync to production before committing or building a release
```
Debug builds expose the WebView to Chrome DevTools (`chrome://inspect`) and Safari Web Inspector.

## Versioning

`mobile/version.json` is the single source of truth (`version` + `build`).

```bash
npm run mobile:version -- 1.1.0      # new version, build +1
npm run mobile:version               # same version, build +1 (resubmission)
```
It updates `package.json`, Android (`versionName`/`versionCode` are read from `mobile/version.json` by Gradle) and
iOS (`MARKETING_VERSION` → `CFBundleShortVersionString`, `CURRENT_PROJECT_VERSION` → `CFBundleVersion`).
Build numbers must always increase for both stores.

## Builds

```bash
npm run mobile:build:android
# → android/app/build/outputs/apk/debug/app-debug.apk        (direct device testing)
# → android/app/build/outputs/bundle/release/app-release.aab (Play upload; signed when keystore.properties exists)
```
The build regenerates the generic `ic_launcher*`/`splash*` resources, but the app does not use them: the launcher and
splash point at the hand-tuned `zest_*_v6` resources (`AndroidManifest.xml`, `styles.xml`), which generation never
overwrites. Discard the regenerated files after a build unless the source artwork in `mobile/assets/` changed.
Release signing: the upload key lives **outside the repository** (e.g. `~/.zest-snap-signing/zest-upload.jks`, owner-only
permissions) and `android/keystore.properties` (git-ignored) points to it:
```
storeFile=/Users/<you>/.zest-snap-signing/zest-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```
Back up the keystore and its password together in a password manager. Losing the upload key means asking Google
for an upload-key reset (Play App Signing keeps the app signing key, so the app itself is never lost).
Use **Play App Signing**; this key is only the upload key. Release builds use R8 (`minifyEnabled`, `shrinkResources`) with
keep-rules for Capacitor and plugins in `android/app/proguard-rules.pro`.

iOS: set the Team in Xcode › Signing & Capabilities (automatic signing), then Product › Archive → Distribute → TestFlight,
or `npm run mobile:build:ios` on a Mac with signing configured. No signing material is committed.

## Deep links & auth

- Custom scheme: `zestsnap://app?view=planner`, `zestsnap://settings` (Android + iOS).
- Universal Links / App Links for `https://app.zestsnap.app/{app,auth/callback,reset-password,login,settings,share,shared}`
  (`/share/<token>` invitations open in the app, where the recipient is signed in):
  - iOS: `App.entitlements` → `applinks:app.zestsnap.app`; the site serves `/.well-known/apple-app-site-association`
    when **`APPLE_TEAM_ID`** is set in Vercel. Team: **D64PWXTUJ5** (Stability Group (Pty) Ltd), also the Xcode
    `DEVELOPMENT_TEAM`. The `app.zestsnap` App ID needs the Associated Domains capability in that team.
  - Android: `autoVerify` intent filter; the site serves `/.well-known/assetlinks.json` when **`ANDROID_CERT_SHA256`**
    (Play App Signing SHA-256, comma-separated) is set.
- `lib/native/deep-links.ts` only routes Zest Snap URLs; auth callbacks get a full navigation so the server can exchange the code.
- Supabase: confirmation/reset e-mails already redirect to `https://app.zestsnap.app/...`. Once the association files are
  live those links open the app; until then they open the browser (the person can sign in there, or in the app).
- Sessions live in WebView cookies (Supabase SSR). Android flushes cookies on pause/stop (`MainActivity`) so swipe-away or an
  OS kill never signs people out. Backups/device transfer of app data are disabled (`data_extraction_rules.xml`).

## Notifications

- Reminders are created exactly as before (server `reminders` table for accounts; local list for guests).
- In the apps, `app/native-bridge.tsx` mirrors pending future reminders into **OS-scheduled local notifications**
  (diffed on every change, on resume and on launch; max 60 for iOS' 64 limit). They fire with the app closed;
  Android re-arms them after reboot. Actions: **Done** and **Snooze 10 min** update the server; tapping opens the reminder.
- Permission is requested only when the person taps **Enable** on a reminder screen. Blocked → “Open Settings”.
- Android 12+: exact timing needs “Alarms & reminders” access. Zest Snap never forces it; it schedules inexactly
  (may shift a few minutes in deep doze) and offers **Settings › App › Precise reminder timing**.
- Web Push (PWA) is unchanged. After arming, the app reports `{id, at}` for each armed reminder
  (`mark_reminders_device_armed`, migration `20261007090000_native_reminder_delivery.sql`). When the delivery job reaches a reminder
  that this account's device armed for its current time, `complete_push_reminder` records it as `sent` with
  `delivered_via = 'device'` instead of retrying into `failed / no_push_subscription`; web-push deliveries record `web_push`.
  A reminder snoozed/rescheduled elsewhere after arming isn't credited until a device re-arms it.
  Remote push (FCM/APNs) for server-originated alerts can be added later with `@capacitor/push-notifications`.

## Calendar

Device calendar ≠ Google Calendar. In the apps, “Calendar” (scan review and Planner cards) opens the system event editor
pre-filled (title, start/end in the event's timezone, all-day, location, notes, alerts on iOS). The person picks the calendar
and confirms. Google Calendar OAuth sync stays a separate, flag-controlled feature (`direct_google_calendar`) and is not used
by the apps' device calendar path. Note: Google's OAuth consent opens in the system browser, so connecting Google Calendar
from inside the app would land back in the browser — keep that flag off for app users until an in-app OAuth flow is added.

## Subscriptions

Apple and Google require their own billing for digital subscriptions bought in the apps. Architecture:

```
App (StoreKit / Play Billing via RevenueCat SDK, appUserID = Supabase user id)
   └─ purchase/restore → POST /api/billing/sync ─┐
RevenueCat webhook → POST /api/billing/revenuecat ┤→ GET RevenueCat REST (server secret) → entitlementFromSubscriber()
                                                  └→ subscriptions (provider app_store|play_store|web) + profiles.plan
```
- The client's success callback never grants anything; the server re-reads RevenueCat (which validated the receipt with Apple/Google).
- A store purchase never activates a plan that's inactive in `plan_rules` (scanning requires an active plan) — activate Plus/Business
  in Admin › Plans before launching subscriptions.
- Lapsed store subscriptions downgrade only plans that a store subscription granted (never admin- or web-granted plans).
- Restore: **Restore Purchases** (iOS) / **Restore purchases** (Android) in Settings › Plans.

Configuration (Vercel env; public values are safe in the client, secrets are server-only):

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_REVENUECAT_IOS_KEY` / `NEXT_PUBLIC_REVENUECAT_ANDROID_KEY` | public | RevenueCat SDK keys (empty → purchases disabled, honest “opens soon” copy) |
| `NEXT_PUBLIC_IAP_APPLE_{PLUS,BUSINESS}_{MONTHLY,ANNUAL}` | public | App Store product IDs (defaults `app.zestsnap.plus.monthly` …) |
| `NEXT_PUBLIC_IAP_GOOGLE_{PLUS,BUSINESS}_{MONTHLY,ANNUAL}` | public | Play subscription:base-plan IDs (defaults `zestsnap_plus:monthly` …) |
| `NEXT_PUBLIC_RC_ENTITLEMENT_{PLUS,BUSINESS}` | public | RevenueCat entitlement ids (default `plus`, `business`) |
| `REVENUECAT_SECRET_API_KEY` | **server only** | REST v1 secret key used by `/api/billing/*` |
| `REVENUECAT_WEBHOOK_AUTH` | **server only** | Authorization header value configured on the RevenueCat webhook |
| `APPLE_TEAM_ID` | server | Enables the Universal Links association file |
| `ANDROID_CERT_SHA256` | server | Enables Android App Links verification |

Store product configuration lives in `lib/billing/config.ts`. Prices shown in the app come from the store (localised); plan names and
allowances from `plan_rules`.

## Analytics & Admin

`record_activity(platform, app_version)` (migration `20261006090000_native_platform_analytics.sql`) tags daily activity with
`web | pwa | ios | android` and the build, and Admin › Activity shows active people by platform and paid subscriptions by
source (App Store / Google Play / web). Support tickets and problem reports include the platform + build.

## Security review (native)

- No service-role/secret keys anywhere in the client, the native projects or `capacitor.config.ts` (enforced by `tests/native.test.ts`).
- HTTPS only in production (`capacitor.config.ts` refuses a non-HTTPS production URL); cleartext only for explicit local testing.
- Navigation is limited to the app's own host; other sites open in the system browser.
- Minimal permissions — Android: INTERNET, CAMERA, READ_EXTERNAL_STORAGE (≤ Android 12), POST_NOTIFICATIONS,
  RECEIVE_BOOT_COMPLETED, SCHEDULE_EXACT_ALARM (opt-in), VIBRATE (+ BILLING / network state from plugins).
  RECORD_AUDIO is added only by the speech plugin and requested the first time someone taps the mic in Plan with Zest.
  No calendar, contacts, location or broad media permissions. iOS purpose strings are specific (camera, photos, calendar
  write-only, microphone and speech recognition for Plan with Zest).
- Tokens are not logged; the session stays in WebView cookie storage (OS-sandboxed, excluded from backups).

## Store readiness checklist

### Apple (App Store Connect / TestFlight)
- [ ] Apple Developer Program membership; App ID `app.zestsnap` with **Associated Domains** capability
- [ ] Set `APPLE_TEAM_ID` in Vercel → verify `https://app.zestsnap.app/.well-known/apple-app-site-association`
- [ ] Create the app in App Store Connect (name “Zest Snap”, primary language, bundle ID)
- [ ] Signing: automatic signing with your Team in Xcode (nothing committed)
- [ ] Subscriptions: subscription group + Plus/Business products (IDs in `lib/billing/config.ts`), RevenueCat project + App Store
      Connect API key / shared secret, entitlements `plus`/`business`, webhook → `https://app.zestsnap.app/api/billing/revenuecat`
- [ ] App Privacy: e-mail, user ID, user content (photos/documents processed, not retained), purchases, product interaction; no tracking
- [ ] Age rating questionnaire; Export compliance answered (HTTPS only — `ITSAppUsesNonExemptEncryption=false`)
- [ ] Screenshots 6.9" + 6.5" (and iPad if you keep iPad support), description, keywords, support URL, privacy URL (`/privacy`)
- [ ] Reviewer notes + a demo account; mention Restore Purchases location (Settings › Plans)
- [ ] **Sign in with Apple:** not required today — Zest Snap only offers e-mail/password. If Google/Facebook sign-in is ever added
      to the app, Apple guideline 4.8 requires an equivalent privacy-preserving option (e.g. Sign in with Apple).
- [ ] Account deletion is available in-app (Settings › Delete my account) ✔

### Google (Play Console)
- [ ] Create app, package `app.zestsnap`; enrol in Play App Signing; upload `app-release.aab`
- [ ] Set `ANDROID_CERT_SHA256` (App signing key SHA-256) in Vercel → verify `/.well-known/assetlinks.json`
- [ ] Data safety form (as above); content rating; target audience; ads: none
- [ ] Permissions declaration: `SCHEDULE_EXACT_ALARM` (reminders the user sets — allowed for calendar/reminder functionality)
- [ ] Subscriptions + base plans (IDs in `lib/billing/config.ts`), RevenueCat Play service-account credentials, real-time developer notifications
- [ ] Screenshots, feature graphic, description, privacy URL
- [ ] Internal testing track → closed testing (required for new personal accounts: 12 testers × 14 days) → production

## Mobile QA checklist (real devices)

Run on one current iPhone (Dynamic Island) and one Android phone (gesture nav), plus one older Android (WebView < 140).

- [ ] Cold launch: navy splash → Home, no white flash, no browser chrome; status bar icons readable
- [ ] Sign up → confirmation e-mail link opens the app (after association files are live) · sign in · sign out · switch account
- [ ] Kill the app (swipe away) and reopen → still signed in; leave in background 1h+ → resumes, data refreshes
- [ ] Password reset e-mail → reset screen
- [ ] Take photo (grant / deny / “don't ask again” → Settings), choose from library, PDF upload, large image, rotated photo
- [ ] Scan review → Calendar → system editor pre-filled (timezone correct) → saved in the chosen calendar
- [ ] Planner card → Calendar (event, task, deadline); To-do complete (haptic)
- [ ] Reminder: Enable notifications from Planner → reminder fires with the app closed; Done / Snooze 10 min; tap opens reminder;
      reboot (Android) and the reminder still fires; disable notifications in OS → Settings shows Blocked + Open Settings
- [ ] Settings › Export my data → PDF share sheet → Save to Files/Drive; JSON export
- [ ] Rewards: feedback, invite (native share sheet), credits
- [ ] Settings › Plans: prices from the store, purchase (sandbox/test track), Restore, cancel in store → plan reverts after expiry
- [ ] Contact support / Report a problem (keyboard never covers the field or Send)
- [ ] Android back: closes sheets first, then navigates back, then backgrounds the app (never kills it)
- [ ] Airplane mode on launch → branded offline page → Try again after reconnecting
- [ ] Rotation: portrait on phones; iPad (if kept) all orientations usable
- [ ] Deep links: `zestsnap://app?view=planner` and an `https://app.zestsnap.app/app?...` link from Notes/Messages

## What still needs manual configuration

- Apple: Team ID, App Store Connect app, signing, products, RevenueCat, App Privacy, screenshots, TestFlight.
- Google: Play Console app, upload key + Play App Signing, products, RevenueCat, Data safety, testers.
- Vercel env: `APPLE_TEAM_ID`, `ANDROID_CERT_SHA256`, RevenueCat keys/secrets (see table above).
- Supabase: confirm `https://app.zestsnap.app/**` is in Auth › URL configuration › Redirect URLs (already used by the web app).
- Migrations `20261006090000_native_platform_analytics.sql` (applied) and `20261007090000_native_reminder_delivery.sql` (device delivery status).

## Android adaptive icon: known tradeoff

`zest_launcher_foreground_v6` draws the card at scale 1.24 so it reads large inside Samsung's squircle mask. On masks
that show a centred circle (Pixel), the visible radius is 1/3 of the 108dp canvas, while the card's rounded corners reach
about 0.41, so the corners are cropped. Fitting the circle needs a scale of about 1.0, which shrinks the mark by ~19%
everywhere. This is an approved branding choice; change it only after checking real Samsung and Pixel devices.
