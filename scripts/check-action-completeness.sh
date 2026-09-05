#!/usr/bin/env bash
#
# check-action-completeness · ACTIONCOMPLETE-1 · a lever the engine can DESCRIBE
# is a lever something EMITS, RENDERS, APPLIES, RECORDS and CAN UNDO.
#
# Sibling of check-doctrine.sh / check-decision-ledger.sh / check-normal-window.sh
# / check-automatic-mutations.sh, wired the same way (web-v2 prebuild → Railway).
#
#   check-doctrine             stops a bad NUMBER reaching a runner's legs.
#   check-swallowed-failure    stops a FAILED READ being served as a FACT.
#   check-automatic-mutations  stops a JOB CHANGING TRAINING without saying so.
#   check-decision-ledger      stops a DECISION HAPPENING WITH NO RECORD.
#   this one                   stops an ACTION KIND EXISTING WITHOUT AN ENGINE
#                              THAT EMITS IT, or a card the runner taps that has
#                              nowhere to land.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS
#
# David, 2026-09-05: "The lane can now carry 21 action kinds, but no engine emits
# most of them... Do not leave legacy actions as the real operating vocabulary
# with the generalized schema acting only as a reader."
#
# `_action_schema_gate.test.ts` proves every kind maps to writes and draws a
# headline, and states in its own Rule 22 note what it cannot see: "Whether
# anything ever RAISES these actions. A union nobody constructs is still fully
# covered here." That is this repo's signature failure — WIRED, TESTED AND INERT
# — arriving on the newest thing built, and it is what this gate is for.
#
# The registry is `web-v2/lib/brain/proposal/facets.ts`: eleven facets per kind,
# 231 cells, and a RATCHET naming every one that is genuinely absent with an
# argued reason. The list may shrink and may never grow, and an entry whose facet
# is now present FAILS UNTIL DELETED.
#
# ─────────────────────────────────────────────────────────────────────────────
# FIVE GUARDS, exit 1 on any violation
#
#   0 · TAMPER    · every owning module, the registry and the suite exist, and
#                   the suite still DECLARES each of its guards by name. A
#                   generic grep for a comment is satisfied by the comment left
#                   behind when a suite is deleted (check-automatic-mutations.sh
#                   guard 2 once used `grep -q "GUARD 0"`), so every probe below
#                   names a specific `describe(` string.
#   1 · TOTALITY  · every kind-switch that owns a facet has an exhaustive
#                   `never` default. That is what makes a new kind a COMPILE
#                   error rather than a silent fall-through, and it is the
#                   property the whole design rests on.
#   2 · AUTHORITY · AUTOMATIC_ADAPTATION_AUTHORITY is still the literal `false`,
#                   and no file added by this workstream writes plan_workouts
#                   outside the mutation boundary. A completeness gate that let
#                   a new writer in would have made the lane complete and the
#                   seam meaningless.
#   3 · CONTROLS  · positive and negative, on this script's own matchers, every
#                   build. Rule 18 point 1.
#   4 · FULL GATE · the suite: the 231-cell matrix, the ratchet in both
#                   directions, the generator import-graph walk.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS GATE CANNOT FAIL ON (Rule 22)
#
#   · WHETHER ANY FACET IS ANY GOOD. It proves a renderer exists, never that the
#     sentence is right; that an executor is named, never that it applies the
#     change correctly.
#   · WHETHER A GENERATOR EVER FIRES FOR A REAL RUNNER. Rule 21's higher bar
#     needs production history and cannot run in CI. A generator wired to a
#     condition no runner ever meets passes every check here.
#   · WHETHER THE LIVE CALLER IS ITSELF ALIVE. The suite walks a STATIC IMPORT
#     GRAPH. A cron nobody schedules and a route nobody calls both pass. Rule 19
#     is the standing reminder that green is not deployed.
#   · A FACET NOBODY THOUGHT OF. Eleven is a list somebody wrote down.
#   · THE NATIVE SIDE. Swift is not in this process.
#   · A RATCHET REASON THAT IS FALSE. It tells a stale entry from a live one; it
#     cannot tell a true sentence from a plausible one.
#   · A KIND ADDED TO THE UNION WITH NO SPECIMEN, when no TypeScript toolchain is
#     present. Guard 4 is what catches that, through the total `Record`, and it
#     SKIPS on a cold container — loudly, saying so.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$ROOT/web-v2"
P="$W/lib/brain/proposal"

