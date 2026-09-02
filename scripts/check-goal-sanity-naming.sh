#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-goal-sanity-naming.sh · A BOOLEAN IS NAMED FOR ITS PREDICATE
#                               (GOAL-SANITY-NAME-1, gated 2026-09-02)
#
# Sibling of check-goal-immutability.sh, wired the same way (web-v2 prebuild →
# Railway build).
#
#   check-goal-immutability   stops the coach ASKING THE RUNNER TO CHANGE
#                             THE GOAL HE STATED.
#   this one                  stops a NARROW SCREEN wearing the name of the
#                             WHOLE QUESTION.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
#
# `authored_state.goal_realism.flag` read `false` on the owner's live CIM block
# on 2026-09-02, while Goal Feasibility's canonical owner — Constitution §L,
# implemented at lib/race/race-outlook.ts §7 — read `unlikely_currently` on a
# 19:42 gap, at the same instant, for the same runner.
#
# Neither number was wrong. `goal_realism` only ever asked "does the typed goal
# demand a VDOT more than 15% above demonstrated threshold capacity", which is
# a typo-and-absurdity screen. It has no runway input and no uncertainty input.
# The name promised a feasibility verdict it could not produce, and a reader —
# the runner, in this case — read it as one.
#
# His ruling: "If the flag answers a narrower question than its name implies,
# rename it." Renamed to `goal_vdot_sanity.beyondSanityBand`. This gate keeps
# the old name from coming back and keeps the new one honest.
#
# ── THREE GUARDS, exit 1 on any violation ───────────────────────────────────
#
#   1 · SHAPE   · the resolver module exists and still exports the seam. Pure
#                 grep, so it runs on a cold container with no TypeScript
#                 toolchain — the posture check-doctrine.sh set.
#   2 · GATE    · the vitest gate and its liveness probe still exist, by real
#     PRESENT     `describe`/`it` text rather than by a comment mentioning them
#                 (GATEAUDIT-4: a tamper-check a tamperer passes by writing a
#                 comment is not a tamper-check).
#   3 · FULL    · run the eight guards, the ratchet and the liveness probes.
#     GATE        Every one was FALSIFIED before it was trusted — the old
#                 struct shape restored, the band narrowed, the direction
#                 awareness deleted, a stale allowlist entry added — and each
#                 was named by the gate before being restored.
#
# ── IF THE GATE FIRES ───────────────────────────────────────────────────────
#
# Either the retired name is back, or the screen has grown a field named for a
# verdict it cannot reach. Neither is fixed by widening an allowlist. If you
# need a feasibility verdict, call the owner: lib/race/race-outlook.ts's
# `goalFeasibility`, which reads the projection, its likely range and expected
# race day, and returns comfortable / realistic / aggressive / unlikely_currently.
#
# WHAT THIS GATE CANNOT FAIL ON (Rule 22): it cannot tell whether 1.15 is the
# right band, it cannot see a rendered surface that decodes the honest field
# and prints a dishonest sentence, and it cannot spot a brand-new third owner
# of feasibility invented under a name it does not know.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DECL="$ROOT/web-v2/lib/plan/goal-vdot-sanity.ts"
GATE="$ROOT/web-v2/lib/plan/_goal_vdot_sanity_gate.test.ts"
fail=0

say() { printf '%s\n' "$*"; }
bad() { printf '  FAIL · %s\n' "$*"; fail=1; }

say "check-goal-sanity-naming · a boolean is named for its predicate"

# ── GUARD 1 · the resolver ──────────────────────────────────────────────────
say "guard 1 · resolver shape"
if [ ! -f "$DECL" ]; then
  bad "resolver missing: $DECL · the question has no single owner to point at"
