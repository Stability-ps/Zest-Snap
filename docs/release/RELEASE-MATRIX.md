# Release matrix — Zest Snap 1.0.0 (7), 2026-10-07

PASS = verified in this pass (unit/DB/browser tests, production probes or builds).
FAIL = defect found; every FAIL from this pass was fixed (see "Fixed in this pass").
DEVICE = BLOCKED — NEEDS PHYSICAL DEVICE. STORE = BLOCKED — NEEDS STORE ACCOUNT ACTION.
A simulated browser never counts as a device result.

| Case | Web | PWA | Android | iOS |
| --- | --- | --- | --- | --- |
| Signed out (guest scan trial, local Planner) | PASS (browser suite) | DEVICE (install) | DEVICE | DEVICE |
| Signed in Free (allowance, credits, refunds) | PASS (DB + unit) | PASS (same web code) | DEVICE | DEVICE |
| Subscribed user | STORE (no live products) | n/a (web checkout not offered) | STORE | STORE |
| Offline / poor network (offline shell, queued Planner) | PASS (browser suite) | DEVICE | DEVICE | DEVICE |
| Denied / allowed permissions | n/a | DEVICE | DEVICE | DEVICE |
| New / existing account, account switch | PASS (cache isolation tests) | DEVICE | DEVICE | DEVICE |
| Scanner image | PASS (mocked AI) | DEVICE camera | DEVICE camera | DEVICE camera |
| PDF (page limit, validation) | PASS | PASS | DEVICE | DEVICE |
| Timetable (weekly recurrence, term range, RLS) | PASS (unit + RLS) | PASS | DEVICE | DEVICE |
| Meals (structured storage, RLS) | PASS (unit + RLS) | PASS | DEVICE | DEVICE |
| Voice planning | PASS (typed path, rate limit) | DEVICE (mic) | DEVICE (native recogniser, build 7) | DEVICE (native recogniser, build 7) |
| Planner / To-Do / Calendar view | PASS | PASS | DEVICE | DEVICE |
| Shared (roles, invites, revoke, leave, delete) | PASS (RLS + definer audit) | PASS | DEVICE (share sheet) | DEVICE (share sheet) |
| Reminders | PASS (server, web push config) | DEVICE (push delivery) | DEVICE (local notifications) | DEVICE |
| Device calendar | n/a (Google handoff / ICS) | n/a | DEVICE (system editor) | DEVICE |
| Google Calendar | PASS (unit; deleted-event re-sync fixed) | PASS | Flag off in apps by design | Flag off in apps by design |
| Rewards (once-only, abuse caps) | PASS (DB tests) | PASS | DEVICE | DEVICE |
| Subscription UI (plans, restore, manage) | PASS (honest "not available" copy) | PASS | STORE | STORE |
| Settings (region, timezone, export, delete) | PASS | PASS | DEVICE | DEVICE |
| Export (PDF/JSON) | PASS (export tests) | DEVICE share sheet | DEVICE | DEVICE |
| Notification deep link | PASS (reminder URL tests) | DEVICE | DEVICE | DEVICE |
| Universal / App Links | PASS (AASA + assetlinks served in prod) | n/a | DEVICE (verify) | DEVICE (verify) |
| Release build | PASS (`next build`) | PASS | PASS (AAB built, unsigned here) | Compile check (see report); archive needs signing |

## Fixed in this pass

1. Plan with Zest in the apps: no working recogniser in Android WebView, no mic/speech purpose strings on iOS (crash risk) → native recogniser plugin + purpose strings.
2. `/api/plan` had no per-account limit on AI calls → `claim_voice_plan` (30/hour, admin-editable).
3. Retired Z/lightning mark still shipped as the iOS icon, the iOS splash (with a baked-in rounded tile) and the Play icon/feature graphic → regenerated from the approved mark.
4. Paid plans advertised benefits nothing enforces (multi-event, smart reminders, priority processing, longer history) → copy limited to the enforced scan allowance and PDF page limit.
5. Store subscribers had no way to manage a subscription from the app → Manage subscription link.
6. Google Calendar re-sync of an event deleted in Google patched an invisible cancelled event → re-syncs restore it.
7. One failing unit test on `main` (server-only import under tsx) → helper moved to the shared module.
8. Privacy policy described push and calendar connections as inactive → PR #54 (owner legal review).
