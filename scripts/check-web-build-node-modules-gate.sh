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
# ── CASES 4-5 (added 2026-09-11) · the refusal above is SCOPED to web-v2 ────
#
# The refusal CASE 1 proves is correct in isolation but was, until this round,
# unconditional: `.githooks/pre-push` called `check-web-build.sh` on EVERY
# push regardless of what it touched, so a push from a node_modules-less
# worktree that changed only e.g. `docs/` got hard-blocked for a change that
# never came near web-v2 — real, frequent friction across this repo's many
# concurrent worktrees, with the only escapes being a slow `verify-commit.sh`
# detour or `--no-verify` (which also disables the shipping lock and watch
# gate, not just this one check). The fix adds `touches_web()` to
# `.githooks/pre-push`, mirroring the existing `touches_watch()` pattern
# exactly, and gates the call to `check-web-build.sh` behind it.
#
# CASE 4/5 test that gating by driving the REAL `.githooks/pre-push` end to
# end with fabricated stdin, the same technique `check-main-push-lock.sh`
# uses for its own CASE 8/9 — real, pre-existing commit pairs from THIS
# repo's own history (never synthesized commits mutating the shared
# checkout's history), so `git cat-file -e` / `git diff --name-only` inside
# the hook exercise the real code path, not a mock. Both pairs are verified
# below to be single-parent (non-merge) and to avoid the watch-gate's own
# trigger paths, for the same reason `check-main-push-lock.sh` verifies that:
# an accidental real watch-gate launch (a full xcodebuild simulator run) has
# collided with another agent's own simulator use before.
#
# CASE 4 proves the bypass is fixed: a real docs-only range, run through the
# hook from THIS worktree (which has no `web-v2/node_modules`), now exits 0 —
# `check-web-build.sh` is never invoked at all.
#
# CASE 5 proves the fix didn't remove the refusal, only scope it: a real
# range that DOES touch `web-v2/` (mixed with non-web-v2 files, so a
# same-commit false-negative can't hide behind "it was a pure web-v2 diff"),
# run through the same hook from the same node_modules-less worktree, still
# triggers `check-web-build.sh` and is still correctly refused — the original
# 2026-09-11 refusal-not-silent-skip behavior, now correctly scoped rather
# than deleted.
#
# WHAT CASES 4-5 CANNOT FAIL ON: they cannot observe the node_modules-PRESENT
# + web-v2-touching path (touches_web() true, check-web-build.sh actually
# typechecks and builds) end to end through the real hook, because that
# needs a real `web-v2/node_modules` this worktree does not carry by
# convention (CASE 2/3 above already skip for the same reason). That path was
# verified once by hand per Rule 13, symlinking a sibling checkout's real
# `node_modules` into this worktree's `web-v2/` and running the real hook
# against the same CASE 5 commit range with `FAFF_SKIP_BUILD=1`: typecheck ran
# (`Typechecking web-v2 before push…` / `Web typecheck clean.`), exit 0 — see
# the commit message / handback for that run's output — and is not re-proven
# on every invocation of this falsifier, same posture as CASE 2/3's own build
# step.
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

# ── CASES 4-5 setup · real commit pairs from THIS repo's own history ───────
# Same discipline as check-main-push-lock.sh's own CASE 8/9: real, resolvable
# SHAs already in the repo's history, never a commit fabricated by this
# script (that would mutate the shared checkout's history — the exact class
# of shared-mutable-state incident CLAUDE.md's Rule 6/Rule 9 document). Both
# pairs are verified below — not assumed — to be single-parent (non-merge,
# so `git diff --name-only` between them is an ordinary one-step diff) and to
# avoid the watch-gate's own trigger paths, so running the real hook here
# cannot accidentally launch a real xcodebuild simulator run.
DOCSONLY_OLD="9f082e33929c670c091920006b0602e85de5dc68"
DOCSONLY_NEW="9696decac2a1861046ec1b255846e5e36d9b0e9c"
MIXED_OLD="1dec1c22a501995c60cd86943ba941f8b36fc510"
MIXED_NEW="1050a48c7a9ab50a5d5a6826dba034fab4a9e2a0"
WATCH_TRIGGER_RE='^(legacy/native/Faff/FaffWatch|native-v2/project\.yml|native-v2/Faff\.xcodeproj/|scripts/watch/|scripts/check-watch\.sh)'

pairs_resolvable=1
for sha in "$DOCSONLY_OLD" "$DOCSONLY_NEW" "$MIXED_OLD" "$MIXED_NEW"; do
  git cat-file -e "$sha" 2>/dev/null || pairs_resolvable=0
