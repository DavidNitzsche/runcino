#!/usr/bin/env bash
#
# verify-commit.sh <sha> · isolated-commit verification, hook-equivalent
# ─────────────────────────────────────────────────────────────────────────────
#
# WHAT THIS IS FOR
#
# `docs/PRODUCT_DECISIONS.md` § 2026-09-01 "Four calls on the migration
# handback's open questions" #4 authorizes isolated-commit verification as a
# FORMAL substitute for the pre-push hook (`.githooks/pre-push`) when the hook
# fails only because this SHARED checkout has another agent's unrelated
# uncommitted WIP in it — never as a silent shortcut around a real failure.
# Read `docs/VERIFICATION_POLICY.md` before using this on a real bypass; this
# header is the short version.
#
# This script exists so condition (2) "verifies the exact commit in a clean
# isolated worktree" and condition (3) "runs the SAME checks the hook would
# have run, not a hand-picked subset" are satisfied BY CONSTRUCTION — you do
# not have to argue you did them correctly, you ran the tool that only knows
# how to do them correctly.
#
# WHAT THE HOOK ACTUALLY RUNS (read from `.githooks/pre-push` and
# `scripts/check-web-build.sh` directly — not assumed)
#
#   0. ALWAYS: `npm run prebuild` in web-v2 — the twenty gates Railway runs
#      before it builds. Added 2026-09-02 because `check-web-build.sh` calls
#      `npx next build` directly, bypassing the npm prebuild lifecycle, so a
#      failing gate passed this script and failed the deploy.
#
#   1. ALWAYS: `scripts/check-web-build.sh` — `npx tsc --noEmit` in web-v2,
#      then `npx next build` in web-v2. Note this calls `next build` via
#      `npx`, NOT `npm run build`, so npm's `prebuild` lifecycle script (the
#      17-script chain: check-doctrine.sh, check-palette-sync.sh,
#      check-normal-window.sh, check-client-graph.sh, etc.) does NOT fire
#      here — verified empirically (see docs/reports/verification-policy-
#      2026-09-01.md). That chain runs on Railway, where the build command is
#      `npm run build` (which npm fires `prebuild` ahead of), and in CI
#      (`.github/workflows/build-check.yml`, `npm run prebuild` as an
#      explicit separate step). The local hook is deliberately a lighter,
#      faster proxy for what Railway will do; it is not the only gate.
#   2. CONDITIONALLY: `scripts/check-watch.sh` — only when the pushed range
#      touches watch paths (legacy/native/Faff/FaffWatch, native-v2/project.yml,
#      native-v2/Faff.xcodeproj/, scripts/watch/, scripts/check-watch.sh).
#      Requires Xcode + a watch simulator.
#
# This script mirrors both, using the SAME diff-scoping logic the dispatcher
# uses, scaled to a single commit (parent..commit instead of remote..local).
#
# USAGE
#
#   scripts/verify-commit.sh <sha>              # full hook-equivalent run
#   scripts/verify-commit.sh <sha> --skip-watch  # skip watch gate even if
#                                                 # touched (record WHY in the
#                                                 # disclosure — this is a
#                                                 # hand-picked subset and
#                                                 # needs its own justification,
#                                                 # it does not get the
#                                                 # by-construction pass)
#   scripts/verify-commit.sh --clean             # remove the persistent
#                                                 # isolated worktree
#
# WHY A PERSISTENT WORKTREE, NOT A FRESH ONE PER CALL
#
# `git worktree add` gives isolation; re-adding and `npm ci`-ing from scratch
# every call is correct but slow (cold install + cold .next ~ minutes). This
# script keeps ONE reusable worktree at .claude/worktrees/verify-commit
# (already gitignored via `.claude/worktrees/`), force-checks-out the target
# SHA into it each run, and reuses node_modules / the Next.js build cache
# across invocations — reinstalling only when package-lock.json's hash
# actually changed. Isolation comes from it being a physically separate
# directory with its own checked-out tree, not from being ephemeral.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
WORKTREE_DIR="$ROOT/.claude/worktrees/verify-commit"

