#!/usr/bin/env bash
#
# Ship the Faff iOS app (it embeds the watch app) to TestFlight.
#
# Secrets live in native/.asc.env (gitignored): ASC_KEY_ID, ASC_ISSUER_ID,
# ASC_KEY_PATH, ASC_TEAM_ID. The build number auto-increments from
# native/.asc.build (committed, so the next number is tracked in-repo).
#
# Usage:
#   scripts/ship-testflight.sh            # uses native/.asc.build
#   scripts/ship-testflight.sh 18         # force a specific build number
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/native/.asc.env"
BUILD_FILE="$ROOT/native/.asc.build"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE" >&2
  echo "Create it with:" >&2
  echo "  ASC_KEY_ID=...          # App Store Connect API key id" >&2
  echo "  ASC_ISSUER_ID=...       # ASC > Users and Access > Integrations > Issuer ID" >&2
  echo "  ASC_KEY_PATH=/path/AuthKey_XXX.p8" >&2
  echo "  ASC_TEAM_ID=...         # Apple Developer team id" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

BUILD="${1:-$(cat "$BUILD_FILE" 2>/dev/null || echo 1)}"
echo "→ Shipping Faff build $BUILD to TestFlight (team $ASC_TEAM_ID)…"

rm -rf /tmp/Faff.xcarchive /tmp/FaffExport
cat > /tmp/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>${ASC_TEAM_ID}</string>
  <key>destination</key><string>export</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST

echo "→ Archiving…"
( cd "$ROOT/native/Faff" && xcodebuild -scheme Faff -configuration Release \
    -destination 'generic/platform=iOS' -archivePath /tmp/Faff.xcarchive archive \
    -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" )

echo "→ Exporting signed .ipa…"
xcodebuild -exportArchive -archivePath /tmp/Faff.xcarchive \
  -exportOptionsPlist /tmp/ExportOptions.plist -exportPath /tmp/FaffExport \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo "→ Uploading to TestFlight…"
xcrun altool --upload-app -f /tmp/FaffExport/Faff.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "$((BUILD + 1))" > "$BUILD_FILE"
echo "✓ Uploaded build $BUILD. native/.asc.build bumped to $((BUILD + 1)) — commit it."

# Wait for processing, then clear export compliance + distribute to the
# internal beta group so it's actually installable (not just "uploaded").
echo "→ Waiting for App Store Connect to finish processing build $BUILD…"
for i in $(seq 1 30); do
  state="$(python3 "$ROOT/scripts/asc.py" status 2>/dev/null || true)"
  echo "   $state"
  case "$state" in
    *"$BUILD: VALID"*) break ;;
  esac
  sleep 20
done
python3 "$ROOT/scripts/asc.py" comply || true
python3 "$ROOT/scripts/asc.py" autoship || true
echo "✓ Build $BUILD distributed to Internal Testers — open the TestFlight app."
