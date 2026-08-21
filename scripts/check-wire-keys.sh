#!/usr/bin/env bash
#
# check-wire-keys · every key the phone DECODES must be a key the server EMITS.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS
#
# Swift catches a MISSING decode: a stored property with no assignment is a
# compile error, so a field added to a struct and forgotten in `init(from:)`
# never ships. What Swift cannot catch is a decode that reads the WRONG KEY —
# `paceNote = c.opt(.sick)` compiles perfectly and silently yields nil forever.
#
# Every lenient decoder in APIV5.swift turns an unknown key into nil or an
# empty array rather than an error, which is the right behaviour on the wire
# and the worst possible behaviour for a typo: the screen simply draws nothing
# and looks like a design decision.
#
# Four bugs of exactly this shape landed in one day (2026-08-20):
#   · `date` vs `date_iso`      — every shoe write silently landed on today
#   · `from`/`to` vs `fromISO`/`toISO` — every travel plan-change was refused
#   · `weekly_summary_enabled`  — dropped by the settings route's allowlist
#   · `push_enabled`            — written, but read by no notification category
#
# So: pull every case out of every `enum K: String, CodingKey` in APIV5.swift,
# and require each one to appear somewhere in the server's own source. A key
# the backend never writes is either a typo or a field nobody implemented.
#
# This is a NET, not a proof. It cannot tell you a key is emitted on the right
# route, only that the string exists somewhere in web-v2. It still catches the
# entire typo/rename class, which is what actually bites.
#
# Sibling of check-palette-sync.sh, check-doctrine.sh and check-modelled-mark.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SWIFT="$ROOT/native-v2/Faff/Faff/DesignV5/APIV5.swift"
SERVER="$ROOT/web-v2"

echo "check-wire-keys · the phone's decoders against the server's emitters"

if [ ! -f "$SWIFT" ]; then
  echo "  APIV5.swift not found at $SWIFT" >&2
  exit 1
fi

# Keys the phone decodes but that are NOT wire fields — these are decoded from
# a nested shape the server names differently, or are client-side only. Each
# needs a reason, and a stale entry is itself a finding.
#   (none yet — add here with a one-line reason if a real exemption appears)
EXEMPT=""

# Every `case a, b, c` line inside an `enum K: String, CodingKey { ... }`.
# awk tracks the brace depth so a `case` in an unrelated switch is not picked up.
KEYS="$(awk '
  /enum K: String, CodingKey/ { inblock = 1; next }
  inblock && /^[[:space:]]*}/  { inblock = 0; next }
  inblock && /^[[:space:]]*case / {
    line = $0
    sub(/^[[:space:]]*case /, "", line)
    sub(/\/\/.*$/, "", line)
    n = split(line, parts, ",")
    for (i = 1; i <= n; i++) {
      k = parts[i]
      gsub(/[[:space:]]/, "", k)
      # `case foo = "bar"` — the WIRE name is the right-hand side.
      if (index(k, "=") > 0) sub(/^[^=]*=/, "", k)
      gsub(/"/, "", k)
      if (k != "") print k
    }
  }
' "$SWIFT" | sort -u)"

TOTAL=0
MISSING=""

while IFS= read -r key; do
  [ -z "$key" ] && continue
  TOTAL=$((TOTAL + 1))
  case " $EXEMPT " in *" $key "*) continue ;; esac
  # Look for the bare identifier as an object key or a quoted string anywhere
  # in the server's own TypeScript. Excludes node_modules and .next.
  if ! grep -rqE "(^|[^A-Za-z0-9_])${key}([^A-Za-z0-9_]|$)" \
        --include='*.ts' --include='*.tsx' \
        --exclude-dir=node_modules --exclude-dir=.next \
        "$SERVER" 2>/dev/null; then
    MISSING="${MISSING}${key}"$'\n'
  fi
done <<< "$KEYS"

if [ -n "$MISSING" ]; then
  echo ""
  echo "  These keys are decoded by the phone and appear NOWHERE in web-v2:" >&2
  echo "$MISSING" | sed '/^$/d' | sed 's/^/    · /' >&2
  echo "" >&2
  echo "  Each is either a typo (the field will read nil forever and the screen" >&2
  echo "  will draw nothing) or a field the backend never implemented. Fix the" >&2
  echo "  key, implement the field, or add it to EXEMPT with a reason." >&2
  exit 1
fi

echo "check-wire-keys OK · $TOTAL decoded key(s), all present in web-v2"