# ── colours (no-op if not a tty) ─────────────────────────────────────────────
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BOLD=''; C_RESET=''
fi

pass() { printf '%s✓ %s%s\n' "$C_GREEN" "$1" "$C_RESET"; }
fail() { printf '%s✗ %s%s\n' "$C_RED" "$1" "$C_RESET"; }
info() { printf '%s→ %s%s\n' "$C_BOLD" "$1" "$C_RESET"; }
warn() { printf '%s! %s%s\n' "$C_YELLOW" "$1" "$C_RESET"; }

# ── --clean ───────────────────────────────────────────────────────────────
if [ "${1:-}" = "--clean" ]; then
  if [ -d "$WORKTREE_DIR" ]; then
    info "Removing $WORKTREE_DIR"
    git -C "$ROOT" worktree remove --force "$WORKTREE_DIR" 2>/dev/null || rm -rf "$WORKTREE_DIR"
    git -C "$ROOT" worktree prune
    pass "Cleaned."
  else
    info "Nothing to clean."
  fi
  exit 0
fi

SHA="${1:-}"
shift || true
SKIP_WATCH=0
for arg in "$@"; do
  case "$arg" in
    --skip-watch) SKIP_WATCH=1 ;;
    *) fail "Unknown argument: $arg"; exit 2 ;;
  esac
done

if [ -z "$SHA" ]; then
  echo "usage: scripts/verify-commit.sh <sha> [--skip-watch]" >&2
  echo "       scripts/verify-commit.sh --clean" >&2
  exit 2
fi

# ── resolve + validate the commit (against the REAL repo, not the worktree) ─
FULL_SHA="$(git -C "$ROOT" rev-parse --verify "${SHA}^{commit}" 2>/dev/null)" || {
  fail "'$SHA' does not resolve to a commit in $ROOT"
  exit 2
}
SHORT_SHA="$(git -C "$ROOT" rev-parse --short "$FULL_SHA")"
SUBJECT="$(git -C "$ROOT" log -1 --format=%s "$FULL_SHA")"

echo ""
info "verify-commit · $FULL_SHA ($SHORT_SHA) — $SUBJECT"
echo ""

START_TS=$(date +%s)

# ── 1 · stand up (or repoint) the isolated worktree ─────────────────────────
info "Isolating commit into $WORKTREE_DIR (not the shared checkout)"

IS_REGISTERED_WORKTREE=0
if git -C "$ROOT" worktree list --porcelain | grep -qx "worktree $WORKTREE_DIR"; then
  IS_REGISTERED_WORKTREE=1
fi

if [ "$IS_REGISTERED_WORKTREE" = "1" ]; then
  if ! git -C "$WORKTREE_DIR" checkout --force --detach "$FULL_SHA" 2>&1 | sed 's/^/  /'; then
    fail "Could not check out $FULL_SHA in the existing worktree."
    exit 2
  fi
  # Discard untracked cruft from whatever the last verification left behind,
  # but keep the caches that make repeated runs fast.
  git -C "$WORKTREE_DIR" clean -fdx \
    -e node_modules -e web-v2/node_modules -e web-v2/.next \
    -e legacy/web/node_modules >/dev/null
else
  if [ -e "$WORKTREE_DIR" ]; then
    warn "$WORKTREE_DIR exists but is not a registered git worktree — removing it."
    rm -rf "$WORKTREE_DIR"
  fi
  mkdir -p "$(dirname "$WORKTREE_DIR")"
  if ! git -C "$ROOT" worktree add --detach "$WORKTREE_DIR" "$FULL_SHA" 2>&1 | sed 's/^/  /'; then
    fail "git worktree add failed."
    exit 2
  fi
fi

# ── prove isolation: the worktree's tracked tree exactly matches the commit ─
DIRTY="$(git -C "$WORKTREE_DIR" status --porcelain)"
if [ -n "$DIRTY" ]; then
  fail "Worktree is not clean after checkout — isolation is not proven. Aborting."
  echo "$DIRTY" | sed 's/^/  /'
  exit 2
