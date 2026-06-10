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
LOCK_DIR="$ROOT/.asc.shipping.lock"   # mkdir is atomic → cross-agent mutex
STALE_LOCK_SEC=$((45 * 60))           # 45-min ceiling for stale locks

# ── Cross-agent ship lock ─────────────────────────────────────────────
#
# Both ship-testflight.sh (legacy) and ship-testflight-v2.sh share the
# same bundle id (run.faff.app) and the same .asc.build counter. If two
# agents run simultaneously they collide on the build number AND the
# second IPA replaces the first on TestFlight invisibly. (See 2026-05-26
# postmortem: both agents shipped build 71, one was overwritten, David
# got the wrong code.)
#
# Lock policy:
#   - mkdir LOCK_DIR is POSIX-atomic — exactly one shipper acquires it.
#   - The lock metadata file records who/when/which commit so a held
#     lock can be diagnosed.
#   - 45-min staleness ceiling — older lock = previous run died; warn
#     and proceed.
#   - Counter read+bump happens INSIDE the lock so the next build
#     number is reserved before any source code starts compiling.
#   - trap EXIT releases the lock on success, failure, or Ctrl-C.

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    : # acquired
  else
    if [ -f "$LOCK_DIR/meta" ]; then
      local held_at agent_id age
      held_at=$(awk -F= '/^held_at=/{print $2}' "$LOCK_DIR/meta" 2>/dev/null || echo "")
      agent_id=$(awk -F= '/^agent_id=/{print $2}' "$LOCK_DIR/meta" 2>/dev/null || echo "")
      age=$(( $(date +%s) - $(date -j -f "%Y-%m-%dT%H:%M:%S%z" "${held_at%%Z}+0000" "+%s" 2>/dev/null || echo 0) ))
      if [ "$age" -gt "$STALE_LOCK_SEC" ] && [ "$age" -lt 99999999 ]; then
        echo "→ stale lock from $agent_id (held $((age/60)) min ago) — clearing"
        rm -rf "$LOCK_DIR"
        mkdir "$LOCK_DIR"
      else
        echo "ERROR: another ship in progress." >&2
        echo "  Lock held since: $held_at" >&2
        echo "  Agent:           $agent_id" >&2
        echo "  Metadata:        $LOCK_DIR/meta" >&2
        echo "" >&2
        echo "  If you're SURE the other agent crashed (>45 min ago), force-clear:" >&2
        echo "    rm -rf $LOCK_DIR" >&2
        exit 2
      fi
    else
      echo "ERROR: $LOCK_DIR exists but has no metadata — manual cleanup needed." >&2
      exit 2
    fi
  fi
  # Write metadata identifying this run
  {
    echo "held_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "agent_id=${AGENT_ID:-$(whoami)@$(hostname -s)}"
    echo "pid=$$"
    echo "script=$0"
    echo "git_commit=$(cd "$ROOT" && git rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "git_branch=$(cd "$ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  } > "$LOCK_DIR/meta"
  trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
  echo "→ acquired ship lock: $LOCK_DIR"
}

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE" >&2
  echo "  legacy/native/.asc.env holds: ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH / ASC_TEAM_ID" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

acquire_lock

# Build number — read AND bump inside the lock so the next ship can't
# steal our number. The counter records the NEXT-AVAILABLE number; we
# consume the current one and write current+1 back immediately. If a CLI
# arg forced a number, honor it but still bump the counter past it.
if [ -n "${1:-}" ]; then
  BUILD="$1"
  CURRENT_NEXT=$(cat "$BUILD_FILE" 2>/dev/null || echo 1)
  if [ "$BUILD" -ge "$CURRENT_NEXT" ]; then
    echo "$((BUILD + 1))" > "$BUILD_FILE"
  fi
else
  BUILD=$(cat "$BUILD_FILE" 2>/dev/null || echo 1)
  echo "$((BUILD + 1))" > "$BUILD_FILE"
fi
echo "→ reserved build $BUILD (next available: $(cat "$BUILD_FILE"))"

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

# Brief v2 §1 build enforcement (queued task 6) · the ten-color lock +
# retired-hex tripwire gates every TestFlight archive. Fails the ship if
# any surface drifts from the locked palette.
echo "→ Palette-sync gate (brief v2 §1)…"
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-palette-sync.sh"

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

# Counter was already bumped inside the lock at script start. The
# .asc.build file currently holds the NEXT-available number. Commit it.
echo "✓ Uploaded build $BUILD. Counter is at $(cat "$BUILD_FILE") — commit asc.build."

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
