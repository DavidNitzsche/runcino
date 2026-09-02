#!/usr/bin/env bash
# Phase 1 of the brain completion · break each new invariant, record the gate failing, restore.
set -u
OUT="${1:?outdir}"; mkdir -p "$OUT"
run() { local name="$1" file="$2" expr="$3" test="$4"
  if ! git diff --quiet -- "$file"; then echo "DIRTY $file · refusing"; return 1; fi
  sed -i '' -E "$expr" "$file"
  if git diff --quiet -- "$file"; then echo "MUTATION DID NOT APPLY · $name"; return 1; fi
  { echo "### $name"; echo "mutation: sed -E \"$expr\" $file"; git diff --no-color -- "$file" | sed -n '1,30p'; echo; echo "--- gate output (broken) ---"; } > "$OUT/$name.log"
  if [[ "$test" == doctrine ]]; then bash ../scripts/check-doctrine.sh 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "FAIL|×|✗|Error|OK" | head -12 >> "$OUT/$name.log";
  else npx vitest run "$test" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "×|Tests |AssertionError|Error:" | head -12 >> "$OUT/$name.log"; fi
  git checkout -- "$file"
  { echo; echo "--- gate output (restored) ---"; } >> "$OUT/$name.log"
  if [[ "$test" == doctrine ]]; then bash ../scripts/check-doctrine.sh 2>&1 | grep -E "doctrine OK|FAIL" | head -2 >> "$OUT/$name.log"; else npx vitest run "$test" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests " >> "$OUT/$name.log"; fi
  if grep -qE "×|FAIL|Error" "$OUT/$name.log"; then echo "FALSIFIED · $name"; else echo "NOT FALSIFIED · $name"; fi
}
run rehearsal-bar-below-doctrine lib/training/durability-anchor.ts "s/MARATHON_REHEARSAL_MIN_SESSIONS = 3;/MARATHON_REHEARSAL_MIN_SESSIONS = 2;/" doctrine
run endpoint-coverage-ignored lib/training/durability-anchor.ts "s/const endpointScore = clamp01\(\(Math.min\(nShort, nLong\) - 1\) \/ \(RACE_EXPONENT_ENDPOINT_SATURATION - 1\)\);/const endpointScore = 1;/" lib/training/_durability_phase1.test.ts
run rehearsal-cap-from-slow-side lib/training/prescription-resolver.ts "s/demonstrated != null \&\& demonstratedSpendable \&\& demonstrated < exponentPace/demonstrated != null \&\& demonstratedSpendable/" lib/training/_durability_phase1.test.ts
run rehearsal-spent-below-confidence lib/training/prescription-resolver.ts "s/args.durability.trainingDurability.confidence >= MARATHON_REHEARSAL_SPEND_CONFIDENCE/true/" lib/training/_durability_phase1.test.ts
run rehearsal-step-up-rule-removed lib/training/durability-anchor.ts "s/if \(mean > beforeMean \* \(1 - MARATHON_REHEARSAL_MIN_STEP_FASTER_PCT \/ 100\)\) continue;/\/\/ removed/" lib/training/_durability_phase1.test.ts
run sparse-cap-scales-with-days lib/training/pace-corpus.ts "s/const allowed = minObservations < CORROBORATION_MIN_OBSERVATIONS/const allowed = false/" lib/training/_durability_phase1.test.ts
run continuity-cap-disabled lib/training/capacity-resolver.ts "s/if \(Math.abs\(delta\) <= cap\) \{/if (true) {/" lib/training/_durability_phase1.test.ts
run representativeness-not-spent lib/training/durability-anchor.ts "s/weight: o.weight \* Math.max\(0, Math.min\(1, read.authority\)\),/weight: o.weight,/" lib/training/_durability_phase1.test.ts
echo done
