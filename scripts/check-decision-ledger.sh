#!/usr/bin/env bash
#
# check-decision-ledger · LEDGER-1 · a decision that reaches a runner's plan is
# written down, and a promise to look again is durable.
#
# Sibling of check-doctrine.sh / check-normal-window.sh / check-automatic-
# mutations.sh / check-write-barrier.sh, wired the same way (web-v2 prebuild →
# Railway build).
#
#   check-doctrine             stops a bad NUMBER reaching a runner's legs.
#   check-swallowed-failure    stops a FAILED READ being served as a FACT.
#   check-automatic-mutations  stops a JOB CHANGING TRAINING without saying so.
#   check-write-barrier        stops a TEST writing the runner's real history.
#   this one                   stops a DECISION HAPPENING WITH NO RECORD, and a
#                              DEFERRAL LIVING ONLY IN MEMORY.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS
#
# CLAUDE.md Rule 21, measured against the owner's entire history: 309
# `coach_intents` rows, twenty distinct reasons, months of real training, and
# the number of UPWARD adaptations is ZERO. Establishing that zero required
# querying `coach_intents` SIDEWAYS, because the engine's own log could not
# answer it — `training_plans.adaptation_log` stored `{"n": 1, "ts": "..."}`.
#
# `lib/plan/adaptation-log.ts` (2026-09-04) fixed the "not a log" half by adding
# a `did` array. It could not fix the two structural halves, and both are why
# `plan_decision_ledger` exists rather than a third key on that object:
#
#   1 · it lives INSIDE THE THING A REBUILD DISCARDS. `adaptation_log` is a
#       column on `training_plans`; a rebuild archives that row and authors a
#       new one with `[]`. A ledger a rebuild empties is a cache.
#   2 · its only writer is the CRON. Its own Rule 22 note says so: "Three other
#       paths can move a workout ... and none of them writes here."
#
# And Rule 23, for the second half: before `reassessment_schedule`, six of the
# seven kinds of promise this engine makes were `reconsiderAtISO` fields on
# in-memory objects. "The date was a PROMISE nothing kept."
#
# ─────────────────────────────────────────────────────────────────────────────
# FOUR GUARDS, exit 1 on any violation
#
#   0 · TAMPER    · the modules, the migrations and the gate suite all still
#                   exist, and the suite still declares both of its guards. A
#                   deleted gate must fail loudly, not silently stop running.
#                   (check-automatic-mutations.sh's guard 2 once used
#                   `grep -q "GUARD 0"`, which ANY comment satisfied, including
#                   the one left behind if the suite were deleted. Every probe
#                   below names a specific `describe(` string instead.)
#   1 · ADDITIVE  · both migrations are additive only — no ALTER, no DROP, no
#                   RENAME, no TRUNCATE, no DELETE in executable SQL — and the
#                   superseded migration 165 cannot be applied by accident.
#   2 · CONTROLS  · positive and negative, on the shell half's own matcher, on
#                   every build. Rule 18 point 1.
#   3 · FULL GATE · the scanning suite: no exit of `mutatePlan` bypasses the
#                   ledger, and no deferral producer lacks a durable sink.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS GATE CANNOT FAIL ON (Rule 22)
#
#   · A DECISION MADE OUTSIDE `mutatePlan`. Guard 3 is scoped to the one door,
#     and inherits `_mutation_boundary.test.ts`'s scope entirely — if that scan
#     ever narrows, this one narrows with it and nothing here would say so.
#   · A LEDGER WRITE THAT RUNS AND FAILS. It scans source. Whether the row
#     actually lands is `_decision_ledger.db.test.ts`'s question, and that suite
#     SKIPS when no scratch database is reachable (loudly, saying so).
#   · WHETHER THE RECORDED EXPLANATION IS TRUE. It cannot tell a correct
#     sentence from a plausible one.
#   · WHETHER EITHER MIGRATION IS APPLIED TO PRODUCTION. Neither is, and that is
#     deliberate: DDL needs the owner's per-statement go. Rule 19 — green is not
#     deployed, and this gate says nothing whatsoever about the live database.
#   · A BRAND-NEW IN-MEMORY QUEUE in a module guard 2 does not know to look at.
#     The producer list is enumerated, and its liveness check catches the list
#     going empty, not the list going stale.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$ROOT/web-v2"

