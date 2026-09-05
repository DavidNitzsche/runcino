#!/usr/bin/env bash
#
# falsify-action-completeness · RULE 18, EXECUTED, for ACTIONCOMPLETE-1.
#
# "A gate that has never failed is a hypothesis, not a guarantee."
#
# This plants a real violation into a real source file, one at a time, runs the
# completeness gate, asserts the gate FAILED and that its message NAMED the
# right thing, then restores the file and verifies the restoration BYTE FOR
# BYTE. Same shape as `lib/adaptation/canonical/_falsify_gates.script.ts` and
# `lib/adaptation/volume-evidence/_falsify_continuity.script.ts`, in bash
# because the gate it falsifies is a shell script with a suite inside it.
#
# NOT part of `npm test` and NOT wired into prebuild, deliberately: it MUTATES
# SOURCE FILES on purpose, and a normal test run must never rewrite the tree
# underneath itself. Run it by hand:
#
#     bash scripts/falsify-action-completeness.sh
#
# ── WHAT EACH PLANT IS, AND WHY IT IS THAT ONE ──────────────────────────────
#
# Every plant below is a defect that would otherwise ship silently:
#
#   A · a RENDERER arm deleted        the runner's card goes blank for one kind
#   B · an EXECUTOR arm deleted       the runner taps accept and nothing lands
#   C · a GENERATOR call removed      the lane can describe it and nothing emits it
#   D · a GENERATOR stops constructing a kind it is registered for
#   E · a STALE RATCHET entry, both directions
#   F · the SEAM flipped to true      unattended coaching authority, opened
#   G · a facet module writing plan_workouts outside the boundary
#   H · a facet switch made non-exhaustive
#
# Two of these found REAL HOLES in the gate on their first run and the gate was
# changed rather than the expectation:
#
#   · C originally PASSED. The generator check asked whether ANY file in the
#     live caller's import graph called the symbol, and a sibling module in the
#     same graph did — so deleting the call from the writer that mattered was
#     invisible. `GeneratorRef.callSite` and its assertion exist because of it.
#   · F originally PASSED. The seam matcher was
#     `AUTOMATIC_ADAPTATION_AUTHORITY[^=]*=\s*false` anywhere in the file, and
#     the file quotes the owner saying exactly that string in a comment. The
#     matcher is now anchored on `^export const`.
#
# ── WHAT THIS FALSIFIER CANNOT PROVE (Rule 22) ──────────────────────────────
#
#   · That the gate catches a defect NOBODY PLANTED. Eight plants is eight
#     hypotheses about how this can break.
#   · That the gate's REASONS are true. It checks the failure message names the
#     right subject, not that the sentence is correct.
#   · That a restore left the tree identical to git HEAD. It verifies against
#     the copy it took, so a file that was already dirty stays dirty.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$ROOT/web-v2"
GATE="$ROOT/scripts/check-action-completeness.sh"
TMP="$(mktemp -d)"
PASS=0
FAIL=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# plant <file> <python-expression-file> <expected-substring> <label>
#
# The mutation is applied with python so a multi-line exact replacement is
# possible; sed cannot do it portably.
run_plant() {
  local rel="$1" mutator="$2" expect="$3" label="$4"
  local abs="$W/$rel"
  local bak="$TMP/$(echo "$rel" | tr '/' '_')"

  cp "$abs" "$bak"
  if ! python3 - "$abs" <<PY
import sys
p = sys.argv[1]
s = open(p).read()
$mutator
open(p, 'w').write(s)
PY
  then
    echo "SETUP FAILED · $label · the plant did not apply (the anchor text has moved)" >&2
    cp "$bak" "$abs"
    FAIL=$((FAIL + 1))
    return
  fi

  local out
  out="$(bash "$GATE" 2>&1)"
  local code=$?

  cp "$bak" "$abs"
  if ! cmp -s "$bak" "$abs"; then
    echo "RESTORE FAILED · $label · the file was not put back byte for byte" >&2
    FAIL=$((FAIL + 1))
    return
  fi

  if [ "$code" -eq 0 ]; then
    echo "HOLE · $label · THE GATE PASSED WITH THE VIOLATION PLANTED." >&2
    echo "       That is a hole in the gate, and it is worth more than a clean report." >&2
    FAIL=$((FAIL + 1))
    return
  fi
  if ! printf '%s' "$out" | grep -qF "$expect"; then
    echo "WRONG REASON · $label · the gate failed but did not name \"$expect\"" >&2
    printf '%s\n' "$out" | tail -5 >&2
    FAIL=$((FAIL + 1))
    return
  fi
  echo "ok   $label"
  PASS=$((PASS + 1))
}

echo "── falsifying check-action-completeness ──────────────────────────────────"

# Baseline: the gate must PASS on a clean tree, or every failure below is
# meaningless (a gate that always fails proves nothing either).
if ! bash "$GATE" >/dev/null 2>&1; then
  echo "BASELINE FAILED · the gate does not pass on the unmutated tree; fix that first" >&2
  exit 1
