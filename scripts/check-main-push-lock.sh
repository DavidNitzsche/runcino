#!/usr/bin/env bash
# scripts/check-main-push-lock.sh · Rule 18 falsifier for the main-push lock
# ─────────────────────────────────────────────────────────────────────────────
# A gate is not trusted until it has been made to fail. This exercises
# scripts/lib/main-push-guard.sh directly (fast, no network, no real push)
# AND the actual `.githooks/pre-push` dispatcher end-to-end (fabricated stdin,
# real script, real exit codes) — both the "blocked" and "released" halves of
# Part 1, per the task's own falsification requirement.
#
# Every case below runs against a SCRATCH lock/auth directory
# (FAFF_MAIN_PUSH_LOCK_DIR / FAFF_MAIN_PUSH_AUTH_DIR under mktemp -d), never
# the real machine-wide paths — a self-test that touched the live lock could
# itself jam a real concurrent push, which would be this file causing the
# exact incident it exists to prevent.
#
# WHAT THIS CANNOT FAIL ON (Rule 22): it cannot observe a REAL second process
# racing a REAL first process on this machine — that would require actually
# forking two independent shells against the shared paths, which this script
# also does (see CASE 3) using background subshells, but a background-subshell
# race under a test harness is a stronger claim than "verified once in CI" and
# a weaker one than "verified under real concurrent agent load." Treat CASE 3
# as a real race, just a small one.
#
# Usage: bash scripts/check-main-push-lock.sh
# Exit 0 = every case behaved as asserted. Exit 1 = at least one did not.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))"
SCRATCH="$(mktemp -d /tmp/faff-main-push-lock-test.XXXXXX)"
export FAFF_MAIN_PUSH_LOCK_DIR="$SCRATCH/lock"
export FAFF_MAIN_PUSH_AUTH_DIR="$SCRATCH/auth"
export FAFF_MAIN_PUSH_LOCK_STALE_SEC=2     # short, so CASE 4 doesn't need to sleep 30 min
export FAFF_MAIN_PUSH_AUTH_TTL_SEC=2       # short, so CASE 6 doesn't need to sleep 30 min
trap 'rm -rf "$SCRATCH"' EXIT

# shellcheck disable=SC1091
source "$ROOT/scripts/lib/main-push-guard.sh"

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

# Two real, distinct commits from THIS repo's own history to authorize
# against — using real SHAs (not made-up hex) so mpg_canonical_sha's
# `git cat-file -e` / `rev-parse --verify` calls exercise the real path.
SHA_A="$(git rev-parse HEAD)"
SHA_B="$(git rev-parse HEAD~3 2>/dev/null || git rev-parse HEAD)"
ZERO=0000000000000000000000000000000000000000   # matches the constant .githooks/pre-push defines internally

# For CASE 8/9's end-to-end hook invocations we need a real, resolvable
# "remote already has this" SHA — NOT $ZERO. Using $ZERO makes the hook treat
# the push as an unscoped/new-branch push (git cat-file -e on the zero SHA
# fails), which flips `touches_watch()` to unconditionally TRUE and launches
# the real watch gate — a full xcodebuild simulator test. That happened once
# already writing this file (it collided with another agent's own watch-gate
# xcodebuild run sharing /tmp/faff-combined-watch-dd) and had to be killed by
# hand. HEAD~1 is a real ancestor of HEAD whose diff touches exactly one file
# and none of it is under the watch-gate's trigger paths — verified below,
# not assumed, since "surely this commit doesn't touch watch files" is exactly
# the kind of assumption Rule 18 exists to catch.
SAFE_REMOTE_SHA="$(git rev-parse HEAD~1 2>/dev/null || git rev-parse HEAD)"
if git diff --name-only "$SAFE_REMOTE_SHA" "$SHA_A" \
     | grep -qE '^(legacy/native/Faff/FaffWatch|native-v2/project\.yml|native-v2/Faff\.xcodeproj/|scripts/watch/|scripts/check-watch\.sh)'; then
  echo "REFUSING to run CASE 8/9: HEAD~1..HEAD unexpectedly touches watch paths." >&2
  echo "  (This would launch a real xcodebuild watch-gate run and risk colliding" >&2
  echo "  with another agent's simulator use — see the comment above this check.)" >&2
  exit 1
fi

