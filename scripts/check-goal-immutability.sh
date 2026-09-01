#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-goal-immutability.sh · THE COACH PROJECTS, IT NEVER RENEGOTIATES
#                              (locked by the owner, gated 2026-08-30)
#
# Fourteenth sibling of check-palette-sync.sh / check-doctrine.sh /
# check-swallowed-failure.sh / check-normal-window.sh, wired the same way
# (web-v2 prebuild → Railway build).
#
#   check-doctrine            stops a bad NUMBER reaching a runner's legs.
#   check-swallowed-failure   stops a FAILED READ being served as a FACT.
#   check-automatic-mutations stops a JOB CHANGING TRAINING without saying so.
#   check-normal-window       stops the engine measuring a runner during a week
#                             it told him to rest and calling that who he is.
#   this one                  stops the coach ASKING THE RUNNER TO CHANGE
#                             THE GOAL HE STATED.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
#
# The owner's rule, app-wide, in his own words:
#
#     the coach PROJECTS, it never RENEGOTIATES a stated goal via a card or a
#     button. A verdict is not a trigger.
#
# It lived only in project memory, and on 2026-08-28 a cron violated it
# silently into his live production account. `plan_proposals` row 57, status
# pending, source `goal_gap_cron`, kind `goal_renegotiation`:
#
#   "Evidence says 3:31:48. The 3:00:00 stays on the board as the season
#    ambition. Recommended race target: 3:31:48, with 3:38:21 as the safe
#    floor. Set the revised target to race off the fitness you have."
#
#   accept_path: "PATCH /api/race/cim { goalSec, source: 'renegotiate' }"
#
# The second sentence is right. The imperative and the accept path are the
# violation: an instruction to lower a 3:00:00 marathon goal, wired to a button
# that rewrites it. Two web surfaces shipped that button and the phone shipped
# the verb ("SET THE REVISED TARGET"). tsc passed. Thirteen prebuild checks
# passed. Nothing in the apparatus could see it, because a card with a button
# is a well-formed card.
#
# A SECOND violation was found while closing the first, by the gate rather than
# by a person: GapPanel.tsx's "upgrade door" fired on the `planUnderBuilt`
# VERDICT and PATCHed /api/race with an engine-picked goal. It raised the goal
# instead of lowering it, which is why nobody had reported it — and it is the
# same shape. A rule enforced in one direction is not a rule.
#
# ── THREE GUARDS, exit 1 on any violation ───────────────────────────────────
#
#   1 · SHAPE   · the declaration module exists and still exports the seam
#                 (routes, allowed sources, informational kinds). Pure sed and
#                 grep, so it runs on a cold container with no TypeScript
#                 toolchain — the posture check-doctrine.sh set.
#
#   2 · GATE    · the vitest gate and its liveness probe still exist. This file
#     PRESENT     cannot be satisfied by deleting the thing it runs, and it
#                 cannot be satisfied by a comment: the greps demand the real
#                 `describe` and the real guard names.
#
#   3 · FULL    · the eight guards, the ratchet, and the scanner-liveness
#     GATE        probes. Every guard in it was FALSIFIED before it was
#                 trusted — reintroduce the real violation, watch the gate name
#                 it, restore — including the stale-exemption branch and the
#                 zero-files-scanned branch. The harness caught one guard whose
#                 staleness predicate was too loose to fail; that is what
#                 falsifying is for.
#
# ── IF THE GATE FIRES ───────────────────────────────────────────────────────
#
# You have written something that asks the runner to change his own goal, or
# that changes it for him. The goal is his. Say what the evidence projects and
# stop there:
#
#   · NO `accept_path` in a proposal payload. That field is what made three
#     renderers wire one mutation without any of them deciding to.
#   · A goal write carries a RUNNER-INITIATED source or it is refused. Never
#     normalise an unknown source to 'manual' — that launders a coach-authored
#     write into one that looks like the runner.
#   · An informational kind gets no accept verb on any surface, and the server
#     refuses the accept regardless of what a client sends.
#   · The number comes from lib/training/race-projection.ts. Rule 16: the old
#     copy said 3:31:48 while every other screen said 3:22:17.
#
# If a surface genuinely IS a goal editor — the runner types the number into a
# form — add it to GOAL_EDITOR_FILES with an argument. Do not add an exemption
# to make a coach card pass.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DECL="$ROOT/web-v2/lib/plan/goal-immutability.ts"
COPY="$ROOT/web-v2/lib/plan/goal-outlook-copy.ts"
WRITER="$ROOT/web-v2/lib/plan/goal-outlook.ts"
GATE="$ROOT/web-v2/lib/plan/_goal_immutability.test.ts"
NATIVE="$ROOT/native-v2/Faff/Faff/Components/CoachDecisionCard.swift"
fail=0