fi
echo "ok   baseline · the gate passes on a clean tree"

# A · a renderer arm deleted.
run_plant "lib/faff/v5-action-render.ts" \
  "s = s.replace(\"    case 'PACE_CHANGE':\n      return \`\${leverWord(action.lever)} pace moves to \${paceStr(action.to.value)}\`;\n\", '')" \
  "PACE_CHANGE has no headline arm and no ratchet entry" \
  "A · a renderer arm deleted"

# B · an executor arm deleted, so the kind falls through to the wrong one.
run_plant "lib/brain/proposal/executor-map.ts" \
  "s = s.replace(\"    case 'PACE_CHANGE':\n      return direct('sets pace_target_s_per_mi on the named rows');\n\", '')" \
  "no executor for" \
  "B · an executor arm deleted"

# C · the generator loses its call at the site the registry names.
run_plant "lib/plan/workout-proposals.ts" \
  "s = s.replace('const brainAction = actionFromAdaptation(action, {', 'const brainAction = PLANTED_NO_GENERATOR(action, {')" \
  "does not call actionFromAdaptation" \
  "C · a generator call removed from its named call site"

# D · the generator can no longer construct a kind it is registered for.
run_plant "lib/brain/proposal/generate/from-progression.ts" \
  "s = s.replace(\"...base, kind: 'REPETITION_CHANGE', direction,\", \"...base, kind: 'QUALITY_DOSE_CHANGE', lever: 'THRESHOLD', direction,\")" \
  "never constructs a REPETITION_CHANGE" \
  "D · a generator stops constructing its registered kind"

# E1 · a stale ratchet entry: a generator registered while its gap still stands.
run_plant "lib/brain/proposal/facets.ts" \
  "s = s.replace('  SAFETY_STOP: null,\n};', \"  SAFETY_STOP: { module: 'lib/brain/proposal/generate/from-safety.ts', symbol: 'safetyStopFrom', callSite: 'lib/plan/workout-proposals.ts', liveCaller: 'app/api/cron/run-adaptations/route.ts', when: 'planted violation for the falsifier, long enough to pass the length check' },\n};\")" \
  "STALE RATCHET · SAFETY_STOP has a GENERATOR gap" \
  "E1 · stale ratchet · a gap standing over a registered generator"

# E2 · a stale ratchet entry: a gap claiming a facet that is demonstrably there.
run_plant "lib/brain/proposal/facets.ts" \
  "s = s.replace(\"  {\n    kind: 'RECOVERY_CHANGE', facet: 'UNDO',\", \"  {\n    kind: 'RESCHEDULE', facet: 'UNDO',\n    because: 'planted violation for the falsifier: a gap claiming RESCHEDULE cannot be undone while undo.ts reverses it cleanly from the recorded date',\n  },\n  {\n    kind: 'RECOVERY_CHANGE', facet: 'UNDO',\")" \
  "STALE RATCHET · RESCHEDULE has an UNDO gap" \
  "E2 · stale ratchet · a gap over a facet that is present"

# F · the seam opened. NOTE the anchor: the first cut of the gate matched the
# constant name anywhere in the file, and the file QUOTES it in a comment.
run_plant "lib/plan/adaptation-authority.ts" \
  "s = s.replace('export const AUTOMATIC_ADAPTATION_AUTHORITY: false = false;', 'export const AUTOMATIC_ADAPTATION_AUTHORITY: boolean = true;')" \
  "the seam has been opened" \
  "F · AUTOMATIC_ADAPTATION_AUTHORITY flipped to true"

# G · a facet module writing the plan directly, around the boundary.
run_plant "lib/brain/proposal/ledger-facet.ts" \
  "s = s.replace('export interface ActionLedgerFacet {', 'const PLANTED = \`UPDATE plan_workouts SET notes = \$1 WHERE id = \$2\`;\nvoid PLANTED;\n\nexport interface ActionLedgerFacet {')" \
  "writes plan_workouts directly" \
  "G · a facet module writing plan_workouts outside mutatePlan"

# H · a facet switch made non-exhaustive, so a new kind falls through silently.
run_plant "lib/brain/proposal/undo.ts" \
  "s = s.replace('    default: {\n      const never: never = action;\n      throw new Error(\`no undo posture for \${JSON.stringify(never)}\`);\n    }\n', \"    default:\n      return notUndoable('planted: the exhaustive default was removed');\n\")" \
  "its switch is not exhaustive" \
  "H · a facet switch made non-exhaustive"

echo "──────────────────────────────────────────────────────────────────────────"
echo "$PASS plant(s) correctly caught, $FAIL not caught."
[ "$FAIL" -eq 0 ] || exit 1

# Liveness (Rule 18 point 2): a falsifier that plants nothing reports clean.
[ "$PASS" -ge 9 ] || { echo "only $PASS plants ran · the falsifier has lost its cases" >&2; exit 1; }
