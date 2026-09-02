#!/usr/bin/env bash
#
# check-goal-volume-leak · GOALVOL-1 · A TYPED GOAL MAY NOT INCREASE TRAINING
# VOLUME.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS
#
# David, 2026-09-02, verbatim:
#
#   "A typed goal must not directly increase training volume. Volume must be
#    governed by demonstrated training history, durable/sustained volume,
#    recovery, plan phase, and safety constraints. The goal may influence plan
#    direction and required development, but it cannot manufacture readiness
#    for more load."
#
# `scripts/check-goal-pace-leak.sh` is this gate's sibling and closes the PACE
# half of Constitution §7/§G. It says, in its own Rule 22 section, that it
# "says nothing about race-day pricing, deliberately" — and it also said
# nothing about VOLUME, because a goal reaching a MILEAGE BAND is a different
# expression entirely and its pattern could not see it.
#
# The defect it could not see: `lookupTierTarget(goalPaceSec, …)` selected the
# LOAD row of `TIER_TARGETS` — peak weekly mileage, peak long run, long-run
# share, quality sessions, training days, MLR ceiling — with the runner's typed
# goal as its FIRST ARGUMENT. `classifyGoalTier`'s advanced branch floored the
# tier and never ceilinged it, so an `advanced` marathoner whose goal crossed
# the elite pace line moved from [65, 90] to [70, 100] mi/wk on identical
# evidence. Measured end to end through `composePlan` on the day this landed:
# 65 mi/wk peak with no goal, 65 with a 3:00 goal, and 70 with a 2:20 goal.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT IT CHECKS
#
#   1. LIVENESS FIRST (Rule 18 point 2). Reports how many files it read and
#      fails on a floor. A scanner that reports clean because it looked at
#      nothing is the worst outcome available.
#   2. POSITIVE AND NEGATIVE CONTROLS, before any finding is reported.
#   3. THE SEAL IS DECLARED. `classifyCapacityTier`'s parameter tuple, the
#      compile-time assertion over it, and the exported witness type must all
#      still be there. A `tsc` assertion that gets deleted takes its guarantee
#      with it silently, and nothing else in the build would notice.
#   4. THE DELETED SYMBOL STAYS DELETED. `lookupTierTarget` had the goal as its
#      first positional parameter and has no honest reintroduction.
#   5. THE SCAN. Any site that hands a goal identifier into a load-table
#      lookup, under the two trees that size training, minus a ratcheted,
#      argued allowlist.
#   6. THE REPLACEMENT STAYS WIRED (Rule 13 point 3 · assert the shape of the
#      result, not the absence of the defect). A deletion with nothing in its
#      place passes every absence check above and leaves the engine unable to
#      size a block.
#   7. THE BEHAVIOURAL GATE EXISTS. The text scan cannot see a leak that goes
#      through a renamed variable; `lib/plan/_goal_volume_seal.test.ts` walks
#      goal pace against composed volume and is what actually proves the
#      invariant. This asserts the file is present and still carries its walk.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS GATE CANNOT FAIL ON (Rule 22 — stated, not implied)
#
#   · IT IS A TEXT SCAN. A goal that reaches the load table through a variable
#     renamed to something innocuous three modules away is invisible to it. The
#     structural defence is the compile-time parameter-tuple assertion in
#     `goal-tiers.ts` (guard 3), and the behavioural defence is
#     `_goal_volume_seal.test.ts` (guard 7). This gate is the belt to those two
#     sets of braces, and it is here because a deleted assertion and a deleted
#     test both pass `tsc` and `vitest` in silence.
#   · IT CANNOT JUDGE MAGNITUDE. A band lifted by one mile and by forty read
#     identically here.
#   · IT SAYS NOTHING ABOUT PACE. The goal legitimately prices RACE DAY
#     (Constitution §J) and `check-goal-pace-leak.sh` owns the training-pace
#     question. This gate is only about LOAD.
#   · IT CANNOT SEE THE REDUCTION HALF. `resolveLoadTier` is
#     `min(capacity, demand)`, so a faster goal can still move a runner from
#     "reduced" back up to their capacity answer. That residual is deliberate,
#     argued in the GOALVOL-1 block of `goal-tiers.ts`, and open for David — it
#     is NOT something this gate is failing to catch, it is something nobody
#     has yet ruled on.
#   · IT CANNOT SEE OUTSIDE ITS TWO TREES. `lib/plan` and `lib/training` are
#     where training load is sized. `lib/coach/limiter.ts` reads
#     `TIER_TARGETS[cat][tier].peakWeeklyMileageBand[0]` as a limiter BAR and
#     is under `lib/coach`, which this does not scan: it belongs to the
#     Coaching Thesis, it prescribes no load, and it now tracks the sealed
#     answer for free because `classifyGoalTier` delegates to
#     `resolveLoadTier`. Reported as a residual rather than scanned, so its
#     owner moves it by name.
#
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0
fail() { echo "FAIL  check-goal-volume-leak · $*" >&2; FAILED=1; }

