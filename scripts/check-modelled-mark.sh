#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-modelled-mark.sh · v5 iPhone · RULE ONE, enforced at build time.
#
#   "A modelled number must never look measured. This is the only real sin.
#    A projected finish, a pace derived from training rather than a race, a
#    projection after time off — all modelled. The amber tilde is the mark,
#    and it is a system rule rather than one screen's fix."
#        — docs/faff-iphone-design-contract.md §1
#
# A rule that lives in eighteen screens' worth of `if projected { "~" }` is a
# rule the nineteenth screen breaks. `FaffValue` makes the right thing easy —
# it has no untyped initialiser, so a number cannot reach a component without
# naming its basis. This script closes the two ways around it.
#
# THREE GUARDS, exit 1 on any violation.
#
#   1 · NO RAW MODELLED FIELD. A v5 view may not print a field the engine
#       marks projected as a bare String. The field names below are the ones
#       `GoalAssessment.basis == 'projected'` covers, plus the projection and
#       trajectory fields. Reaching them means going through V5Number.
#
#   2 · NO HAND-DRAWN TILDE. The mark is `Theme.V5.modelledMark`, rendered by
#       `FaffValueText` as its own amber run. A literal "~" glued into a string
#       can be copied, truncated, or formatted away, and — worse — can be
#       written by a caller who has no idea whether the number is modelled.
#
#   3 · NO HEX IN A V5 VIEW. Not rule one, but the same class of problem and
#       the same place to catch it: a v5 screen paints from the token layer or
#       it does not paint. check-palette-sync.sh locks the tokens; this locks
#       the call sites.
#
# Scope is `native-v2/Faff/Faff/ViewsV5` and `native-v2/Faff/Faff/DesignV5`,
# because those are the v5 surface. The legacy views are on their way out and
# are not scanned — when the last one goes, so does this sentence.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V5_VIEWS="$ROOT/native-v2/Faff/Faff/ViewsV5"
V5_KIT="$ROOT/native-v2/Faff/Faff/DesignV5"
FAIL=0

say()  { printf '%s\n' "$*"; }
bad()  { printf '  ✗ %s\n' "$*"; FAIL=1; }

# `/Volumes/WP` is not APFS, so an AppleDouble `._*` shadow sits beside every
# source file. They are binary resource forks and must never be scanned.
sources() {
  find "$@" -name '*.swift' ! -name '._*' 2>/dev/null
}

[ -d "$V5_VIEWS" ] || mkdir -p "$V5_VIEWS"

# ── 1 · a modelled field may not be printed raw ──────────────────────────────
#
# Every one of these is PROJECTED by the engine's own admission. `basis` is the
# literal string 'projected' on GoalAssessment and covers the first four.
MODELLED_FIELDS='safeTargetSec|stretchTargetSec|reportAgainstSec|weeksToReach|projectionSec|projectedSec|currentEquivalentSec|requiredVdot'

say "check-modelled-mark · rule one"

while IFS= read -r f; do
  [ -n "$f" ] || continue
  # A modelled field inside a Text(...) or a string interpolation, without a
  # FaffValue anywhere on the line, is the sin.
  hits=$(grep -nE "(Text\(|\\\\\()[^)]*($MODELLED_FIELDS)" "$f" \
         | grep -vE 'FaffValue|V5Number|\.value|// *ok:' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      bad "modelled field printed raw · ${f#$ROOT/}:${h%%:*}"
      printf '      %s\n' "$(printf '%s' "$h" | cut -d: -f2- | sed 's/^[0-9]*://' | head -c 140)"
    done <<< "$hits"
  fi
done < <(sources "$V5_VIEWS" "$V5_KIT")

# ── 2 · the mark is not hand-drawn ───────────────────────────────────────────
#
# ValuesV5.swift renders it and is the one file allowed to name it.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in */ValuesV5.swift) continue;; esac
  hits=$(grep -nE '"[^"]*~[^"]*"' "$f" | grep -vE '^\s*[0-9]+:\s*//|// *ok:' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      bad "hand-drawn tilde · ${f#$ROOT/}:${h%%:*} — use FaffValue.modelled and let FaffValueText draw the mark"
    done <<< "$hits"
  fi
done < <(sources "$V5_VIEWS" "$V5_KIT")

# ── 3 · a v5 view paints from the token layer ────────────────────────────────
#
# ThemeV5/TokensV5 hold the palette; a call site may not restate it. The kit's
# own token files are exempt because they ARE the layer.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in */TokensV5.swift|*/ThemeV5.swift) continue;; esac
  hits=$(grep -nE 'Color\(hex:|Color\(red:|#[0-9A-Fa-f]{6}\b' "$f" \
         | grep -vE '^\s*[0-9]+:\s*//|^[0-9]+:\s*//|// *ok:' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      bad "hex at a call site · ${f#$ROOT/}:${h%%:*} — paint from V5.*"
    done <<< "$hits"
  fi
done < <(sources "$V5_VIEWS" "$V5_KIT")

if [ "$FAIL" -ne 0 ]; then
  say ""
  say "RULE ONE · a modelled number must never look measured."
  say "  Build the value with FaffValue.modelled(...) / FaffValue.from(text:modelled:)"
  say "  and render it with FaffValueText. The amber tilde is drawn by the type,"
  say "  never typed into a string."
  exit 1
fi

n=$(sources "$V5_VIEWS" "$V5_KIT" | wc -l | tr -d ' ')
say "check-modelled-mark OK · $n v5 source file(s) clean"
