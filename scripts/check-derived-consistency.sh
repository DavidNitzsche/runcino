#!/usr/bin/env bash
#
# check-derived-consistency · a derived value may not be read without the
# inputs stored beside it.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS
#
# `runs.data` stores derived values NEXT TO the inputs they were derived from.
# `paceSPerMi` sits beside `movingTimeS` and `distanceMi`. `avgSpeedMph` is a
# third spelling of the same quantity. `avgPaceMinPerMi` is a display string of
# a DIFFERENT clock again. Nothing forces any of them to agree, and every
# reader picks one without knowing the others exist.
#
# 2026-08-23, one canonical row, eleven miles: `durationSec` 5298 (8:01/mi)
# beside `paceSPerMi` 217 (3:37/mi). Three surfaces printed three different
# runs, and the recap congratulated the runner on 3:37/mi.
#
# The mechanism was not a bad number from a bad source. Both source rows were
# internally consistent. The merge absorber's fill-when-missing branch is
# tier-blind, so the canonical ended up holding half of the watch's arithmetic
# and half of Strava's — a member of an arithmetic family entered a row from a
# source that did not supply the rest of the family.
#
# So the thing worth failing a build over is a READER that holds two members of
# one family in one expression and reconciles neither. There were twenty-odd of
# them, no two in the same rung order.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT IT CHECKS
#
#   1. Every family in lib/runs/derived-registry.ts parses, with its members.
#   2. Every source expression holding 2+ members of one GUARDED family either
#      sits in a file that imports lib/runs/coherence, or is allowlisted with a
#      reason.
#   3. The allowlist has no stale entries — an allowlisted file that no longer
#      holds such an expression is a finding, so a migration forces its removal.
#   4. POSITIVE AND NEGATIVE CONTROLS: a synthetic file carrying a raw ladder
#      must be detected, and the same ladder routed through the reconciler must
#      not be. Either control failing exits 1 before any finding is reported.
#
# ─────────────────────────────────────────────────────────────────────────────
# THE FORMAT CONTRACT
#
# Each registry entry keeps `id:`, `members:` and `guard:` on ONE line each.
# That is what lets this script read the registry with no TypeScript toolchain,
# on a cold container, exactly as check-doctrine.sh reads its claims. Break the
# contract and the extractor floor below fails the build rather than quietly
# reading fewer families.
#
# ─────────────────────────────────────────────────────────────────────────────
# THE FOUR TRAPS THIS SCRIPT IS WRITTEN AROUND
#
#   · A gate that extracts zero items and reports "all present". Every
#     extractor here has a floor, and zero is never a pass.
#   · Multi-line SQL defeats a single-line grep. Half these ladders are
#     COALESCEs inside multi-line template literals, so the matcher runs over a
#     sliding window of consecutive lines rather than one line at a time.
#   · `set -o pipefail` plus an early-exiting consumer (`| head`) turns a
#     successful grep into a failure, and only once the input is large enough
#     to fill the pipe buffer. No pipeline here ends in a truncating consumer.
#   · `grep -E "(^|[^A-Za-z0-9_])key"` false-negatives under the grep shim in
#     some interactive shells. Word boundaries here are done inside awk with an
#     explicit two-sided character class, never a leading alternation group.
#
# And the fifth, which is about findings rather than mechanics: the first
# version of this scanner asked "does this FILE mention two members of one
# family?" and reported 291 sites, most of them noise — `distanceMi` is in
# nearly every family and nearly every file. Proximity is the signal. Reporting
# the other 250 would have been the same mistake as the multi-line-SQL false
# finding this project has already filed once.
#
# Sibling of check-palette-sync.sh, check-doctrine.sh and check-wire-keys.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web-v2"
REGISTRY="$WEB/lib/runs/derived-registry.ts"
COHERENCE="$WEB/lib/runs/coherence.ts"

# ── FLOORS ──────────────────────────────────────────────────────────────────
# Below today's numbers so ordinary growth does not trip them, far enough above
# zero that a broken extractor cannot pass.
MIN_FAMILIES=6
MIN_MEMBERS=12
MIN_FILES_SCANNED=300
MIN_CANDIDATE_SITES=8

# How many consecutive lines count as "one expression".
WINDOW=4

fail=0
note() { printf '  %s\n' "$1"; }
bad()  { printf '  %s\n' "$1" >&2; fail=1; }

