#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-race-week-canonical-reads.sh · RACEWEEK-CONSOLIDATION-1 (2026-09-11)
#
# Sibling of check-normal-window.sh / check-doctrine.sh / check-active-plan-*
# (wired the same way once this passes review: web-v2 prebuild -> Railway
# build). Stops the ELEVENTH undisclosed instance of the
# `is_race_week`-column-only bug shape from landing silently.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
#
# `plan_weeks.is_race_week` marks ONLY the plan's GOAL race's week
# (lib/plan/race-week.ts's own header). A B/C tune-up embedded mid-block reads
# `is_race_week = false` even though the runner races that week too. Nine
# confirmed instances of the exact same shape were fixed piecemeal in one
# session before this gate existed — dose-guard.ts, adapt.ts, mutate.ts,
# progression-pass.ts (x2), the sick-ladder in replan/route.ts,
# load-adaptation-engine.ts, replan-scenarios.ts (x5-ish), move-orchestrator.ts
# — and an independent reviewer found TWO of those nine had themselves been
# missed by an earlier "exhaustive" search claim. This pass fixed four more
# (strategy-contracts.ts, adjudication/adjudicate.ts,
# adjudication/live-sequence.ts, adjudication-corpus.ts) and built this gate
# so the pattern stops being found by David on his phone.
#
# ── THE FIVE CANONICAL ANSWERS ───────────────────────────────────────────────
#
#   GOAL RACE            isGoalRaceWeek / plan_weeks.is_race_week itself
#                         (lib/plan/race-week.ts)
#   RACE WEEK, any        weekContainsRace (lib/plan/race-week.ts)
#     priority
#   RACE DAY              type === 'race' on the day itself
#   GOAL/TUNEUP/           resolveRaceWeekRole (lib/plan/race-week-role.ts)
#     CONTROLLED/NONE
#   PlannedWeek            containsRaceOf (lib/plan/adjudication/adjudicate.ts)
#     (adjudicate.ts)
#
# ── TWO GUARDS, exit 1 on any violation ──────────────────────────────────────
#
#   1 · SHAPE   · the registry and the scanner both exist and export/contain
#                 the symbols the rest of this check depends on. Pure grep, so
#                 it runs on a cold container with no TypeScript toolchain —
#                 the same posture as check-doctrine.sh and check-normal-window.
#
#   2 · FULL    · the vitest scanner itself: every file that reads
#     GATE        is_race_week/isRaceWeek is registered with an EXACT, argued
#                 count (Rule 18 §4's ratchet, both directions — a stale pin
#                 fails exactly like a new unreviewed read), the registry is
#                 shaped correctly (every entry argued, no duplicate files),
#                 and the five canonical answers are still exported and still
#                 agree with each other on a goal-week case.
#
# ── IF THE GATE FIRES ───────────────────────────────────────────────────────
#
# Read the vitest failure. Two shapes:
#
#   · "NO registry entry" — you added a new raw read. Route it through
#     weekContainsRace / isGoalRaceWeek / resolveRaceWeekRole / containsRaceOf
#     instead of reading the column/field directly. If the raw, goal-only read
#     is genuinely correct (see race-week-role.ts's RACEWEEK-2 ruling: a B/C
#     week must NOT be assumed an automatic taper/dip), add an argued
#     RACE_WEEK_EXEMPTIONS entry in
#     web-v2/lib/audit/race-week-canonical-registry.ts explaining WHY, not
#     just that it is.
#   · "drifted from their registered count" — you changed an already-exempt
#     file. If the count went UP, a new site landed there and needs the same
#     treatment as above. If it went DOWN, the registry is stale — lower the
#     pin in the same change (Rule 18 §4: an exemption whose target has
#     changed is re-argued, not left pointing at a number that no longer
#     exists).
#
# Never widen the scanner's regex to stop matching a real site, and never
# delete a registry entry to make a failure go away without also fixing (or
# arguing) the underlying read.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REG="$ROOT/web-v2/lib/audit/race-week-canonical-registry.ts"
GATE="$ROOT/web-v2/lib/audit/_race_week_canonical_scan.test.ts"
RACE_WEEK="$ROOT/web-v2/lib/plan/race-week.ts"
RACE_WEEK_ROLE="$ROOT/web-v2/lib/plan/race-week-role.ts"
ADJUDICATE="$ROOT/web-v2/lib/plan/adjudication/adjudicate.ts"
fail=0