fi
CHECKED_OUT_SHA="$(git -C "$WORKTREE_DIR" rev-parse HEAD)"
if [ "$CHECKED_OUT_SHA" != "$FULL_SHA" ]; then
  fail "Worktree HEAD ($CHECKED_OUT_SHA) does not match requested commit ($FULL_SHA)."
  exit 2
fi
pass "Isolated worktree matches $SHORT_SHA exactly (clean, detached HEAD)."
echo ""

# ── 2 · dependencies — reuse unless the lockfile changed ────────────────────
info "Dependencies (web-v2)"
LOCKFILE="$WORKTREE_DIR/web-v2/package-lock.json"
NM_DIR="$WORKTREE_DIR/web-v2/node_modules"
MARKER="$NM_DIR/.verify-commit-lockfile.sha256"
NEW_HASH="$(shasum -a 256 "$LOCKFILE" | awk '{print $1}')"
OLD_HASH="$( [ -f "$MARKER" ] && cat "$MARKER" || echo "" )"

if [ "$NEW_HASH" = "$OLD_HASH" ] && [ -d "$NM_DIR" ]; then
  pass "node_modules reused (package-lock.json unchanged: ${NEW_HASH:0:12}…)."
else
  info "package-lock.json changed or node_modules absent — running npm ci (this is the slow path)…"
  if ! ( cd "$WORKTREE_DIR/web-v2" && npm ci --no-audit --no-fund ); then
    fail "npm ci failed."
    exit 1
  fi
  echo "$NEW_HASH" > "$MARKER"
  pass "Dependencies installed fresh."
fi
echo ""

# ── 3 · same checks the hook runs, unconditionally ───────────────────────────
RESULTS=()
OVERALL=0

# ── 3a · THE SHIPPING GATE CHAIN ──────────────────────────────────────────────
# Added 2026-09-02, after main stopped deploying for three commits while this
# script reported CLEAN on the same tree.
#
# `check-web-build.sh` runs `npx next build` DIRECTLY. That is deliberate there
# (putting `next build` inside `prebuild` would be circular), but it means the
# npm `prebuild` lifecycle never fires, so none of the twenty gates Railway runs
# were in this script's scope. A gate failure therefore passed verification and
# failed the deploy — Rule 19's own lesson one layer in: the chain that PROVES a
# commit was not the chain that SHIPS it.
#
# The cause was two parallel branches colliding: one retired an identifier and
# added a ratchet asserting it was gone, the other branched from an older base
# and still read it. Nothing local could see it, because nothing local ran the
# ratchet.
#
# Falsified before being trusted: reintroducing that identifier makes this
# script FAIL and name the gate, the file and the assertion.
info "Running the shipping prebuild gate chain (npm run prebuild — what Railway runs)"
CHECK_START=$(date +%s)
if ( cd "$WORKTREE_DIR/web-v2" && npm run prebuild ); then
  pass "npm run prebuild (shipping gate chain) — PASS ($(( $(date +%s) - CHECK_START ))s)"
  RESULTS+=("PASS  npm run prebuild (shipping gate chain)")
else
  fail "npm run prebuild — FAIL ($(( $(date +%s) - CHECK_START ))s)"
  fail "This is what blocks the deploy. A green tsc and a green next build do not"
  fail "override it — the gate chain runs first on Railway and stops the build."
  RESULTS+=("FAIL  npm run prebuild (shipping gate chain)")
  OVERALL=1
fi
echo ""

info "Running scripts/check-web-build.sh against the isolated checkout (identical to what the hook runs)"
CHECK_START=$(date +%s)
if ( cd "$WORKTREE_DIR" && bash scripts/check-web-build.sh ); then
  pass "check-web-build.sh (tsc --noEmit + next build) — PASS ($(( $(date +%s) - CHECK_START ))s)"
  RESULTS+=("PASS  check-web-build.sh (typecheck + next build)")
else
  fail "check-web-build.sh — FAIL ($(( $(date +%s) - CHECK_START ))s)"
  RESULTS+=("FAIL  check-web-build.sh (typecheck + next build)")
  OVERALL=1