else
  for sym in \
    "export const GOAL_VDOT_SANITY_BAND" \
    "export type GoalVdotSanity" \
    "export function assessGoalVdotSanity" \
    "export function goalVdotSanityFromLegacyRecord" \
    "beyondSanityBand" \
    "bandExcessVdot"
  do
    grep -q "$sym" "$DECL" || bad "resolver lost '$sym'"
  done

  # The resolver must keep pointing at the canonical owner of the WIDER
  # question, so the next reader cannot mistake this file for it.
  grep -q "lib/race/race-outlook.ts" "$DECL" \
    || bad "resolver no longer names Goal Feasibility's canonical owner"

  # The retired field name may be QUOTED in the header (it is, so the next
  # reader knows what was renamed) but must never be a property of the type.
  if grep -qE "^[[:space:]]*flag[?]?:" "$DECL"; then
    bad "'flag' is back as a field on the sanity struct"
  fi
fi

# The retired identifiers must not appear anywhere in web-v2 outside the files
# the vitest allowlist argues for. This is the cheap cold-container half; the
# full ratcheted version with reasons is guard 1 of the vitest gate.
if [ -d "$ROOT/web-v2" ]; then
  scanned=$(grep -rl --include=*.ts --include=*.tsx -E "goal_realism|goalRealism" \
    "$ROOT/web-v2/lib" "$ROOT/web-v2/app" "$ROOT/web-v2/components" "$ROOT/web-v2/scripts" 2>/dev/null \
    | grep -vE "goal-vdot-sanity\.ts|_goal_vdot_sanity_gate\.test\.ts|lib/plan/generate\.ts|_coldstart_doctrine\.test\.ts|app/api/coach/read/route\.ts" || true)
  if [ -n "$scanned" ]; then
    bad "retired identifier present outside the argued allowlist:"
    # Quoted: the repo lives under a path with spaces, and an unquoted
    # expansion word-split one filename into three lines the first time this
    # was falsified.
    printf '    %s\n' "$scanned"
  fi
fi
[ "$fail" = "0" ] && say "  ok · resolver intact, retired name contained"

# ── GUARD 2 · the gate still exists ─────────────────────────────────────────
say "guard 2 · gate present"
if [ ! -f "$GATE" ]; then
  bad "gate missing: $GATE · this check cannot be satisfied by deleting it"
else
  grep -qE "describe\(['\"]GOAL-SANITY-NAME-1" "$GATE" \
    || bad "gate lost its GOAL-SANITY-NAME-1 describe block"
  grep -qE "it\(['\"]LIVENESS · the scanner actually read files" "$GATE" \
    || bad "gate lost its liveness probe · a scanner that reads nothing reports clean"
  for n in 1 2 3 4 5 6 7 8; do
    grep -qE "it\(['\"]guard ${n}b? · " "$GATE" || bad "gate lost guard $n"
  done
  grep -q "WHAT THIS GATE CANNOT FAIL ON" "$GATE" \
    || bad "gate lost its Rule 22 blind-spot declaration"
  grep -q "LEGACY_NAME_ALLOWLIST" "$GATE" || bad "gate lost its ratcheted allowlist"
  [ "$fail" = "0" ] && say "  ok · gate present with all guards, its ratchet and its blind-spot note"
fi

# ── GUARD 3 · run it ────────────────────────────────────────────────────────
say "guard 3 · full gate"
if [ ! -d "$ROOT/web-v2/node_modules" ]; then
  say "  skip · no node_modules (cold container) · guards 1 and 2 stand"
else
  if ( cd "$ROOT/web-v2" && npx vitest run lib/plan/_goal_vdot_sanity_gate.test.ts >/tmp/_goalsanity.log 2>&1 ); then
    say "  ok · $(grep -oE 'Tests  [0-9]+ passed' /tmp/_goalsanity.log | tail -1)"
  else
    bad "vitest gate failed · output follows"
    tail -40 /tmp/_goalsanity.log
  fi
fi

if [ "$fail" != "0" ]; then
  say ""
  say "FAILED · read the header of this file before changing anything."
  say "A screen that asks a narrow question keeps a narrow name. If you want"
  say "the wide answer, call Goal Feasibility — it exists and it is canonical."
  exit 1
fi
say "PASS"
