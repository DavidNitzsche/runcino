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
#   · IT CANNOT SEE A LEAK OUTSIDE ITS TREES. Those are now seven —
#     `lib/plan`, `lib/training`, `lib/prescription`, `lib/faff`, `lib/coach`,
#     `lib/watch` and `app` — which is every tree that has ever priced a
#     training pace in this repo. `components/` is NOT scanned: the web
#     frontend is paused per CLAUDE.md and nothing there persists a pace.
#     `legacy/` and `native-v2/` are not TypeScript and are out of reach by
#     construction; a goal-derived pace written in Swift is invisible here.
#
#     This bullet used to read "`app/` routes and `lib/faff/` are not scanned;
#     the v5 Today surface reads `tPaceFromGoal(goal_seconds, …)` for a DISPLAY
#     pace and is a known, open, separately-owned question." Both halves are
#     closed as of 2026-09-02: the trees are in, and the v5 Today ladder is
#     deleted (SECOND-OWNER-1).
#   · IT CANNOT JUDGE AN EXCLUSION IT WAS GIVEN. `EXCLUDE` carves one shape out
#     of `goalT =` — a goal DATE, not a goal pace. It is pinned by its own
#     positive and negative controls, but a second false-positive shape would
#     have to be found the same way this one was: by widening the trees and
#     reading every finding.
#
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0
fail() { echo "FAIL  check-goal-pace-leak · $*" >&2; FAILED=1; }