fi
echo ""

# ── 3b · the unit tests CI gates on ──────────────────────────────────────────
#
# WHY THIS EXISTS, and it is the same hole Rule 19 names.
#
# On 2026-09-03 this script reported CLEAN at 7de5375f while `main` was RED.
# Both statements were true. `npm run prebuild` runs the twenty shipping gates
# and `check-web-build.sh` runs the compiler, and neither of them runs a single
# vitest file — but `.github/workflows/surface-sweep.yml` does, and it is what caught
# eight raw jsonb reads in a new loader. A verification tool that can say CLEAN
# about a commit CI will reject is worse than no tool, because it is confidently
# wrong at exactly the moment somebody is relying on it to skip the hook.
#
# The globs are READ OUT OF THE WORKFLOW at run time rather than copied here.
# Rule 18: a check that hardcodes both sides only proves it agrees with itself,
# and a list duplicated into this file would drift the first time CI's changed.
# If the parse finds nothing, that is a FAILURE and not a skip — a gate that
# reports clean because it looked at nothing is the worst outcome available.
SWEEP_WF="$WORKTREE_DIR/.github/workflows/surface-sweep.yml"
CI_TEST_GLOBS="$(grep -E '^[[:space:]]*run:[[:space:]]*npx vitest run ' "$SWEEP_WF" 2>/dev/null | head -1 | sed -e 's/.*npx vitest run //' -e 's/[[:space:]]*$//')"
if [ -z "$CI_TEST_GLOBS" ]; then
  fail "could not read the vitest globs out of $SWEEP_WF — refusing to report a"
  fail "result I cannot back. Fix the parse or the workflow path; do not skip this."
  RESULTS+=("FAIL  CI unit tests (could not read the globs from sweep.yml)")
  OVERALL=1
else
  info "Running the unit tests CI gates on: $CI_TEST_GLOBS"
  CHECK_START=$(date +%s)
  # shellcheck disable=SC2086 -- the globs are a deliberate multi-arg word split
  if ( cd "$WORKTREE_DIR/web-v2" && npx vitest run $CI_TEST_GLOBS --reporter=dot ); then
    pass "CI unit tests — PASS ($(( $(date +%s) - CHECK_START ))s)"
    RESULTS+=("PASS  CI unit tests ($CI_TEST_GLOBS)")
  else
    fail "CI unit tests — FAIL ($(( $(date +%s) - CHECK_START ))s)"
    RESULTS+=("FAIL  CI unit tests ($CI_TEST_GLOBS)")
    OVERALL=1
  fi
fi
echo ""

# ── 4 · watch gate, only if this commit touches watch paths (dispatcher logic) ─
# Mirrors .githooks/pre-push's touches_watch(), scaled from a push range
# (remote..local) to a single commit (parent..commit). A root commit (no
# parent) is treated as "can't scope it" -> run the gate, same fallback the
# dispatcher uses when it has no stdin range to scope against.
PARENT="$(git -C "$WORKTREE_DIR" rev-parse "${FULL_SHA}^" 2>/dev/null || true)"
if [ -n "$PARENT" ]; then
  TOUCHED="$(git -C "$WORKTREE_DIR" diff --name-only "$PARENT" "$FULL_SHA")"
else
  TOUCHED="__root_commit_unscoped__"
fi

TOUCHES_WATCH=0
if [ -z "$PARENT" ] || printf '%s' "$TOUCHED" | grep -qE \
  '^(legacy/native/Faff/FaffWatch|native-v2/project\.yml|native-v2/Faff\.xcodeproj/|scripts/watch/|scripts/check-watch\.sh)'; then
  TOUCHES_WATCH=1
fi

