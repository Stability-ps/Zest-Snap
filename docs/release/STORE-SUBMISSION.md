# Zest Snap 1.0.0 (7) — store submission package

Derived from the code on `main` (Capacitor shell loading `https://app.zestsnap.app/app`). Disclosures list only what the
code does. Anything marked **OWNER** needs the account owner (legal, payment, console access).

## Shared listing copy

- **App name:** Zest Snap
- **Subtitle (iOS, ≤30):** Photos & PDFs to your planner
- **Short description (Play, ≤80):** Turn photos, screenshots and PDFs into calendar events, reminders and to-dos.
- **Promotional text (iOS, ≤170):** Snap a letter, invite or timetable and Zest finds the dates. Review, then save to your Planner, set reminders and add to your calendar.
- **Keywords (iOS, ≤100):** planner,calendar,scan,reminders,to-do,timetable,school,schedule,events,dates,pdf,organiser
- **Category:** Productivity (secondary: Utilities)
- **Website / marketing URL:** https://zestsnap.app
- **Support URL:** https://zestsnap.app (contact form in Settings › Contact support; e-mail support@zestsnap.app)
- **Privacy policy URL:** https://zestsnap.app/privacy
- **Terms URL:** https://zestsnap.app/terms

### Description

```
Zest Snap turns anything with a date into a plan.

Take a photo or upload a screenshot or PDF — a school letter, invitation, booking, appointment card,
exam timetable or meal schedule — and Zest Snap finds the events, deadlines and times in it.
You review every result before anything is saved.

CAPTURE
• Camera, photo library and PDF upload
• Flags unclear or missing dates instead of guessing

PLAN
• Planner with Today, Upcoming and Calendar views
• To-dos with due dates
• Plan with Zest: say or type your plans and review the suggested events
• Class timetables become weekly recurring classes for the term you choose
• Meal plans by day and meal

STAY ON TRACK
• Reminders on your phone, even when the app is closed
• Smart follow-ups that help you prepare for upcoming plans
• Optional Daily Briefing

SHARE
• Share an event or a whole plan with family, classmates or a team
• Owner, editor and viewer roles; remove access at any time

CALENDAR
• Add events to your phone's calendar — you confirm each one
• Optional Google Calendar connection

Free plan includes monthly AI scans. Zest Snap+ adds more AI scans each month and longer PDFs.
Earn bonus scan credits through rewards and invites.
```

### Subscription disclosure (shown in-app above purchase and in the listing)

```
Zest Snap+ and Business are auto-renewing subscriptions (monthly or annual). Payment is charged to your
App Store / Google Play account at confirmation of purchase. The subscription renews automatically unless
cancelled at least 24 hours before the end of the current period. Manage or cancel in your App Store /
Google Play account settings (Settings › Plans › Manage subscription in the app). Prices are shown in the app
in your local currency. Terms: https://zestsnap.app/terms · Privacy: https://zestsnap.app/privacy
```

### Release notes (1.0.0)

```
Welcome to Zest Snap. Snap a photo, screenshot or PDF and turn the dates in it into Planner events,
reminders and to-dos — or just say what you need with Plan with Zest.
```

## Permissions rationale

| Permission | Platform | Used for | When requested |
| --- | --- | --- | --- |
| Camera | both | Photographing documents to scan | First tap on Take photo |
| Photos (system picker) | both | Choosing an image to scan | iOS picker; Android photo picker needs no permission |
| Microphone + Speech recognition | both | Plan with Zest voice input | First tap on the mic; typing works without it |
| Notifications | both | Reminders the user sets, Daily Briefing | Only when the user taps Enable |
| Exact alarms (`SCHEDULE_EXACT_ALARM`) | Android | On-time reminders the user sets (calendar/reminder functionality) | Opt-in from Settings; inexact without it |
| Calendar (write-only) | iOS | Adding an event the user confirms in the system editor | Android uses the system editor with no permission |
| Billing | Android | Google Play subscriptions | Never prompts |

## Google Play — Data safety

Encrypted in transit: **Yes**. Deletion: **Yes**, in-app (Settings › Delete my account) and by e-mail
privacy@zestsnap.app. Data sold: **No**. Ads / tracking SDKs: **None**.

