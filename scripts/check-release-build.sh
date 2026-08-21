#!/usr/bin/env bash
#
# check-release-build · the archive has to compile, not just the simulator.
#
# ─────────────────────────────────────────────────────────────────────────
# WHY
#
# On 2026-08-21 `xcodebuild -configuration Release` failed with 12 errors on
# main and nothing anywhere said so. A TestFlight archive would have failed,
# and it had been that way long enough that nobody knew.
#
# The cause is a shape that Debug cannot see: `#Preview` expands in RELEASE
# too, so a preview helper calling a `#if DEBUG`-only seam compiles fine on
# the simulator every single time and only breaks when you try to ship. Every
# build in this project's whole audit programme was Debug.
#
# So: compile Release for a generic device. No signing, no archive, no upload
# — just the compile that was failing.
#
# Sibling of check-palette-sync / check-doctrine / check-modelled-mark /
# check-wire-keys / check-coach-voice. NOT wired into web-v2's prebuild —
# Railway has no Xcode, and a shell that cannot run xcodebuild passes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$ROOT/native-v2/Faff.xcodeproj"

echo "check-release-build · the archive has to compile"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "  xcodebuild not on this machine — skipped (this gate is for a Mac)"
  exit 0
fi
if [ ! -d "$PROJ" ]; then
  echo "  $PROJ not found — run xcodegen first" >&2
  exit 1
fi

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

# Generic device, so it compiles the way an archive does. Signing off: we are
# checking the COMPILE, and a missing certificate must not read as a failure.
if xcodebuild -project "$PROJ" -scheme Faff -configuration Release \
     -destination 'generic/platform=iOS' \
     -derivedDataPath "${TMPDIR:-/tmp}/faff-release-gate" \
     CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
     build > "$OUT" 2>&1; then
  echo "check-release-build OK · Release compiles for a generic iOS device"
  exit 0
fi

echo "" >&2
echo "  RELEASE BUILD FAILED. A TestFlight archive would fail too." >&2
echo "" >&2
grep -E "error:" "$OUT" | head -20 | sed 's/^/    /' >&2
echo "" >&2
echo "  The usual cause is a #Preview helper calling a #if DEBUG-only symbol." >&2
echo "  #Preview expands in Release, so wrap the whole preview region in" >&2
echo "  #if DEBUG rather than relying on the macro being debug-only." >&2
exit 1
