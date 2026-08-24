#!/usr/bin/env bash
#
# check-surface-freshness.sh — a screen that can be pulled to refresh must
# also refresh itself when the app comes back to the foreground.
#
# WHY THIS EXISTS
#
# The v5 tab destinations live inside a TabView and are never torn down, so
# `.task` ran once per process. Everything after that came from pull-to-refresh
# — a gesture a runner has no reason to know is load-bearing. An app left in
# the background overnight showed yesterday: an overnight adaptation, a plan
# edited on the web, a run synced off the watch, a correction to the data.
#
# `.faffForegroundRefresh` had existed the whole time. Every listener for it
# was in the v4 `Views/` directory; the v5 port carried the screens over and
# not the signal. Nothing broke — a behaviour simply stopped happening, and no
# test asks "is this still fresh".
#
# The rule is mechanical: `.refreshable` means the content can go stale. If it
# can go stale on a pull it can go stale on a foreground, so both must be
# handled. This fails the build when a new surface has one and not the other.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V5="$ROOT/native-v2/Faff/Faff/ViewsV5"

if [ ! -d "$V5" ]; then
  echo "check-surface-freshness: $V5 not found" >&2
  exit 1
fi

fail=0
scanned=0

while IFS= read -r f; do
  scanned=$((scanned + 1))
  pulls=$(/usr/bin/grep -c '\.refreshable' "$f" 2>/dev/null || true)
  fores=$(/usr/bin/grep -c 'v5ReloadOnForeground' "$f" 2>/dev/null || true)
  [ -z "$pulls" ] && pulls=0
  [ -z "$fores" ] && fores=0
  if [ "$pulls" -gt 0 ] && [ "$fores" -lt "$pulls" ]; then
    echo "✗ $(basename "$f"): $pulls .refreshable but only $fores v5ReloadOnForeground" >&2
    /usr/bin/grep -n '\.refreshable' "$f" >&2
    fail=1
  fi
done < <(find "$V5" -name '*.swift' -type f)

# A scanner that opens nothing and reports clean is worse than no scanner.
if [ "$scanned" -lt 5 ]; then
  echo "✗ scanned only $scanned files under ViewsV5 — the glob has drifted" >&2
  exit 1
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "A surface that can be pulled to refresh can go stale in the background too." >&2
  echo "Add .v5ReloadOnForeground { await surface.load() } beside the .refreshable." >&2
  exit 1
fi

echo "✓ surface freshness: $scanned files scanned, every .refreshable has a foreground reload"
