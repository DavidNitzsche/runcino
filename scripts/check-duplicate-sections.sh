#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-duplicate-sections.sh · RULE 17 ON THE PHONE · one section, one place
#                                                                  (2026-09-08)
#
# Sibling of check-sentence-repetition.sh, and the half of Rule 17 it cannot
# reach. Wired the same way (web-v2 prebuild → Railway build), pure grep/sed/
# awk so it runs on a cold container with no Swift or TypeScript toolchain.
#
#   check-sentence-repetition   the same SENTENCE twice in an authored week.
#   this one                    the same SECTION CARD twice on one screen.
#
# ── WHY THIS EXISTS · DUP-PIECE-1 ───────────────────────────────────────────
#
# `RunDetailV5` drew `RepBreakdownV5` — the "PIECE BY PIECE" card — from TWO
# places at once, and had since before 2026-09-03:
#
#   · `body`, at §6 of the DIGEST-1 hierarchy, guarded on `!repPieces.isEmpty`
#   · `breakdownSection`, which `body` calls at §7, in both its `.sections`
#     and `.milesAndSections` branches
#
# The two guards are the SAME EXPRESSION — `hasSections:` is passed
# `!repPieces.isEmpty` — so this was never an edge case. Every run that
# reached either branch printed the identical card twice, with the same title
# and the same rows. PHASE-GRAIN-1 (2026-09-08) then nested a per-phase mile
# table inside each work row, so the runner's 2026-09-08 tempo printed its four
# tempo miles twice and, confirmed against the real UIKit accessibility tree,
# VoiceOver SPOKE the whole session twice over.
#
# Nothing could tell. The design contract's "no content is printed twice on one
# screen" and Rule 17 are both prose, and Rule 20 is explicit that prose is not
# in force. This is the check.
#
# ── THE RULE ────────────────────────────────────────────────────────────────
#
# Within ONE Swift file, a watched section component is constructed inside AT
# MOST ONE `some View` member.
#
# The member is the unit, not the file, and that is the whole design. Two
# constructions inside one member are almost always the mutually exclusive
# branches of one `switch` — `TodayAfterV5.breakdownSection` builds
# `MileBreakdownV5` in its `.miles` and `.milesAndSections` arms and exactly
# one of them ever runs. Two constructions in two DIFFERENT members is the
# defect shape: one in `body` and one in a helper `body` also calls, both
# executing, on the same screen, on the same data.
#
# ── WHAT IT CANNOT FAIL ON (Rule 22) ────────────────────────────────────────
#
# Say it plainly, because a gate whose limits are unwritten gets trusted past
# them:
#
#   · It is SYNTACTIC. It counts constructor call sites; it does not evaluate
#     guards. Two call sites in two members whose conditions are genuinely
#     exclusive would fail this gate and would need an argued exemption. That
#     is the intended trade: the false positive is cheap and loud, the false
#     negative is what shipped for weeks.
#   · The inverse is the real gap. ONE call site inside a member that `body`
#     renders TWICE — a `ForEach` over a list that repeats, a helper called
#     from two branches that both run — is invisible here, because the source
#     holds one construction. Only rendering catches that, which is Rule 13's
#     job and this gate does not replace it.
#   · It watches a NAMED LIST of components (`WATCHED` below), not every view
#     in the app. A new section card is not covered until it is added. That is
#     deliberate — every small leaf view is legitimately drawn from many
#     members — but it means coverage is a decision somebody has to make, not
#     something this file gives for free.
#   · It says nothing about the OTHER screens' composition, about ordering, or
#     about whether the surviving copy is the right one.
#
# ── THREE GUARDS, exit 1 on any violation ───────────────────────────────────
#
#   1 · LIVENESS · it names how many files it read and how many call sites it
#                  found, and REFUSES on zero of either. A scanner that opens
#                  nothing and reports clean is the worst outcome available,
#                  because it reports confidence too (GATEAUDIT: three guards
#                  of check-modelled-mark.sh once scanned zero files).
#   2 · DUPLICATE · the rule above, over every watched component.
#   3 · RATCHET  · every exemption in EXEMPT still describes a real duplicate.
#                  An exemption whose file is now clean FAILS until deleted.
#
# ── IF THE GATE FIRES ───────────────────────────────────────────────────────
#
# Two members draw the same card. Decide which one YIELDS and delete the other
# — Rule 17 says it yields on the rendered text, not on a row id. Prefer the
# copy whose guard is the SUPERSET, which is what DUP-PIECE-1 turned on: §6
# asks only "is there a list to draw", while `breakdownSection` sits behind
# `readings.splitsMeaningful`, so keeping the second copy would have silently
# dropped the piece list from every run whose splits are untrustworthy.
#
# Do not answer it by renaming a member or by hiding a construction behind a
# helper. That relocates the defect; it does not remove it.
#
# ── FALSIFYING IT (Rule 18) ─────────────────────────────────────────────────
#
# Both directions, and both were run before this file was trusted:
#
#   new violation must fail · restore the deleted line inside
#     `RunDetailV5.breakdownSection`:
#       RepBreakdownV5(title: repSectionTitle, pieces: repPieces)
#     expected: "DUPLICATE SECTION · RepBreakdownV5 · RunDetailV5.swift".
#
#   stale exemption must fail · add any key to EXEMPT over a clean file.
#     expected: "STALE EXEMPTION".
#
#   liveness must fail · point VIEWS at an empty directory.
#     expected: "REFUSING · read 0 files".
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE="${FAFF_DUPSEC_ROOT:-$ROOT/native-v2/Faff/Faff}"

