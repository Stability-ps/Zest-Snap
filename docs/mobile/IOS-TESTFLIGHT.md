# iOS — automated TestFlight releases

`.github/workflows/ios-testflight.yml` builds, signs and uploads Zest Snap (`app.zestsnap`, App Store Connect app
`6820771548`, team `D64PWXTUJ5`) and makes the build available to the internal TestFlight testers. Xcode isn't opened.

## When it runs

Never on ordinary pushes or pull requests. A release is one of:

- **Actions › iOS TestFlight › Run workflow** on `main` (optional "What to Test" text), or `gh workflow run ios-testflight.yml --ref main`
- pushing a tag `ios-v*` (e.g. `ios-v1.0.0-9`) on a commit that is on `main`

Then, in order: the commit must be on `main` → the full CI suite (typecheck, lint, tests) runs again → a reviewer
approves the `testflight` environment deployment → build → sign → upload → wait for processing → distribute.
Runs are serialised (`concurrency: ios-testflight`), so two releases can never pick the same build number.

The iOS app loads the production web app, so web-only changes reach testers through the normal Vercel deploy. A
new TestFlight build is only needed when the native shell changes (`ios/`, `capacitor.config.ts`, Capacitor plugins,
`mobile/www`).

## Signing (why there is no certificate in CI)

The team's **Apple Distribution certificate is cloud-managed**: Xcode Organizer created it, Apple holds the private
key, and it never existed in a local keychain — that is why no distribution certificate shows up on the Mac (only
`Apple Development: patric sibande`). Builds 1–8 were archived with the development certificate and re-signed in
Organizer with the cloud certificate.

CI does the same without Xcode's UI (`scripts/ios/testflight-build.sh`):

1. archive with `CODE_SIGNING_ALLOWED=NO` (CI never needs or creates an Apple Development certificate);
2. ad-hoc sign the app with `App.entitlements`, so Associated Domains (`applinks:app.zestsnap.app`) survive export;
3. `xcodebuild -exportArchive` with automatic signing and the App Store Connect API key → signed with the existing
   cloud-managed Apple Distribution certificate and the Xcode-managed App Store profile, and uploaded.

No certificate, `.p12`, provisioning profile or password is stored anywhere, and no new Apple identity is created.
Rehearse locally (uses your Xcode account, exports an `.ipa`, uploads nothing):
`npm run mobile:sync -- ios && scripts/ios/testflight-build.sh 9999 export`

## Build numbers

`scripts/ios/asc.mjs next-build` picks `max(CURRENT_PROJECT_VERSION in the Xcode project, highest build in App Store
Connect + 1)`. CI sets it at build time only; nothing is committed back. Change the version shown to testers with
`npm run mobile:version -- 1.0.1` (merged to `main` as usual).

## One-time setup (owner)

1. **App Store Connect API key** — App Store Connect › Users and Access › Integrations › App Store Connect API ›
   Team Keys › **+**. Name `GitHub Actions TestFlight`, access **Admin** (required for xcodebuild to use the
   cloud-managed distribution certificate). Download the `.p8` (only possible once), note the **Key ID** and the
   **Issuer ID** shown above the key list.
2. **GitHub secrets** in the `testflight` environment (Settings › Environments › testflight), from a terminal:
   ```sh
   gh secret set ASC_KEY_ID      --env testflight --repo Stability-ps/Zest-Snap   # paste the Key ID
   gh secret set ASC_ISSUER_ID   --env testflight --repo Stability-ps/Zest-Snap   # paste the Issuer ID
   gh secret set ASC_PRIVATE_KEY --env testflight --repo Stability-ps/Zest-Snap < ~/Downloads/AuthKey_XXXXXXXXXX.p8
   ```
   Then delete the downloaded `.p8` (or keep it only in a password manager). Never commit it.
   Set `ASC_PRIVATE_KEY` from the file (`< AuthKey_….p8`) rather than pasting it. The workflow validates the key before
   any App Store Connect call (`node scripts/ios/asc.mjs install-key`): it accepts the `.p8` as downloaded or the same
   text on one line with literal `\n` escapes, and rejects anything else with a message naming the problem (quoted,
   base64-encoded, missing `-----BEGIN PRIVATE KEY-----`, not EC P-256, …) without printing the key. Those formats
   otherwise fail inside OpenSSL as `error:1E08010C:DECODER routines::unsupported`.
3. **Internal TestFlight group** — App Store Connect › Zest Snap › TestFlight › Internal Testing. Every internal group
   receives CI builds; to limit it, set the repository variable `TESTFLIGHT_GROUPS` (comma-separated group names).
   Turning on the group's *Automatic distribution* is optional — the workflow adds each build to the group itself.

Optional repository variable `XCODE_PATH` pins the runner's Xcode (default: newest stable on `macos-26`).

## Results

The run summary shows `✅ Zest Snap 1.0.0 (9) is on TestFlight` or `❌ TestFlight release failed` with the failed
step; GitHub emails the person who started a failed run. Archive/export logs are kept 14 days as the `ios-build-logs`
artifact. Processing failures (e.g. a missing usage description) are reported from App Store Connect.

Revoking access: delete the key in App Store Connect (Integrations) — the workflow stops immediately.