LEDGER_ENTRY="$W/lib/brain/ledger/ledger-entry.ts"
LEDGER_STORE="$W/lib/brain/ledger/decision-ledger.ts"
SCHEDULER="$W/lib/ops/reassessment-scheduler.ts"
MUTATE="$W/lib/plan/mutate.ts"
GATE="$W/lib/audit/_decision_ledger_gate.test.ts"
MIG_LEDGER="$W/db/migrations/166_plan_decision_ledger.sql"
MIG_SCHEDULE="$W/db/migrations/167_reassessment_schedule.sql"
MIG_SUPERSEDED="$W/db/migrations/165_canonical_adaptation_deferrals.sql"

fail() { echo "FAIL  check-decision-ledger · $1" >&2; exit 1; }

# ── 0 · TAMPER ───────────────────────────────────────────────────────────────
# Never `mkdir -p` anything here. check-modelled-mark.sh once contained
# `[ -d "$V5_VIEWS" ] || mkdir -p "$V5_VIEWS"` — a gate creating the tree it
# audits — and scanned zero files while reporting clean.
for f in "$LEDGER_ENTRY" "$LEDGER_STORE" "$SCHEDULER" "$MUTATE" "$GATE" \
         "$MIG_LEDGER" "$MIG_SCHEDULE" "$MIG_SUPERSEDED"; do
  [ -f "$f" ] || fail "missing $f · the gate cannot check what is not there"
done

# The suite must still DECLARE both guards, named. A generic grep for a comment
# is satisfied by the comment left behind when the suite is deleted.
grep -q "describe('GUARD 1 · every exit of the mutation boundary lands a ledger row'" "$GATE" \
  || fail "the gate suite no longer declares GUARD 1 · it has been renamed, weakened or removed"
grep -q "describe('GUARD 2 · a deferred action has a durable scheduler row'" "$GATE" \
  || fail "the gate suite no longer declares GUARD 2 · it has been renamed, weakened or removed"

# The boundary must still route through the ledger at all. If this line goes,
# every finding in guard 3 goes with it and the suite would pass vacuously.
grep -q "landDecisionInLedger" "$MUTATE" \
  || fail "lib/plan/mutate.ts no longer calls the ledger at all · every decision is unrecorded"
grep -q "recordDecision" "$LEDGER_STORE" \
  || fail "the ledger store no longer exports a write path"

# ── 1 · ADDITIVE ONLY ────────────────────────────────────────────────────────
# Read out of the migration files themselves, with comment lines stripped, so
# the check cannot be satisfied by prose that merely CLAIMS the migration is
# additive. Rule 18: read the source at run time, never hardcode both sides.
for mig in "$MIG_LEDGER" "$MIG_SCHEDULE"; do
  body="$(sed -E 's/^[[:space:]]*--.*$//' "$mig")"
  for forbidden in 'ALTER[[:space:]]+TABLE' 'DROP[[:space:]]' 'RENAME' 'TRUNCATE' 'DELETE[[:space:]]+FROM'; do
    if printf '%s' "$body" | grep -qiE "$forbidden"; then
      fail "$(basename "$mig") contains non-additive SQL matching /$forbidden/ · this gate only passes additive migrations"
    fi
  done
  creates="$(printf '%s' "$body" | grep -icE 'CREATE[[:space:]]+(UNIQUE[[:space:]]+)?(TABLE|INDEX)')"
  idem="$(printf '%s' "$body" | grep -icE 'CREATE[[:space:]]+(UNIQUE[[:space:]]+)?(TABLE|INDEX)[[:space:]]+IF NOT EXISTS')"
  [ "$creates" -gt 0 ] || fail "$(basename "$mig") creates nothing · the gate is reading the wrong file"
  [ "$creates" = "$idem" ] \
    || fail "$(basename "$mig") has $((creates - idem)) CREATE(s) without IF NOT EXISTS · re-running it would error"
