#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-surface-sweep.sh · surface conformance gate (2026-08-24)
#
# Sibling of check-doctrine.sh and check-palette-sync.sh, wired the same way
# (web-v2 prebuild → Railway build). check-palette-sync stops a bad colour
# reaching production. check-doctrine stops a bad number reaching a runner's
# legs. This one stops a PLAUSIBLE WRONG ANSWER reaching a runner's eyes.
#
# The incident it generalises: on 2026-08-24 the owner found four visible
# defects on one screen in twenty minutes that a six-agent audit had missed. A
# pace that wrapped only past sixty minutes. A staleness that showed only after
# backgrounding. A headline that truncated only on a quality day. A label that
# was engine shorthand only on a recovery-block rebuild.
#
# Every one of them only broke UNDER A CONDITION — and a condition is exactly
# what a fixture lacks. That is why they survived every unit test and every
# gate: each of those tests asserts one hand-built case, and the case a human
# hand-builds is the case a human already thought of.
#
# `lib/faff/_surface_sweep.test.ts` drives the real composers across every
# runner state × awkward data shape × calendar boundary and asserts each cell
# does one of three things — renders the truth, refuses, or degrades honestly —
# and never the fourth.
#
# ── Two guards, exit 1 on any violation ────────────────────────────────────
#
#   1. FLOOR         · the matrix still declares a real matrix and every rule
#      (cold guard)    still has a positive control. Bash only, so it runs on a
#                      container with no node_modules. This is the guard that
#                      catches the failure mode the sweep exists to prevent one
#                      level up: a sweep that runs ZERO cells and reports
#                      clean. That has happened in this repo twice.
#
#   2. FULL GATE     · the sweep itself, via vitest. A FAILURE here is fatal;
#                      vitest merely being absent prints a notice, because
#                      guard 1 has already proven the matrix is intact.
#
# Deliberately no `set -e`: every guard below reports ALL of its findings
# before exiting, which a bare -e would cut short at the first one. And no
# `grep | head` anywhere — an early-exiting consumer under `pipefail` turns a
# successful MATCH into a pipeline failure, and only once the input is large
# enough for grep to still be writing when head closes the pipe.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MATRIX="$ROOT/web-v2/lib/faff/surface-sweep-matrix.ts"
SWEEP="$ROOT/web-v2/lib/faff/_surface_sweep.test.ts"

fail=0

for f in "$MATRIX" "$SWEEP"; do
  if [ ! -f "$f" ]; then
    echo "SURFACE SWEEP FAIL · missing ${f#$ROOT/}"
    echo "  The surface gate cannot be deleted to make a build pass."
    exit 1
  fi
done

# ── 1 · FLOOR ───────────────────────────────────────────────────────────────
#
# The three axes and the rule set are declared as `as const` arrays / objects
# with one entry per line, which is what lets a cold container count them with
# sed alone. Keep them that way.
#
# These minimums are not the current sizes — they are the sizes below which the
# sweep stops being a sweep. Raise them when an axis grows; never lower one to
# make a build pass.
MIN_STATES=15
MIN_SHAPES=15
MIN_BOUNDARIES=10
MIN_RULES=12

count_block() {
  # $1 = file, $2 = opening line marker, counts quoted entries until the
  # closing `] as const;`. sed only: BSD awk and mawk both lack gawk's
  # 3-argument match(), and a gate with two code paths is a gate that is only
  # ever tested on one of them.
  sed -n "/^export const $2 = \[/,/^\] as const;/p" "$1" \
    | sed -n "s/^[[:space:]]*'\([a-z_0-9]*\)',.*$/\1/p" \
    | sort -u | grep -c .
}

n_states=$(count_block "$MATRIX" "RUNNER_STATES")
n_shapes=$(count_block "$MATRIX" "DATA_SHAPES")
n_bounds=$(count_block "$MATRIX" "BOUNDARIES")
n_rules=$(sed -n '/^export const RULES = {/,/^} as const;/p' "$MATRIX" \
  | sed -n 's/^  \([A-Z_][A-Z_0-9]*\):[[:space:]]*{[[:space:]]*$/\1/p' | sort -u | grep -c .)

check_floor() {
  if [ "$2" -lt "$3" ]; then
    echo "SURFACE SWEEP FAIL · $1 declares $2 entries, floor is $3"
    echo "  An axis that shrinks is a sweep that stops covering what it claims to."
    fail=1
  else
    echo "  ok · $1: $2 (floor $3)"
  fi
}

echo "SURFACE SWEEP · matrix floor"
check_floor "RUNNER_STATES" "$n_states" "$MIN_STATES"
check_floor "DATA_SHAPES"   "$n_shapes" "$MIN_SHAPES"
check_floor "BOUNDARIES"    "$n_bounds" "$MIN_BOUNDARIES"
check_floor "RULES"         "$n_rules"  "$MIN_RULES"

cells=$((n_states * n_shapes * n_bounds))
echo "  ok · matrix yields $cells cells"

# ── every rule has a positive control ───────────────────────────────────────
#
# A rule with no control is a rule that may already be dead — it would report
# clean whether or not the defect it names is present. The test file asserts
# this too (`Object.keys(CONTROLS)` vs `RULE_IDS`), and it is repeated here so
# the cheap guard catches a deleted control on a container with no toolchain.
#
# The CONTROLS block is extracted ONCE into a variable and matched with a
# here-string, never piped per-rule into `grep -q`. `grep -q` exits on its
# first match, and under `pipefail` a producer still writing when the consumer
# closes the pipe takes SIGPIPE and fails the whole pipeline. Inverted by the
# `!` below, that turns a rule which HAS a control into a reported missing one,
# and only once the file has grown big enough to lose the race. That exact
# shape has produced a false finding in this repo before.
controls=$(sed -n '/^const CONTROLS/,/^};$/p' "$SWEEP")
missing=""
for rule in $(sed -n '/^export const RULES = {/,/^} as const;/p' "$MATRIX" \
  | sed -n 's/^  \([A-Z_][A-Z_0-9]*\):[[:space:]]*{[[:space:]]*$/\1/p'); do
  if ! grep -q "^  ${rule}: () => {" <<<"$controls"; then
    missing="$missing $rule"
  fi
done
if [ -n "$missing" ]; then
  echo "SURFACE SWEEP FAIL · rules with no positive control:$missing"
  echo "  Add a control that plants the defect the rule names, or the rule proves nothing."
  fail=1
else
  echo "  ok · all $n_rules rules carry a positive control"
fi

if [ "$fail" -ne 0 ]; then exit 1; fi

# ── 2 · FULL GATE ───────────────────────────────────────────────────────────
if [ -x "$ROOT/web-v2/node_modules/.bin/vitest" ]; then
  echo "SURFACE SWEEP · running the sweep"
  ( cd "$ROOT/web-v2" && ./node_modules/.bin/vitest run \
      lib/faff/_surface_sweep.test.ts --disable-console-intercept --reporter=dot )
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "SURFACE SWEEP FAIL · a cell produced a plausible wrong answer. Read the FIRM list above."
    exit 1
  fi
  echo "SURFACE SWEEP OK"
else
  echo "SURFACE SWEEP · vitest not present, floor guard only (this is expected on a cold container)"
fi

exit 0