TIERS="$ROOT/web-v2/lib/plan/goal-tiers.ts"
GEN="$ROOT/web-v2/lib/plan/generate.ts"
SEAL="$ROOT/web-v2/lib/plan/_goal_volume_seal.test.ts"

TREES=(
  "$ROOT/web-v2/lib/plan"
  "$ROOT/web-v2/lib/training"
)
for d in "${TREES[@]}"; do
  [ -d "$d" ] || { echo "FAIL  check-goal-volume-leak · missing tree $d · the gate is watching nothing" >&2; exit 1; }
done
for f in "$TIERS" "$GEN" "$SEAL"; do
  [ -f "$f" ] || { echo "FAIL  check-goal-volume-leak · missing $f · the gate is watching nothing" >&2; exit 1; }
done

# ── THE PATTERN · a goal identifier handed into a load-table lookup ──────────
#
# Deliberately narrow and call-shaped. Each alternative is a real expression
# this repo has shipped or could ship:
#
#   lookupTierTarget(          — the deleted function, goal-first by signature
#   classifyGoalTier(          — the deprecated shim; a LOAD consumer must not
#                                call it, because its name says goal and its
#                                answer is load
#   goalPaceSec: … TIER_TARGETS / peakWeekly — a goal threaded straight into
#                                the band on one line
#
# `goalDemandTier(` is NOT matched: it is the reduction half by construction
# and `resolveLoadTier` is its only honest caller, which the seal test pins.
PATTERN='lookupTierTarget[[:space:]]*\(|classifyGoalTier[[:space:]]*\(|TIER_TARGETS\[[^]]*\]\[[^]]*(goalTier|tierFromGoal)|peakWeeklyMileageBand.*goalPaceSec|goalPaceSec.*peakWeeklyMileageBand'

# ── 1 · LIVENESS ─────────────────────────────────────────────────────────────
#
# `! -name '._*'` matters and has already cost this programme a red build once:
# the working volume is exFAT, macOS writes an AppleDouble `._foo.ts` sidecar
# beside every file, and `find -name '*.ts'` matches those too — so a local
# count is DOUBLE what CI checks out. Both `find` calls exclude them, so the
# local and CI counts agree.
SCANNED=$(find "${TREES[@]}" \( -name '*.ts' -o -name '*.tsx' \) ! -name '._*' | wc -l | tr -d ' ')
# A liveness floor, not a target: low enough never to fail on an honest
# deletion, high enough to notice a tree silently dropping out. The two trees
# held ~250 files (tests included) when this was written.
if [ "$SCANNED" -lt 120 ]; then
  echo "FAIL  check-goal-volume-leak · read only $SCANNED files · the scan is not looking at the engine" >&2
  exit 1
fi

# ── 2 · CONTROLS · both directions, before any finding ───────────────────────
POS='  const { target } = lookupTierTarget(input.goalPaceSec, input.raceDistanceMi, input.level);'
NEG='  const { target } = lookupLoadTierTarget({ raceDistanceMi, level, demonstratedPaceSec, goalPaceSec });'
echo "$POS" | grep -qE "$PATTERN" \
  || { echo "FAIL  check-goal-volume-leak · POSITIVE CONTROL failed · the matcher cannot see a leak it was handed" >&2; exit 1; }
if echo "$NEG" | grep -qE "$PATTERN"; then
  echo "FAIL  check-goal-volume-leak · NEGATIVE CONTROL failed · the matcher flags the sealed lookup" >&2
  exit 1
fi

# ── 3 · THE COMPILE-TIME SEAL IS DECLARED ───────────────────────────────────
#
# Rule 20's corollary pointed at a type: a `tsc` assertion that is deleted
# takes its guarantee with it and nothing else in the build notices, because
# everything still compiles. These four lines are the assertion.
grep -q 'export function classifyCapacityTier(' "$TIERS" \
  || fail "goal-tiers.ts no longer declares classifyCapacityTier · the load ceiling has no goal-free owner"