done
docsonly_is_docs_only=0
docsonly_avoids_watch=0
mixed_touches_web=0
mixed_touches_nonweb=0
mixed_avoids_watch=0
mixed_is_single_parent=0
docsonly_is_single_parent=0
if [ "$pairs_resolvable" = "1" ]; then
  docsonly_diff="$(git diff --name-only "$DOCSONLY_OLD" "$DOCSONLY_NEW")"
  mixed_diff="$(git diff --name-only "$MIXED_OLD" "$MIXED_NEW")"
  printf '%s' "$docsonly_diff" | grep -qE '^web-v2/' || docsonly_is_docs_only=1
  printf '%s' "$docsonly_diff" | grep -qE "$WATCH_TRIGGER_RE" || docsonly_avoids_watch=1
  printf '%s' "$mixed_diff" | grep -qE '^web-v2/' && mixed_touches_web=1
  printf '%s' "$mixed_diff" | grep -vE '^web-v2/' | grep -q . && mixed_touches_nonweb=1
  printf '%s' "$mixed_diff" | grep -qE "$WATCH_TRIGGER_RE" || mixed_avoids_watch=1
  [ "$(git rev-parse "$DOCSONLY_NEW^@" | wc -l | tr -d ' ')" = "1" ] && docsonly_is_single_parent=1
  [ "$(git rev-parse "$MIXED_NEW^@" | wc -l | tr -d ' ')" = "1" ] && mixed_is_single_parent=1
fi

echo ""
echo "── CASE 4 · docs-only push, no node_modules → hook now PASSES (bypass fixed) ──"
if [ "$pairs_resolvable" = "1" ] && [ "$docsonly_is_docs_only" = "1" ] && [ "$docsonly_avoids_watch" = "1" ] && [ "$docsonly_is_single_parent" = "1" ]; then
  case4_out="$SCRATCH/case4.out"
  printf 'refs/heads/faff-gate-test %s refs/heads/faff-gate-test %s\n' "$DOCSONLY_NEW" "$DOCSONLY_OLD" \
    | bash "$ROOT/.githooks/pre-push" origin "https://example.invalid/repo.git" \
    > "$case4_out" 2>&1
  case4_exit=$?
  assert "real hook exits 0 for a docs-only range regardless of node_modules" "$([ "$case4_exit" = "0" ] && echo 1 || echo 0)"
  assert "check-web-build.sh was never invoked (no typecheck line, no refusal line)" \
    "$(grep -qE 'Typechecking web-v2|node_modules is missing' "$case4_out" && echo 0 || echo 1)"
else
  echo "  SKIPPED — the pinned docs-only commit pair no longer verifies as docs-only/" >&2
  echo "  single-parent/watch-safe in this checkout's history. Re-pin DOCSONLY_OLD/NEW" >&2
  echo "  to a current real commit pair before trusting CASE 4." >&2
fi

echo ""
echo "── CASE 5 · web-v2-touching push, no node_modules → still REFUSED (not swallowed) ──"
# Guarded on node_modules being ABSENT here (inverse of CASE 2/3's guard),
# deliberately: check-web-build.sh never checks out the historical commit
# range into $WEB, it typechecks whatever is CURRENTLY sitting in this
# worktree's web-v2 — so this case only exercises the refusal path
# deterministically when this worktree genuinely has no node_modules. When it
# does, the web-v2-touching + node_modules-present combination is CASE 2/3's
# territory (plus the hand-verified real-hook run cited in this file's header).
if [ "$pairs_resolvable" = "1" ] && [ "$mixed_touches_web" = "1" ] && [ "$mixed_touches_nonweb" = "1" ] && [ "$mixed_avoids_watch" = "1" ] && [ "$mixed_is_single_parent" = "1" ] && [ ! -d "$WEB/node_modules" ]; then
  case5_out="$SCRATCH/case5.out"
  printf 'refs/heads/faff-gate-test %s refs/heads/faff-gate-test %s\n' "$MIXED_NEW" "$MIXED_OLD" \
    | bash "$ROOT/.githooks/pre-push" origin "https://example.invalid/repo.git" \
    > "$case5_out" 2>&1
  case5_exit=$?
  assert "real hook exits 1 (still refused, not silently bypassed) for a mixed range touching web-v2" \
    "$([ "$case5_exit" = "1" ] && echo 1 || echo 0)"
  assert "check-web-build.sh WAS invoked and gave the original refusal message" \
    "$(grep -q 'node_modules is missing' "$case5_out" && echo 1 || echo 0)"
  assert "message still says the push was aborted" "$(grep -q 'Push aborted' "$case5_out" && echo 1 || echo 0)"
elif [ -d "$WEB/node_modules" ]; then
  echo "  SKIPPED — $WEB/node_modules is present in this worktree, so this exact" >&2
  echo "  case (missing-node_modules refusal on a real web-v2-touching push) can't" >&2
  echo "  run deterministically here — see CASE 2/3 and this file's header for the" >&2
  echo "  node_modules-present + web-v2-touching path instead." >&2
else
  echo "  SKIPPED — the pinned mixed commit pair no longer verifies as web-v2-touching/" >&2
  echo "  mixed/single-parent/watch-safe in this checkout's history. Re-pin MIXED_OLD/NEW" >&2
  echo "  to a current real commit pair before trusting CASE 5." >&2
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
