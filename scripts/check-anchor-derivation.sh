#!/usr/bin/env bash
#
# check-anchor-derivation · CLAUDE.md Rule 10 · a persisted derived value
# carries its anchor, or it is recomputed.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS
#
# A value derived from a physiological anchor — LTHR, HRmax, VDOT, threshold
# pace — that is written to a row and read back as authoritative goes stale
# silently when the anchor moves, and EVERY EXISTING GUARD IS BLIND TO IT BY
# CONSTRUCTION. lib/runs/derived-registry.ts has nine families and all nine ask
# whether a row agrees with ITSELF. reconcileHrZones asks whether five numbers
# sum to 100.
#
# A stale distribution is internally perfect. That is exactly why it survives.
#
# The owner's easy 13.5-mile long run displayed 60% Zone 5 because its zone
# shares were frozen at an LTHR of 162 that has since been re-derived to 168.
# Two sibling defects had the same shape and the same false comment — that
# "the next briefing/render will re-load HR anchors":
#
#   · ANCHOR-STALE-2 · lib/plan/recompute-paces.ts   (fixed db3fb5e7)
#   · ANCHOR-STALE-3 · lib/plan/adapt.ts             (fixed with this gate)
#
# Nothing re-loads them. Rendering and briefing are READ paths, and no read
# path writes workout_spec.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT IT CHECKS
#
#   1. The registry parses, with a FLOOR on every extractor. Zero is never a
#      pass — a gate that reads nothing and reports clean is the worst outcome
#      available, because it also reports confidence.
#   2. Every registry entry's `anchor:` string still appears in the file it
#      names. Rule 7: anchor on quoted text, never a line number.
#   3. Every registry entry's `file:` exists.
#   4. POSITIVE AND NEGATIVE CONTROLS: a synthetic call with a null anchor must
#      be detected, and the same call with live anchors must not. Either
#      control failing exits 1 BEFORE any finding is reported.
#   5. The deep scan (argument-position parsing, writer resolution through
#      lib/audit/sql-scan.ts, the ratchets) runs in
#      lib/audit/_anchor_derivation_scan.test.ts, which this script invokes when
#      a node_modules is present and SKIPS WITH A LOUD NOTICE when it is not —
#      never silently.
#
# ─────────────────────────────────────────────────────────────────────────────
# THE FORMAT CONTRACT
#
# Each registry entry keeps `id:`, `posture:` and `anchor:` on ONE line each,
# single-quoted. That is what lets this script read the registry with no
# TypeScript toolchain, on a cold container, exactly as check-doctrine.sh reads
# its claims. Break the contract and the extractor floor below fails the build
# rather than quietly reading fewer sites.
#
# ─────────────────────────────────────────────────────────────────────────────
# THE TRAPS THIS SCRIPT IS WRITTEN AROUND (all shipped in this repo before)
#
#   · check-modelled-mark.sh ran `mkdir -p` on the directory it audited, then
#     scanned zero files and reported clean. NOTHING here creates anything, and
#     every path is asserted to exist before it is read.
#   · check-automatic-mutations.sh's tamper check was `grep -q "GUARD 0"`,
#     which any comment satisfies. The controls here run the real matcher over
#     real strings and compare counts.
#   · `set -o pipefail` plus a truncating consumer (`| head`) turns a successful
#     grep into a failure. No pipeline here ends in one.
#   · check-palette-sync.sh named two files that no longer existed, in the
#     header of the script whose job is catching exactly that rot. Every path
#     this script names is checked at runtime.
#
# Sibling of check-doctrine.sh and check-derived-consistency.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="$ROOT/web-v2/lib/audit/anchor-derivation-registry.ts"
SCANNER="$ROOT/web-v2/lib/audit/anchor-derivation-scan.ts"
SUITE="$ROOT/web-v2/lib/audit/_anchor_derivation_scan.test.ts"

fail() { echo "FAIL  check-anchor-derivation · $*" >&2; exit 1; }

# ── 0 · THE GATE'S OWN FILES EXIST ───────────────────────────────────────────
# Named rather than globbed, because the failure this catches is a rename that
# leaves the gate pointing at nothing.
for f in "$REGISTRY" "$SCANNER" "$SUITE"; do
  [ -f "$f" ] || fail "missing $f — the gate cannot audit what it cannot read"
done

# ── 1 · EXTRACT THE REGISTRY, WITH FLOORS ────────────────────────────────────
ids=$(grep -cE "^[[:space:]]+id: '" "$REGISTRY" || true)
postures=$(grep -cE "^[[:space:]]+posture: '" "$REGISTRY" || true)
anchors=$(grep -cE "^[[:space:]]+anchor: '" "$REGISTRY" || true)
builders=$(grep -cE "^[[:space:]]+fn: '" "$REGISTRY" || true)

[ "$ids" -gt 0 ]      || fail "extracted 0 site ids — the format contract is broken, not the registry empty"
[ "$builders" -gt 0 ] || fail "extracted 0 derivation builders — nothing would ever be scanned"
[ "$ids" -eq "$postures" ] || fail "$ids ids but $postures postures — every site declares exactly one posture"
[ "$ids" -eq "$anchors" ]  || fail "$ids ids but $anchors anchors — every site anchors on verbatim quoted text"

