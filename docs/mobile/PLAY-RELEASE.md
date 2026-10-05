# Google Play — first internal-testing release (Zest Snap 1.0.0, versionCode 1)

## Upload

- File: `android/app/build/outputs/bundle/release/app-release.aab` (built from `main`, signed with the upload key)
- Release name: `Zest Snap 1.0.0 - Internal Test`
- Release notes:

```
<en-GB>
Initial Zest Snap Android internal testing release.

Includes:
- AI-assisted date and event extraction
- Planner and To-Do
- reminders and native Android notifications
- Google Calendar integration
- native Android calendar handoff
- rewards
- PDF/data sharing
- offline recovery
- Android native navigation and device integration

This release is for internal testing before public launch.
</en-GB>
```

## Signing

- Upload key: `~/.zest-snap-signing/zest-upload.jks` (alias `upload`, RSA 2048, valid to 2056) — **outside the repo**.
  Back up the keystore and `upload-store-password.txt` together in a password manager.
- Play App Signing: accept Google-managed app signing when Play asks on first upload.
- App Links must use the **App signing key certificate** SHA-256 from
  Play Console → Test and release → Setup → App integrity → App signing — **not** the upload certificate.
  Then set `ANDROID_CERT_SHA256=<that SHA-256>` in Vercel (Production) and redeploy once;
  verify `https://app.zestsnap.app/.well-known/assetlinks.json`.

## Subscriptions (Play Console → Monetise with Play → Products → Subscriptions)

IDs the app expects (`lib/billing/config.ts`, overridable via `NEXT_PUBLIC_IAP_GOOGLE_*`):

| Subscription product ID | Base plan IDs | Plan |
| --- | --- | --- |
| `zestsnap_plus` | `monthly`, `annual` | Zest Snap+ |
| `zestsnap_business` | `monthly`, `annual` | Business |

RevenueCat: Android app `app.zestsnap` → Google Play service-account credentials → import products
(`zestsnap_plus:monthly`, …) → entitlements `plus` and `business` → current offering with Monthly/Annual packages →
webhook `https://app.zestsnap.app/api/billing/revenuecat` with an Authorization header value you also store as
`REVENUECAT_WEBHOOK_AUTH`. Vercel: `NEXT_PUBLIC_REVENUECAT_ANDROID_KEY` (public SDK key), `REVENUECAT_SECRET_API_KEY`
and `REVENUECAT_WEBHOOK_AUTH` (server-only). Activate the Plus/Business plans in Admin › Plans before selling them
(scanning requires an active plan).

## Policy forms (based on the implementation)

| Form | Recommended answer |
| --- | --- |
| App access | Some functionality is restricted → provide a reviewer test account (e-mail + password) that can sign in; guest mode also works without an account. |
| Ads | No, the app contains no ads. |
| Content rating | Utility/productivity; no violence, sexual content, gambling, user-to-user communication, or location sharing. Users can contact the developer (support), which is not user-to-user. |
| Target audience | 18+ recommended (the app isn't designed for children; avoids Families policy obligations). Your business decision. |
| News app | No. |
| Government app / Financial features / Health | No. |
| Exact alarms (`SCHEDULE_EXACT_ALARM`) | Core functionality: user-set reminders for calendar events, tasks and deadlines (calendar/reminder app). The app works without it (inexact scheduling) and lets users opt in from Settings. |
| Account deletion | In-app: Settings › Delete my account (deletes the account and cloud data). Web URL for the form: `https://app.zestsnap.app/settings` (sign in → Delete my account), or e-mail `privacy@zestsnap.app`. |
| Privacy policy | `https://zestsnap.app/privacy` |

### Data safety (what the code actually does)

Encrypted in transit: **Yes** (HTTPS only). Users can request deletion: **Yes** (in-app). Data sold: **No**.
Used for advertising/tracking: **No** (no ad or analytics SDKs).

| Data type | Collected | Shared* | Purpose | Optional? |
| --- | --- | --- | --- | --- |
| Email address | Yes | No | Account management | Required for accounts (guest mode needs none) |
| Name (display name) | Yes | No | App functionality, personalisation | Optional |
| User IDs | Yes | No | Account management, fraud prevention | Required for accounts |
| Device or other IDs (app-generated install ID, stored hashed) | Yes | No | Fraud prevention (free-scan abuse limits) | Required |
| Photos / Files and docs (images & PDFs you scan) | Yes, processed | No* | App functionality — processed to extract dates; originals are **not retained** | Optional (user-initiated) |
| Calendar events (Planner items, extracted events, Google Calendar events if connected) | Yes | No | App functionality | Optional |
| Other user-generated content (feedback, ratings) | Yes | No | App functionality, analytics (product improvement) | Optional |
| Other in-app messages (support tickets / problem reports) | Yes | No | Customer support | Optional |
| Purchase history (subscriptions, once billing is live) | Yes | No | App functionality | Optional |
| App interactions (daily activity, scan counts) | Yes | No | Analytics, fraud prevention | Required |
| Crash logs / diagnostics | No | — | — | — |
| Location, contacts, audio, health, financial info | No | — | — | — |

\* Processing by service providers on Zest Snap's behalf (Supabase hosting, OpenAI for document extraction, Vercel, RevenueCat/Google Play for billing) is **not** "sharing" under Play's definitions. Google Calendar sync sends events to Google only when the user connects their own Google account and asks for it (user-initiated transfer, also not "sharing").

## Store listing

- App name: **Zest Snap** · Short description (≤80): *Turn photos, screenshots and PDFs into calendar events, reminders and to-dos.*
- Category: **Productivity** · Contact e-mail: `support@zestsnap.app` · Website: `https://zestsnap.app`
- App icon: `mobile/store/play-icon-512.png` · Feature graphic: `mobile/store/feature-graphic-1024x500.png`
- Phone screenshots (min 2, 1080×1920+ portrait), current UI, no mock-ups: Home/scan · scan result review ·
  Planner · To-do · reminders (Planner › Reminders) · Rewards · Settings/Pro plans.

## Testing tracks

Internal testing: add testers (e-mail list or Google Group) and share the opt-in link. Personal developer accounts
created after Nov 2023 must run a **closed test with ≥12 testers for 14 days** before applying for production;
organisation accounts are exempt.
