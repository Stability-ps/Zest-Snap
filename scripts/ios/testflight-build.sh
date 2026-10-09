#!/usr/bin/env bash
# Builds, signs and uploads Zest Snap to App Store Connect without a certificate on the machine.
#
#   scripts/ios/testflight-build.sh <build-number> [export|upload]
#
# 1. Archive with code signing disabled, so CI never needs (or creates) an Apple Development certificate.
# 2. Ad-hoc sign the archived app with App.entitlements, so the entitlements (Associated Domains) are carried into export.
# 3. Export with automatic signing: Xcode signs with the team's existing cloud-managed Apple Distribution certificate and
#    App Store provisioning profile, authenticated by the App Store Connect API key. "upload" also sends it to App Store Connect.
#
# Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (omit all three locally to use the Xcode account instead).
set -euo pipefail

BUILD_NUMBER="${1:?build number required}"
DESTINATION="${2:-upload}"
TEAM_ID="D64PWXTUJ5"
OUT="${IOS_BUILD_DIR:-ios/build}"
ARCHIVE="$OUT/ZestSnap.xcarchive"
APP="$ARCHIVE/Products/Applications/App.app"

[[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]] || { echo "Build number must be an integer" >&2; exit 2; }
[[ "$DESTINATION" == export || "$DESTINATION" == upload ]] || { echo "Destination must be export or upload" >&2; exit 2; }
rm -rf "$ARCHIVE" "$OUT/export"
mkdir -p "$OUT"

auth=()
if [[ -n "${ASC_KEY_PATH:-}" ]]; then
  auth=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -derivedDataPath "$OUT/DerivedData" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" CODE_SIGNING_ALLOWED=NO \
  archive | tee "$OUT/archive.log" | grep -E "^(\*\*|error:|.*: error:)" || true
[[ -d "$APP" ]] || { echo "::error::Archive failed — see $OUT/archive.log"; tail -40 "$OUT/archive.log"; exit 1; }

for framework in "$APP"/Frameworks/*.framework; do
  [[ -e "$framework" ]] && codesign --force --sign - --timestamp=none "$framework"
done
codesign --force --sign - --timestamp=none --generate-entitlement-der --entitlements ios/App/App/App.entitlements "$APP"

cat > "$OUT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict></plist>
EOF

xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates ${auth[@]+"${auth[@]}"} 2>&1 | tee "$OUT/export.log" | grep -vE "^\s*$" | tail -20
grep -q "EXPORT SUCCEEDED\|Upload succeeded\|Uploaded" "$OUT/export.log" || { echo "::error::Signing/upload failed — see $OUT/export.log"; exit 1; }
echo "Zest Snap $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Info.plist") ($BUILD_NUMBER): $DESTINATION succeeded"
