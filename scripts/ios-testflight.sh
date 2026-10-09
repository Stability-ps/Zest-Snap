#!/usr/bin/env bash
# Archives the Zest Snap iOS app from this checkout and uploads it to App Store Connect (TestFlight).
#
#   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=~/.zest-snap-signing/AuthKey_….p8 scripts/ios-testflight.sh
#
# Needs an App Store Connect API team key (Users and Access › Integrations › Team Keys) with the Admin role,
# stored outside the repository. Signing is automatic and cloud-managed (-allowProvisioningUpdates): Xcode uses
# the team's Apple Distribution signing in the cloud and creates the App Store profile for app.zestsnap
# itself, so no certificate or .p12 is created on or exported to this Mac.
# Bump the build first (npm run mobile:version); App Store Connect rejects a build number it already has.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ASC_KEY_ID:?Set ASC_KEY_ID}" "${ASC_ISSUER_ID:?Set ASC_ISSUER_ID}" "${ASC_KEY_PATH:?Set ASC_KEY_PATH to the .p8 file}"
[ -f "$ASC_KEY_PATH" ] || { echo "No API key at $ASC_KEY_PATH" >&2; exit 1; }
case "$(cd "$(dirname "$ASC_KEY_PATH")" && pwd)" in "$(pwd)"*) echo "Keep the API key outside the repository." >&2; exit 1 ;; esac
[ -z "${CAP_SERVER_URL:-}" ] || { echo "Unset CAP_SERVER_URL: store builds load the production web app." >&2; exit 1; }

node scripts/mobile-sync.mjs ios
build=$(node -p 'require("./mobile/version.json").build'); version=$(node -p 'require("./mobile/version.json").version')
echo "Archiving Zest Snap $version ($build)…"
auth=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
out=ios/build/testflight-$build
rm -rf "$out"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination generic/platform=iOS \
  -archivePath "$out/ZestSnap.xcarchive" archive "${auth[@]}"
xcodebuild -exportArchive -archivePath "$out/ZestSnap.xcarchive" -exportOptionsPlist ios/ExportOptions-TestFlight.plist \
  -exportPath "$out/export" "${auth[@]}"
echo "Uploaded $version ($build). App Store Connect › TestFlight shows it as Processing for a few minutes."