echo "── CASE 1 · lock held blocks a second acquire ─────────────────────────────"
mpg_acquire_lock "$SHA_A" "origin" "https://example.invalid/repo.git"
first_acquire=$?
assert "first acquire succeeds" "$([ "$first_acquire" = "0" ] && echo 1 || echo 0)"
if mpg_acquire_lock "$SHA_B" "origin" "https://example.invalid/repo.git" 2>/tmp/faff-mpl-test-blocked.$$; then
  assert "second concurrent acquire is BLOCKED while first holds the lock" 0
else
  held_msg_ok=0
  grep -q "another push-to-main is already validating" /tmp/faff-mpl-test-blocked.$$ && held_msg_ok=1
  assert "second concurrent acquire is BLOCKED while first holds the lock" 1
  assert "block message names the holder, not a bare failure" "$held_msg_ok"
fi
rm -f /tmp/faff-mpl-test-blocked.$$

echo "── CASE 2 · lock released allows the next acquire ──────────────────────────"
mpg_release_lock
if mpg_acquire_lock "$SHA_B" "origin" "https://example.invalid/repo.git"; then
  assert "acquire succeeds immediately after release" 1
else
  assert "acquire succeeds immediately after release" 0
fi
mpg_release_lock

echo "── CASE 3 · a REAL two-process race: exactly one of two concurrent acquires wins ──"
rm -rf "$FAFF_MAIN_PUSH_LOCK_DIR"
(
  # shellcheck disable=SC1091
  source "$ROOT/scripts/lib/main-push-guard.sh"
  if mpg_acquire_lock "race-a" "" ""; then echo won > "$SCRATCH/race-a.result"; else echo lost > "$SCRATCH/race-a.result"; fi
) &
PID_A=$!
(
  # shellcheck disable=SC1091
  source "$ROOT/scripts/lib/main-push-guard.sh"
  if mpg_acquire_lock "race-b" "" ""; then echo won > "$SCRATCH/race-b.result"; else echo lost > "$SCRATCH/race-b.result"; fi
) &
PID_B=$!
wait "$PID_A" "$PID_B"
winners=$(cat "$SCRATCH/race-a.result" "$SCRATCH/race-b.result" 2>/dev/null | grep -c '^won$')
assert "exactly one of two truly concurrent acquires wins (got $winners)" "$([ "$winners" = "1" ] && echo 1 || echo 0)"
mpg_release_lock

echo "── CASE 4 · a stale lock (older than the ceiling) is detected and cleared ──"
mpg_acquire_lock "$SHA_A" "origin" "https://example.invalid/repo.git" >/dev/null
sleep 3   # > FAFF_MAIN_PUSH_LOCK_STALE_SEC=2
if mpg_acquire_lock "$SHA_B" "origin" "https://example.invalid/repo.git" 2>/tmp/faff-mpl-test-stale.$$; then
  grep -q "stale lock" /tmp/faff-mpl-test-stale.$$
  assert "stale lock is auto-cleared and the next acquire succeeds" 1
else
  assert "stale lock is auto-cleared and the next acquire succeeds" 0
fi
rm -f /tmp/faff-mpl-test-stale.$$
mpg_release_lock

echo "── CASE 5 · authorization is required, bound to the exact SHA, single-use ──"
if mpg_check_authorization "$SHA_A" 2>/dev/null; then
  assert "unauthorized SHA is rejected" 0
else
  assert "unauthorized SHA is rejected" 1
fi
mpg_authorize "$SHA_A" "test: falsifying the gate" >/dev/null
if mpg_check_authorization "$SHA_A"; then
  assert "authorized SHA passes check" 1
else
  assert "authorized SHA passes check" 0
fi
if mpg_check_authorization "$SHA_B" 2>/dev/null; then
  assert "authorization for SHA_A does NOT cover a different SHA_B" 0
else
  assert "authorization for SHA_A does NOT cover a different SHA_B" 1
fi
mpg_consume_authorization "$SHA_A" >/dev/null
if mpg_check_authorization "$SHA_A" 2>/dev/null; then
  assert "authorization is SINGLE-USE (consumed once, gone after)" 0
else
  assert "authorization is SINGLE-USE (consumed once, gone after)" 1
fi

echo "── CASE 6 · an expired authorization is rejected ────────────────────────────"
mpg_authorize "$SHA_A" "test: TTL expiry" >/dev/null
sleep 3   # > FAFF_MAIN_PUSH_AUTH_TTL_SEC=2
if mpg_check_authorization "$SHA_A" 2>/dev/null; then
  assert "expired authorization is rejected" 0
