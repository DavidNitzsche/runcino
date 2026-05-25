#!/usr/bin/env bash
#
# Ship the v2 Faff iOS app to TestFlight.
#
# Same flow as scripts/ship-testflight.sh (legacy) but rooted at
# native-v2/. Generates the Xcode project from project.yml first
# (XcodeGen), then archive + export + upload + comply + autoship.
#
# Reuses the same App Store Connect credentials (legacy/native/.asc.env)
# and the same .asc.build counter — TestFlight build numbers must be
# monotonic across the bundle id, and we ship both binaries to the same
# run.faff.app.
#
# Usage:
#   scripts/ship-testflight-v2.sh              # uses next .asc.build number
#   scripts/ship-testflight-v2.sh 63           # force a specific build
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE_V2="$ROOT/native-v2"
ENV_FILE="$ROOT/legacy/native/.asc.env"
BUILD_FILE="$ROOT/legacy/native/.asc.build"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE" >&2
  echo "  legacy/native/.asc.env holds: ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH / ASC_TEAM_ID" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

# Build number — shared monotonic counter across legacy + v2 (same bundle id).
BUILD="${1:-$(cat "$BUILD_FILE" 2>/dev/null || echo 1)}"

# Ensure xcodegen is installed
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "→ XcodeGen not installed. Installing via brew..."
  brew install xcodegen
fi

# Generate the .xcodeproj from project.yml (idempotent — safe to re-run).
echo "→ Generating native-v2 Xcode project from project.yml…"
( cd "$NATIVE_V2" && xcodegen generate )

# Ensure the watch app source is symlinked into v2 so it ships in the same
# .ipa as legacy did. (Watch app SOURCE stays at legacy/; the symlink lets
# the v2 Xcode project compile it as part of the same bundle.)
if [ ! -e "$NATIVE_V2/Faff/FaffWatch Watch App" ]; then
  echo "→ Linking watch app source from legacy/…"
  ln -s "$ROOT/legacy/native/Faff/FaffWatch Watch App" \
        "$NATIVE_V2/Faff/FaffWatch Watch App"
fi

echo "→ Shipping Faff-v2 build $BUILD to TestFlight (team $ASC_TEAM_ID)…"
rm -rf /tmp/Faff-v2.xcarchive /tmp/Faff-v2-export
cat > /tmp/FaffV2ExportOptions.plist <<PLIST
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
( cd "$NATIVE_V2" && xcodebuild -scheme Faff -configuration Release \
    -destination 'generic/platform=iOS' -archivePath /tmp/Faff-v2.xcarchive archive \
    -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" )

echo "→ Exporting signed .ipa…"
xcodebuild -exportArchive -archivePath /tmp/Faff-v2.xcarchive \
  -exportOptionsPlist /tmp/FaffV2ExportOptions.plist -exportPath /tmp/Faff-v2-export \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo "→ Uploading to TestFlight…"
xcrun altool --upload-app -f /tmp/Faff-v2-export/Faff.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

# Bump the shared build counter
echo "$((BUILD + 1))" > "$BUILD_FILE"
echo "✓ Uploaded build $BUILD. .asc.build bumped to $((BUILD + 1)) — commit it."

# Wait for processing → comply → autoship to internal testers (reuse legacy script)
echo "→ Waiting for App Store Connect to finish processing build $BUILD…"
for i in $(seq 1 30); do
  state="$(python3 "$ROOT/scripts/asc.py" status 2>/dev/null || true)"
  echo "   $state"
  case "$state" in
    *"$BUILD: VALID"*) break ;;
  esac
  sleep 20
done
python3 "$ROOT/scripts/asc.py" comply  || true
python3 "$ROOT/scripts/asc.py" autoship || true
echo "✓ Build $BUILD distributed to Internal Testers — open the TestFlight app."
