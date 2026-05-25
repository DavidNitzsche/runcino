#!/usr/bin/env bash
#
# Build native-v2 + boot iOS Simulator + install + launch.
# Fast iterative loop: change Swift → run this → see changes live.
#
# Usage:
#   scripts/run-sim-v2.sh              # iPhone 15 Pro default
#   scripts/run-sim-v2.sh "iPhone 16"  # specific simulator
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE_V2="$ROOT/native-v2"
SIM_NAME="${1:-iPhone 15 Pro}"
BUNDLE_ID="run.faff.app"

if ! command -v xcodegen >/dev/null 2>&1; then
  brew install xcodegen
fi

echo "→ Generating Xcode project…"
( cd "$NATIVE_V2" && xcodegen generate )

# Link watch source if missing
if [ ! -e "$NATIVE_V2/Faff/FaffWatch Watch App" ]; then
  ln -s "$ROOT/legacy/native/Faff/FaffWatch Watch App" \
        "$NATIVE_V2/Faff/FaffWatch Watch App"
fi

echo "→ Finding simulator: $SIM_NAME…"
DEVICE_ID="$(xcrun simctl list devices available | grep -E "^\s+$SIM_NAME " | head -1 | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}')"
if [ -z "$DEVICE_ID" ]; then
  echo "ERROR: simulator '$SIM_NAME' not found." >&2
  echo "Available:" >&2
  xcrun simctl list devices available | grep -E "iPhone|iPad" | head -10 >&2
  exit 1
fi
echo "  device id: $DEVICE_ID"

echo "→ Booting simulator (no-op if already booted)…"
xcrun simctl boot "$DEVICE_ID" 2>/dev/null || true
open -a Simulator

echo "→ Building for simulator…"
DERIVED="/tmp/Faff-v2-sim-derived"
( cd "$NATIVE_V2" && xcodebuild -scheme Faff -configuration Debug \
    -destination "id=$DEVICE_ID" -derivedDataPath "$DERIVED" build )

# Find the built .app — depth-limited search
APP_PATH="$(find "$DERIVED/Build/Products" -name "*.app" -type d | head -1)"
if [ -z "$APP_PATH" ]; then
  echo "ERROR: could not find built .app" >&2; exit 1
fi
echo "  app: $APP_PATH"

echo "→ Installing on simulator…"
xcrun simctl install "$DEVICE_ID" "$APP_PATH"

echo "→ Launching app…"
xcrun simctl launch "$DEVICE_ID" "$BUNDLE_ID"

echo "✓ Faff v2 running on $SIM_NAME. Iterate with re-running this script."