FACETS="$P/facets.ts"
ACTION="$P/action.ts"
VALIDATE="$P/validate.ts"
SERIALIZE="$P/serialize.ts"
EXECUTE="$P/execute.ts"
EXECUTOR="$P/executor-map.ts"
ACCEPT="$P/accept.ts"
LEDGER="$P/ledger-facet.ts"
UNDO="$P/undo.ts"
WATCH="$P/watch-facet.ts"
RENDER="$W/lib/faff/v5-action-render.ts"
GATE="$P/_action_completeness.test.ts"
AUTHORITY="$W/lib/plan/adaptation-authority.ts"

GEN_PROGRESSION="$P/generate/from-progression.ts"
GEN_ADAPTATION="$P/generate/from-adaptation.ts"
GEN_REPRICE="$P/generate/from-reprice.ts"
GEN_SEAL="$P/generate/from-seal.ts"
GEN_SAFETY="$P/generate/from-safety.ts"

fail() { echo "FAIL  check-action-completeness · $1" >&2; exit 1; }

# ── 0 · TAMPER ───────────────────────────────────────────────────────────────
# Never `mkdir -p` anything here. check-modelled-mark.sh once contained
# `[ -d "$V5_VIEWS" ] || mkdir -p "$V5_VIEWS"` — a gate creating the tree it
# audits — and scanned zero files while reporting clean.
for f in "$FACETS" "$ACTION" "$VALIDATE" "$SERIALIZE" "$EXECUTE" "$EXECUTOR" \
         "$ACCEPT" "$LEDGER" "$UNDO" "$WATCH" "$RENDER" "$GATE" "$AUTHORITY" \
         "$GEN_PROGRESSION" "$GEN_ADAPTATION" "$GEN_REPRICE" "$GEN_SEAL" "$GEN_SAFETY"; do
  [ -f "$f" ] || fail "missing $f · the gate cannot check what is not there"
done

# The suite must still DECLARE each guard, by name.
for g in \
  "GUARD 0 · the completeness matrix covers every kind and every facet" \
  "GUARD 1 · VALIDATOR · every kind is checked for coherence" \
  "GUARD 1 · SERIALIZER · every kind survives the database" \
  "GUARD 1 · RENDERER · every kind knows which way the card draws" \
  "GUARD 1 · EXPLANATION · every kind gives the runner a sentence" \
  "GUARD 1 · MUTATION · every kind resolves to writes or is non-mutating out loud" \
  "GUARD 1 · ACCEPT_EXECUTOR · every kind reaches a named apply path" \
  "GUARD 1 · LEDGER · every decision can be written down" \
  "GUARD 1 · UNDO · every kind says whether the runner can take it back" \
  "GUARD 1 · WATCH · every kind says what the wrist must do" \
  "GUARD 2 · GENERATOR · every kind is emitted by something live" \
  "GUARD 3 · INTEGRATION_TEST · every kind survives the whole lane at once" \
  "GUARD 4 · the completed lane can push as fluently as it can pull back" ; do
  grep -qF "describe('$g'" "$GATE" \
    || fail "the gate suite no longer declares \"$g\" · it has been renamed, weakened or removed"
done

# The ratchet must exist and must be a list, not a comment claiming to be one.
grep -q 'export const FACET_GAPS' "$FACETS" \
  || fail "facets.ts no longer exports FACET_GAPS · the ratchet is gone"
