#!/usr/bin/env bash
#
# Ship the Faff iOS app (it embeds the watch app) to TestFlight.
#
# Secrets live in legacy/native/.asc.env (gitignored): ASC_KEY_ID,
# ASC_ISSUER_ID, ASC_KEY_PATH, ASC_TEAM_ID. The build number
# auto-increments from legacy/native/.asc.build (committed, so the
# next number is tracked in-repo).
#
# Paths: web/ and native/ were archived to legacy/ under Phase 0.1
# of the v2 rebuild — production deploys keep building from legacy/
# until cutover (see commit 64ff3a9).
#
# Usage:
#   scripts/ship-testflight.sh            # uses legacy/native/.asc.build
#   scripts/ship-testflight.sh 18         # force a specific build number
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/legacy/native/.asc.env"
BUILD_FILE="$ROOT/legacy/native/.asc.build"
LOCK_DIR="$ROOT/.asc.shipping.lock"  # shared with ship-testflight-v2.sh
STALE_LOCK_SEC=$((45 * 60))

# Cross-agent ship lock — same convention as ship-testflight-v2.sh.
# See that file for the full rationale. tl;dr: mkdir is atomic; counter
# is read+bumped inside the lock so no two shipments collide on a build
# number; trap EXIT/INT/TERM releases the lock.
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    :
  else
    if [ -f "$LOCK_DIR/meta" ]; then
      local held_at agent_id age
      held_at=$(awk -F= '/^held_at=/{print $2}' "$LOCK_DIR/meta" 2>/dev/null || echo "")
      agent_id=$(awk -F= '/^agent_id=/{print $2}' "$LOCK_DIR/meta" 2>/dev/null || echo "")
      age=$(( $(date +%s) - $(date -j -f "%Y-%m-%dT%H:%M:%S%z" "${held_at%%Z}+0000" "+%s" 2>/dev/null || echo 0) ))
      if [ "$age" -gt "$STALE_LOCK_SEC" ] && [ "$age" -lt 99999999 ]; then
        echo "→ stale lock from $agent_id ($((age/60)) min ago) — clearing"
        rm -rf "$LOCK_DIR"
        mkdir "$LOCK_DIR"
      else
        echo "ERROR: another ship in progress (lock $LOCK_DIR)" >&2
        echo "  Held since: $held_at by $agent_id" >&2
        echo "  If sure they died (>45 min): rm -rf $LOCK_DIR" >&2
        exit 2
      fi
    else
      echo "ERROR: $LOCK_DIR exists w/o metadata — manual cleanup needed" >&2
      exit 2
    fi
  fi
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
  echo "Create it with:" >&2
  echo "  ASC_KEY_ID=...          # App Store Connect API key id" >&2
  echo "  ASC_ISSUER_ID=...       # ASC > Users and Access > Integrations > Issuer ID" >&2
  echo "  ASC_KEY_PATH=/path/AuthKey_XXX.p8" >&2
  echo "  ASC_TEAM_ID=...         # Apple Developer team id" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

acquire_lock

# Reserve build number INSIDE the lock so concurrent shippers can't collide.
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
( cd "$ROOT/legacy/native/Faff" && xcodebuild -scheme Faff -configuration Release \
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

# Counter was reserved+bumped inside the lock at script start. File now
# holds the NEXT available number. Commit it.
echo "✓ Uploaded build $BUILD. Counter is at $(cat "$BUILD_FILE") — commit asc.build."

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
