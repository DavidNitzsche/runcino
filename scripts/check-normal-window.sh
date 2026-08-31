#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-normal-window.sh · RULE 8 · a taper is never the runner's normal (2026-08-30)
#
# Thirteenth sibling of check-palette-sync.sh / check-doctrine.sh /
# check-swallowed-failure.sh / check-automatic-mutations.sh, wired the same way
# (web-v2 prebuild → Railway build).
#
#   check-doctrine           stops a bad NUMBER reaching a runner's legs.
#   check-swallowed-failure  stops a FAILED READ being served as a FACT.
#   check-automatic-mutations stops a JOB CHANGING TRAINING without saying so.
#   this one                 stops the engine MEASURING A RUNNER DURING A WEEK
#                            IT TOLD HIM TO REST and calling that who he is.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
#
# CLAUDE.md Rule 8, locked at the owner's explicit instruction, given twice, the
# second time as an absolute: "It cannot look at taper and recover as my
# 'normal'. Ever."
#
# Six distinct defects in one engine, every one found by the runner and none by
# any gate, because every output was well-formed and only the WINDOW was wrong:
#
#   · a 28-day mean read 31.6 mi/wk against a sustained 43.5, and the marathon
#     block opened at 31;
#   · a 14-day easy median read 4.0 mi for a runner whose easy days are 3-7.8;
#   · quality-per-week read 0 for a runner whose habit is two;
#   · a long-run ramp anchored to a 13.5 mi taper long instead of the 18.0 he
#     ran on 2026-07-25;
#   · the return-to-volume ladder switched off entirely;
#   · a six-day-a-week runner would have been capped at five.
#
# Every number was arithmetically correct against its window. That is precisely
# why no existing gate saw any of it: they all sample the OUTPUT and ask whether
# each point is legal, and a number measured over the wrong window is legal.
#
# ── THREE GUARDS, exit 1 on any violation ───────────────────────────────────
#
#   1 · SHAPE   · the shared filter module and the registry both exist, export
#                 the symbols the rest of the app imports, and the registry has
#                 not been gutted. Pure sed and grep, so it runs on a cold
#                 container with no TypeScript toolchain — the same posture as
#                 check-doctrine.sh.
#
#   2 · GATE    · the scanner and its liveness assertion still exist. This file
#     PRESENT     cannot be made to pass by deleting the thing it runs, and it
#                 cannot be satisfied by a comment: the greps demand the real
#                 `describe`/`it` and the real predicate constants.
#
#   3 · FULL    · the vitest gate: no unguarded habit read over a rolling
#     GATE        window, the allowlist ratchet, the count-pinned hand-off, and
#                 the scanner-liveness probe that fails LOUDLY rather than
#                 reporting clean when the predicate stops matching. Two gates
#                 in this repo have shipped green because they scanned zero
#                 files; that is the failure this probe exists to prevent.
#
# ── IF THE GATE FIRES ───────────────────────────────────────────────────────
#
# You added a reader that answers "what does this runner normally do" without
# excluding the days the engine itself prescribed. Import the filter from
# web-v2/lib/training/normal-window.ts. Two clauses are easy to get wrong:
#
#   · EXCLUDE, DO NOT WIDEN. A longer window still contains the taper; it only
#     dilutes it. A reader "fixed" by reaching for 90 days instead of 14 has the
#     wrong shape even when the number improves.
#   · IF EXCLUDING LEAVES TOO LITTLE DATA, REFUSE — and keep that refusal
#     distinguishable from a measured zero. A zero because the plan prescribed
#     recovery and a zero because the runner is detrained are OPPOSITE FACTS.
#
# If the reader is genuinely exempt — execution rather than habit, a load model
# that is supposed to move, or a race detector — add an argued entry to
# NORMAL_WINDOW_EXEMPTIONS. Do NOT loosen a floor to make this pass.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOD="$ROOT/web-v2/lib/training/normal-window.ts"
REG="$ROOT/web-v2/lib/audit/normal-window-registry.ts"
GATE="$ROOT/web-v2/lib/audit/_normal_window_scan.test.ts"
fail=0

say() { printf '%s\n' "$*"; }
bad() { printf '  FAIL · %s\n' "$*"; fail=1; }

say "check-normal-window · a taper or a recovery window is never the runner's normal"

# ── GUARD 1 · the module and the registry ───────────────────────────────────
say "guard 1 · module + registry shape"

if [ ! -f "$MOD" ]; then
  bad "shared filter missing: $MOD · Rule 8 has no single definition to point at"