echo "check-derived-consistency · every reader of a derived value against its inputs"

for f in "$REGISTRY" "$COHERENCE"; do
  if [ ! -f "$f" ]; then
    printf '  MISSING: %s\n' "$f" >&2
    printf '  This gate cannot check anything without it. Failing, not passing.\n' >&2
    exit 1
  fi
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ═════════════════════════════════════════════════════════════════════════════
# 1 · READ THE REGISTRY
# ═════════════════════════════════════════════════════════════════════════════
extract_families() {
  awk '
    # QUOTED value only. `id: string;` in the DerivedFamily interface above the
    # registry matches an unquoted pattern and injected a phantom family on the
    # first run of this script — a family with no members, counted as guarded.
    /^[[:space:]]*id:[[:space:]]*['"'"'"]/ {
      line = $0
      sub(/^[[:space:]]*id:[[:space:]]*/, "", line)
      gsub(/['"'"'",]/, "", line); gsub(/[[:space:]]/, "", line)
      id = line; next
    }
    /^[[:space:]]*members:[[:space:]]*\[/ {
      line = $0
      sub(/^[[:space:]]*members:[[:space:]]*\[/, "", line)
      sub(/\].*$/, "", line)
      gsub(/['"'"'"]/, "", line); gsub(/,/, " ", line)
      gsub(/[[:space:]]+/, " ", line)
      sub(/^ /, "", line); sub(/ $/, "", line)
      if (id != "" && line != "") print id "\t" line
      id = ""
    }
  ' "$1"
}

extract_guarded() {
  awk '
    # QUOTED value only. `id: string;` in the DerivedFamily interface above the
    # registry matches an unquoted pattern and injected a phantom family on the
    # first run of this script — a family with no members, counted as guarded.
    /^[[:space:]]*id:[[:space:]]*['"'"'"]/ {
      line = $0; sub(/^[[:space:]]*id:[[:space:]]*/, "", line)
      gsub(/['"'"'",]/, "", line); gsub(/[[:space:]]/, "", line); id = line; next
    }
    /^[[:space:]]*guard:[[:space:]]*['"'"'"]/ {
      line = $0; sub(/^[[:space:]]*guard:[[:space:]]*/, "", line)
      gsub(/['"'"'",]/, "", line); gsub(/[[:space:]]/, "", line)
      if (id != "" && line != "none") print id
      id = ""
    }
  ' "$1"
}

FAMPATH="$WORK/families.tsv"
GUARDPATH="$WORK/guarded.txt"
extract_families "$REGISTRY" > "$FAMPATH"
extract_guarded  "$REGISTRY" > "$GUARDPATH"

fam_count="$(grep -c . "$FAMPATH" || true)"
member_count="$(cut -f2 "$FAMPATH" | tr ' ' '\n' | grep -c . || true)"
guarded_count="$(grep -c . "$GUARDPATH" || true)"

if [ "$fam_count" -lt "$MIN_FAMILIES" ] || [ "$member_count" -lt "$MIN_MEMBERS" ]; then
  printf '  REGISTRY EXTRACTOR FOUND TOO LITTLE — %s families, %s members.\n' \
    "$fam_count" "$member_count" >&2
  printf '  Floors are %s / %s. This is a broken extractor, not a clean bill of\n' \
    "$MIN_FAMILIES" "$MIN_MEMBERS" >&2
  printf '  health: a pass here would be a green light over an unwatched road.\n' >&2
  printf "  Check that every entry keeps 'id:', 'members:' and 'guard:' on one\n" >&2
  printf '  line each.\n' >&2
  exit 1
fi
note "registry OK · $fam_count families ($guarded_count guarded), $member_count member slots"

# ═════════════════════════════════════════════════════════════════════════════
# 2 · THE SCANNER
#
# Emits "family<TAB>file<TAB>n_members" once per family per file, for any
# window of WINDOW consecutive lines naming 2+ members of that family.
# ═════════════════════════════════════════════════════════════════════════════
# Files that DEFINE the contract rather than consume it, plus tests.
EXEMPT_BY_NATURE='lib/runs/coherence\.ts|lib/runs/derived-registry\.ts|lib/runs/run-shape\.ts|lib/doctrine/registry\.ts|\.test\.tsx?$|\.audit\.test\.ts$'

files_scanned=0

scan_tree() {
  local base="$1" out="$2" file
  : > "$out"
  while IFS= read -r -d '' file; do
    case "$file" in *node_modules*|*/.next/*) continue ;; esac
    if printf '%s' "$file" | grep -qE -- "$EXEMPT_BY_NATURE"; then continue; fi
    files_scanned=$((files_scanned + 1))
    awk -v FAMFILE="$FAMPATH" -v FILE="$file" -v W="$WINDOW" '
      BEGIN {
        nf = 0
        while ((getline fl < FAMFILE) > 0) {
          split(fl, a, "\t")
          if (a[1] == "" || a[2] == "") continue
          nf++
          fid[nf] = a[1]
          nm[nf] = split(a[2], mm, " ")
          for (j = 1; j <= nm[nf]; j++) mem[nf, j] = mm[j]
        }
        close(FAMFILE)
      }
      {
        for (i = W; i > 1; i--) buf[i] = buf[i-1]
        buf[1] = $0
        # Pad both ends so a member at the very start or end of the window is
        # still flanked by a non-identifier character.
        win = " "
        for (i = 1; i <= W; i++) win = win buf[i] " "
        for (f = 1; f <= nf; f++) {
          if (seen[f]) continue
          hits = 0
          for (j = 1; j <= nm[f]; j++) {
            if (match(win, "[^A-Za-z0-9_]" mem[f, j] "[^A-Za-z0-9_]")) hits++
          }
          if (hits >= 2) { seen[f] = 1; print fid[f] "\t" FILE "\t" hits }
        }
      }
    ' "$file" >> "$out" 2>/dev/null || true
  done < <(find "$base" \( -name '*.ts' -o -name '*.tsx' \) \
             -not -path '*/node_modules/*' -not -path '*/.next/*' -print0 2>/dev/null)
}

HITS="$WORK/hits.tsv"
: > "$HITS"
for d in app lib components; do
  [ -d "$WEB/$d" ] || continue
  scan_tree "$WEB/$d" "$WORK/part.tsv"
  cat "$WORK/part.tsv" >> "$HITS"
done

hit_count="$(grep -c . "$HITS" || true)"

# The distinct FILES that hold a family expression, materialised once.
#
# Precomputed deliberately. The staleness check below used to ask
# `cut -f2 "$HITS" | grep -qxF -- "$path"`, and under `set -o pipefail` that
# reports FAILURE on a match: `grep -q` exits the moment it finds the line,
# `cut` takes SIGPIPE writing to the closed pipe, and pipefail hands back
# cut's status rather than grep's. It only misfires once the input is long
# enough that grep can win the race, so it flagged 11 of 34 live allowlist
# entries as stale and left the rest alone — the exact shape of the trap, and
# the reason the rule is "no pipeline ends in a truncating consumer".
HITFILES="$WORK/hitfiles.txt"
cut -f2 "$HITS" | sort -u > "$HITFILES"

if [ "$files_scanned" -lt "$MIN_FILES_SCANNED" ]; then
  printf '  SCANNER OPENED ONLY %s FILES (floor %s).\n' "$files_scanned" "$MIN_FILES_SCANNED" >&2
  printf '  A scanner that opens no files and reports clean is the same bug one\n' >&2
  printf '  level up. Check the find roots under %s\n' "$WEB" >&2
  exit 1
fi
if [ "$hit_count" -lt "$MIN_CANDIDATE_SITES" ]; then
  printf '  SCANNER FOUND ONLY %s candidate sites (floor %s).\n' "$hit_count" "$MIN_CANDIDATE_SITES" >&2
  printf '  These families are read all over this codebase; finding almost none\n' >&2
  printf '  means the member matcher is broken, not that the codebase got clean.\n' >&2
  exit 1
fi
note "scanner OK · $files_scanned files opened, $hit_count family/file sites found"

# ═════════════════════════════════════════════════════════════════════════════
# 3 · CONTROLS
#
# Before trusting a single finding, prove the scanner can produce one AND can
# withhold one. The ARTEFACT is inspected, never an exit code.
# ═════════════════════════════════════════════════════════════════════════════
CTL="$WORK/control/lib"
mkdir -p "$CTL"
cat > "$CTL/synthetic-ladder.ts" <<'CTLEOF'
// Positive control. Not shipped, not imported. The exact shape the gate exists
// to catch: members of one arithmetic family coalesced by hand, nothing
// reconciling them.
export function durationOf(d: Record<string, number>): number {
  return Number(d.movingTimeS) || Number(d.movingSec) || Number(d.elapsedTimeS) || 0;
}
CTLEOF
cat > "$CTL/synthetic-sql-ladder.ts" <<'CTLEOF'
// Positive control, multi-line form. A single-line matcher walks past this one,
// which is how a false finding got filed here once.
export const SQL = `
  SELECT COALESCE(
           NULLIF(data->>'movingTimeS','')::numeric,
           NULLIF(data->>'durationSec','')::numeric
         ) AS secs
    FROM runs`;
CTLEOF

saved="$files_scanned"; files_scanned=0
scan_tree "$WORK/control" "$WORK/ctl1.tsv"
ctl_inline="$(grep -c 'synthetic-ladder' "$WORK/ctl1.tsv" || true)"
ctl_sql="$(grep -c 'synthetic-sql-ladder' "$WORK/ctl1.tsv" || true)"

if [ "$ctl_inline" -lt 1 ]; then
  printf '  POSITIVE CONTROL FAILED — the scanner did not flag a file that is\n' >&2
  printf '  nothing but a raw one-line clock ladder. Every "clean" result is\n' >&2
  printf '  therefore meaningless. Fix the matcher before trusting this gate.\n' >&2
  exit 1
fi
if [ "$ctl_sql" -lt 1 ]; then
  printf '  MULTI-LINE CONTROL FAILED — the scanner flagged the one-line ladder\n' >&2
  printf '  but walked past the identical COALESCE spread over four lines. That\n' >&2
  printf '  is the exact blind spot that produced a false finding here before.\n' >&2
  exit 1
fi

# Negative half · the same ladder, reconciled, must be recognised as migrated.
rm -f "$CTL"/synthetic-ladder.ts "$CTL"/synthetic-sql-ladder.ts
cat > "$CTL/synthetic-guarded.ts" <<'CTLEOF'
// Negative control. It must still NAME the family — a file that mentions no
// member is not a family site at all, and clearing it would prove nothing. The
// first draft of this control imported the reconciler and named no key, so it
// was never a hit, and the check failed for the wrong reason.
import { coherentMovingSec } from '@/lib/runs/coherence';
interface Row { movingTimeS?: number; durationSec?: number; elapsedTimeS?: number }
export function durationOf(d: Row): number | null {
  return coherentMovingSec(d);
}
CTLEOF
files_scanned=0
scan_tree "$WORK/control" "$WORK/ctl2.tsv"
ctl_guarded_hits="$(grep -c 'synthetic-guarded' "$WORK/ctl2.tsv" || true)"
if [ "$ctl_guarded_hits" -lt 1 ]; then
  printf '  NEGATIVE CONTROL FAILED — a file naming three members of the clock\n' >&2
  printf '  family was not recognised as a family site, so the scanner cannot\n' >&2
  printf '  see the thing it is meant to judge.\n' >&2
  exit 1
fi
# Now run the judge's own clearing rule over it. This is the half that matters:
# a migrated reader must survive the judge, or every migration below is
# pointless work.
if ! grep -q 'lib/runs/coherence' "$CTL/synthetic-guarded.ts"; then
  printf '  NEGATIVE CONTROL FAILED — the judge would not clear a reader that\n' >&2
  printf '  routes through the reconciler, so migrating a file could not fix it.\n' >&2
  exit 1
fi
files_scanned="$saved"
note "controls OK · inline ladder flagged, multi-line SQL ladder flagged, reconciled reader cleared"

# ═════════════════════════════════════════════════════════════════════════════
# 4 · THE ALLOWLIST
#
# A path here holds a guarded family's arithmetic without reconciling it, ON
# PURPOSE, and says why. Checked for staleness in step 5: migrate the reader and
# the gate makes you delete the line.
#
# Format: <path relative to web-v2> :: <reason>
# ═════════════════════════════════════════════════════════════════════════════
ALLOW="$WORK/allow.txt"
cat > "$ALLOW" <<'ALLOWEOF'
app/api/admin/audit-weather/route.ts :: An admin diagnostic. It exists to show raw stored values, so reconciling them would hide what it is for.
app/api/admin/backfill-splits/route.ts :: An admin backfill that WRITES the splits array.
app/api/ingest/workout/route.ts :: A WRITER, same reason.
app/api/run/manual/route.ts :: A WRITER, same reason.
app/api/strava/webhook/route.ts :: A WRITER. It records what Strava sent, verbatim. Reconciling at write would rewrite what a source actually said, which is the one thing this design refuses to do.
app/api/targets/projection/route.ts :: Projection over already-summed weekly aggregates; names the pace keys in its goal arithmetic, not in a per-run read.
app/api/watch/workouts/complete/route.ts :: A WRITER, same reason. It is also the row that shows why the read guard is needed: it writes durationSec and avgPaceMinPerMi and no other clock-family member, which is the gap the absorber used to fill from Strava.
app/dev/route-map-mockups/route.ts :: A developer mockup page, not a runner-facing surface.
components/faff-app/seed.ts :: Carries the calories/kcal COALESCE documented in the registry's energy entry. A display-path read queued with that fix, which changes an axis label as well as a column.
components/faff-app/toolkit/DayDetail.tsx :: Renders a day from facts the API reconciles upstream; the key names appear in its prop types.
components/faff-app/types.ts :: Type declarations. It names the keys without reading any of them.
components/faff-app/views/RaceView.tsx :: Prop types only, over race data.
components/races/RaceRetrospective.tsx :: Renders the race retrospective from server-computed facts; queued with the race-side findings.
components/redesign/log/LogSheetClient.tsx :: Renders the log from facts lib/coach/log-state.ts now reconciles upstream; the key names appear in its prop types.
lib/conservation/laws.ts :: THE HARNESS'S OWN LAWS. It names the members of a family in order to CHECK that they agree — that is the whole function of the file. A conservation law that could not read two members at once could not detect the disagreement it exists to detect.
lib/conservation/shapes.ts :: THE HARNESS'S OWN FIXTURES, and the one file in the repo where an incoherent row is the POINT. It deliberately builds rows whose members contradict each other — the 2026-08-23 merge verbatim among them — so the laws and their positive controls have something real to fail on. Reconciling these would delete the test data.
lib/postrun-siege/shapes.ts :: THE POST-RUN SIEGE'S OWN FIXTURES, and the second file where an incoherent row is the POINT. Forty-odd hostile shapes a real watch, merge or Strava sync can produce - moving time exceeding elapsed, a stored pace its own clock disproves, zone shares summing to 99 and to 140, splits totalling twice the run - driven through reconcileRun, deriveRecap and deriveWin so the invariants and their planted-fabrication controls have something real to fail on. Reconciling these would delete the attack.
lib/conservation/surfaces.ts :: Drives the real composers with those fixtures and reads the numbers back off all four surfaces to compare them. It holds two members of a family at once because comparing them across surfaces is exactly the assertion.
lib/runs/splits-pick.ts :: THE SPLIT-ARRAY PICKER, and it holds the family in order to JUDGE it. Its whole function is to compare each candidate array's coverage against the run's own distance and choose the one that decomposes it — a reader that could not hold both at once could not detect the mismatch it exists to detect. Same standing as lib/runs/coherence.ts, which is a reader module for the same reason.
lib/watch/heat.ts :: A PRESCRIPTION, NOT AN OBSERVATION. Its distanceMi/durationSec/pace are the numbers the watch is ASKED to run, eased for heat off the shared Research/06 model — there is no logged row behind them, so there is nothing to reconcile them against. The coherence readers answer "which of this run's contradictory figures is true"; a workout not yet run has no contradictory figures. It must NOT be routed through them: reconciling a target against a clock that does not exist would either refuse a valid prescription or invent a measurement.
lib/adaptation/load.ts :: Sums training load over canonical rows. An aggregate, never a per-run figure.
lib/coach/calibration.ts :: Reads timeMoving for a calibration trend. Comparative; same batch.
lib/coach/easy-discipline.ts :: Reads the clock for an easy-day effort distribution. Comparative; same batch.
lib/runs/twins.ts :: A READER MODULE, in the same sense as lib/runs/coherence.ts. It holds the run's distance beside the twins' split arrays precisely in order to RECONCILE them — that is the call to pickSplits, and it is the fix for run detail drawing three miles of a four-mile run. A reconciler has to name the members of the family it reconciles, and a lint that flagged its own vocabulary could not describe what it checks. If this file ever starts CHOOSING a clock or computing a pace, that is a real finding and this entry is where the argument lives.
lib/coach/pacing-discipline.ts :: Parses avgPaceMinPerMi in SQL for a pacing-discipline TREND. Comparative within one query, so a consistent elapsed basis does not skew it. Already on the run-shape lint allowlist for the same batch.
lib/coach/recovery-brief.ts :: SQL-side moving-time SUM over a recovery window. Comparative within one query and never printed as a per-run figure; queued behind the surfaces that print numbers.
lib/coach/recovery-phase.ts :: SQL-side moving-time sum, same shape and same queue.
lib/coach/state-loader.ts :: Assembles the coach's own fact sheet from an already-shaped row. Migrating it moves the pace basis for every coach surface at once and wants its own change with its own review.
lib/coach/training-state.ts :: SQL-side aggregate over a training window, same shape and same queue.
lib/courses/promote-from-race.ts :: Names the clock keys in a comment describing the ladder it defers to; carries no ladder of its own.
lib/execution/reconstruct.ts :: Already reads through run-shape's accessors. Listed because it names family members while doing so.
lib/faff/v5-today.ts :: A RENDERER. Its durationSec / paceSPerMi are fields on its own RunRow type, populated by app/api/v5/today/route.ts which reconciles them before handing them over. Formatting two already-agreed numbers is not a ladder.
lib/plan/drift-monitor.ts :: SQL-side duration COALESCE feeding a drift trend. Comparative, not printed per run; same batch.
lib/race/distance-doctrine.ts :: Same, race-side. Holds the certified-distance constants.
lib/race/execution-plan.ts :: Same, race-side.
lib/race/pacing.ts :: Race pacing over races.meta and course geometry, not runs.data. Queued with the race-side findings.
lib/race/race-detail-pacing.ts :: Same, race-side.
lib/race/representativeness-inputs.ts :: Same, race-side.
lib/race/retrospective.ts :: Reads races.actual_result, not runs.data. The family names appear in its matched-run fallback and it is queued with the race-side findings.
lib/runs/elev-sanity.ts :: Ingest-side elevation plausibility. Names the clock to compute a rate; upstream of the read guard and writes no pace.
lib/runs/identity.ts :: Clusters rows by physical-run identity BEFORE any merge, so it must compare the raw stored clocks of two candidate rows exactly as each source wrote them. Reconciling first would make two rows that disagree look identical and defeat the clustering.
lib/runs/length-guard.ts :: Ingest-side plausibility classification over raw stored keys, upstream of the read guard.
lib/runs/log-enrich.ts :: Ingest-side enrichment and the log badge rules, over raw stored keys. The pace it is handed comes reconciled from lib/coach/log-state.ts.
lib/runs/split-coverage.ts :: Measures how much of a run the splits cover at ingest. It computes one side of splits.total-vs-distance rather than consuming it.
lib/strava/build-tcx.ts :: A WRITER, outbound. It must emit what the row stores.
lib/strava/pullSync.ts :: A WRITER, same reason.
lib/strava/push.ts :: A WRITER, outbound. It must emit what the row stores, and its normalizeSplits works at SPLIT level where the same key names mean per-mile values rather than run-level ones.
lib/terrain/grade-adjust.ts :: The grade-adjusted-pace model. Handed an already-resolved pace and duration by run-terrain.ts and converts between them; it reads no stored key of its own.
lib/terrain/run-terrain.ts :: Resolves terrain cost. It is HANDED distanceMi / durationSec / paceSPerMi by its callers, and every caller that feeds it (the recap route, run-state.ts) now reconciles them first; its own parameter names are what the scanner sees.
lib/training/aerobic-decoupling.ts :: Walks the SPLIT series. paceSPerMi on a split element is a per-mile value, a different quantity from the run-level key of the same name, and lib/runs/split-sanity.ts is its guard.
lib/training/cadence-fatigue.ts :: Same split-level scope, same guard.
lib/training/expand-spec.ts :: Expands plan_workouts.workout_spec into phases. Plan-side, not runs.data - the key names collide, the tables do not.
lib/training/goal-projection.ts :: Reads split-level paces and watch-PHASE durations, not the run-level family. Its one run-level read is a single key in SQL, which cannot contradict a sibling it does not fetch.
lib/training/spec-card.ts :: Composes the Today card from plan_workouts.workout_spec. Plan-side, the same collision as expand-spec.ts and build-workout.ts: its distanceMi / durationSec / targetPaceSPerMi are a PRESCRIPTION's figures, carried on ExpandedPhase, and there is no stored row for them to contradict. It is the phone-side sibling of lib/watch/build-workout.ts and reads runs.data never.
lib/training/vdot.ts :: The Daniels table and its conversions. Pure arithmetic over arguments; it reads no stored row.
lib/watch/build-workout.ts :: Builds the watch payload from the plan. Plan-side, same collision as expand-spec.ts.
lib/weather/openmeteo.ts :: Uses the clock only to size the weather lookup window. A wrong clock moves the window by minutes and cannot put a false number on a screen.
ALLOWEOF

allow_count="$(grep -c '::' "$ALLOW" || true)"
note "allowlist · $allow_count entr(ies)"

# ═════════════════════════════════════════════════════════════════════════════
# 5 · JUDGE
# ═════════════════════════════════════════════════════════════════════════════
ALLOWPATHS="$WORK/allowpaths.txt"
sed 's/ ::.*$//' "$ALLOW" | sed '/^$/d' > "$ALLOWPATHS"

UNGUARDED="$WORK/unguarded.txt"
: > "$UNGUARDED"
checked=0
while IFS=$'\t' read -r fam file n; do
  [ -z "${fam:-}" ] && continue
  grep -qx -- "$fam" "$GUARDPATH" || continue
  rel="${file#"$WEB"/}"
  checked=$((checked + 1))
  grep -q 'lib/runs/coherence' "$file" 2>/dev/null && continue
  grep -qxF -- "$rel" "$ALLOWPATHS" && continue
  printf '%s  [%s]\n' "$rel" "$fam" >> "$UNGUARDED"
done < "$HITS"

if [ "$checked" -lt "$MIN_CANDIDATE_SITES" ]; then
  printf '  ONLY %s guarded-family sites were judged (floor %s).\n' "$checked" "$MIN_CANDIDATE_SITES" >&2
  printf "  The guarded-family filter matched almost nothing — check that the\n" >&2
  printf "  ids in the registry's 'guard:' lines still line up with its 'id:'\n" >&2
  printf '  lines.\n' >&2
  exit 1
fi

if [ -s "$UNGUARDED" ]; then
  echo "" >&2
  bad "These expressions hold two or more members of one arithmetic family and"
  bad "reconcile none of them:"
  sort -u "$UNGUARDED" | sed 's/^/    · /' >&2
  echo "" >&2
  bad "Each is a place one row can answer one question two ways. Route the read"
  bad "through lib/runs/coherence (coherentPace / coherentMovingSec /"
  bad "coherentElapsedSec / coherentDurationSec), or add the path to the"
  bad "allowlist in this script with an honest reason."
fi

# ── 5b · stale allowlist entries ────────────────────────────────────────────
STALE="$WORK/stale.txt"
: > "$STALE"
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  if [ ! -f "$WEB/$rel" ]; then
    printf '%s  (file no longer exists)\n' "$rel" >> "$STALE"
    continue
  fi
  if ! grep -qxF -- "$WEB/$rel" "$HITFILES"; then
    printf '%s  (no longer holds any registered family expression)\n' "$rel" >> "$STALE"
  fi
done < "$ALLOWPATHS"

if [ -s "$STALE" ]; then
  echo "" >&2
  bad "STALE ALLOWLIST ENTRIES — these no longer describe the codebase:"
  sed 's/^/    · /' "$STALE" >&2
  echo "" >&2
  bad "Delete them. An allowlist that outlives its reasons stops being read."
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "check-derived-consistency OK"
echo "  $fam_count families · $guarded_count guarded · $files_scanned files scanned"
echo "  $checked guarded-family read sites, every one reconciled or allowlisted"
echo ""
echo "  NOTE: this gate is a NET, not a proof. It asserts that an expression"
echo "  holding two members of one family sits in a file that imports the"
echo "  reconciler — not that it uses it on the right value. The arithmetic"
echo "  itself is proved in lib/runs/_coherence_gate.test.ts, whose controls are"
echo "  real production row shapes and which fails if any guard stops firing."
