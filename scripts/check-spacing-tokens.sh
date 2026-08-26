#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-spacing-tokens.sh · the v5 iPhone spacing scale, enforced (2026-08-25)
#
# David, live in the simulator, after a run of one-off polish fixes:
# "The spacing is all fucking retarded... we need some guardrails and rules
# in place... I need to approach this with the highest level of app finishing
# and finesse possible."
#
# The scale (`V5.S` in DesignV5/TokensV5.swift) was never the problem — it is
# a complete 2/4/6/8/9/10/12/14/16/20/24/32/40/56/72/96/128 ladder plus the
# named semantic steps (gutter, tilePad, inGroup, betweenGroups). The problem
# was that call sites kept reaching past it: an audit the same day found 24
# `.padding()` calls and 20 `spacing:` arguments written as bare numeric
# literals across ViewsV5/ and DesignV5/ — some coincidentally matching a rung
# (`.padding(.vertical, 10)` instead of `V5.S.s10`), some genuinely off the
# ladder (`14`, `9`, `22`, `26`, `34` — no token existed at any of those
# values). Every one was fixed in the commit this script ships with; `s9`
# and `s14` were added to the ladder because six-plus call sites had already
# converged on 14 informally and it was clearly a real, recurring measurement,
# not noise to snap away.
#
# This is the tripwire that keeps it from drifting back. It does not check
# WHICH token a value should be — that is a design judgement this script
# cannot make — only that a call site (padding, HStack/VStack spacing) went
# through `V5.S.*` or `TypeScaleV5.*` rather than typing a number by hand.
#
# ── WHAT COUNTS AS A VIOLATION ──────────────────────────────────────────────
#
#   .padding([.axis,] <bare number>)
#   HStack(..., spacing: <bare number>)
#   VStack(..., spacing: <bare number>)
#
# `spacing: 0` is exempt outright — a deliberate zero-gap stack states an
# intent no token can express ("touching"), not a missing rung.
#
# ── EXEMPTIONS ──────────────────────────────────────────────────────────────
#
# A line preceded (within 6 lines, to tolerate this codebase's own habit of
# multi-line explanatory comments) by one containing the literal marker
# `v5-spacing-exempt` is skipped — for a genuine one-off (an optical hairline
# nudge, a value tied to a system metric rather than the design's own scale),
# named and justified at the call site rather than silently ignored by this
# script. `ComponentsV5.swift`'s checkbox-circle `.padding(.top, 1)` is the
# first of these; grep for the marker to find the rest as they accrue.
#
# Wire-up: chained into `web-v2`'s `npm run prebuild`, same as
# check-palette-sync.sh — which also scans native-v2/ from there and is,
# despite living beside an Xcode project, likewise not an actual Xcode Run
# Script build phase. Matching the precedent rather than half-fixing it here.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE="$ROOT/native-v2/Faff/Faff"
fail=0

if [ ! -d "$NATIVE/ViewsV5" ] || [ ! -d "$NATIVE/DesignV5" ]; then
  echo "spacing-tokens SKIP · native-v2/Faff/Faff/ViewsV5 or DesignV5 not found (not this checkout)"
  exit 0
fi

# One pass per directory, one file at a time — need the file's own text to
# check the preceding line for the exemption marker and to skip AppleDouble
# sidecars, which `find` on the WP volume otherwise happily hands to grep.
scan_dir() {
  local dir="$1"
  find "$dir" -name '*.swift' ! -name '._*' -print0 | while IFS= read -r -d '' file; do
    # `.padding(` with an axis or bare, ending in a plain integer/decimal —
    # never `.padding(V5.S....)`, `.padding(someVar)`, `.padding()`.
    grep -nE '\.padding\((\.(horizontal|vertical|top|bottom|leading|trailing))?,?[[:space:]]*[0-9]+(\.[0-9]+)?\)' "$file" | while IFS=: read -r lineno rest; do
      # A multi-line comment block can sit several lines above the call this
      # codebase's own documentation habit runs long — check a short window,
      # not just the one immediately-preceding line.
      win_start=$((lineno - 6)); [ "$win_start" -lt 1 ] && win_start=1
      window="$(sed -n "${win_start},$((lineno - 1))p" "$file")"
      if [[ "$window" == *"v5-spacing-exempt"* ]]; then continue; fi
      echo "$file:$lineno: $rest"
    done
    # `spacing: N)` inside an HStack/VStack call — exempt spacing: 0.
    grep -nE '(HStack|VStack)\([^)]*spacing:[[:space:]]*[0-9]+(\.[0-9]+)?\)' "$file" | while IFS=: read -r lineno rest; do
      if echo "$rest" | grep -qE 'spacing:[[:space:]]*0\)'; then continue; fi
      win_start=$((lineno - 6)); [ "$win_start" -lt 1 ] && win_start=1
      window="$(sed -n "${win_start},$((lineno - 1))p" "$file")"
      if [[ "$window" == *"v5-spacing-exempt"* ]]; then continue; fi
      echo "$file:$lineno: $rest"
    done
  done
}

hits="$(scan_dir "$NATIVE/ViewsV5"; scan_dir "$NATIVE/DesignV5")"

if [ -n "$hits" ]; then
  echo "SPACING-TOKENS FAIL · bare numeric literal where a V5.S.* token belongs:"
  echo "$hits"
  echo
  echo "  Fix: use the nearest V5.S.* rung (see DesignV5/TokensV5.swift for the"
  echo "  full ladder — 2/4/6/8/9/10/12/14/16/20/24/32/40/56/72/96/128, plus"
  echo "  gutter/tilePad/inGroup/betweenGroups). If the value is a genuine"
  echo "  design measurement no rung covers and it is NOT a one-off (it will"
  echo "  recur), that is a real gap in the ladder — add the rung to"
  echo "  DesignV5/TokensV5.swift rather than writing the number by hand at"
  echo "  each call site. If it truly is a one-off (an optical nudge, a value"
  echo "  tied to a system metric), mark the line above it with a comment"
  echo "  containing 'v5-spacing-exempt' and say why."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "spacing-tokens OK · every padding/spacing call in ViewsV5 + DesignV5 goes through V5.S.*"
fi
exit $fail