if [ "$TOUCHES_WATCH" = "1" ]; then
  if [ "$SKIP_WATCH" = "1" ]; then
    warn "Commit touches watch paths but --skip-watch was passed. This is a HAND-PICKED"
    warn "SUBSET of the hook's checks — it does NOT satisfy condition (3) on its own."
    warn "Justify this explicitly in the disclosure if you rely on this run to bypass the hook."
    RESULTS+=("SKIP  check-watch.sh (--skip-watch passed, touches watch paths — NOT hook-equivalent)")
  else
    info "Commit touches watch paths — running scripts/check-watch.sh (needs Xcode + a watch simulator)…"
    CHECK_START=$(date +%s)
    if ( cd "$WORKTREE_DIR" && bash scripts/check-watch.sh ); then
      pass "check-watch.sh — PASS ($(( $(date +%s) - CHECK_START ))s)"
      RESULTS+=("PASS  check-watch.sh")
    else
      fail "check-watch.sh — FAIL ($(( $(date +%s) - CHECK_START ))s)"
      RESULTS+=("FAIL  check-watch.sh")
      OVERALL=1
    fi
  fi
else
  RESULTS+=("N/A   check-watch.sh (commit does not touch watch paths — hook would skip it too)")
fi
echo ""

# ── THE TOOL CHECKS WHAT IT ACTUALLY RAN ─────────────────────────────────────
#
# On 2026-09-03 this script ran WITHOUT its prebuild section and reported CLEAN
# on a commit CI then rejected on the write-barrier ratchet. Nothing was wrong
# with the version on `main`: the copy being INVOKED came from a shared checkout
# on a stale commit, and an amend from there reverted the file to a version
# predating that section while keeping a newer edit. A verification tool with a
# section quietly missing, reporting confidence.
#
# The first attempt at this check grepped the script for each section's name —
# and could never fail, because its own list of names satisfied the grep. That
# is the gate Rule 18 exists to catch, built while fixing the thing Rule 18
# exists to catch.
#
# So it asserts what RAN, not what is written: every expected section must have
# put a line in RESULTS. A section that is missing from the file produces no
# line, and this fails. Add an entry when you add a section.
EXPECTED=(
  "npm run prebuild"
  "check-web-build.sh"
  "CI unit tests"
  "check-watch.sh"
)
missing=""
for want in "${EXPECTED[@]}"; do
  found=0
  for r in "${RESULTS[@]}"; do
    case "$r" in *"$want"*) found=1; break ;; esac
  done
  [ "$found" = "1" ] || missing="$missing
    · $want"
done
if [ -n "$missing" ]; then
  fail "THIS RUN WAS INCOMPLETE — these sections produced no result at all:$missing"
  fail "The copy of this script being run is missing them. Restore it with:"
  fail "    git show origin/main:scripts/verify-commit.sh > scripts/verify-commit.sh"
  OVERALL=1
  RESULTS+=("FAIL  verify-commit is incomplete — sections did not run")
fi

TOTAL=$(( $(date +%s) - START_TS ))

echo "─────────────────────────────────────────────────────────────────────"
echo "verify-commit summary · $FULL_SHA ($SHORT_SHA)"
echo "  \"$SUBJECT\""
echo "  worktree: $WORKTREE_DIR"
echo "  elapsed:  ${TOTAL}s"
echo ""
for r in "${RESULTS[@]}"; do
  case "$r" in
    PASS*) printf '  %s%s%s\n' "$C_GREEN" "$r" "$C_RESET" ;;
    FAIL*) printf '  %s%s%s\n' "$C_RED" "$r" "$C_RESET" ;;
    SKIP*) printf '  %s%s%s\n' "$C_YELLOW" "$r" "$C_RESET" ;;
    *)     printf '  %s\n' "$r" ;;
  esac
done
echo "─────────────────────────────────────────────────────────────────────"
if [ "$OVERALL" = "0" ]; then
  pass "verify-commit: CLEAN at $FULL_SHA."
  echo ""
  echo "This satisfies docs/VERIFICATION_POLICY.md conditions (2) and (3) by"
  echo "construction. Conditions (1), (4), (5), (6), (7) are still yours to"
  echo "argue and disclose — this tool proves the commit, not the bypass."
else
  fail "verify-commit: FAILED at $FULL_SHA. Do not treat this commit as verified."
fi
exit "$OVERALL"
