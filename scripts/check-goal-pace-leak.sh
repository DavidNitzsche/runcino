#!/usr/bin/env bash
#
# check-goal-pace-leak · Constitution §7/§G · A STATED GOAL MAY NOT PRICE A
# TRAINING PACE.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS
#
# `docs/BRAIN_CONSTITUTION.md` §G gives "what pace should this workout be run
# at" to Pace Prescription, whose inputs are compile-time sealed against goal
# data, and gives "what race performance does current evidence support" to Race
# Prediction. A goal belongs in the second question and nowhere near the first:
# a runner does not become faster by typing an ambitious time.
#
# That was written down, decided, and violated anyway, for months, because
# NOTHING COULD TELL. The 2026-09-01 independent audit measured it firing on
# the owner's own production plan:
#
#   · `blendedTPaceForWeek` walked his prescribed threshold pace 15% of the way
#     toward a 3:00 marathon goal on ZERO demonstrated progress, and up to
#     20 s/mi on that block with more available on a longer one.
#   · `generate.ts:14160` set the plan-wide threshold to
#     `min(tPaceFromGoal(goal), currentT)` — `min` of two PACES picks the
#     FASTER, so for any ambitious goal the plan-wide number WAS the goal's.
#   · `resolveMarathonPace` returned the goal pace outright whenever it landed
#     inside the marathon zone.
#   · The blend was ASYMMETRIC: `BRK-1` kept current fitness whenever the goal
#     was slower, so a goal could only ever make training harder.
#
# `check-goal-immutability.sh` passed throughout. It watches goal MUTATION —
# whether anything rewrites the runner's stated goal — which is a different
# question, and the audit says so in as many words: "There is no gate for the
# latter. Rule 20."
#
# This is that gate.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT IT CHECKS
#
#   1. LIVENESS FIRST (Rule 18 point 2). It reports how many files it read and
#     fails on zero. A scanner that reports clean because it looked at nothing
#     is the worst outcome available, because it also reports confidence.
#   2. POSITIVE AND NEGATIVE CONTROLS, run on every build BEFORE any finding is
#     reported. A matcher that cannot see a leak it was handed is not evidence
#     about the codebase.
#   3. THE SCAN. Every non-test, non-comment line under the three owned trees
#     that derives a pace from a goal identifier, minus the two owners allowed
#     to and minus an explicit, argued, RATCHETED allowlist.
#   4. THE ALLOWLIST IS A RATCHET AND SELF-EXPIRING. An entry whose file no
#     longer leaks fails until it is deleted. "We might need it" is not a
#     reason.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS GATE CANNOT FAIL ON (Rule 22 — stated, not implied)
#
#   · IT IS A TEXT SCAN. A goal that reaches a pace through a variable renamed
#     to something innocuous (`target`, `aspiration`, `t2`) three modules away
#     is invisible to it. The structural defence is
#     `capacity-resolver.ts`'s compile-time parameter-tuple assertion, which
#     makes a goal argument on any capacity resolver a TYPE ERROR; this gate is
#     the belt to that suspenders, aimed at the plan/prescription layers the
#     type seal does not reach.
#   · IT CANNOT JUDGE MAGNITUDE. A leak of 1 s/mi and a leak of 200 s/mi read
#     identically here.
#   · IT SAYS NOTHING ABOUT RACE-DAY PRICING, deliberately. A race row IS
#     priced from the runner's goal, bounded by `achievableRaceTarget`, and
#     that is correct — Constitution §J. `lib/race/` and
#     `lib/training/achievable-target.ts` are excluded by design, not by
#     oversight.
#   · IT CANNOT SEE A LEAK OUTSIDE THE THREE TREES. `app/` routes and
#     `lib/faff/` are not scanned; the v5 Today surface reads
#     `tPaceFromGoal(goal_seconds, …)` for a DISPLAY pace and is a known, open,
#     separately-owned question.
#
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0
fail() { echo "FAIL  check-goal-pace-leak · $*" >&2; FAILED=1; }

TREES=(
  "$ROOT/web-v2/lib/plan"
  "$ROOT/web-v2/lib/training"
  "$ROOT/web-v2/lib/prescription"
)
for d in "${TREES[@]}"; do
  [ -d "$d" ] || { echo "FAIL  check-goal-pace-leak · missing tree $d · the gate is watching nothing" >&2; exit 1; }
done

