#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-belief-owners.sh · OWNER-AGREEMENT-1 · one quantity, one owner, and the
# owners have to AGREE (2026-09-05)
#
# Sibling of check-doctrine.sh and wired the same way (web-v2 prebuild →
# Railway build). check-doctrine stops a number that disagrees with the
# research; this one stops TWO numbers that disagree with EACH OTHER.
#
# The gap it closes. Every ownership check this repository had was a text scan,
# and both said so in their own headers:
#
#   _threshold_owner_scan.test.ts  "IT IS A TEXT SCAN OVER NAMED SYMBOLS."
#   _runner_state.test.ts          "WHETHER A LOADER ACTUALLY CALLED THE
#                                   CANONICAL OWNER … nothing syntactic joins
#                                   them."
#
# A caller that INVOKES the canonical resolver, DISCARDS its result and answers
# with its own arithmetic passes both, and every allowlist in them. So the gate
# behind this script does not read source: it CALLS every registered producer
# against the same synthetic runner and compares the numbers.
#
# Two guards, exit 1 on any violation:
#
#   1. REGISTRY     · lib/runner-state/quantity-owners.ts exists, declares the
#      SHAPE          twelve quantities, and every quantity has an owner. A
#                     grep tripwire, not a parser — this half must run on a
#                     cold container, so it needs nothing but bash. It is also
#                     what stops the gate being deleted to make a build pass.
#
#   2. FULL GATE    · resolve every producer and compare, plus the five
#                     falsification oracles, via vitest. Fatal.
#
# ── RULE 22 · WHAT THIS SCRIPT CANNOT FAIL ON ───────────────────────────────
#
#   · A PRODUCER NOBODY REGISTERED. Guard 1 counts what the registry declares;
#     it cannot know what the tree contains. The text scans stay where they are
#     and remain the other half of this defence.
#   · WHETHER THE AGREED NUMBER IS RIGHT. That is check-doctrine.sh's job.
#   · A DB-ONLY PRODUCER'S VALUE. CI has no database. Those are measured in
#     lib/runner-state/_owner_agreement.audit.test.ts against the real account,
#     and guard 2 can only assert that the audit file NAMES them.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="$ROOT/web-v2/lib/runner-state/quantity-owners.ts"
GATE="$ROOT/web-v2/lib/runner-state/_owner_agreement.test.ts"

fail=0

# ── 1 · REGISTRY SHAPE ──────────────────────────────────────────────────────

if [ ! -f "$REGISTRY" ]; then
  echo "BELIEF-OWNERS FAIL · registry missing at web-v2/lib/runner-state/quantity-owners.ts"
  echo "  The ownership gate cannot be deleted to make a build pass."
  exit 1
fi
if [ ! -f "$GATE" ]; then
  echo "BELIEF-OWNERS FAIL · gate missing at web-v2/lib/runner-state/_owner_agreement.test.ts"
  echo "  The registry without the gate is a survey. It was a survey before."
  exit 1
fi

# The twelve. Named here as well as in the registry ON PURPOSE: a quantity
# quietly dropped from the union would otherwise take its owners, its measured
# divergences and its whole section of the report with it, silently.
QUANTITIES="WEEKLY_VOLUME LONG_RUN_DISTANCE THRESHOLD_DOSE INTERVAL_PACE \
INTERVAL_DOSE MARATHON_PACE_DOSE QUALITY_FREQUENCY RUNNING_FREQUENCY \
RECOVERY_SPACING RACE_TARGET GOAL HEAT_TERRAIN_RESPONSE"

seen=0
for q in $QUANTITIES; do
  if ! grep -qE "^  $q: \{" "$REGISTRY"; then
    echo "BELIEF-OWNERS FAIL · $q has no entry in the registry"
    echo "  Twelve quantities were consolidated. Removing one removes its gate."
    fail=1
    continue
  fi
  seen=$((seen + 1))
done

# LIVENESS (Rule 18 point 2). A guard that matched nothing must not report OK.
if [ "$seen" -eq 0 ]; then
  echo "BELIEF-OWNERS FAIL · the registry matched none of the twelve quantities"
  echo "  Either the file's shape changed or this guard has stopped seeing it."
  echo "  A guard that reads nothing and reports clean is the worst outcome available."
  exit 1
fi

