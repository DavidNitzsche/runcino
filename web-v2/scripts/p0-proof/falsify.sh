#!/usr/bin/env bash
# scripts/p0-proof/falsify.sh · Rule 18 for the P0 race-pace brain: break each
# invariant on purpose, run its gate, record the failure, restore. Every
# mutation is a sed on a source file that `git checkout --` reverts; the script
# refuses to run on a dirty tree for the files it mutates.
#
# Usage (from web-v2/): DATABASE_URL=$DATABASE_URL_RO bash scripts/p0-proof/falsify.sh <outdir>
set -u
OUT="${1:?outdir}"; mkdir -p "$OUT"
run() { # name · file · sed-expr · test path · expected-failing-substring
  local name="$1" file="$2" expr="$3" test="$4" expect="$5"
  if ! git diff --quiet -- "$file"; then echo "DIRTY $file · refusing"; return 1; fi
  sed -i '' -E "$expr" "$file"
  if git diff --quiet -- "$file"; then echo "MUTATION DID NOT APPLY · $name"; return 1; fi
  { echo "### $name"; echo "mutation: sed -E \"$expr\" $file"; git diff --no-color -- "$file" | sed -n '1,40p'; echo; echo "--- gate output (broken) ---"; } > "$OUT/$name.log"
  npx vitest run "$test" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "×|✓|Tests |AssertionError|Error:" | head -30 >> "$OUT/$name.log"
  git checkout -- "$file"
  { echo; echo "--- gate output (restored) ---"; } >> "$OUT/$name.log"
  npx vitest run "$test" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests |Test Files" >> "$OUT/$name.log"
  if grep -q "$expect" "$OUT/$name.log" && grep -q "×" "$OUT/$name.log"; then echo "FALSIFIED · $name"; else echo "NOT FALSIFIED · $name (check $OUT/$name.log)"; fi
}
run threshold-admission-ee-no-evidence lib/training/pace-corpus.ts \
  "s/evidenceKind === 'no_evidence'/evidenceKind === 'never_matches'/" lib/training/_threshold_evidence_contract.test.ts "×"
run one-session-move-cap lib/training/pace-corpus.ts \
  "s/THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI = 5/THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI = 999/" lib/training/_threshold_evidence_contract.test.ts "×"
run staleness-lowers-support-not-level lib/training/pace-corpus.ts \
  "s/supportWeight: o.weight \* stalenessFactor/weight: o.weight * stalenessFactor/" lib/training/_threshold_evidence_contract.test.ts "×"
run goal-isolation-gain-reads-goal lib/race/race-outlook.ts \
  "s/executionQuality: signal\?\.executionQuality \?\? null,/executionQuality: (signal?.executionQuality ?? 1) * (race.statedGoalSec ? 10800 \/ race.statedGoalSec : 1),/" lib/race/_race_outlook_contract.test.ts "×"
run execution-target-past-fast-edge lib/race/race-outlook.ts \
  "s/targetSec = roundRaceTargetSec\(likelyRangeSec\[0\]\);/targetSec = goalSec;/" lib/race/_race_outlook_contract.test.ts "×"
run hr-informational-without-evidence lib/race/race-hr-guidance.ts \
  "s/const informationalOnly = comparable.length === 0 \|\| /const informationalOnly = /" lib/race/_race_outlook_contract.test.ts "×"
run race-row-staleness-recompute-skips-refresh lib/plan/recompute-paces.ts \
  "s/raceRefresh = await refreshRaceRowsForPlan\(planId, \{/raceRefresh = null; const _skipped = (planId, {/" lib/race/_race_row_refresh_gate.test.ts "×"
run race-row-hr-cap-returns lib/plan/spec-builder.ts \
  "s/hr_cap_bpm: null,\n          fuel_mi: fuelMi\(distance_mi\)/X/; /2026-09-01 · P0 · a race row carries NO/,/hr_cap_bpm: null,/ s/hr_cap_bpm: null,/hr_cap_bpm: lthr ? Math.round(lthr * 0.92) : null,/" lib/race/_race_row_refresh_gate.test.ts "×"
run sealed-history-refresh-touches-sealed lib/race/race-row-refresh.ts \
  "s/if \(row.sealed \|\| row.date_iso < today\)/if (false \&\& (row.sealed || row.date_iso < today))/" lib/race/_race_row_refresh_gate.test.ts "×"
run projection-consumer-computes-its-own app/api/v5/races/route.ts \
  "s/const \{ projectedSec \} = raceProjectionFromOutlook\(nextAOutlook\);/const projectedSec = predictRaceTime(47.8, distanceMi ?? 26.2); void raceProjectionFromOutlook(nextAOutlook);/" lib/training/_race_projection.test.ts "×"
run effective-target-second-rule lib/race/effective-race-target.ts \
  "s/targetSec: x.targetSec,/targetSec: Math.round(x.targetSec * 0.95),/" lib/race/_effective_target.test.ts "×"
run limiter-grows-its-own-fit lib/coach/limiter.ts \
  "s/export interface CurveRead \{/export function fitRiegelExponent(a: number, b: number): number { return Math.log(a) \/ Math.log(b); }\nexport interface CurveRead {/" lib/coach/_limiter.test.ts "×"
echo done