## ── THE TREES ───────────────────────────────────────────────────────────────
#
# 2026-09-02 · SECOND-OWNER-1 · `app/`, `lib/faff`, `lib/coach` and `lib/watch`
# ADDED. The Rule 22 section above used to say, in as many words, that the
# scan "cannot see a leak outside the three trees" and that "`app/` routes and
# `lib/faff/` are not scanned; the v5 Today surface reads
# `tPaceFromGoal(goal_seconds, …)` for a DISPLAY pace and is a known, open,
# separately-owned question."
#
# That question is now closed — `derivePaces` is deleted and the card surfaces
# read `resolvePrescribedPaceAnchors` — and a gate that still cannot look at
# the two trees the defect was actually RENDERED from could not catch it coming
# back at the site where it happened. So it looks there now.
TREES=(
  "$ROOT/web-v2/lib/plan"
  "$ROOT/web-v2/lib/training"
  "$ROOT/web-v2/lib/prescription"
  "$ROOT/web-v2/lib/faff"
  "$ROOT/web-v2/lib/coach"
  "$ROOT/web-v2/lib/watch"
  "$ROOT/web-v2/app"
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

# ── THE EXCLUSION · one shape that is NOT a leak, named and argued ───────────
#
# 2026-09-02 · found by widening the trees. `goalT` was added to the pattern
# because this repo shipped `const goalT = tPaceFromGoal(...)` — a goal-derived
# THRESHOLD PACE. It also matches `lib/faff/block-state.ts`'s
#
#     const goalT = parseISO(goalDateISO);
#
# which is a goal DATE in milliseconds, differenced against the block's open
# date to count weeks. A timestamp is not a pace and never becomes one.
#
# Exempting the FILE would have been the reflex and the wrong move: it would
# have excused any future real leak in it. Excluding the SHAPE keeps every
# other line in that file under the scan, and the negative control below pins
# the exclusion so it cannot quietly widen into "any assignment to goalT".
EXCLUDE='goalT[[:space:]]*=[[:space:]]*(parseISO|Date\.parse|new Date|dateOf|toMs)'

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
web-v2/lib/plan/authoring-shadow-compare.ts|SHADOW ONLY, AND THE LAST PLACE THE LEGACY DERIVATION EXISTS. `legacyPricingFor` hands the stated goal to `resolveMarathonPace` because that is precisely what the pre-migration composer did, and a comparison that does not reproduce the leak cannot measure it - the goal-at-MP days are the single largest divergence in the whole block. The module has no runtime importer, is declared in MODULE_ORPHANS with that argument, and imports nothing that can persist. It is deleted the day the migration report stops needing a before.
EOF

# ── SECOND-OWNER-1 (2026-09-02) · ONE EXEMPTION CLOSED ───────────────────────
#
# `web-v2/lib/training/prescriptions.ts` was on that list, and its own reason
# text said what to do about it: "it IS a second answer to 'what is this
# runner's threshold pace' and should be re-pointed at the canonical anchors."
# It has been. `derivePaces` and `tPaceSecPerMi` are DELETED; the file no longer
# imports `tPaceFromGoal` at all, and `cardPaceTargets` reads the six anchors
# from `resolvePrescribedPaceAnchors`. Measured on the owner's own account the
# day it was removed, goal-derived against canonical: threshold 394 vs 430,
# interval 376 vs 401, repetition 333 vs 365, marathon 412 vs 472.
#
# The entry is DELETED rather than kept with a "closed" note, because the
# ratchet in section 4 below fails on a stale exemption — which is exactly how
# this one was meant to expire, and it is the proof the ratchet works.

# ── 1 · LIVENESS ─────────────────────────────────────────────────────────────
SCANNED=$(find "${TREES[@]}" \( -name '*.ts' -o -name '*.tsx' \) ! -name '._*' ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.audit.test.ts' | wc -l | tr -d ' ')
# 2026-09-02 · the floor rose with the trees. Three trees held ~246 files; the
# seven hold ~438, so a 50-file floor would no longer notice the scan losing
# `app/` entirely.
#
# THE FLOOR WAS 500 FOR ONE COMMIT AND IT BROKE THE BUILD. It was set from a
# local count of 876, which was double the truth: the working volume is exFAT
# and macOS writes an AppleDouble `._foo.ts` sidecar beside every file, and
# `find -name '*.ts'` matches those too. CI checks out a clean tree, counted
# the real 438, and failed the floor it could never reach. Both `find` calls
# now exclude `._*`, so the local and CI counts agree and the scan never tries
# to read a sidecar as source. 300 is comfortably under 438 and still well
# above what any single tree holds. This is a LIVENESS floor, not a target: it must
# be low enough never to fail on an honest deletion and high enough to notice a
# tree silently dropping out.
if [ "$SCANNED" -lt 300 ]; then
  echo "FAIL  check-goal-pace-leak · read only $SCANNED files · the scan is not looking at the app" >&2
  exit 1
fi

# ── 2 · CONTROLS · both directions, before any finding ───────────────────────
POS='const goalT = tPaceFromGoal(input.goalSec, input.raceDistanceMi);'
NEG='const currentT = anchors.thresholdSecPerMi;'
# The exclusion gets its own pair, for the same reason the pattern does: an
# EXCLUDE that stopped matching would silently reintroduce the false positive,
# and an EXCLUDE that widened would silently swallow the real leak it is
# carved out of.
EXC_POS='  const goalT = parseISO(goalDateISO);'
EXC_NEG='  const goalT = tPaceFromGoal(goalSec, goalDistanceMi);'
echo "$POS" | grep -qE "$PATTERN" \
  || { echo "FAIL  check-goal-pace-leak · POSITIVE CONTROL failed · the matcher cannot see a leak it was handed" >&2; exit 1; }
if echo "$NEG" | grep -qE "$PATTERN"; then
  echo "FAIL  check-goal-pace-leak · NEGATIVE CONTROL failed · the matcher flags canonical pricing" >&2
  exit 1
fi
echo "$EXC_POS" | grep -qE "$EXCLUDE" \
  || { echo "FAIL  check-goal-pace-leak · EXCLUDE POSITIVE CONTROL failed · a goal DATE is being reported as a goal PACE" >&2; exit 1; }
if echo "$EXC_NEG" | grep -qE "$EXCLUDE"; then
  echo "FAIL  check-goal-pace-leak · EXCLUDE NEGATIVE CONTROL failed · the exclusion has widened to swallow a real goal-derived pace" >&2
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
    | grep -E "$PATTERN" | grep -vcE "$EXCLUDE")
  [ "$hits" -gt 0 ] && echo "$rel $hits" >> "$HITS_FILE"
done < <(find "${TREES[@]}" \( -name '*.ts' -o -name '*.tsx' \) ! -name '._*' ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.audit.test.ts')

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
