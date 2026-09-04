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
  done < <(find "$base" \( -name '*.ts' ! -name '._*' -o -name '*.tsx' \) \
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
app/api/admin/audit-races/route.ts :: An admin diagnostic, same standing as audit-weather below. It exists to surface DRIFT — it prints a curated chip time beside the raw movingTimeS/distanceMi of the run it was populated from, and flags the gap. Routing those reads through lib/runs/coherence would return one reconciled figure, which is the one thing that would stop the route detecting the disagreement it was written to detect. Same argument as lib/runs/splits-pick.ts and lib/conservation/laws.ts: a reader that cannot hold two members of a family at once cannot report that they differ.
app/api/admin/audit-weather/route.ts :: An admin diagnostic. It exists to show raw stored values, so reconciling them would hide what it is for.
app/api/admin/backfill-splits/route.ts :: An admin backfill that WRITES the splits array.
app/api/ingest/workout/route.ts :: A WRITER, same reason.
app/api/run/manual/route.ts :: A WRITER, same reason.
app/api/strava/webhook/route.ts :: A WRITER. It records what Strava sent, verbatim. Reconciling at write would rewrite what a source actually said, which is the one thing this design refuses to do.
app/api/targets/projection/route.ts :: Projection over already-summed weekly aggregates; names the pace keys in its goal arithmetic, not in a per-run read.
app/api/watch/workouts/complete/route.ts :: A WRITER, same reason. It is also the row that shows why the read guard is needed: it writes durationSec and avgPaceMinPerMi and no other clock-family member, which is the gap the absorber used to fill from Strava.
app/dev/route-map-mockups/route.ts :: A developer mockup page, not a runner-facing surface.
components/faff-app/toolkit/DayDetail.tsx :: Renders a day from facts the API reconciles upstream; the key names appear in its prop types.
components/faff-app/types.ts :: Type declarations. It names the keys without reading any of them.
components/faff-app/views/RaceView.tsx :: Prop types only, over race data.
components/races/RaceRetrospective.tsx :: RACESIDE-1 (2026-08-30) · the "queued with the race-side findings" deferral this entry used to carry never named a specific pending change, and audit found none pending — see lib/race/retrospective.ts below for what actually resolves the cluster. This file renders `RaceRetro`, a fully server-composed object built by lib/race/retrospective.ts (finish/miles/phases/projections already resolved, provenance already labeled); the key names appear only in its prop types and chart geometry. Same standing as components/faff-app/toolkit/DayDetail.tsx.
components/redesign/log/LogSheetClient.tsx :: Renders the log from facts lib/coach/log-state.ts now reconciles upstream; the key names appear in its prop types.
lib/conservation/laws.ts :: THE HARNESS'S OWN LAWS. It names the members of a family in order to CHECK that they agree — that is the whole function of the file. A conservation law that could not read two members at once could not detect the disagreement it exists to detect.
lib/conservation/shapes.ts :: THE HARNESS'S OWN FIXTURES, and the one file in the repo where an incoherent row is the POINT. It deliberately builds rows whose members contradict each other — the 2026-08-23 merge verbatim among them — so the laws and their positive controls have something real to fail on. Reconciling these would delete the test data.
lib/postrun-siege/shapes.ts :: THE POST-RUN SIEGE'S OWN FIXTURES, and the second file where an incoherent row is the POINT. Forty-odd hostile shapes a real watch, merge or Strava sync can produce - moving time exceeding elapsed, a stored pace its own clock disproves, zone shares summing to 99 and to 140, splits totalling twice the run - driven through reconcileRun, deriveRecap and deriveWin so the invariants and their planted-fabrication controls have something real to fail on. Reconciling these would delete the attack.
lib/conservation/surfaces.ts :: Drives the real composers with those fixtures and reads the numbers back off all four surfaces to compare them. It holds two members of a family at once because comparing them across surfaces is exactly the assertion.
lib/postrun/experience.ts :: POSTRUN-COVERAGE-1 (2026-09-02) · `readCapture` holds the run's total beside the phase sum and the split coverage precisely in order to RECONCILE them, and reports the difference as overtime. Same standing as lib/runs/splits-pick.ts and lib/conservation/laws.ts below: a reader that cannot hold two members of a family at once cannot report that they differ, and reporting that they differ is this function's entire purpose. The 2026-09-02 run is why it exists — 6.41 mi total, 5.98 mi of phases, 5.00 mi of splits, all three correct, and a screen that showed the third alone. It computes NO pace from a clock and presents NO stored pace: the only pace it names is `GradedPhase.avgSecPerMi`, already resolved by run-shape.ts. If this file ever starts DIVIDING a distance by a duration, that is a real finding and this entry is where the argument lives.
lib/postrun/load.ts :: POSTRUN-COVERAGE-1 (2026-09-02) · the loader for the above. It reads `distanceMi`, the phase array and `splits` off three different places on one row BECAUSE they are three different quantities that `readCapture` then reconciles — naming them is what the reconciliation requires. It derives nothing from them: the sums are passed through verbatim and no pace, moving time or cadence is computed here. Same standing as lib/runs/twins.ts below, which holds a run's distance beside its twins' split arrays for the same reason.
lib/postrun/analysis.ts :: POSTRUN-CHARTS-1 (2026-09-03) · the chart stack's composer. It holds the run's total beside the per-split distances for ONE purpose, and it is a reconciliation: a split array that does not state its rows' lengths ends in a fragment, and the run's own total is the only thing that can size it — a 2.4 mile run reporting three unsized rows ends in a 0.4 mile piece, and placing that as a whole mile pushes the axis to three. Same standing as lib/runs/splits-pick.ts. It computes NO pace from a clock and never divides a distance by a duration: every pace on the series is `paceSPerMi` as the wrist recorded it, and a sample without one is a GAP rather than a subtraction. That is stated in the module header as the rule and it is what makes this entry safe. If this file ever starts dividing a distance by a duration, that is a real finding and this entry is where the argument lives.
lib/postrun/matched.ts :: POSTRUN-MATCH-1 (2026-09-03) · PR-15's comparator. The family members are FIELD NAMES on `MatchSegment` — pace, distance, duration, heart rate for one already-graded phase — carried so the ranking can ask about structure. The two figures that ARE a mean over those fields, the work-segment pace and heart rate, are NOT computed here: they arrive on `WorkReading` from `WorkoutVerdict.work`, which is the app's owner for that quantity, precisely so this file cannot become a second answer to it. That routing was made in response to this gate. What arithmetic remains computes quantities NOTHING else owns and which no clock can disprove — the spread across the reps, the first-rep-to-last drift, the median recovery pace. Same standing as components/faff-app/types.ts: it names the keys, and the one place it would have derived one it now asks the owner instead.
lib/postrun/detail-load.ts :: POSTRUN-MATCH-1 (2026-09-03) · the loader for the above. It maps `GradedPhase` onto `MatchSegment` field for field and hands `WorkoutVerdict.work` through untouched; the family members appear only in that mapping. It derives nothing: no pace, no moving time, no cadence is computed in this file, and the one SQL statement that touches these keys builds a jsonb object of them for transport. Same standing as lib/postrun/load.ts above.
lib/postrun/wire.ts :: POSTRUN-COVERAGE-1 (2026-09-02) · the phone mapper for the above. It carries the reconciled coverage numbers and formats already-resolved per-stride figures for display; the family members appear as field names on a payload, never as arithmetic. Raw cadence was REMOVED from this file rather than exempted, on the post-run brief's own HIDE-BY-DEFAULT list. Same standing as components/faff-app/types.ts above — it names the keys without reading any of them.
lib/runs/splits-pick.ts :: THE SPLIT-ARRAY PICKER, and it holds the family in order to JUDGE it. Its whole function is to compare each candidate array's coverage against the run's own distance and choose the one that decomposes it — a reader that could not hold both at once could not detect the mismatch it exists to detect. Same standing as lib/runs/coherence.ts, which is a reader module for the same reason.
lib/watch/heat.ts :: A PRESCRIPTION, NOT AN OBSERVATION. Its distanceMi/durationSec/pace are the numbers the watch is ASKED to run, eased for heat off the shared Research/06 model — there is no logged row behind them, so there is nothing to reconcile them against. The coherence readers answer "which of this run's contradictory figures is true"; a workout not yet run has no contradictory figures. It must NOT be routed through them: reconciling a target against a clock that does not exist would either refuse a valid prescription or invent a measurement.
lib/adaptation/load.ts :: Sums training load over canonical rows. An aggregate, never a per-run figure.
lib/coach/calibration.ts :: Reads timeMoving for a calibration trend. Comparative; same batch.
lib/coach/easy-discipline.ts :: Reads the clock for an easy-day effort distribution. Comparative; same batch.
lib/runs/twins.ts :: A READER MODULE, in the same sense as lib/runs/coherence.ts. It holds the run's distance beside the twins' split arrays precisely in order to RECONCILE them — that is the call to pickSplits, and it is the fix for run detail drawing three miles of a four-mile run. A reconciler has to name the members of the family it reconciles, and a lint that flagged its own vocabulary could not describe what it checks. If this file ever starts CHOOSING a clock or computing a pace, that is a real finding and this entry is where the argument lives.
lib/coach/pacing-discipline.ts :: Parses avgPaceMinPerMi in SQL for a pacing-discipline TREND. Comparative within one query, so a consistent elapsed basis does not skew it. Already on the run-shape lint allowlist for the same batch.
lib/coach/recovery-brief.ts :: RECOVBRIEF-1 (2026-08-30) · the "queued behind the surfaces that print numbers" deferral this entry used to carry named no specific surface and none was ever identified — the real reason it triggers is `loadTodayRunTiming`'s moving-time COALESCE, now routed through the shared `runMovingSecSql` (lib/runs/run-shape.ts) rather than a hand-rolled copy of it, so it can no longer drift from the canonical ladder. It stays on this list because that value is never displayed: it anchors `end_unix_s`, an internal timestamp the fueling-window and HRV-rebound-ETA math is measured FROM, never a moving-time or pace figure shown to the runner. Same standing as lib/weather/openmeteo.ts — a wrong clock here moves an internal window by minutes, it cannot put a false number on a screen.
lib/coach/recovery-phase.ts :: RECOVBRIEF-1 (2026-08-30) · same fix, same argument as recovery-brief.ts above: the hand-rolled moving-time COALESCE is now `runMovingSecSql`. The distinction here is starker — `anchor.movingTimeS` is set on the returned object and has no reader anywhere else in the repo today (grepped; only this file's own declaration and assignment reference it), so nothing was ever displaying it, reconciled or not.
lib/coach/state-loader.ts :: COACHPACE-1 (2026-08-29) · its two PACE reads are now routed through coherentPace and are no longer the reason it is here. The deferral this entry used to carry — "migrating it moves the pace basis for every coach surface at once" — had gone stale: `recentRuns` has no reader at all and `latest_activity` is read only for its null-ness by a topic predicate nothing builds, so there was no coach surface on the other end and the migration cost nothing. What keeps the entry is the rest of the fact sheet, which names clock-family members while shaping an already-shaped row; those are comparative or pass-through and none is printed as a per-run figure.
lib/plan/authoring-shadow-compare.ts :: AUTHORING-CANONICAL-1 (2026-09-01) - SHADOW ONLY, and it holds two members of a pace family in order to COMPARE them, which is its entire function. Both sides are PRESCRIPTIONS the engine just computed - a legacy-priced spec and a canonically-priced one for the same composed day - not two readings of one logged row, so there is nothing for the coherence readers to reconcile: no clock, no distance, no watch, no `runs` row is involved at any point. Same standing as lib/watch/heat.ts, whose entry makes the identical argument for a workout not yet run, and as lib/conservation/surfaces.ts, which likewise holds a family at once because comparing across it IS the assertion. The module has no runtime importer (MODULE_ORPHANS) and cannot persist. If it ever starts CHOOSING a pace rather than diffing two, that is a real finding and this entry is where the argument lives.
lib/courses/promote-from-race.ts :: Names the clock keys in a comment describing the ladder it defers to; carries no ladder of its own.
lib/execution/day-resolver.ts :: WORKOUT-EXECUTION-ID-1 (2026-09-03) · `richer()` picks which of two CANDIDATE RUN ROWS is the fuller description of the same physical run, the same question lib/runs/identity.ts's exemption above answers for clustering — it is never asked whether one row's own splits and distance agree with each other. It compares `data.phases.length`, then `data.splits.length`, then `distanceMi` as three successive tie-break rungs across TWO DIFFERENT rows, purely by count; no pace, duration or per-split total is read or computed anywhere in this file. A reader that could not hold `splits` and `distanceMi` at once could not run this tie-break at all, same standing as lib/runs/splits-pick.ts.
lib/execution/reconstruct.ts :: Already reads through run-shape's accessors. Listed because it names family members while doing so.
lib/faff/v5-today.ts :: DEFENSE-IN-DEPTH, not just formatting — corrected 2026-08-30, the prior reason undersold this. `shownPaceSPerMi = reconcilePaceWithClock(r.distanceMi, r.durationSec, r.paceSPerMi)` is an ACTIVE re-reconciliation via lib/runs/run-shape.ts (a second reconciler, not lib/runs/coherence, which is why the scanner cannot auto-clear it by import). Its own comment states why: the panel is "the last place the contradiction can be caught" — the 2026-08-23 incident (11.01mi, 5298s clock, a stored 217 s/mi from a Strava moving time printing as "3:37/mi") happened on a row that HAD already been reconciled upstream by app/api/v5/today/route.ts before reaching here. In the common case this is a no-op (the inputs already agree), but it is not decorative: it is the same judgment the upstream reconciler makes, repeated at the surface that actually prints the number, on the theory that an upstream reconciliation can be bypassed or stale by the time a row reaches render.
lib/plan/drift-monitor.ts :: SQL-side duration COALESCE feeding a drift trend. Comparative, not printed per run; same batch.
lib/plan/plan-snapshot.ts :: PLANSNAPSHOT-1 (2026-09-04) · two shapes, both already argued for near-identical code elsewhere in this same allowlist. (1) `treadmillGuidanceFor`'s `speedMph = 3600 / card.workPaceSPerMi` is a pace-to-speed conversion off a plan's own authored pace target — a PRESCRIPTION, no `runs` row or clock involved. Same standing as lib/watch/heat.ts and lib/race/distance-doctrine.ts below ("a workout not yet run has no contradictory figures"). (2) `matched_run`/`supplemental_runs` derive durationSec and paceSPerMi from two calls to `runFacts(data, { basis: 'elapsed' })` (lib/runs/run-facts.ts) against the same run's data with the same basis — already reconciled, the scanner just can't see through a differently-named canonical function; `runFacts` calls `reconcileRun` from lib/runs/coherence.ts internally. Same standing as lib/execution/reconstruct.ts above and lib/faff/v5-today.ts's entry. It never reads avgCadence, avgStrideLengthM or avgPaceMinPerMi at all — the cadence and display-string families it also trips share distanceMi/durationSec as members, not because this file touches cadence or a display string. If this file ever starts deriving pace/duration from runs.data directly (bypassing runFacts) or reading a MEASURED pace into the treadmill hint, that is a real finding and this entry is where the argument lives.
lib/race/distance-doctrine.ts :: RACESIDE-1 (2026-08-30) · the "queued with the race-side findings" deferral this batch used to carry named no specific pending change; audited and none was ever pending — this file's own header says why in as many words: "Pure: no DB, no Date.now(), no I/O." Every distanceMi/durationSec/paceSPerMi/splits name here is a doctrine-table CELL or a PRESCRIBED split built from a race's goalSec/distanceMi target — there is no logged run behind any of them. Same standing as lib/watch/heat.ts: a prescription, not an observation, and reconciling a target against a clock that does not exist would either refuse a valid prescription or invent a measurement.
lib/race/execution-plan.ts :: RACESIDE-1 (2026-08-30) · same argument as lib/race/distance-doctrine.ts above, which this module consumes: `computeRaceFueling` and the split-target builder are handed `goalSec`/`distanceMi` (the race's target, from races.meta) and return `RaceSplitTarget[]` — a PRESCRIPTION carried on the args and the return shape, never a read of runs.data.
lib/race/pacing.ts :: RACESIDE-1 (2026-08-30) · same argument. `buildRacePacing` distributes a `goalSec` over `distanceMi` and course-phase geometry from `races.meta`/`course_library`, producing `PacingSplit[]` — the same prescription shape as distance-doctrine.ts and execution-plan.ts, no runs.data read.
lib/race/race-detail-pacing.ts :: RACESIDE-1 (2026-08-30) · same argument, and stated by the file itself: "Pure module — no DB, no cookies." Delegates to pacing.ts and execution-plan.ts over the effective race target; distMi throughout is the race's own distance, not a run's.
lib/race/representativeness-inputs.ts :: RACESIDE-1 (2026-08-30) · different shape from its distance-doctrine.ts siblings above, so audited separately rather than left under the same blanket "same, race-side" line the batch used to carry. This file DOES read runs.data: it matches the race's date+distance against `data->>'distanceMi'` in SQL to find the one training run closest to it, and takes that row's `splits` as a fallback when `races.actual_result.miles` is empty. The match is COMPARATIVE (choosing which run corresponds to the race) and the fallback is the CLAUDE.md-required behaviour, not a display read of two disagreeing members of one run's own family — same standing as lib/runs/identity.ts, which also compares raw stored clocks across candidate rows before any reconciliation could apply.
lib/race/retrospective.ts :: RACESIDE-1 (2026-08-30) · audited on its own terms rather than the batch's old "queued with the race-side findings" line, which named no pending change and none was found. `avgPaceSPerMi` is computed fresh from `finishS / distanceMi` (the race's own resolved finish and distance), not read as a stored pace member. The one place a genuine runs.data family expression sits is `loadMatchedRunSplits`: a date+distance-matched watch run's `splits` used as a labeled fallback (`milesSource: 'watch'`) when `actual_result.miles` is empty — exactly the CLAUDE.md race-data checklist's required, disclosed-provenance behaviour, not an undisclosed clock ladder. Same standing as representativeness-inputs.ts above, which the same matched-run pattern serves.
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
lib/adaptation-harness/substrate.ts :: The adaptation harness's synthesised variation, and it is a WRITER, not a reader — the only file on this list that touches the whole family on purpose. `runFasterOn` makes one of the owner's real runs quicker in a local scratch database, and moves movingTimeS, movingSec, durationSec, elapsedSec and avgPaceSPerMi in ONE statement by the same factor precisely so no reader can meet a row that disagrees with itself. Reconciling on the way out would be reconciling the harness's own input. It cannot reach production: assertHarnessDatabase() runs at module scope and throws unless DATABASE_URL names the harness's own loopback database, and the directory is excluded from vitest.config.ts.
lib/training/goal-projection.ts :: Reads split-level paces and watch-PHASE durations, not the run-level family. Its one run-level read is a single key in SQL, which cannot contradict a sibling it does not fetch.
lib/training/spec-card.ts :: Composes the Today card from plan_workouts.workout_spec. Plan-side, the same collision as expand-spec.ts and build-workout.ts: its distanceMi / durationSec / targetPaceSPerMi are a PRESCRIPTION's figures, carried on ExpandedPhase, and there is no stored row for them to contradict. It is the phone-side sibling of lib/watch/build-workout.ts and reads runs.data never.
lib/training/vdot.ts :: The Daniels table and its conversions. Pure arithmetic over arguments; it reads no stored row.
lib/watch/build-workout.ts :: Builds the watch payload from the plan. Plan-side, same collision as expand-spec.ts.
lib/weather/openmeteo.ts :: Uses the clock only to size the weather lookup window. A wrong clock moves the window by minutes and cannot put a false number on a screen.
app/api/v5/race/[slug]/route.ts :: RACEMARK-1 (2026-09-03) · the family member here is a POSITION, not a second answer to a distance. `elevationMarks` normalises a pace-phase boundary to a fraction of the course — `boundaryMile / distanceMi` — so a mark can be placed along an elevation profile. It reconciles nothing because there is nothing to reconcile: no split total is compared against the race distance, and no pace, duration or moving time is derived from the quotient. The one number it produces is clamped to [0,1] and used only to position a label. Routing it through lib/runs/coherence would be wrong twice over — those helpers answer "which of two disagreeing readings of one run is true", and this row is a PLANNED race that has not been run, so it has no readings at all. The pace ladder that feeds it is separately guarded: `pacingDriftSec` measures the ladder's own total against the course-adjusted target and REFUSES the plan outright beyond per-phase rounding, which is the Q26 property this route exists to protect.
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