done

# 165 is superseded. A file that says "do not apply" and still applies cleanly
# is a comment, not a control (Rule 20).
grep -q 'SUPERSEDED' "$MIG_SUPERSEDED" \
  || fail "165 is no longer stamped SUPERSEDED · either it is live again (say so) or the banner was lost"
raise_line="$(grep -n 'RAISE EXCEPTION' "$MIG_SUPERSEDED" | head -1 | cut -d: -f1)"
create_line="$(grep -n 'CREATE TABLE' "$MIG_SUPERSEDED" | head -1 | cut -d: -f1)"
[ -n "$raise_line" ] || fail "165 has no executable refusal · it would apply cleanly despite its banner"
[ -n "$create_line" ] || fail "165 no longer contains its DDL · the gate is reading the wrong file"
[ "$raise_line" -lt "$create_line" ] \
  || fail "165's refusal comes AFTER its DDL · the table would be created before the refusal fires"

# ── 2 · CONTROLS · Rule 18 point 1, on every build ───────────────────────────
# The one property the shell half owns: that a naked exit is findable in text
# and a recorded one is not. Both directions, every build.
probe_naked='    return fail("rejected", [], [], null);'
probe_recorded='    await land("REFUSE", "rejected", [], "because", null); return fail("x", [], [], null);'

printf '%s' "$probe_naked" | grep -qE '^\s*return fail\(' \
  || fail "POSITIVE CONTROL failed · the matcher cannot see an exit it was handed"
printf '%s' "$probe_recorded" | grep -q 'await land(' \
  || fail "NEGATIVE CONTROL failed · the matcher cannot see a ledger write it was handed"

# The ledger store must write on its OWN connection. A row written inside the
# mutation's transaction rolls back with the mutation, so the ledger would
# record every decision EXCEPT the refusals.
# NOTE the missing `\(`. Written with it, this check MISSED a planted
# `client.query<{ id: string }>(...)` during falsification — a generic type
# argument sits between the name and the paren, which is the ordinary way this
# codebase writes a typed query. The matcher now anchors on the word boundary
# after `query`, and the falsification that found this is recorded in the report.
if grep -qE '\bclient\.query\b' "$LEDGER_STORE"; then
  fail "the ledger store writes on a caller's client · a rejected mutation would roll its own record back"
fi
grep -qE '\bpool\.query\b' "$LEDGER_STORE" \
  || fail "the ledger store issues no query at all"

# ── 3 · THE FULL GATE ────────────────────────────────────────────────────────
# The exit scan, the lineage-ordering check, the direction-is-measured check and
# both ORACLEs live in the suite. Run it when a toolchain is present; say so
# LOUDLY when it is not. A silent skip is how a gate stops meaning anything.
if [ -x "$W/node_modules/.bin/vitest" ]; then
  ( cd "$W" && ./node_modules/.bin/vitest run \
      lib/audit/_decision_ledger_gate.test.ts \
      lib/brain/ledger/_decision_ledger.test.ts \
      lib/ops/_reassessment_scheduler.test.ts ) \
    || fail "the LEDGER-1 suite failed (above)"
else
  echo "NOTE  check-decision-ledger · no vitest binary; ran tamper + additive + controls only." >&2
  echo "NOTE  the mutatePlan exit scan and the deferral-sink scan DID NOT RUN." >&2
fi

exits="$(sed -n '/export async function mutatePlan<T>/,/^\/\/ ── the record ──/p' "$MUTATE" \
  | grep -cE '^\s*(return \{ ok: (true|false)|return fail\(|throw new Error\(|throw e;)')"
lands="$(grep -cE '(await land\(|await landDecisionInLedger\()' "$MUTATE")"
[ "$exits" -ge 8 ] || fail "only $exits mutatePlan exits found · the extractor has lost the function"
[ "$lands" -ge "$exits" ] || fail "$lands ledger writes for $exits exits · at least one exit records nothing"

echo "ok    check-decision-ledger · $exits mutatePlan exits, $lands ledger writes, both migrations additive, 165 refuses to apply"