say() { printf '%s\n' "$*"; }
bad() { printf '  FAIL · %s\n' "$*"; fail=1; }

say "check-race-week-canonical-reads · is_race_week is goal-only, and every raw read of it is accounted for"

# ── GUARD 1 · shape ─────────────────────────────────────────────────────────
say "guard 1 · canonical definitions + registry + gate shape"

for sym_file in \
  "export function isGoalRaceWeek|$RACE_WEEK" \
  "export function weekContainsRace|$RACE_WEEK" \
  "export function racePresence|$RACE_WEEK" \
  "export function resolveRaceWeekRole|$RACE_WEEK_ROLE" \
  "export function resolveRaceWeekRoleWithoutPriority|$RACE_WEEK_ROLE" \
  "export function containsRaceOf|$ADJUDICATE"
do
  sym="${sym_file%%|*}"
  file="${sym_file##*|}"
  if [ ! -f "$file" ]; then
    bad "canonical definition file missing: $file"
  elif ! grep -q "$sym" "$file"; then
    bad "$file lost '$sym' · a canonical answer this whole gate depends on is gone"
  fi
done

if [ ! -f "$REG" ]; then
  bad "registry missing: $REG"
else
  entries=$(grep -cE "^\s+file: '[^']+'," "$REG" || true)
  args=$(grep -cE "^\s+argument:" "$REG" || true)
  if [ "$entries" -lt 30 ]; then
    bad "only $entries registry entries · the registry has been gutted (expected 30+)"
  fi
  if [ "$args" -lt "$entries" ]; then
    bad "$entries entries but $args arguments · every entry must be argued (Rule 18 §4)"
  fi
  for sym in "RACE_WEEK_EXEMPTIONS" "RACE_WEEK_REGISTERED_FILES" "RaceWeekExemptionReason"; do
    grep -q "$sym" "$REG" || bad "registry lost '$sym'"
  done
  [ "$fail" = "0" ] && say "  ok · $entries registry entries, all argued"
fi

if [ ! -f "$GATE" ]; then
  bad "gate missing: $GATE · this check cannot be satisfied by deleting it"
else
  grep -qE "describe\(['\"]RACEWEEK-SCAN-1" "$GATE" \
    || bad "gate lost its RACEWEEK-SCAN-1 describe block"
  grep -qE "it\(['\"]LIVENESS" "$GATE" \
    || bad "gate lost its liveness probe · a scanner that reads nothing reports clean"
  grep -qE "it\(['\"]THE RATCHET" "$GATE" \
    || bad "gate lost its ratchet check · new/stale reads would go unnoticed"
  for sym in "RACE_WEEK_EXEMPTIONS" "walk\(" "MATCH ="; do
    grep -qE "$sym" "$GATE" || bad "gate lost '$sym'"
  done
  [ "$fail" = "0" ] && say "  ok · gate present with its liveness + ratchet probes"
fi

# ── GUARD 2 · run it ─────────────────────────────────────────────────────────
say "guard 2 · full gate"
if [ ! -d "$ROOT/web-v2/node_modules" ]; then
  say "  skip · no node_modules (cold container) · shape checks above stand"
else
  if ( cd "$ROOT/web-v2" && npx vitest run lib/audit/_race_week_canonical_scan.test.ts >/tmp/_raceweekscan.log 2>&1 ); then
    say "  ok · $(grep -oE 'Tests  [0-9]+ passed' /tmp/_raceweekscan.log | tail -1)"
  else
    bad "vitest gate failed · output follows"
    tail -60 /tmp/_raceweekscan.log
  fi
fi

if [ "$fail" != "0" ]; then
  say ""
  say "FAILED · read the header of this file before changing anything."
  exit 1
fi
say "PASS"