grep -q 'type CapacityTierParams = \[' "$TIERS" \
  || fail "goal-tiers.ts no longer declares CapacityTierParams · nothing pins the capacity tier's parameter tuple"
grep -q '_TierEquals<Parameters<typeof classifyCapacityTier>, CapacityTierParams>' "$TIERS" \
  || fail "the compile-time goal-isolation assertion over classifyCapacityTier is GONE · a goal parameter would now compile"
grep -q 'export type LoadCeilingIsGoalFree' "$TIERS" \
  || fail "the exported witness type is gone · an unused-locals pass could delete the assertion with it"
# And the tuple must not have quietly grown a fourth member.
if grep -A 5 'type CapacityTierParams = \[' "$TIERS" | grep -qiE 'goal'; then
  fail "CapacityTierParams mentions a goal · the seal has been widened to admit the thing it excludes"
fi

# ── 4 · THE DELETED SYMBOL STAYS DELETED ────────────────────────────────────
# Guarded as REMOVED, the same shape `weeklyVolWoWMaxPct` uses in the doctrine
# registry. `lookupTierTarget` took the goal as its first positional parameter.
if grep -qE '^export function lookupTierTarget\b' "$TIERS"; then
  fail "goal-tiers.ts exports \`lookupTierTarget\` again · the goal-first load lookup was deleted by GOALVOL-1"
fi

# ── 5 · THE SCAN ─────────────────────────────────────────────────────────────
# Comment lines are stripped: several files now DOCUMENT the deletion at
# length, and a gate that cannot tell an epitaph from a resurrection fires on
# the wrong one.
HITS_FILE="$(mktemp)"
trap 'rm -f "$HITS_FILE"' EXIT

while IFS= read -r f; do
  rel="${f#"$ROOT"/}"
  hits=$(sed -e 's://.*$::' "$f" \
    | awk 'BEGIN{inc=0} {line=$0; if (inc) { if (match(line,/\*\//)) { line=substr(line,RSTART+2); inc=0 } else next } while (match(line,/\/\*/)) { pre=substr(line,1,RSTART-1); rest=substr(line,RSTART+2); if (match(rest,/\*\//)) { line=pre substr(rest,RSTART+2) } else { line=pre; inc=1 } } print line}' \
    | grep -cE "$PATTERN")
  [ "$hits" -gt 0 ] && echo "$rel $hits" >> "$HITS_FILE"
done < <(find "${TREES[@]}" \( -name '*.ts' -o -name '*.tsx' \) ! -name '._*')

# ── THE ALLOWLIST · every entry carries an argued reason and self-expires ────
#
# FORMAT: one `path|reason` per line. A path listed here that NO LONGER matches
# FAILS the build until the entry is deleted (Rule 18 point 4). It may shrink.
# It may not grow without an argument that survives review.
read -r -d '' ALLOWLIST <<'EOF'
web-v2/lib/plan/goal-tiers.ts|DEFINITION SITE. `classifyGoalTier` is declared here as the deprecated positional shim over `resolveLoadTier`, and this is the file the seal itself lives in. Shrinks to nothing the day the last external caller moves and the shim is deleted.
web-v2/lib/plan/_coldstart_doctrine.test.ts|COLD-1's OWN TEST. Asserts a typed goal cannot authorize elite volume off zero evidence - the same invariant one rung earlier - and it names `classifyGoalTier` because that is the symbol COLD-1 was written against.
web-v2/lib/plan/_audit_tier_experience.test.ts|THE VAR-01 / GOALVOL-1 TABLE TEST. Its whole subject is what the tier resolves to per experience level, so it names the classifier by construction.
web-v2/lib/plan/_sweep_allusers.test.ts|THE ANSWER KEY. The archetype sweep grades each plan against `TIER_TARGETS[cat][tier]` and must resolve the tier the SAME way the composer did, or the grading side and the graded side disagree and every conformance assertion becomes noise.
web-v2/lib/plan/_open_block_authoring.test.ts|OPEN-BLOCK AUTHORING. Calls the classifier with a NULL goal on purpose - the no-target path has no goal to leak, and the test is asserting exactly that its tier comes from evidence and level.
EOF

