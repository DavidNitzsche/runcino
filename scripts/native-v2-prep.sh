#!/usr/bin/env bash
# native-v2-prep.sh — non-signing prep for the v2 iOS app.
#
# What it does:
#   1. Verifies xcodegen is installed (brew install if not)
#   2. Generates native-v2/Faff.xcodeproj from project.yml
#   3. Opens the project in Xcode
#
# What you do next, in Xcode:
#   - Set the team / signing identity (one-time setup per machine)
#   - Product → Archive
#   - Distribute App → App Store Connect → Upload
#   - When the build promotes, you have v2 on TestFlight
#
# The watch app stays in legacy/native/Faff/FaffWatch Watch App/
# and ships unchanged. To include it in v2 (if you want one build that
# carries both phone-v2 + watch-untouched), you'd add the watch source
# folder to the v2 Xcode project's target. That's a manual one-time step
# in Xcode (File → Add Files to "Faff") — kept manual on purpose so we
# don't fight Xcode's signing assumptions.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE_V2="$REPO/native-v2"

if [ ! -d "$NATIVE_V2" ]; then
  echo "✗ native-v2 directory not found at $NATIVE_V2"; exit 1
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "→ XcodeGen not installed. Install with:"
  echo "  brew install xcodegen"
  echo
  read -r -p "Install now via brew? [y/N] " yn
  if [[ "$yn" =~ ^[Yy]$ ]]; then
    brew install xcodegen
  else
    echo "✗ aborted — install XcodeGen first."; exit 1
  fi
fi

cd "$NATIVE_V2"
echo "→ Regenerating Faff.xcodeproj from project.yml..."
xcodegen generate

echo
echo "✓ Project generated at: $NATIVE_V2/Faff.xcodeproj"
echo
echo "Next steps (in Xcode):"
echo "  1. Set signing team (Faff target → Signing & Capabilities)"
echo "  2. Product → Archive"
echo "  3. Distribute App → App Store Connect → Upload"
echo
echo "Opening Xcode..."
open "$NATIVE_V2/Faff.xcodeproj"