grep -q 'export const GENERATOR_REGISTRY' "$FACETS" \
  || fail "facets.ts no longer exports GENERATOR_REGISTRY · nothing records who emits what"

# Counted out of the file itself rather than hardcoded on both sides (Rule 18).
KINDS="$(sed -n "/export const ALL_ACTION_KINDS/,/^];/p" "$ACTION" \
  | grep -oE "'[A-Z_]+'" | sort -u | wc -l | tr -d ' ')"
[ "$KINDS" -ge 21 ] || fail "only $KINDS action kinds found in action.ts · the extractor has lost the union"

FACET_COUNT="$(sed -n "/export const ALL_FACETS/,/^];/p" "$FACETS" \
  | grep -oE "'[A-Z_]+'" | sort -u | wc -l | tr -d ' ')"
[ "$FACET_COUNT" -eq 11 ] \
  || fail "$FACET_COUNT facets declared, expected 11 · adding or removing one changes what completeness MEANS and must be argued, not absorbed"

GAPS="$(grep -cE "^[[:space:]]+kind: '[A-Z_]+', facet: '[A-Z_]+'," "$FACETS")"
[ "$GAPS" -gt 0 ] || fail "the ratchet parses to zero entries · either the format changed or the list was emptied"

# ── 1 · TOTALITY · a facet owner without a `never` default is not total ──────
# This is the property the whole design rests on: a new kind must be a COMPILE
# error in every facet, not a silent fall-through. `executor-map.ts` and
# `watch-facet.ts` close over the union with an exhaustive switch instead, and
# both are checked for their own shape below.
for f in "$VALIDATE" "$EXECUTE" "$LEDGER" "$UNDO" "$RENDER"; do
  grep -q 'const never: never' "$f" \
    || fail "$(basename "$f") owns a facet and its switch is not exhaustive · a new kind would fall through silently"
done
grep -q 'const never: never' "$EXECUTOR" \
  || fail "executor-map.ts is not exhaustive · a new kind would reach the accept route with nowhere to land"
grep -q 'const never: never' "$WATCH" \
  || fail "watch-facet.ts is not exhaustive · a new kind could reach the plan while the wrist keeps yesterday's session"

# ── 2 · AUTHORITY · the seam is untouched ────────────────────────────────────
# A completeness gate that let a new writer past the boundary would have made
# the lane complete and the seam meaningless. Read out of the file, not asserted.
SEAM="$W/lib/plan/adaptation-authority.ts"
# ANCHORED ON `export const`, and that is not decoration. The first cut matched
# `AUTOMATIC_ADAPTATION_AUTHORITY[^=]*=\s*false` anywhere in the file, and the
# falsification proved it: flipping the seam while ANY comment in the file still
# spelled `AUTOMATIC_ADAPTATION_AUTHORITY=false` — and one does, quoting the
# owner verbatim — would have passed. That is check-automatic-mutations.sh's
# `grep -q "GUARD 0"` defect exactly: a matcher any prose satisfies.
grep -qE '^export const AUTOMATIC_ADAPTATION_AUTHORITY: false = false;' "$SEAM" \
  || fail "AUTOMATIC_ADAPTATION_AUTHORITY is no longer declared as the literal false · the seam has been opened"

# Nothing this workstream added may write plan_workouts except through the
# boundary. `accept.ts` is the ONE file here that writes, and it writes inside
# `mutatePlan`'s own `apply` callback.
for f in "$FACETS" "$VALIDATE" "$SERIALIZE" "$EXECUTE" "$EXECUTOR" "$LEDGER" \
         "$UNDO" "$WATCH" "$GEN_PROGRESSION" "$GEN_ADAPTATION" "$GEN_REPRICE" \
         "$GEN_SEAL" "$GEN_SAFETY"; do
  if grep -qiE '(UPDATE|INSERT INTO|DELETE FROM)[[:space:]]+plan_workouts' "$f"; then
    fail "$(basename "$f") writes plan_workouts directly · every plan mutation goes through lib/plan/mutate.ts"
  fi