else
  # The API every habit reader imports. A rename that skips this list is a
  # rename that leaves callers re-implementing the predicate by hand, which is
  # the state the module was written to end.
  for sym in \
    "export const NORMAL_TRAINING_DAY_SQL" \
    "export function normalTrainingDaySql" \
    "export function normalWindowParams" \
    "export function isPrescribedNonNormal" \
    "export function representativeDayCount" \
    "export async function loadPrescribedWindows" \
    "export async function normalWeeklyMileage" \
    "export type NormalReading"
  do
    grep -q "$sym" "$MOD" || bad "module lost '$sym'"
  done

  # The doctrine numbers must be REUSED, never re-derived. A second copy of the
  # taper table is exactly the drift Rule 7's lint exists to catch, and Rule 8
  # names both sources explicitly.
  grep -q "TAPER_WEEKS_BY_DISTANCE" "$MOD" \
    || bad "module no longer reuses TAPER_WEEKS_BY_DISTANCE · it must not re-derive a taper table"
  grep -q "postRaceRecoveryWeeks" "$MOD" \
    || bad "module no longer reuses postRaceRecoveryWeeks · it must not re-derive a recovery table"
  if grep -qE "taperWeeks:\s*[0-9]" "$MOD"; then
    bad "module declares its own taperWeeks literals · reuse the doctrine-bound table"
  fi

  # Clause 2 of the rule. A module that cannot refuse will always answer.
  grep -q "not-enough-representative-training" "$MOD" \
    || bad "module lost its refusal code · it must be able to say 'too little to answer'"
fi

if [ ! -f "$REG" ]; then
  bad "registry missing: $REG"
else
  exempt=$(grep -cE "^\s+file: '[^']+'," "$REG" || true)
  reasons=$(grep -cE "^\s+reason:$|^\s+reason: '" "$REG" || true)

  if [ "$exempt" -lt 10 ]; then
    bad "only $exempt file entries · the registry has been gutted (expected 10+)"
  fi
  if [ "$reasons" -lt "$exempt" ]; then
    bad "$exempt file entries but $reasons reasons · every entry is argued or it is not an entry"
  fi

  for sym in "NORMAL_WINDOW_EXEMPTIONS" "NORMAL_WINDOW_HANDOFF" "HABIT_READERS"; do
    grep -q "export const $sym" "$REG" || bad "registry lost '$sym'"
  done

  # A hand-off is not an exemption. It is a count-pinned, self-expiring record
  # of a file that IS broken — so it must carry a number, or it is just an
  # exemption wearing a different word.
  grep -qE "^\s+findings: [0-9]+," "$REG" \
    || bad "no count-pinned hand-off entry · a hand-off without a number cannot expire"

  [ "$fail" = "0" ] && say "  ok · module exports intact, $exempt registry entries, all argued"
fi

# ── GUARD 2 · the gate still exists ─────────────────────────────────────────
say "guard 2 · gate present"
if [ ! -f "$GATE" ]; then
  bad "gate missing: $GATE · this check cannot be satisfied by deleting it"
else
  # Demand the real describe/it, not prose mentioning them. A tamper-check a
  # tamperer passes by writing a comment is not a tamper-check (GATEAUDIT-4).
  grep -qE "describe\(['\"]NORMALWINDOW-1" "$GATE" \
    || bad "gate lost its NORMALWINDOW-1 describe block"
  grep -qE "it\(['\"]the scanner still reads real source" "$GATE" \
    || bad "gate lost its liveness probe · a scanner that reads nothing reports clean"
  for sym in "ROLLING_WINDOW" "HABIT_AGGREGATE" "FILTER_MODULE" "extractStringLiterals"; do
    grep -q "$sym" "$GATE" || bad "gate lost '$sym'"
  done
  [ "$fail" = "0" ] && say "  ok · gate present with its liveness probe"
fi

# ── GUARD 3 · run it ────────────────────────────────────────────────────────
say "guard 3 · full gate"
if [ ! -d "$ROOT/web-v2/node_modules" ]; then
  say "  skip · no node_modules (cold container) · guards 1 and 2 stand"
else
  if ( cd "$ROOT/web-v2" && npx vitest run lib/audit/_normal_window_scan.test.ts >/tmp/_normwin.log 2>&1 ); then
    say "  ok · $(grep -oE 'Tests  [0-9]+ passed' /tmp/_normwin.log | tail -1)"
  else
    bad "vitest gate failed · output follows"
    tail -40 /tmp/_normwin.log
  fi
fi

if [ "$fail" != "0" ]; then
  say ""
  say "FAILED · read the header of this file before changing anything."
  exit 1
fi
say "PASS"