else
  assert "expired authorization is rejected" 1
fi

echo "── CASE 7 · authorize refuses a SHA that does not resolve in this repo ─────"
if mpg_authorize "0000000000000000000000000000000000dead" "test: bogus sha" 2>/dev/null; then
  assert "authorize refuses an unresolvable SHA" 0
else
  assert "authorize refuses an unresolvable SHA" 1
fi

echo ""
echo "── CASE 8 · end-to-end: the REAL .githooks/pre-push blocks an unauthorized push to main ──"
rm -rf "$FAFF_MAIN_PUSH_LOCK_DIR" "$FAFF_MAIN_PUSH_AUTH_DIR"
hook_out="$SCRATCH/hook-blocked.out"
printf 'refs/heads/some-local-branch %s refs/heads/main %s\n' "$SHA_A" "$SAFE_REMOTE_SHA" \
  | FAFF_WATCH_FAST=1 bash "$ROOT/.githooks/pre-push" origin "https://example.invalid/repo.git" \
  > "$hook_out" 2>&1
hook_rc=$?
grep -q "REFUSED: no valid authorization" "$hook_out"
refused_msg=$?
assert "real pre-push hook exits non-zero for an unauthorized main push" "$([ "$hook_rc" != "0" ] && echo 1 || echo 0)"
assert "real pre-push hook names the refusal reason" "$([ "$refused_msg" = "0" ] && echo 1 || echo 0)"
assert "real pre-push hook releases the lock on refusal (no dir left behind)" "$([ ! -d "$FAFF_MAIN_PUSH_LOCK_DIR" ] && echo 1 || echo 0)"

echo ""
echo "── CASE 9 · end-to-end: authorized + FAFF_SKIP_BUILD path reaches success ──"
rm -rf "$FAFF_MAIN_PUSH_LOCK_DIR" "$FAFF_MAIN_PUSH_AUTH_DIR"
bash "$ROOT/scripts/main-push-lock.sh" authorize "$SHA_A" "test: case 9 end-to-end" >/dev/null
hook_out2="$SCRATCH/hook-authorized.out"
printf 'refs/heads/some-local-branch %s refs/heads/main %s\n' "$SHA_A" "$SAFE_REMOTE_SHA" \
  | FAFF_SKIP_BUILD=1 FAFF_WATCH_FAST=1 bash "$ROOT/.githooks/pre-push" origin "https://example.invalid/repo.git" \
  > "$hook_out2" 2>&1
hook_rc2=$?
assert "real pre-push hook exits 0 once authorized (build gate no-ops: no node_modules here)" "$([ "$hook_rc2" = "0" ] && echo 1 || echo 0)"
assert "authorization is consumed after the successful run" "$([ ! -f "$FAFF_MAIN_PUSH_AUTH_DIR/$SHA_A" ] && echo 1 || echo 0)"
assert "lock is released after the successful run" "$([ ! -d "$FAFF_MAIN_PUSH_LOCK_DIR" ] && echo 1 || echo 0)"
# Re-running the SAME push again must now be refused — the authorization was
# single-use, so a naive "it passed once, so it always passes" reading is wrong.
hook_out3="$SCRATCH/hook-replay.out"
printf 'refs/heads/some-local-branch %s refs/heads/main %s\n' "$SHA_A" "$SAFE_REMOTE_SHA" \
  | FAFF_SKIP_BUILD=1 FAFF_WATCH_FAST=1 bash "$ROOT/.githooks/pre-push" origin "https://example.invalid/repo.git" \
  > "$hook_out3" 2>&1
hook_rc3=$?
assert "REPLAYING the same push after success is refused (no reuse of a burned authorization)" "$([ "$hook_rc3" != "0" ] && echo 1 || echo 0)"

echo ""
echo "─────────────────────────────────────────────────────────────────────────"
TOTAL=$((PASS + FAIL))
if [ "$TOTAL" = "0" ]; then
  echo "UNRUNNABLE — zero assertions executed. This is the worst outcome (Rule 18)."
  exit 3
fi
echo "MAIN-PUSH-LOCK-GATE: $PASS/$TOTAL passed"
[ "$FAIL" = "0" ] && exit 0 || exit 1