done
grep -q "mutatePlan" "$ACCEPT" \
  || fail "accept.ts writes the plan without the mutation boundary"
grep -q "authority: 'RUNNER_ACCEPTED'" "$ACCEPT" \
  || fail "accept.ts no longer declares RUNNER_ACCEPTED · a plan write here must name the runner's consent"

# ── 3 · CONTROLS · Rule 18 point 1, on every build ───────────────────────────
# The matchers this script owns, exercised both ways, every build. A gate that
# has never failed is a hypothesis.
probe_gap="    kind: 'ADD_WORKOUT', facet: 'GENERATOR',"
probe_not_gap="    kindOfThing: 'ADD_WORKOUT', facetish: 'GENERATOR',"
printf '%s' "$probe_gap" | grep -qE "^[[:space:]]+kind: '[A-Z_]+', facet: '[A-Z_]+'," \
  || fail "POSITIVE CONTROL failed · the ratchet matcher cannot see an entry it was handed"
if printf '%s' "$probe_not_gap" | grep -qE "^[[:space:]]+kind: '[A-Z_]+', facet: '[A-Z_]+',"; then
  fail "NEGATIVE CONTROL failed · the ratchet matcher matches text that is not an entry"
fi
printf '%s' "export const AUTOMATIC_ADAPTATION_AUTHORITY: false = false;" \
  | grep -qE '^export const AUTOMATIC_ADAPTATION_AUTHORITY: false = false;' \
  || fail "POSITIVE CONTROL failed · the seam matcher cannot see the declaration it was handed"
if printf '%s' "export const AUTOMATIC_ADAPTATION_AUTHORITY: boolean = true;" \
  | grep -qE '^export const AUTOMATIC_ADAPTATION_AUTHORITY: false = false;'; then
  fail "NEGATIVE CONTROL failed · the seam matcher accepts an opened seam"
fi
# And the control the falsification actually earned: a COMMENT that spells the
# constant out must not satisfy the matcher.
if printf '%s' " *     agent. He ruled: \"AUTOMATIC_ADAPTATION_AUTHORITY=false is meaningless if" \
  | grep -qE '^export const AUTOMATIC_ADAPTATION_AUTHORITY: false = false;'; then
  fail "NEGATIVE CONTROL failed · the seam matcher is satisfied by prose quoting the constant"
fi
printf '%s' "  UPDATE plan_workouts SET x = 1" | grep -qiE '(UPDATE|INSERT INTO|DELETE FROM)[[:space:]]+plan_workouts' \
  || fail "POSITIVE CONTROL failed · the write matcher cannot see a write it was handed"
if printf '%s' "  -- plan_workouts is the table this describes" \
  | grep -qiE '(UPDATE|INSERT INTO|DELETE FROM)[[:space:]]+plan_workouts'; then
  fail "NEGATIVE CONTROL failed · the write matcher fires on prose"
fi

# ── 4 · THE FULL GATE ────────────────────────────────────────────────────────
# The matrix, the ratchet in both directions and the generator import-graph walk
# live in the suite. Run it when a toolchain is present; say so LOUDLY when it
# is not. A silent skip is how a gate stops meaning anything.
if [ -x "$W/node_modules/.bin/vitest" ]; then
  ( cd "$W" && ./node_modules/.bin/vitest run \
      lib/brain/proposal/_action_completeness.test.ts \
      lib/brain/proposal/_action_schema_gate.test.ts ) \
    || fail "the ACTIONCOMPLETE-1 suite failed (above)"
else
  echo "NOTE  check-action-completeness · no vitest binary; ran tamper + totality + authority + controls only." >&2
  echo "NOTE  the 231-cell matrix, the ratchet staleness check and the generator import-graph walk DID NOT RUN." >&2
fi

echo "ok    check-action-completeness · $KINDS kinds x $FACET_COUNT facets, $GAPS ratcheted gaps, seam still false"