n_owner=$(grep -cE "^        role: 'OWNER'," "$REGISTRY")
if [ "$n_owner" -lt 12 ]; then
  echo "BELIEF-OWNERS FAIL · $n_owner owners declared for $seen quantities"
  echo "  Every quantity names exactly one owner, except the four headings that"
  echo "  genuinely cover two questions (recovery spacing, heat and terrain, the"
  echo "  long run's evidence and share ceilings, marathon pace and its dose)."
  fail=1
fi

# Every accepted divergence carries its measured size and the migration that
# deletes it. Cheap counterpart to the gate's own assertion, so a stripped
# `why`/`closesWhen` is caught on a container with no toolchain.
n_between=$(grep -cE "^        between: \[" "$REGISTRY")
n_maxabs=$(grep -cE "^        maxAbs: " "$REGISTRY")
n_why=$(grep -cE "^        why: " "$REGISTRY")
n_closes=$(grep -cE "^        closesWhen: " "$REGISTRY")
if [ "$n_between" -ne "$n_maxabs" ] || [ "$n_between" -ne "$n_why" ] || [ "$n_between" -ne "$n_closes" ]; then
  echo "BELIEF-OWNERS FAIL · accepted-divergence format contract broken"
  echo "  $n_between between: · $n_maxabs maxAbs: · $n_why why: · $n_closes closesWhen:"
  echo "  Every accepted divergence needs all four. An exemption with no measured size"
  echo "  is not a ratchet, and one with no named migration is not an exemption — it is"
  echo "  a permanent second answer with a comment on it."
  fail=1
fi

# ── 2 · FULL GATE (resolve, compare, and the five oracles) ──────────────────

VITEST="$ROOT/web-v2/node_modules/.bin/vitest"
if [ "${BELIEF_OWNERS_SKIP_VITEST:-}" = "1" ]; then
  echo "belief-owners · vitest stage skipped (BELIEF_OWNERS_SKIP_VITEST=1)"
elif [ -x "$VITEST" ]; then
  # `--disable-console-intercept` for the reason check-doctrine.sh gives: the
  # report is printed by a PASSING test on purpose, and vitest buffers and
  # drops console output for a passing file. A green run that says nothing
  # about what is still contested is a green run nobody learns from.
  # The two files are NAMED rather than `run lib/runner-state`, which would
  # also sweep `_owner_agreement.audit.test.ts` into a Railway build. That file
  # is `describe.skipIf(!RO)` and would skip harmlessly, but a build step that
  # would open a production connection given the wrong environment variable is
  # not a build step this repository wants (vitest.setup.ts's own header is
  # about exactly that hazard).
  if ! (cd "$ROOT/web-v2" && "$VITEST" run \
        lib/runner-state/_owner_agreement.test.ts \
        lib/runner-state/_runner_state.test.ts \
        --disable-console-intercept); then
    echo "BELIEF-OWNERS FAIL · two production-reachable sites answer one question"
    echo "  with different numbers for the same runner (see above)."
    echo "  Route the loser to the owner. If the divergence is real and cannot be closed"
    echo "  in this change, add an ARGUED entry to \`acceptedDivergence\` in"
    echo "  web-v2/lib/runner-state/quantity-owners.ts with the MEASURED delta and the"
    echo "  migration that removes it — never widen an existing entry to swallow a new"
    echo "  case. A CARRIER_ALTERED finding may not be excused at all: a layer that"
    echo "  changes the number it exists to carry is the owner being silently replaced."
    fail=1
  fi
else
  # ── RULE 18 point 2 · A GATE THAT CHECKS NOTHING MAY NOT REPORT OK ────────
  # Guard 1 has only counted declarations. It has resolved nothing and compared
  # nothing, so saying "OK" here would report confidence about an unrun check.
  echo "BELIEF-OWNERS FAIL · vitest not found at web-v2/node_modules/.bin/vitest"
  echo "  Guard 1 counted the registry's declarations and nothing else — no producer"
  echo "  was called and no two numbers were compared. Install dependencies, or set"
  echo "  BELIEF_OWNERS_SKIP_VITEST=1 deliberately if this environment genuinely has"
  echo "  no toolchain."
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "belief-owners OK · $seen quantities · $n_owner owners · $n_between measured divergences, each argued"