# Postures must be from the closed set Rule 10 names. A typo'd posture would
# otherwise read as a declared one.
while IFS= read -r p; do
  case "$p" in
    recompute|stamped|refuse-or-label|exempt) ;;
    *) fail "unknown posture '$p' — Rule 10 names recompute, stamped, refuse-or-label, exempt" ;;
  esac
done < <(sed -nE "s/^[[:space:]]+posture: '([^']*)'.*/\1/p" "$REGISTRY")

# ── 2 · EVERY ENTRY POINTS AT REAL CODE ──────────────────────────────────────
# Rule 7 · anchor on quoted text. This is the check that makes a fix DELETE its
# own exemption instead of leaving it standing and meaningless.
files=$(sed -nE "s/^[[:space:]]+file: '([^']*)'.*/\1/p" "$REGISTRY")
[ -n "$files" ] || fail "extracted 0 site files"

checked=0
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  [ -f "$ROOT/$rel" ] || fail "registry names $rel, which does not exist"
  checked=$((checked + 1))
done <<< "$files"
[ "$checked" -gt 0 ] || fail "verified 0 registry files"

# Pair each anchor with the file declared just above it and require a verbatim
# match. awk rather than a shell loop so a quote or a backslash in the anchor
# survives intact.
missing=$(awk -v root="$ROOT" '
  /^[[:space:]]+file: '\''/ {
    line = $0
    sub(/^[[:space:]]+file: '\''/, "", line)
    sub(/'\''.*$/, "", line)
    file = line
    next
  }
  /^[[:space:]]+anchor: '\''/ {
    line = $0
    sub(/^[[:space:]]+anchor: '\''/, "", line)
    sub(/'\'',?[[:space:]]*$/, "", line)
    gsub(/\\'\''/, "'\''", line)
    if (file == "") next
    path = root "/" file
    found = 0
    while ((getline src < path) > 0) {
      if (index(src, line) > 0) { found = 1; break }
    }
    close(path)
    if (!found) print file " :: " line
    file = ""
  }
' "$REGISTRY")

if [ -n "$missing" ]; then
  echo "$missing" >&2
  fail "registry anchors no longer appear in their files (above) · re-point or delete them"
fi

# ── 3 · CONTROLS · Rule 18 point 1, on every build ───────────────────────────
# The matcher these exercise is the one property the shell half actually owns:
# that an anchor argument written as a bare `null` is findable in source. The
# argument-POSITION parsing is TypeScript and is controlled in the suite.
probe_pos='buildWorkoutSpec(type, mi, t, null, label, null);'
probe_neg='buildWorkoutSpec(type, mi, t, lthr, label, maxHr);'

echo "$probe_pos" | grep -qE 'buildWorkoutSpec\([^)]*,[[:space:]]*null' \
  || fail "POSITIVE CONTROL failed · the matcher cannot see a null anchor it was handed"
if echo "$probe_neg" | grep -qE 'buildWorkoutSpec\([^)]*,[[:space:]]*null'; then
  fail "NEGATIVE CONTROL failed · the matcher flags a call whose anchors are live"
fi

# The registry must still describe the builder the app actually calls. A rename
# that silences the scanner is the ANCHOR-STALE class turned on the gate itself.
#
# EXCLUDING lib/audit/ IS LOAD-BEARING, and this line is here because the check
# was written without it and passed a deliberate falsification. The registry
# lives under web-v2/lib, so a plain recursive grep for the builder name matched
# THE REGISTRY'S OWN DECLARATION and the check could never fail — the same shape
# as check-automatic-mutations.sh's `grep -q "GUARD 0"`, which any comment
# satisfied. The name must appear in code the gate does not own.
for dir in "$ROOT/web-v2/lib/plan" "$ROOT/web-v2/app"; do
  [ -d "$dir" ] || fail "missing $dir — cannot confirm the builders are still called"
done
while IFS= read -r fn; do
  [ -n "$fn" ] || continue
  grep -rqlE "\b${fn}\b" "$ROOT/web-v2/lib/plan" "$ROOT/web-v2/app" \
    || fail "registry declares builder '$fn', which nothing under lib/plan or app calls · the gate is watching nothing"
done < <(sed -nE "s/^[[:space:]]+fn: '([^']*)'.*/\1/p" "$REGISTRY")

# ── 4 · THE DEEP SCAN ────────────────────────────────────────────────────────
# Argument-position parsing, writer resolution through sql-scan.ts, and both
# ratchets live in the vitest suite. Run it when a toolchain is present; say so
# loudly when it is not. A silent skip is how a gate stops meaning anything.
if [ -x "$ROOT/web-v2/node_modules/.bin/vitest" ]; then
  ( cd "$ROOT/web-v2" && ./node_modules/.bin/vitest run lib/audit/_anchor_derivation_scan.test.ts ) \
    || fail "the ANCHORSTAMP-1 suite failed (above)"
else
  echo "NOTE  check-anchor-derivation · no vitest binary; ran registry + control checks only." >&2
  echo "NOTE  the argument-position scan and both ratchets DID NOT RUN." >&2
fi

# The file count exceeds the site count by the number of declared builder
# forks, which carry a `file:` of their own. Both are reported so a drift
# between them is visible rather than averaged away.
echo "ok    check-anchor-derivation · $ids sites, $checked declared files verified, controls passed"
