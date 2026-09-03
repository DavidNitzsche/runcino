#!/usr/bin/env bash
# scripts/p0-proof/falsify-row-contract.sh · Rule 18 for ROW-CONTRACT-1.
#
# Break each half of the coherence contract on purpose, run the gate, record
# that it NAMED the break, restore. A gate that has never failed is a
# hypothesis, and this repo has shipped checks that could not fail at all.
#
# Every mutation is a sed on a tracked file that `git checkout --` reverts, and
# the script refuses to start on a dirty tree for the files it touches.
#
# Usage, from web-v2/:   bash scripts/p0-proof/falsify-row-contract.sh <outdir>
set -u
OUT="${1:?outdir}"; mkdir -p "$OUT"
GATE="lib/race/_race_row_coherence_gate.test.ts"
PASS=0; FAIL=0

run() { # name · file · sed-expr · expected-violation-substring
  local name="$1" file="$2" expr="$3" expect="$4"
  if ! git diff --quiet -- "$file"; then echo "DIRTY $file · refusing"; FAIL=$((FAIL+1)); return; fi
  sed -i '' -E "$expr" "$file"
  if git diff --quiet -- "$file"; then echo "MUTATION DID NOT APPLY · $name"; FAIL=$((FAIL+1)); return; fi
  {
    echo "### $name"
    echo "mutation: sed -E \"$expr\" $file"
    git diff --no-color -- "$file" | sed -n '1,30p'
    echo; echo "--- gate output (broken) ---"
  } > "$OUT/$name.log"
  npx vitest run "$GATE" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' \
    | grep -E "×|✓|Tests |AssertionError|expected|\"code\"|NOTE value" | head -40 >> "$OUT/$name.log"
  git checkout -- "$file"
  { echo; echo "--- gate output (restored) ---"; } >> "$OUT/$name.log"
  npx vitest run "$GATE" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests |Test Files" >> "$OUT/$name.log"
  if grep -q "$expect" "$OUT/$name.log" && grep -q "×" "$OUT/$name.log"; then
    echo "FALSIFIED · $name"; PASS=$((PASS+1))
  else
    echo "NOT FALSIFIED · $name (check $OUT/$name.log)"; FAIL=$((FAIL+1))
  fi
}

# 1 · the prose stops moving with the number. The Santa Monica defect, exactly.
run notes-frozen lib/race/race-row-refresh.ts \
  "s/^    const notes = repriceRaceNote\(row\.notes, pace, voice\);$/    const notes = null;/" \
  "PROSE_NAMES_ANOTHER_PACE"

# 2 · every tune-up repriced to the race target again, reps left behind.
#     The 12-01 defect: a 7:23\/mi headline over 6:41 reps.
run tuneup-repriced-to-race-pace lib/race/race-row-refresh.ts \
  "s/^  if \(anchor !== 'race_pace'\) \{$/  if (false) {/" \
  "REPRICED_TO_RACE_PACE"

# 3 · the race's execution block and HR band left standing on a tune-up.
run tuneup-keeps-race-fields lib/race/race-row-refresh.ts \
  "s/^  'race_execution', 'race_hr', 'pace_target_s_per_mi_lo', 'pace_target_s_per_mi_hi',$/  'pace_target_s_per_mi_lo', 'pace_target_s_per_mi_hi',/" \
  "RACE_ONLY_FIELD_ON_A_NON_RACE_ROW"

# 4 · the target moves and the mid-race abort stays on the abandoned anchor.
run abort-not-repriced lib/race/race-row-refresh.ts \
  "s/^    targetPaceSecPerMi: o\.execution\.paceSecPerMi,$/    targetPaceSecPerMi: (o.execution.paceSecPerMi ?? 0) + 30,/" \
  "ABORT_PRICED_OFF_ANOTHER_TARGET"

# 5 · a step note naming a distance, under a header forbidding it.
run note-names-a-distance lib/training/spec-card.ts \
  "s/^  race: 'Hold the plan early\..*$/  race: 'Hold the plan through the first 5K. Mile 1 decisions are paid for at mile 12.',/" \
  "NOTE value names a distance"

# 6 · the atomicity check itself removed, so an incoherent contract would write.
run atomicity-check-removed lib/race/race-row-refresh.ts \
  "s/^  if \(violations\.length === 0\) return write;$/  if (true) return write;/" \
  "CONTRACT_INCOHERENT"

echo
echo "falsified: $PASS · not falsified: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
