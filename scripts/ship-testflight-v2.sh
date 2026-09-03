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
# The link is RELATIVE (../../legacy/…) and committed that way. An absolute
# link resolves to whichever checkout minted it, so a git worktree — or a
# clone at any other path — compiled the OTHER tree's watch sources, or a
# dangling link (which `-e` reports as missing, so this block then tried
# `ln -s` over an existing name and errored). `-L` tests the link itself.
if [ ! -L "$NATIVE_V2/Faff/FaffWatch Watch App" ] && [ ! -e "$NATIVE_V2/Faff/FaffWatch Watch App" ]; then
  echo "→ Linking watch app source from legacy/…"
  ln -s "../../legacy/native/Faff/FaffWatch Watch App" \
        "$NATIVE_V2/Faff/FaffWatch Watch App"
fi

# Same for the WidgetKit extension (complications + Smart Stack). Its sources
# live beside the watch app in legacy/ for the same reason and are linked the
# same relative way — an absolute link compiles the wrong checkout's sources
# from a git worktree.
if [ ! -L "$NATIVE_V2/Faff/FaffWatch Widgets" ] && [ ! -e "$NATIVE_V2/Faff/FaffWatch Widgets" ]; then
  echo "→ Linking watch widget extension source from legacy/…"
  ln -s "../../legacy/native/Faff/FaffWatch Widgets" \
        "$NATIVE_V2/Faff/FaffWatch Widgets"
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

# Palette build enforcement (queued task 6) · the per-surface palette lock +
# retired-hex tripwire gates every TestFlight archive. Fails the ship if any
# surface drifts from the palette its own design document specifies.
#
# 2026-08-19 · the phone is locked to the v5 iPhone handoff
# (design/0819/design_handoff_faff_iphone_app v5), NOT to brief v2 — brief v2
# still governs web and watch. The gate itself carries the full ruling.
echo "→ Palette-sync gate (iPhone: v5 handoff · watch: brief v2 §1)…"
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-palette-sync.sh"

# Watch gate · THE WHOLE ONE, not a compile check.
#
# 2026-09-03 · THIS STEP COULD NOT FAIL ON A FAILING TEST.
#
# It ran `xcodebuild build-for-testing` and its own comment said so: "test
# execution is separately verified in dev via xcodebuild test". So the step
# named "Watch engine test gate" compiled the tests and never ran one. Every
# regression it lists as its purpose — state machine, overtime, snapshot,
# race-pause — is invisible to a compile, and a shipped build could carry any
# of them past a green ✓.
#
# That is this programme's recurring shape (rule 19): the chain that PROVES a
# commit was not the chain that SHIPS it. Here the two were one step apart and
# the shipping one was the weaker.
#
# It now runs `scripts/check-watch.sh` — the gate that already knows how to do
# this properly: the suite serially (parallel cloning produced eleven spurious
# failures), a floor derived from the @Test declarations so "0 ran" cannot read
# as a pass, one retry when the test HOST dies rather than a test, the rendered
# board geometry, and the source-level guards that the run stays endable and
# the Q41-Q43 contract holds. Reusing it also means the ship gate and the
# pre-push gate cannot drift apart, which is how this one rotted.
#
# Verdicts, per that script's header:
#   0 · OK or PARTIAL — PARTIAL names the guard that could not run (usually
#       board geometry, when no 46mm watch simulator is booted). Shipping
#       proceeds and SAYS what was not checked.
#   3 · UNRUNNABLE — nothing was checked. Aborts: a ship must not pass a gate
#       that executed nothing.
#   1 · FAIL — aborts.
echo "→ Watch gate (full: engine tests, board geometry, endability, Q41-Q43)…"
GATE_OUT=/tmp/faff-ship-watch-gate.txt
set +e
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-watch.sh" 2>&1 | tee "$GATE_OUT"
GATE_RC=${PIPESTATUS[0]}
set -e
case "$GATE_RC" in
  0)
    if grep -q '^WATCH-GATE: PARTIAL' "$GATE_OUT"; then
      echo "  ! Watch gate PARTIAL — shipping, but note what it did NOT check:"
      grep '^WATCH-GATE: PARTIAL' "$GATE_OUT" | sed 's/^/    /'
    else
      echo "✓ Watch gate OK"
    fi
    ;;
  3)
    echo "ERROR: watch gate UNRUNNABLE — it checked nothing. Aborting ship." >&2
    echo "  A build that no gate could examine is not a verified build." >&2
    exit 1
    ;;
  *)
    echo "ERROR: watch gate FAILED — aborting ship. See $GATE_OUT." >&2
    exit 1
    ;;
esac

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
