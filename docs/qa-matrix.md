# Launch QA matrix

Do not mark a physical-device or live-cloud result passed based on a simulated browser.

| Area | Automated evidence | Manual / external verification |
| --- | --- | --- |
| Take Photo | File input/capture attribute preserved | iOS, Android/Samsung camera and permissions required |
| Upload image | Browser fixture → review → save | Real AI image quality sample pending |
| Upload PDF | MIME/signature/size validation; parser page checks | Real multi-page extraction sample pending |
| Multi-event scan / Add selected | Two events edited/exported; ICS contains two VEVENTs | Native imports pending |
| Ambiguous / blurred / relative dates | Conservative prompt and runtime invalid-date handling | Multilingual, blurred, angled, handwriting corpus needs human accuracy review |
| Large images / oversized PDF | Client compression retained; bounded request test | Phone compression/low-memory test pending |
| Edit event | Browser title edit persists into reopened History | Native date/time keyboard check pending |
| Select/deselect / duplicates | Fingerprint unit tests; two already-added labels in browser | Physical touch targets pending |
| Calendar | UTC/DST, all-day, multi-day, folding, injection, stable UID and multi-event tests | Google Calendar, Apple Calendar and Outlook import required |
| History | Reopen edited extraction; stored warnings/deletion control | Cloud smoke after activation |
| Agenda | Saved events; past/upcoming split; widths 320,360,375,390,412,430,1280 | Device back/safe-area behavior required |
| Rewards | Database once-only milestone; local 8 credits after first two actions | Live account ledger after activation |
| Offline | Browser offline reload preserves History and Rewards | Installed-PWA cold start/OS eviction required |
| Install | Manifest raster/maskable checks; browser install affordance | Android, Samsung, desktop and iOS home screen required |
| Worker cache | Browser checks absence of auth/admin/API cached URLs | Two deployed release update cycle required |
| Settings | Save/reload timezone; export/delete controls | Cloud deletion/export smoke after activation |
| Auth | Redirect allowlist; local-mode sign-in screen | Verification/reset/session expiry on dedicated project |
| Local → cloud | Stable merge idempotency tests; unique DB fingerprint index | Two-device repeated merge smoke after activation |
| Security | PostgreSQL RLS, cross-user writes, profile privilege escalation, usage/reward writes rejected | Supabase Advisors after activation |

Commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx playwright test` (start production app on port 3100 first). Browser tests mock extraction deliberately, so they do not certify OpenAI accuracy or external calendar behavior.
