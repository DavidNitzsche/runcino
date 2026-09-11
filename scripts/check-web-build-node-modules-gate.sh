#!/usr/bin/env bash
# scripts/check-web-build-node-modules-gate.sh · Rule 18 falsifier for the
# missing-node_modules hole in scripts/check-web-build.sh
# ─────────────────────────────────────────────────────────────────────────────
# What this catches: until 2026-09-11, `check-web-build.sh` responded to a
# missing `web-v2/node_modules` by printing a notice and `exit 0` — the whole
# pre-push hook passed with ZERO checks run, and the push's own output looked
# identical to a push that had actually been typechecked and built. A real
# commit (`b018980c1` on `fix/recovery-honesty-strides-grading`) pushed
# through this exact hole with no signal that anything had been skipped.
#
# The fix makes a missing `node_modules` a hard `exit 1` refusal instead of a
# silent `exit 0` pass (see `check-web-build.sh`'s own header for why this was
# chosen over auto-installing: concurrent `npm install` in this repo's SHARED
# checkout is a Rule 6/Rule 9-shaped race on `node_modules`, so a mutating
# side effect has no business living inside a hook the pusher didn't ask to
# mutate anything). This script proves both halves that matter per Rule 18:
# the refusal actually fires, AND the normal (node_modules present) path is
# completely unaffected — a fix to the broken case is worthless if it also
# quietly breaks the working one.
#
# Every case runs against ISOLATED scratch trees under `mktemp -d`, never the
# real shared checkout's `node_modules` — self-testing a node_modules-mutation
# bug by mutating the real shared `node_modules` would be the exact incident
# this file exists to prevent.
#
# WHAT THIS CANNOT FAIL ON (Rule 22): it cannot observe a REAL concurrent
# `npm install` race, because the fix's whole point is that this script no
# longer runs `npm install` at all — there is nothing left to race. It also
# does not re-verify `next build` itself (CASE 2 sets `FAFF_SKIP_BUILD=1` for
# speed, ~5s warm vs. ~120s for a full build); the full node_modules-present
# path, build included, was verified once by hand per Rule 13 — see the
# commit message / handback for that run's output — and is not re-proven on
# every invocation of this falsifier.
#
# Usage: bash scripts/check-web-build-node-modules-gate.sh
# Exit 0 = every case behaved as asserted. Exit 1 = at least one did not.
# Exit 3 = zero assertions ran (Rule 18: the worst outcome, not "clean").
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))"
SCRATCH="$(mktemp -d /tmp/faff-web-build-nm-gate-test.XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT

PASS=0
FAIL=0
assert() {
  local desc="$1" ok="$2"
  if [ "$ok" = "1" ]; then
    echo "  PASS · $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL · $desc"
    FAIL=$((FAIL + 1))
  fi
}

# ── CASE 1 · node_modules genuinely absent → the push is REFUSED ───────────
# An isolated scratch tree carrying ONLY the CURRENT (working-tree) copy of
# check-web-build.sh, deliberately outside any git repo, so `git rev-parse
# --show-toplevel` fails inside it and the script's own documented fallback
# (`cd "$(dirname "$0")/.." && pwd`) resolves $ROOT to the scratch dir itself.
# $WEB/node_modules therefore does not exist — not because we deleted
# anything real, but because nothing here was ever installed. This exercises
# the exact file this change touches, whatever its current on-disk state is
# (committed or not), which is what a falsifier run BEFORE a commit needs.
echo "── CASE 1 · node_modules absent → push refused, not silently allowed ──────"
CASE1="$SCRATCH/case1"
mkdir -p "$CASE1/scripts"
cp "$ROOT/scripts/check-web-build.sh" "$CASE1/scripts/check-web-build.sh"
chmod +x "$CASE1/scripts/check-web-build.sh"
case1_out="$SCRATCH/case1.out"
( cd "$CASE1" && bash "$CASE1/scripts/check-web-build.sh" >"$case1_out" 2>&1 )
case1_exit=$?
assert "exit code is 1 (refused), not 0 (silently passed)" "$([ "$case1_exit" = "1" ] && echo 1 || echo 0)"
assert "message says the push was aborted" "$(grep -q 'Push aborted' "$case1_out" && echo 1 || echo 0)"
assert "message tells the pusher to run npm install" "$(grep -q 'npm install' "$case1_out" && echo 1 || echo 0)"
assert "message names the --no-verify override, not a silent default" "$(grep -q -- '--no-verify' "$case1_out" && echo 1 || echo 0)"
assert "it did NOT claim to have typechecked anything it never ran" "$(grep -q 'Typechecking web-v2' "$case1_out" && echo 0 || echo 1)"
assert "it did NOT print the old silent-skip wording" "$(grep -q 'skipping pre-push checks' "$case1_out" && echo 0 || echo 1)"