# The section cards. A component earns a place here when it draws a TITLED
# block the runner reads as one thing — the unit the design contract's
# "printed twice on one screen" is about.
WATCHED="RepBreakdownV5 MileBreakdownV5 SessionDetailsGridV5 PostRunVerdictV5"

# key = "<file>:<Component>"; value = the argued reason.
# RATCHET · may shrink, never grow. A stale entry fails until deleted.
# "We might need it" is not a reason.
EXEMPT_KEYS=""
EXEMPT_REASON_FOR() { :; }

fail=0
say() { printf '%s\n' "$*"; }

if [ ! -d "$NATIVE" ]; then
  say "check-duplicate-sections · REFUSING · $NATIVE is not a directory."
  say "  This gate does not create the tree it audits. If the native app moved,"
  say "  point NATIVE at it; do not mkdir past the refusal."
  exit 1
fi

FILES=$(find "$NATIVE" -name '*.swift' -type f | sort)
NFILES=$(printf '%s\n' "$FILES" | grep -c . || true)

# ── GUARD 2 · one component, one member ─────────────────────────────────────
#
# awk walks each file tracking brace depth and the name of the innermost
# `some View` member it is inside. A construction is a watched identifier
# followed by `(`. Definitions (`struct X`), static helpers (`X.pieces(`) and
# type references never match, because the pattern demands the bare name and
# an immediately following paren.
REPORT=$(printf '%s\n' "$FILES" | while IFS= read -r f; do
  [ -n "$f" ] || continue
  awk -v file="$f" -v watched="$WATCHED" '
    BEGIN {
      n = split(watched, w, " ")
      for (i = 1; i <= n; i++) want[w[i]] = 1
      depth = 0; member = ""; memberDepth = -1
    }
    {
      line = $0
      sub(/\/\/.*$/, "", line)          # strip line comments

      # Entering a `some View` member? `var body: some View {`,
      # `var routeSection: some View {`, `func x(...) -> some View {`.
      if (member == "" && line ~ /some View/) {
        nm = ""
        if (match(line, /var[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*:[ \t]*some View/)) {
          s = substr(line, RSTART, RLENGTH)
          sub(/^var[ \t]+/, "", s); sub(/[ \t]*:.*$/, "", s); nm = s
        } else if (match(line, /func[ \t]+[A-Za-z_][A-Za-z0-9_]*/)) {
          s = substr(line, RSTART, RLENGTH); sub(/^func[ \t]+/, "", s); nm = s
        }
        if (nm != "") { member = nm; memberDepth = depth }
      }

      if (member != "") {
        for (name in want) {
          rest = line
          while (match(rest, "(^|[^A-Za-z0-9_.])" name "\\(")) {
            print file "\t" member "\t" name
            rest = substr(rest, RSTART + RLENGTH)
          }
        }
      }

      # brace accounting, last, so an opening line counts as inside
      nopen = gsub(/{/, "{", line)
      nclose = gsub(/}/, "}", line)
      depth += nopen - nclose
      if (member != "" && depth <= memberDepth) { member = ""; memberDepth = -1 }
    }
  ' "$f"
done)

NSITES=$(printf '%s\n' "$REPORT" | grep -c . || true)

# ── GUARD 1 · LIVENESS ──────────────────────────────────────────────────────
say "check-duplicate-sections · read $NFILES Swift files under ${NATIVE#$ROOT/}"
say "  watched components: $WATCHED"
say "  construction sites found: $NSITES"
if [ "$NFILES" -eq 0 ]; then
  say "REFUSING · read 0 files. A scanner that opens nothing and reports clean"
  say "  is the bug this gate exists to catch, one level up."
  exit 1
fi
if [ "$NSITES" -eq 0 ]; then
  say "REFUSING · found 0 construction sites for any watched component."
  say "  Either the components were renamed or the matcher stopped matching."
  say "  Reporting clean on nothing is not a pass."
  exit 1
fi

# Distinct (file, component) pairs drawn from more than one member.
DUPES=$(printf '%s\n' "$REPORT" | grep . \
  | awk -F'\t' '{ key = $1 "\t" $3; if (!seen[key "\t" $2]++) count[key]++; \
                  if (members[key] == "") members[key] = $2; \
                  else if (members[key] !~ ("(^|, )" $2 "(,|$)")) members[key] = members[key] ", " $2 } \
       END { for (k in count) if (count[k] > 1) print k "\t" members[k] }' | sort)

while IFS=$'\t' read -r f comp members; do
  [ -n "${f:-}" ] || continue
  base=$(basename "$f")
  key="$base:$comp"
  case " $EXEMPT_KEYS " in
    *" $key "*) say "  exempt · $key" ; continue ;;
  esac
  say ""
  say "DUPLICATE SECTION · $comp · $base"
  say "  drawn from $members"
  say "  Rule 17: the runner reads a sentence once, and the design contract"
  say "  forbids printing the same content twice on one screen. Decide which"
  say "  member yields and delete the other — see this script's header."
  fail=1
done <<EOF
$DUPES
EOF

# ── GUARD 3 · RATCHET · a stale exemption fails ─────────────────────────────
for key in $EXEMPT_KEYS; do
  hit=0
  while IFS=$'\t' read -r f comp _; do
    [ -n "${f:-}" ] || continue
    [ "$(basename "$f"):$comp" = "$key" ] && hit=1
  done <<EOF
$DUPES
EOF
  if [ "$hit" -eq 0 ]; then
    say ""
    say "STALE EXEMPTION · $key no longer draws twice. Delete the entry."
    say "  An allowlist that outlives its violation is how a gate quietly"
    say "  stops meaning anything."
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  say "check-duplicate-sections · clean · no watched component is drawn from"
  say "  two members of one file."
fi
exit "$fail"