# The identifiers that mean "a goal reached a pace". Deliberately narrow and
# deliberately named: each one is a real expression this repo has shipped.
#
# CALL-SHAPED on purpose. `measuredProgressFraction: null` is a FIELD — the
# explicit null `recompute-paces.ts` keeps so a reader of an old stamp can tell
# "the gate ran" from "there is no gate any more" (Rule 11). Matching the bare
# identifier reported that field as a leak on the first run of this gate, which
# is the false-positive that makes a check get switched off.
PATTERN='tPaceFromGoal[[:space:]]*\(|blendedTPaceForWeek[[:space:]]*\(|measuredProgressFraction[[:space:]]*\(|gatedBlendFraction[[:space:]]*\(|BLEND_GRACE_FRACTION|goalT[[:space:]]*=|goalTraw|goalTFloored|goalPaceSPerMi[[:space:]]*:[[:space:]]*(input\.goalPaceSec|goalPaceSec)'

# ── THE OWNERS · the two places a goal legitimately meets a pace ─────────────
#
# `lib/training/achievable-target.ts` — Race Prediction's own bound on a
#   race-day target (§J). Its whole job is to take the goal.
# `lib/race/**` — outside these trees already; named here so the boundary is
#   written down in one place rather than inferred from the tree list.
OWNERS_RE='web-v2/lib/training/achievable-target\.ts'

# ── THE ALLOWLIST · every entry carries an argued reason and an expiry ───────
#
# FORMAT: one `path|reason` per line. A path listed here that NO LONGER matches
# the pattern FAILS the build until the entry is deleted (self-expiring, per
# Rule 18 point 4). The list may shrink. It may not grow without an argument
# that survives review.
read -r -d '' ALLOWLIST <<'EOF'
web-v2/lib/plan/spec-builder.ts|DEFINITION SITE + THE RACE BRANCH. `tPaceFromGoal` is defined here and `buildWorkoutSpec`'s `case race` prices race day off `goalPaceSPerMi`, which is Constitution §J and correct. The AUTHORING callers are gone (AUTHORING-CANONICAL-1); what remains are the definition, the race branch, and the restore/adapt fallbacks below that still import it. Shrinks to the race branch alone when `tPaceFromGoal` loses its last non-race caller.
web-v2/lib/plan/adapt.ts|ADAPT-TIME RESTORE FALLBACK. `adapt.ts` re-derives a T-pace from the goal when it has to rebuild a single row and no anchor was handed to it. Phase 3 of the P0 order owns the adaptation path and will re-point it at `resolvePrescribedPaceAnchors`; migrating it here would collide with that work. OPEN — a real, if narrow, §G leak.
web-v2/lib/training/prescriptions.ts|DISPLAY SURFACE. `paces(p)` returns `tPaceFromGoal(p.goal_seconds, p.goal_distance_mi)` for the v5 Today card. It prices nothing that is persisted and nothing the runner is prescribed; it is a label. OPEN, and the UI phase owns it — but it IS a second answer to "what is this runner's threshold pace" and should be re-pointed at the canonical anchors.
EOF

# ── 1 · LIVENESS ─────────────────────────────────────────────────────────────
SCANNED=$(find "${TREES[@]}" -name '*.ts' ! -name '*.test.ts' ! -name '*.audit.test.ts' | wc -l | tr -d ' ')
if [ "$SCANNED" -lt 50 ]; then
  echo "FAIL  check-goal-pace-leak · read only $SCANNED files · the scan is not looking at the engine" >&2
  exit 1
fi

# ── 2 · CONTROLS · both directions, before any finding ───────────────────────
POS='const goalT = tPaceFromGoal(input.goalSec, input.raceDistanceMi);'
NEG='const currentT = anchors.thresholdSecPerMi;'
echo "$POS" | grep -qE "$PATTERN" \
  || { echo "FAIL  check-goal-pace-leak · POSITIVE CONTROL failed · the matcher cannot see a leak it was handed" >&2; exit 1; }
if echo "$NEG" | grep -qE "$PATTERN"; then
  echo "FAIL  check-goal-pace-leak · NEGATIVE CONTROL failed · the matcher flags canonical pricing" >&2
  exit 1
fi

# ── 3 · THE SCAN ─────────────────────────────────────────────────────────────
# Comment lines are stripped: a file that DOCUMENTS the deletion (and several
# now do, at length) must not be reported as performing it. A gate that cannot
# tell an epitaph from a resurrection fires on the wrong one.
HITS_FILE="$(mktemp)"
trap 'rm -f "$HITS_FILE"' EXIT

