#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-automatic-mutations.sh · a job declares what it does to a runner (2026-08-25)
#
# Eleventh sibling of check-palette-sync.sh / check-doctrine.sh /
# check-swallowed-failure.sh, wired the same way (web-v2 prebuild → Railway
# build).
#
#   check-doctrine          stops a bad NUMBER reaching a runner's legs.
#   check-generated-content stops a good SENTENCE never reaching their eyes.
#   check-swallowed-failure stops a FAILED READ being served as a FACT.
#   this one                stops a JOB CHANGING THEIR TRAINING without saying so.
#
# ── THE INCIDENT ────────────────────────────────────────────────────────────
#
# 2026-08-25, 09:29:32 UTC. The `plan-drift` cron fired a `long_drift` signal,
# archived the owner's two-week recovery block in the middle of week two, and
# authored a one-week block in its place. His week went from 23 miles to 38.
# Nothing on any surface said it had happened. He found out because the week
# counter reset and he asked why.
#
# The new number was right. That was never the point.
#
# When he asked which job did it, the plan's own `archive_reason` said
# `regenerated` — which is what it said for every rebuild this app had ever
# performed, because the parameter had a default and no caller ever passed it.
# The audit that followed asked for an inventory of every scheduled job. That
# inventory named two writers of the training plan.
#
# THERE WERE FOUR. The one nobody listed is `snapshot-projections`: a job named
# after taking snapshots, which calls `reanchorActivePlan` and rewrites
# `plan_workouts.pace_target_s_per_mi` and `workout_spec` for every future
# unsealed day, daily, for every active runner.
#
# A hand-written inventory would have missed it again on the next pass. So the
# gate does not read the inventory and believe it.
#
# ── THREE GUARDS, exit 1 on any violation ───────────────────────────────────
#
#   1 · REGISTRY   · automatic-mutation-registry.ts parses, is not empty, has
#       SHAPE        one single-line quoted `id:` and one `route:` per entry,
#                    no duplicate ids, no line numbers in an id (those rot),
#                    and numeric floors. Pure sed and grep, so it runs on a
#                    cold container with no TypeScript toolchain — the same
#                    posture as check-doctrine.sh.
#
#   2 · GATE       · the registry and its test still exist and still export the
#       PRESENT      entry points. This file cannot be made to pass by deleting
#                    the thing it runs.
#
#   3 · FULL GATE  · the vitest gate: every cron route declared, every
#                    scheduled workflow either declared or argued as a
#                    non-mutator, and — the one with a body behind it — the set
#                    of files that write a plan DERIVED FROM SOURCE equal to
#                    the set the registry claims. Plus floors, plus a planted
#                    defect the gate must fail.
#
# ── IF THE GATE FIRES ───────────────────────────────────────────────────────
#
# You added something that changes a runner's data on a schedule or an event.
# Add an entry to AUTOMATIC_MUTATIONS answering the five questions: what it can
# change, what triggers it and whether one cause can fire it twice, whether it
# is idempotent, what a partial failure leaves behind, and whether the runner
# would know. If your honest answer to the last one is "no", that is not a
# reason to skip the entry. That is the entry.
#
# Do NOT loosen a floor to make this pass.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REG="$ROOT/web-v2/lib/audit/automatic-mutation-registry.ts"
GATE="$ROOT/web-v2/lib/audit/_automatic_mutations.test.ts"
fail=0

say()  { printf '%s\n' "$*"; }
bad()  { printf '  FAIL · %s\n' "$*"; fail=1; }

say "check-automatic-mutations · a job declares what it does to a runner"

# ── GUARD 1 · registry shape ────────────────────────────────────────────────
say "guard 1 · registry shape"

if [ ! -f "$REG" ]; then
  bad "registry missing: $REG"
else
  # `grep -c` on a large file with an early-exiting consumer plus pipefail has
  # bitten this repo before (a MATCH became a failure). Count into a variable,
  # never into a pipeline.
  ids=$(grep -cE "^\s+id: '[^']+'," "$REG" || true)
  routes=$(grep -cE "^\s+route: '[^']+'," "$REG" || true)

  if [ "$ids" -lt 15 ]; then
    bad "only $ids entries · the registry has been gutted (expected 15+)"
  fi
  if [ "$ids" != "$routes" ]; then
    bad "$ids ids but $routes routes · every entry needs both, one per line"
  fi

  dupes=$(grep -oE "^\s+id: '[^']+'," "$REG" | sort | uniq -d | wc -l | tr -d ' ')
  if [ "$dupes" != "0" ]; then
    bad "$dupes duplicate id(s) · ids must be unique"
  fi

  if grep -qE "^\s+id: '[^']*:[0-9]+" "$REG"; then
    bad "an id carries a line number · ids must be <kind>/<name>, line numbers rot"
  fi

  if ! grep -q "MUTATION_SCAN_FLOORS" "$REG"; then
    bad "MUTATION_SCAN_FLOORS missing · a gate that parses nothing must not report clean"
  fi
  if ! grep -q "SCHEDULED_NON_MUTATORS" "$REG"; then
    bad "SCHEDULED_NON_MUTATORS missing · a scheduled job is declared or argued, never skipped"
  fi

  [ "$fail" = "0" ] && say "  ok · $ids entries, ids unique, floors present"
fi

# ── GUARD 2 · the gate still exists ─────────────────────────────────────────
say "guard 2 · gate present"
if [ ! -f "$GATE" ]; then
  bad "gate missing: $GATE · this check cannot be satisfied by deleting it"
else
  # GATEAUDIT-4 (2026-08-30) · these three used to be checked with a bare
  # `grep -q "GUARD 0"`, which any COMMENT containing the words satisfies —
  # including the comment that would be left behind when the suite was deleted.
  # A tamper-check a tamperer passes by writing prose is not a tamper-check.
  # They are `describe()` titles, so the grep now demands the describe.
  for sym in "GUARD 0" "GUARD 4" "GUARD 5"; do
    grep -qE "describe\(['\"]${sym} " "$GATE" || bad "gate lost the '$sym' describe block"
  done
  for sym in "scanPlanWriterFiles" "writesAPlan"; do
    grep -q "$sym" "$GATE" || bad "gate lost '$sym'"
  done
  [ -f "$GATE" ] && say "  ok · gate present with its guards"
fi

# ── GUARD 3 · run it ────────────────────────────────────────────────────────
say "guard 3 · full gate"
if [ ! -d "$ROOT/web-v2/node_modules" ]; then
  say "  skip · no node_modules (cold container) · guards 1 and 2 stand"
else
  if ( cd "$ROOT/web-v2" && npx vitest run lib/audit/_automatic_mutations.test.ts >/tmp/_autmut.log 2>&1 ); then
    say "  ok · $(grep -oE 'Tests  [0-9]+ passed' /tmp/_autmut.log | tail -1)"
  else
    bad "vitest gate failed · output follows"
    tail -40 /tmp/_autmut.log
  fi
fi

if [ "$fail" != "0" ]; then
  say ""
  say "FAILED · read the header of this file before changing anything."
  exit 1
fi
say "PASS"