# ── ONE EXEMPTION CLOSED THE DAY IT WAS WRITTEN ──────────────────────────────
#
# `web-v2/lib/training/_brain_acceptance.test.ts` was on that list. Its goal-
# isolation walk labelled each pair with `classifyGoalTier(goalPace, distance,
# level)` and omitted `demonstratedPaceSec`, so the bucket it sorted pairs into
# was a DIFFERENT quantity from the tier `composePlan` sized the block with
# (Rule 16) — golden runner 3 sat astride the divergence and the strong
# within-tier assertion fired on two blocks the engine had deliberately sized
# apart. It now calls `resolveLoadTier` with the composer's own demonstrated
# pace, so it no longer matches, and the ratchet in section 5 failed until this
# entry was DELETED rather than annotated. That is the ratchet working, on its
# first build.

ALLOWED_COUNT=0
UNEXPLAINED=0
while read -r rel hits; do
  [ -n "$rel" ] || continue
  if echo "$ALLOWLIST" | grep -qF "$rel|"; then
    ALLOWED_COUNT=$((ALLOWED_COUNT + 1))
    continue
  fi
  echo "FAIL  check-goal-volume-leak · $rel · $hits goal-into-load-table expression(s)" >&2
  echo "      A typed goal may not increase training volume (GOALVOL-1)." >&2
  echo "      Read the band from lookupLoadTierTarget / resolveLoadTier, whose" >&2
  echo "      ceiling half has no goal in its parameter tuple, or add an argued" >&2
  echo "      allowlist entry to scripts/check-goal-volume-leak.sh." >&2
  UNEXPLAINED=$((UNEXPLAINED + 1))
done < "$HITS_FILE"
[ "$UNEXPLAINED" -gt 0 ] && FAILED=1

# ── THE RATCHET · a stale exemption fails until it is deleted ────────────────
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  path="${entry%%|*}"
  if [ ! -f "$ROOT/$path" ]; then
    fail "allowlist names $path, which does not exist · delete the entry"
    continue
  fi
  if ! grep -qF "$path " "$HITS_FILE" 2>/dev/null; then
    fail "allowlist exempts $path, which no longer reaches a load table from a goal · DELETE the entry (Rule 18: a stale exemption fails until removed)"
  fi
done <<< "$ALLOWLIST"

# ── 6 · THE REPLACEMENT STAYS WIRED ─────────────────────────────────────────
# Pinned to the RACE-PATH destructure, not to the bare call. The first cut of
# this guard grepped `lookupLoadTierTarget({` and PASSED while the race path was
# unwired, because the HORIZON-RAISE call one screen below satisfied it. A gate
# reporting clean on the one site that matters is exactly Rule 18's failure, and
# it was found by falsifying rather than by reading.
grep -q 'const { tier, capacityTier, reducedByGoal, target: baseTierTarget } = lookupLoadTierTarget({' "$GEN" \
  || fail "composePlan no longer reads its load band from lookupLoadTierTarget · the block would be sized by something else"
grep -q 'raceDistanceMi: h.distanceMi, level: input.level,' "$GEN" \
  || fail "the horizon-raise lookup no longer goes through the sealed load lookup · a future race's typed goal could lift this block's long-run dials"
grep -q 'goalPaceSec: input.goalPaceSec, // reduction only' "$GEN" \
  || fail "the race path no longer passes the goal as a REDUCTION · check what it does pass"
grep -q 'capacity_tier: capacityTier' "$GEN" \
  || fail "authored_state no longer stamps capacity_tier · a block can no longer say what ceiling it was authored under (Rule 11)"

# ── 7 · THE BEHAVIOURAL GATE EXISTS AND STILL WALKS ─────────────────────────
grep -q 'the goal never widens the load band' "$SEAL" \
  || fail "_goal_volume_seal.test.ts no longer carries the §2 seal walk"
grep -q 'a faster goal buys no volume' "$SEAL" \
  || fail "_goal_volume_seal.test.ts no longer carries the §3 end-to-end walk"
grep -q 'demonstrated evidence still lifts the band' "$SEAL" \
  || fail "_goal_volume_seal.test.ts no longer carries the §5 Rule 21 walk · a seal with no upward path is a wall"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
echo "ok    check-goal-volume-leak · $SCANNED files scanned, $ALLOWED_COUNT argued exemptions (0 stale), controls passed, compile-time seal declared, lookupTierTarget still absent"