while IFS= read -r f; do
  rel="${f#"$ROOT"/}"
  echo "$rel" | grep -qE "$OWNERS_RE" && continue
  # Strip block comments, line comments and blank lines before matching.
  hits=$(sed -e 's://.*$::' "$f" \
    | awk 'BEGIN{inc=0} {line=$0; if (inc) { if (match(line,/\*\//)) { line=substr(line,RSTART+2); inc=0 } else next } while (match(line,/\/\*/)) { pre=substr(line,1,RSTART-1); rest=substr(line,RSTART+2); if (match(rest,/\*\//)) { line=pre substr(rest,RSTART+2) } else { line=pre; inc=1 } } print line}' \
    | grep -cE "$PATTERN")
  [ "$hits" -gt 0 ] && echo "$rel $hits" >> "$HITS_FILE"
done < <(find "${TREES[@]}" -name '*.ts' ! -name '*.test.ts' ! -name '*.audit.test.ts')

ALLOWED_COUNT=0
UNEXPLAINED=0
while read -r rel hits; do
  [ -n "$rel" ] || continue
  if echo "$ALLOWLIST" | grep -qF "$rel|"; then
    ALLOWED_COUNT=$((ALLOWED_COUNT + 1))
    continue
  fi
  echo "FAIL  check-goal-pace-leak · $rel · $hits goal-derived pace expression(s)" >&2
  echo "      A stated goal may not price a training pace (Constitution §7/§G)." >&2
  echo "      Price the zone from resolvePrescribedPaceAnchors, or add an argued" >&2
  echo "      allowlist entry to scripts/check-goal-pace-leak.sh." >&2
  UNEXPLAINED=$((UNEXPLAINED + 1))
done < "$HITS_FILE"
[ "$UNEXPLAINED" -gt 0 ] && FAILED=1

# ── 4 · THE RATCHET · a stale exemption fails until it is deleted ────────────
STALE=0
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  path="${entry%%|*}"
  if [ ! -f "$ROOT/$path" ]; then
    fail "allowlist names $path, which does not exist · delete the entry"
    STALE=$((STALE + 1))
    continue
  fi
  if ! grep -qF "$path " "$HITS_FILE" 2>/dev/null; then
    fail "allowlist exempts $path, which no longer derives a pace from a goal · DELETE the entry (Rule 18: a stale exemption fails until removed)"
    STALE=$((STALE + 1))
  fi
done <<< "$ALLOWLIST"

# ── 5 · THE DELETED SYMBOLS STAY DELETED ─────────────────────────────────────
# Guarded as removed, the same shape `weeklyVolWoWMaxPct` uses. These five were
# the goal→training-pace blend and they have no honest reintroduction.
RP="$ROOT/web-v2/lib/plan/recompute-paces.ts"
[ -f "$RP" ] || fail "recompute-paces.ts is gone · this guard is watching nothing"
for sym in BLEND_GRACE_FRACTION maxSeasonalVdotGain measuredProgressFraction gatedBlendFraction blendedTPaceForWeek; do
  if grep -qE "^export (const|function) ${sym}\b" "$RP"; then
    fail "recompute-paces.ts exports \`${sym}\` again · the goal→training-pace blend was deleted by AUTHORING-CANONICAL-1"
  fi
done

# ── 6 · THE REPLACEMENT STAYS WIRED ──────────────────────────────────────────
# A deletion with nothing in its place passes every absence check above and
# leaves the engine unable to price a block. Assert the shape of the RESULT,
# not the absence of the defect (Rule 13 point 3).
GEN="$ROOT/web-v2/lib/plan/generate.ts"
grep -q 'const currentT = anchors.thresholdSecPerMi;' "$GEN" \
  || fail "composePlan no longer prices its threshold from the canonical anchors"
grep -q 'resolvePrescribedPaceAnchors(userId, todayISO)' "$GEN" \
  || fail "loadGeneratorInputs no longer resolves the canonical pace anchors · authoring and the nightly flex would price the same block two different ways (Constitution §8)"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
echo "ok    check-goal-pace-leak · $SCANNED files scanned, $ALLOWED_COUNT argued exemptions (0 stale), controls passed, 5 deleted symbols still absent"