| Data type | Collected | Shared | Purpose | Required |
| --- | --- | --- | --- | --- |
| Email address | Yes | No | Account management | Accounts only (guest mode needs none) |
| Name | Yes | No | Personalisation | Optional |
| User IDs | Yes | No | Account management, fraud prevention | Accounts only |
| Device or other IDs (app-generated install ID, hashed server-side) | Yes | No | Fraud prevention (free-scan limits) | Yes |
| Photos; Files and docs | Yes (processed, originals not stored) | No | App functionality | User-initiated |
| Calendar events (Planner, extracted, Google Calendar if connected) | Yes | No | App functionality | Optional |
| Other user-generated content (voice-plan text, shared plans, feedback) | Yes | No | App functionality | Optional |
| Audio | **No** — speech is turned into text by the phone's own recogniser; Zest receives only the text | — | — | — |
| Other in-app messages (support tickets) | Yes | No | Customer support | Optional |
| Purchase history | Yes | No | App functionality | Subscribers only |
| App interactions | Yes | No | Analytics, fraud prevention | Yes |
| Crash logs, location, contacts, health, financial info | No | — | — | — |

Service providers acting for Zest Snap (Supabase, Vercel, OpenAI, RevenueCat, Google Play) are not "sharing".
Google Calendar sync is a user-initiated transfer to the user's own account.

**Other Play forms:** Ads: No · App access: provide the reviewer account below · Content rating: Utility/Productivity, no
user-to-user public content (Shared plans are private invite-only groups — answer "users can interact/share content
with invited people") · Target audience: 18+ recommended (OWNER decision) · News/Government/Financial/Health: No ·
Exact alarm declaration: calendar/reminder core functionality.

## App Store — App Privacy

Tracking: **No**. Data linked to the user (none used for tracking):

| Apple category | Data | Purpose |
| --- | --- | --- |
| Contact Info | Email address, Name | App Functionality |
| Identifiers | User ID; Device ID (app-generated install ID) | App Functionality (fraud prevention) |
| User Content | Photos or Videos, Other User Content (documents, voice-plan text, plans), Customer Support | App Functionality |
| Purchases | Purchase History | App Functionality |
| Usage Data | Product Interaction | Analytics, App Functionality |

Not collected: Audio Data (on-device/OS speech recognition returns text only), Location, Contacts, Health, Financial
Info, Browsing History, Diagnostics.

**Export compliance:** HTTPS only — `ITSAppUsesNonExemptEncryption = NO` (already in Info.plist).
**Age rating:** 4+ answers (no objectionable content); "Unrestricted web access": **No** (WebView is locked to the app's
own host); user-generated content limited to private invite-only sharing.
**Sign in with Apple:** not required (e-mail/password only, no third-party login).
**Account deletion:** in-app (Settings › Delete my account). ✔

### App Review notes (paste into App Store Connect / Play "App access")

```
Zest Snap is a planner that extracts dates from photos, screenshots and PDFs (AI-assisted, reviewed by the
user before saving). Guest mode works without an account; sign in to save to the cloud, share plans and subscribe.

Demo account: <OWNER: create a dedicated reviewer account, e.g. review@zestsnap.app, with a few saved plans>
Password: <OWNER>

To test scanning: Home › camera card › Upload, choose any image or PDF with a date (e.g. an invitation).
To test voice: Home › Plan with Zest › tap the mic (or type) › "Dentist next Tuesday at 3pm" › Review.
Subscriptions: Settings › Plans. Restore Purchases and Manage subscription are on the same sheet.
Account deletion: Settings › Delete my account.
```

## Screenshots required

- **iPhone 6.9"** (1320×2868) and **6.5"** (1284×2778): Home · Scan review · Planner (Today) · Calendar · Plan with Zest ·
  Shared plan · Reminders · Plans. Add **iPad 13"** only if iPad support stays enabled (the target currently includes iPad).
- **Play phone:** 2–8 portrait screenshots ≥1080×1920, same set. Tablet screenshots optional.
- **Play feature graphic:** `mobile/store/feature-graphic-1024x500.png` · **Play icon:** `mobile/store/play-icon-512.png`
- Capture from a real device on the production build; no device frames with text that overstates features.

## Rollout recommendation

Play: Internal testing (build 7) → Closed testing (personal developer accounts: ≥12 testers for 14 days) → Production with
a staged rollout (20% → 100%). iOS: TestFlight internal → external group → App Review → phased release.
