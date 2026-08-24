#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-generated-content.sh · nothing the engine authors goes unread (2026-08-24)
#
# Sibling of check-doctrine.sh, and wired the same way (web-v2 prebuild →
# Railway build). That script stops a bad NUMBER reaching a runner's legs. This
# one stops a good SENTENCE never reaching their eyes.
#
# THE INCIDENT IT GENERALISES. Three pieces of authored content turned up unread
# in one afternoon:
#
#   · plan_phases.rationale — a cited reason per phase, written on all 210 rows.
#     Every SELECT against the table asked for label / start_week_idx /
#     end_week_idx and nothing else.
#   · plan_workouts.notes — a sentence per day, on all 4431 rows, while the
#     Today screen composed its own copy from a function keyed on workout type.
#   · lib/plan/block-preview.ts — a module, its tests and an API route,
#     imported by nothing outside itself.
#
# The pattern is not laziness. The authoring side and the reading side get built
# at different times, and NOTHING FAILS WHEN THEY DO NOT MEET. A green build, a
# passing suite and every other gate agree that unread content is fine.
#
# TWO GUARDS, exit 1 on any violation:
#
#   1 · REGISTRY      · lib/audit/generated-content-registry.ts parses, is not
#       SHAPE           empty, has one single-line `id:` and one `verdict:` per
#                       entry, uses only the three legal verdicts, and every
#                       non-`surfaced` entry carries a reason. Pure sed and
#                       grep, so it runs on a cold container with no TypeScript
#                       toolchain — the same posture as check-doctrine.sh's
#                       citation pass.
#
#   2 · FULL GATE     · the scanners themselves, via vitest: does each generated
#                       column have a real SELECT reader, does a `surfaced` one
#                       name a file that still renders it, is every orphaned
#                       module and uncalled route named and reasoned, and — GUARD
#                       0, the one that matters most — did the scanner open any
#                       files at all. A scanner that opens nothing and reports
#                       clean is worse than no scanner.
#
# IF THE GATE FIRES, do not widen a verdict to make it pass. Unread content is a
# bug in one of two directions: either the surface is missing or the writer is
# waste. Decide which, and say so in the entry.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="$ROOT/web-v2/lib/audit/generated-content-registry.ts"
SCANNER="$ROOT/web-v2/lib/audit/sql-scan.ts"
GRAPH="$ROOT/web-v2/lib/audit/module-graph.ts"

fail=0

for f in "$REGISTRY" "$SCANNER" "$GRAPH"; do
  if [ ! -f "$f" ]; then
    echo "GENERATED-CONTENT FAIL · missing ${f#"$ROOT/"}"
    echo "  This gate cannot be deleted to make a build pass."
    exit 1
  fi
done

# ── 1 · REGISTRY SHAPE ───────────────────────────────────────────────────────
# sed rather than awk: BSD awk (macOS) and mawk (most Linux images) both lack
# gawk's 3-argument match(), and a gate with two code paths is a gate only ever
# tested on one of them. Same reasoning as check-doctrine.sh.
ids=$(sed -n "s/^[[:space:]]*id:[[:space:]]*'\([^']*\)',[[:space:]]*$/\1/p" "$REGISTRY")
verdicts=$(sed -n "s/^[[:space:]]*verdict:[[:space:]]*'\([^']*\)',[[:space:]]*$/\1/p" "$REGISTRY")

n_id=$(printf '%s\n' "$ids" | sed '/^$/d' | wc -l | tr -d ' ')
n_verdict=$(printf '%s\n' "$verdicts" | sed '/^$/d' | wc -l | tr -d ' ')

if [ "$n_id" -eq 0 ]; then
  echo "GENERATED-CONTENT FAIL · registry has no entries"
  echo "  Either the format contract broke or the registry was emptied. Both are findings."
  exit 1
fi

if [ "$n_id" -ne "$n_verdict" ]; then
  echo "GENERATED-CONTENT FAIL · registry format contract broken"
  echo "  found $n_id id: lines and $n_verdict verdict: lines"
  echo "  Every entry needs exactly one of each, single-line and single-quoted, so this"
  echo "  guard can run without a TypeScript toolchain. Fix the entry you just added."
  fail=1
fi

# Only three verdicts exist. A typo silently skips every check below it.
bad_verdicts=$(printf '%s\n' "$verdicts" | sed '/^$/d' | grep -vxE 'surfaced|internal|exempt' || true)
if [ -n "$bad_verdicts" ]; then
  echo "GENERATED-CONTENT FAIL · unknown verdict(s):"
  printf '    %s\n' $bad_verdicts
  echo "  Legal values: surfaced · internal · exempt."
  fail=1
fi

# Duplicate ids mean one of the two entries is never evaluated.
dupes=$(printf '%s\n' "$ids" | sed '/^$/d' | sort | uniq -d || true)
if [ -n "$dupes" ]; then
  echo "GENERATED-CONTENT FAIL · duplicate id(s):"
  printf '    %s\n' $dupes
  fail=1
fi

# Every id has to look like table.column, or the scanner cannot resolve it.
malformed=$(printf '%s\n' "$ids" | sed '/^$/d' | grep -vxE '[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*' || true)
if [ -n "$malformed" ]; then
  echo "GENERATED-CONTENT FAIL · id(s) that are not table.column:"
  printf '    %s\n' $malformed
  fail=1
fi

n_reason=$(grep -cE "^[[:space:]]*reason:[[:space:]]*'" "$REGISTRY" || true)
n_surfaced=$(printf '%s\n' "$verdicts" | sed '/^$/d' | grep -cx 'surfaced' || true)
n_needs_reason=$((n_id - n_surfaced))
if [ "$n_reason" -lt "$n_needs_reason" ]; then
  echo "GENERATED-CONTENT FAIL · $n_needs_reason entries are internal/exempt but only $n_reason carry a reason"
  echo "  An exemption with no reason is not an exemption, it is a column nobody looked at."
  fail=1
fi

# ── 2 · FULL GATE ────────────────────────────────────────────────────────────
VITEST="$ROOT/web-v2/node_modules/.bin/vitest"
if [ "${GENERATED_CONTENT_SKIP_VITEST:-}" = "1" ]; then
  echo "generated-content · vitest stage skipped (GENERATED_CONTENT_SKIP_VITEST=1)"
elif [ -x "$VITEST" ]; then
  if ! (cd "$ROOT/web-v2" && "$VITEST" run lib/audit --silent); then
    echo "GENERATED-CONTENT FAIL · a column, a module or a route has no reader (see above)."
    echo "  Wire it to the surface that should have it, or delete the writer. If neither is"
    echo "  yours to decide today, change the verdict to 'exempt' and write the honest reason"
    echo "  and the open decision — never widen a verdict to swallow a real violation."
    fail=1
  fi
else
  echo "generated-content · vitest not installed here · ran the registry shape check only"
  echo "  ($n_id entries, $n_surfaced surfaced; run 'npm run test:generated' for the scanners)"
fi

if [ "$fail" -eq 0 ]; then
  echo "generated-content OK · $n_id authored columns, every one with a named reader"
fi
exit $fail