# ── CASE 2 · node_modules present, tree healthy → UNCHANGED normal behaviour ─
# Runs the REAL script against the REAL $ROOT/web-v2, which has a real
# `node_modules` installed in THIS isolated worktree (never the shared
# checkout's). FAFF_SKIP_BUILD=1 keeps this fast (~5s warm) for a falsifier
# that may run often; the full build path (this same tree, no skip flag) was
# verified once by hand — see this change's commit message for that run.
echo ""
echo "── CASE 2 · node_modules present, tree healthy → unaffected regression ────"
WEB="$ROOT/web-v2"
if [ -d "$WEB/node_modules" ]; then
  case2_out="$SCRATCH/case2.out"
  ( cd "$ROOT" && FAFF_SKIP_BUILD=1 bash "$ROOT/scripts/check-web-build.sh" >"$case2_out" 2>&1 )
  case2_exit=$?
  assert "exit code is 0 (healthy tree still passes)" "$([ "$case2_exit" = "0" ] && echo 1 || echo 0)"
  assert "it actually ran the typecheck (present-path is not a no-op)" "$(grep -q 'Typechecking web-v2' "$case2_out" && echo 1 || echo 0)"
  assert "typecheck reported clean" "$(grep -q 'Web typecheck clean' "$case2_out" && echo 1 || echo 0)"
  assert "it did NOT hit the missing-node_modules refusal path" "$(grep -q 'node_modules is missing' "$case2_out" && echo 0 || echo 1)"
else
  echo "  SKIPPED — $WEB/node_modules is absent in this worktree." >&2
  echo "  Run 'cd web-v2 && npm install' first to exercise CASE 2/3 for real." >&2
  echo "  (CASE 1 above does not need this and still ran.)" >&2
fi

# ── CASE 3 · node_modules present, a REAL type error → still caught ─────────
# Proves the present-path is not merely reached (CASE 2) but still able to
# FAIL when the tree is actually broken — a fix to the missing-node_modules
# hole that accidentally softened the present-path's own failure mode would
# be exactly the "half-measure that also silently succeeds" the task warned
# against. The planted file lives under web-v2/lib, which tsconfig.json's
# `"include": [..., "**/*.ts", ...]` picks up automatically, and is removed
# unconditionally on exit via the trap below (in addition to the outer trap).
echo ""
echo "── CASE 3 · node_modules present, a genuine tsc error → still refused ─────"
if [ -d "$WEB/node_modules" ]; then
  PLANT="$WEB/lib/__gate_falsify_tmp__.ts"
  cleanup_plant() { rm -f "$PLANT"; }
  trap 'cleanup_plant; rm -rf "$SCRATCH"' EXIT
  printf 'export const __gateFalsifyTmp__: number = "this is a string, not a number";\n' > "$PLANT"
  case3_out="$SCRATCH/case3.out"
  ( cd "$ROOT" && FAFF_SKIP_BUILD=1 bash "$ROOT/scripts/check-web-build.sh" >"$case3_out" 2>&1 )
  case3_exit=$?
  cleanup_plant
  trap 'rm -rf "$SCRATCH"' EXIT
  assert "exit code is 1 (a real type error is still caught)" "$([ "$case3_exit" = "1" ] && echo 1 || echo 0)"
  assert "message says the typecheck failed, not that it was skipped" "$(grep -q 'Web typecheck FAILED' "$case3_out" && echo 1 || echo 0)"
  assert "the planted file's own error is named in the output" "$(grep -q '__gate_falsify_tmp__' "$case3_out" && echo 1 || echo 0)"
else
  echo "  SKIPPED — $WEB/node_modules is absent in this worktree." >&2
fi

echo ""
echo "─────────────────────────────────────────────────────────────────────────"
TOTAL=$((PASS + FAIL))
if [ "$TOTAL" = "0" ]; then
  echo "UNRUNNABLE — zero assertions executed. This is the worst outcome (Rule 18)."
  exit 3
fi
echo "WEB-BUILD-NODE-MODULES-GATE: $PASS/$TOTAL passed"
[ "$FAIL" = "0" ] && exit 0 || exit 1
