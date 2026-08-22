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
WATCH_MODELS="$ROOT/legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift"
SERVER="$ROOT/web-v2"

# ── WHY THE WATCH NEEDED A SECOND AND THIRD EXTRACTOR (2026-08-21) ───────────
# For its first life this gate read exactly one file - APIV5.swift - and only
# `enum K: String, CodingKey` blocks. That is the phone's shape. It therefore
# passed, cleanly and every time, over a watch wire it had never read: a green
# light above an unwatched road, which is worse than no light.
#
# The watch needs two more shapes:
#
#   INCOMING  WatchWorkout / WatchPhase spell it `private enum CodingKeys`,
#             so the phone's `enum K` matcher never sees them.
#
#   OUTGOING  WatchCompletion is `Encodable` with NO CodingKeys AT ALL. The
#             wire is literally the stored-property names. That is not an
#             oversight, it is the contract - and it is why the camelCase rule
#             is absolute here. A server that reads `route_polyline` when Swift
#             emits `routePolyline` silently dropped every GPS track once
#             (6616d766). Nothing in the compiler catches that; this does.
#
# So: three extractors, one checker.
# ─────────────────────────────────────────────────────────────────────────────

fail=0

# $1 = file, $2 = awk program, $3 = human label, $4 = exempt list
check_keys() {
  local file="$1" prog="$2" label="$3" exempt="${4:-}"
  if [ ! -f "$file" ]; then
    echo "  $label: file not found at $file" >&2
    fail=1
    return
  fi
  local keys total missing key
  keys="$(awk "$prog" "$file" | sort -u)"

  # AN EXTRACTOR THAT FINDS NOTHING IS BROKEN, NOT SATISFIED.
  #
  # This guard exists because the first version of the watch-emitter pass
  # reported "0 key(s), all present in web-v2" and exited 0. The awk used `\b`
  # in its struct-header regex, which macOS awk does not honour, so it matched
  # no struct, extracted no property, checked nothing, and PASSED - reproducing
  # in the fix the exact failure the fix was written to remove.
  #
  # Zero is never a legitimate answer for any target here: every one of them
  # names a type that demonstrably has wire keys. If a target ever genuinely
  # goes empty, that is a deletion worth failing over until someone removes
  # the target on purpose.
  if [ -z "$keys" ]; then
    echo "" >&2
    echo "  $label - EXTRACTED NOTHING." >&2
    echo "  The awk program matched no keys in:" >&2
    echo "    $file" >&2
    echo "  This is a broken extractor, not a clean bill of health - a pass" >&2
    echo "  here would be a green light over a road nobody is watching." >&2
    echo "  Check the struct/enum header regex against the file's real text." >&2
    fail=1
    return
  fi

  total=0
  missing=""
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    total=$((total + 1))
    case " $exempt " in *" $key "*) continue ;; esac
    if ! grep -rqE "(^|[^A-Za-z0-9_])${key}([^A-Za-z0-9_]|$)" \
          --include='*.ts' --include='*.tsx' \
          --exclude-dir=node_modules --exclude-dir=.next \
          "$SERVER" 2>/dev/null; then
      missing="${missing}${key}"$'\n'
    fi
  done <<< "$keys"

  if [ -n "$missing" ]; then
    echo "" >&2
    echo "  $label - these keys cross the wire and appear NOWHERE in web-v2:" >&2
    echo "$missing" | sed '/^$/d' | sed 's/^/    · /' >&2
    echo "" >&2
    echo "  Each is either a typo (the field reads nil forever and the screen" >&2
    echo "  draws nothing) or a field the backend never implemented. Fix the" >&2
    echo "  key, implement the field, or exempt it with a reason." >&2
    fail=1
  else
    echo "  $label OK · $total key(s), all present in web-v2"
  fi
}

echo "check-wire-keys · every decoder and emitter against the server's own source"

# The CodingKeys case-line extractor. Shared by the phone (`enum K`) and the
# watch (`enum CodingKeys`) - the header regex is the only difference, so it is
# passed in. Brace depth is tracked so a `case` in an unrelated switch cannot
# be picked up.
awk_codingkeys() {
  cat <<AWK
  /$1/ { inblock = 1; next }
  inblock && /^[[:space:]]*}/  { inblock = 0; next }
  inblock && /^[[:space:]]*case / {
    line = \$0
    sub(/^[[:space:]]*case /, "", line)
    sub(/\\/\\/.*\$/, "", line)
    n = split(line, parts, ",")
    for (i = 1; i <= n; i++) {
      k = parts[i]
      gsub(/[[:space:]]/, "", k)
      if (index(k, "=") > 0) sub(/^[^=]*=/, "", k)
      gsub(/"/, "", k)
      if (k != "") print k
    }
  }
AWK
}

# ── 1 · PHONE, incoming ─────────────────────────────────────────────────────
# Keys the phone decodes that are NOT wire fields need a reason here, and a
# stale entry is itself a finding. (none yet)
check_keys "$SWIFT" "$(awk_codingkeys 'enum K: String, CodingKey')" \
  "phone decoders (APIV5.swift)" ""

# ── 2 · WATCH, incoming ─────────────────────────────────────────────────────
check_keys "$WATCH_MODELS" "$(awk_codingkeys 'enum CodingKeys: String, CodingKey')" \
  "watch decoders (WatchWorkoutModels.swift)" ""

# ── 3 · WATCH, outgoing · the shape with no CodingKeys ──────────────────────
# WatchCompletion and the structs it nests are Encodable with no key map, so
# every stored property name IS a wire key. Extract `let x:` / `var x:` inside
# those struct bodies only - a property on a Decodable-only type is not a wire
# key the server has to write, and a local inside a func is not a property.
#
# EXEMPT here means: the watch EMITS this and the server legitimately does not
# read it. That is a real category - the watch sends more than any one consumer
# needs - so each entry carries its reason and a stale one is a finding.
WATCH_OUT_EXEMPT=""

check_keys "$WATCH_MODELS" '
  /^struct (WatchCompletion|WatchCompletionPhase|PaceSample|HRSample)[ :]/ { inblock = 1; depth = 0 }
  inblock {
    for (i = 1; i <= length($0); i++) {
      c = substr($0, i, 1)
      if (c == "{") depth++
      if (c == "}") { depth--; if (depth == 0) { inblock = 0 } }
    }
    # Stored properties sit at one level of nesting inside the struct body.
    if (inblock && $0 ~ /^[[:space:]]+(let|var) [A-Za-z_][A-Za-z0-9_]*[[:space:]]*:/) {
      line = $0
      sub(/^[[:space:]]+(let|var) /, "", line)
      sub(/[[:space:]]*:.*$/, "", line)
      gsub(/[[:space:]]/, "", line)
      if (line != "") print line
    }
  }
' "watch emitters (WatchCompletion, no CodingKeys)" "$WATCH_OUT_EXEMPT"

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "check-wire-keys OK · phone + watch, both directions"