say() { printf '%s\n' "$*"; }
bad() { printf '  FAIL · %s\n' "$*"; fail=1; }

say "check-goal-immutability · the coach projects, it never renegotiates"

# ── GUARD 1 · the declaration ───────────────────────────────────────────────
say "guard 1 · declaration shape"

if [ ! -f "$DECL" ]; then
  bad "declaration missing: $DECL · the rule has no single definition to point at"
else
  for sym in \
    "export const GOAL_MUTATION_ROUTES" \
    "export const RUNNER_INITIATED_GOAL_SOURCES" \
    "export const RETIRED_GOAL_SOURCES" \
    "export const INFORMATIONAL_PROPOSAL_KINDS" \
    "export const RETIRED_PROPOSAL_KINDS" \
    "export const GOAL_OUTLOOK_KINDS" \
    "export function isGoalOutlookKind" \
    "export function isInformationalProposalKind"
  do
    grep -q "$sym" "$DECL" || bad "declaration lost '$sym'"
  done

  # It must stay import-free. A `'use client'` renderer imports it, and Rule 19
  # cost this repo a full day of undeployed main over exactly one such edge.
  if grep -qE "^import " "$DECL"; then
    bad "declaration grew an import · it must stay client-safe (Rule 19)"
  fi

  # The retired source may be NAMED (it is, in the header, so the next reader
  # knows what was removed) but never re-admitted to the allowed set.
  if grep -qE "RUNNER_INITIATED_GOAL_SOURCES = \[[^]]*renegotiate" "$DECL"; then
    bad "'renegotiate' is back in RUNNER_INITIATED_GOAL_SOURCES"
  fi

  # Every route the declaration names must exist, or guard 2 of the vitest gate
  # is checking a file that is not there.
  while IFS= read -r route; do
    [ -f "$ROOT/web-v2/$route" ] || bad "declared goal-write route does not exist: $route"
  done < <(sed -n "s/^  '\\(app\\/api\\/[^']*\\)'.*/\\1/p" "$DECL")
fi

for f in "$COPY" "$WRITER"; do
  [ -f "$f" ] || bad "missing: $f"
done

if [ -f "$COPY" ] && [ -f "$WRITER" ]; then
  # The sentence that shipped. It must not come back in any file that composes
  # runner-facing copy.
  #
  # Comment lines are stripped FIRST (both files quote the retired sentence in
  # their headers, on purpose, so the next reader knows what was removed), and
  # the strip happens with sed rather than a `grep -q | grep -v` pipe. The
  # first draft of this block used exactly that pipe — and `grep -q` writes
  # nothing to stdout, so the second grep read an empty stream and the `if`
  # could never be true. A guard that cannot fire is this repo's most-repeated
  # defect and it very nearly shipped inside the check written to stop it.
  imperative=$(sed -E 's,^[[:space:]]*(//|\*|/\*).*,,' "$COPY" "$WRITER" \
    | grep -icE "set the revised target|recommended race target|move the target")
  if [ "$imperative" != "0" ]; then
    bad "the retired imperative is back in the outlook copy ($imperative code lines)"
  fi
fi

if [ -f "$WRITER" ]; then
  # The CALL, not the name. An earlier version of this line grepped for the
  # bare identifier and stayed green when the falsifier changed the import to
  # `resolveRaceProjection as _unused` — a check satisfied by a mention is the
  # same defect class as check-automatic-mutations' `grep -q "GUARD 0"`.
  # 2026-09-01 · P0 · the shared resolver is now the race-pace brain: the
  # writer must resolve the outlook (resolveOutlookForGap) AND map it through
  # raceProjectionFromOutlook. Both calls, not names.
  grep -qE "raceProjectionFromOutlook\s*\(" "$WRITER" \
    || bad "goal-outlook.ts no longer CALLS the shared projection mapping raceProjectionFromOutlook (Rule 16)"
  grep -qE "resolveOutlookForGap\s*\(" "$WRITER" \
    || bad "goal-outlook.ts no longer resolves the race outlook (resolveOutlookForGap) (Rule 16)"
fi

if [ ! -f "$NATIVE" ]; then
  bad "native CoachDecisionCard.swift missing · the phone half of guard 4 cannot run"
else
  grep -q "informationalPlanKinds" "$NATIVE" \
    || bad "native lost informationalPlanKinds · the phone can grow an accept button again"
fi

[ "$fail" = "0" ] && say "  ok · declaration intact, copy clean, both surfaces present"

# ── GUARD 2 · the gate still exists ─────────────────────────────────────────
say "guard 2 · gate present"
if [ ! -f "$GATE" ]; then
  bad "gate missing: $GATE · this check cannot be satisfied by deleting it"
else
  # Demand the real describe/it, not prose mentioning them. A tamper-check a
  # tamperer passes by writing a comment is not a tamper-check (GATEAUDIT-4).
  grep -qE "describe\(['\"]GOALIMMUT-1" "$GATE" \
    || bad "gate lost its GOALIMMUT-1 describe block"
  grep -qE "it\(['\"]the scanner still reads real source" "$GATE" \
    || bad "gate lost its liveness probe · a scanner that reads nothing reports clean"
  for n in 1 2 3 4 5 6 7; do
    grep -qE "it\(['\"]guard $n · " "$GATE" || bad "gate lost guard $n"
  done
  grep -qE "describe\(['\"]guard 8 · " "$GATE" || bad "gate lost guard 8"
  grep -q "a stale one fails until deleted" "$GATE" \
    || bad "gate lost its stale-exemption ratchet"
  for sym in "GUARD_PREDICATE" "requestBodies" "GOAL_EDITOR_FILES" "SHIPPED"; do
    grep -q "$sym" "$GATE" || bad "gate lost '$sym'"
  done
  [ "$fail" = "0" ] && say "  ok · gate present with all eight guards and its ratchet"
fi

# ── GUARD 3 · run it ────────────────────────────────────────────────────────
say "guard 3 · full gate"
if [ ! -d "$ROOT/web-v2/node_modules" ]; then
  say "  skip · no node_modules (cold container) · guards 1 and 2 stand"
else
  if ( cd "$ROOT/web-v2" && npx vitest run lib/plan/_goal_immutability.test.ts >/tmp/_goalimmut.log 2>&1 ); then
    say "  ok · $(grep -oE 'Tests  [0-9]+ passed' /tmp/_goalimmut.log | tail -1)"
  else
    bad "vitest gate failed · output follows"
    tail -40 /tmp/_goalimmut.log
  fi
fi

if [ "$fail" != "0" ]; then
  say ""
  say "FAILED · read the header of this file before changing anything."
  say "The goal is the runner's. The engine's job is to project, and to say"
  say "honestly where he is. It is not to ask him to move his goal."
  exit 1
fi
say "PASS"
