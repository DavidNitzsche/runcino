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
echo "── CASE 10 · end-to-end: DELETING refs/heads/main is gated the same as a content push ──"
# The independent review's Defect 1: the stdin loop's `[ "$lsha" = "$ZERO" ] &&
# continue` (a branch deletion) used to run BEFORE the `refs/heads/main` check,
# so MAIN_PUSH_SHAS never got populated for a deletion and Section 0 never ran
# at all — `git push origin :main` sailed through with zero authorization on
# file. Reproduced live against a real scratch bare repo before this fix
# existed: the deletion succeeded outright, stopped only by the remote's own
# unrelated `receive.denyDeleteCurrent` default. This simulates the exact
# stdin git feeds a pre-push hook for `git push origin :main` — local ref
# literally `(delete)` (confirmed against a real git invocation, not assumed),
# local sha ZERO, remote ref refs/heads/main, remote sha whatever main
# currently is — with ZERO authorization on file, same as the reviewer's run.
rm -rf "$FAFF_MAIN_PUSH_LOCK_DIR" "$FAFF_MAIN_PUSH_AUTH_DIR"
hook_out4="$SCRATCH/hook-main-deletion.out"
printf '(delete) %s refs/heads/main %s\n' "$ZERO" "$SAFE_REMOTE_SHA" \
  | FAFF_WATCH_FAST=1 bash "$ROOT/.githooks/pre-push" origin "https://example.invalid/repo.git" \
  > "$hook_out4" 2>&1
hook_rc4=$?
assert "deleting main with ZERO authorization on file is REFUSED (not silently allowed)" "$([ "$hook_rc4" != "0" ] && echo 1 || echo 0)"
grep -q "REFUSED: no valid authorization for $ZERO" "$hook_out4"
del_msg_ok=$?
assert "refusal names the all-zero sha — proving Section 0 actually evaluated the deletion, not that it errored some other way" "$([ "$del_msg_ok" = "0" ] && echo 1 || echo 0)"
assert "lock is released after the refused deletion (no dir left behind)" "$([ ! -d "$FAFF_MAIN_PUSH_LOCK_DIR" ] && echo 1 || echo 0)"
# NOTE on a negative control this deliberately does NOT add: a deletion of a
# branch OTHER than main (rref != refs/heads/main) never populates
# MAIN_PUSH_SHAS, exactly like any other non-main push — that half of the
# matcher is unchanged by this fix (it was never the bug) and isn't
# re-asserted here. It is deliberately NOT exercised end-to-end via the real
# hook: ANY deletion (lsha == $ZERO) makes `scoped` fall to 0 by the same
# "no stdin at all" fallback that handles manual invocation, which flips
# `touches_watch()` unconditionally true and launches the REAL watch gate
# (xcodebuild + simulator) — exactly the trap CASE 8/9's own comment above
# warns about, and confirmed by hitting it while writing this case (a run
# that should take under a second instead ran the full watch suite and
# either hung or intermittently failed on simulator contention with other
# agents). The deletion-of-main case above never reaches that code at all —
# Section 0 refuses and exits before check-web-build.sh or touches_watch()
# ever run — which is why it stays fast and deterministic while a same-shape
# non-main test would not. Fixing the underlying "any deletion looks
# unscoped" behavior is a separate, pre-existing quirk unrelated to the
# authorization bypass this file exists to gate, and is out of scope here.

echo ""
echo "── CASE 11 · mpg_check_authorization fails CLOSED on a corrupted expires_at_epoch ──"
# The independent review's Defect 2a: `[ "$now" -gt "$expires" ]` on a
# non-numeric `$expires` throws "integer expression expected" and `[` returns
# a non-zero USAGE-ERROR status — which the old `[ -z "$expires" ] || [ "$now"
# -gt "$expires" ]` read as "not expired" (the `||` chain went false, so the
# function fell through to `return 0`). A HAND-CORRUPTED file — never written
# by the real `mpg_authorize` — must be rejected, not accepted, and the
# rejection must be reported as CORRUPT specifically (Rule 11: a corrupted
# record and a valid one are different facts, not both "authorized").
mpg_authorize "$SHA_A" "test: case 11 baseline, will be corrupted by hand" >/dev/null
corrupt_file="$(mpg_auth_dir)/$(mpg_canonical_sha "$SHA_A")"
sed -i.bak 's/^expires_at_epoch=.*/expires_at_epoch=NOT_A_NUMBER/' "$corrupt_file" && rm -f "$corrupt_file.bak"
corrupt_check_out="$SCRATCH/corrupt-check.out"
if mpg_check_authorization "$SHA_A" >/dev/null 2>"$corrupt_check_out"; then
  assert "a HAND-CORRUPTED expires_at_epoch is rejected, not accepted as valid" 0
else
  assert "a HAND-CORRUPTED expires_at_epoch is rejected, not accepted as valid" 1
  grep -qi "CORRUPT" "$corrupt_check_out"
  assert "  (rejection is reported as CORRUPT, distinct from a normal EXPIRED message)" "$([ "$?" = "0" ] && echo 1 || echo 0)"
fi
mpg_release_lock 2>/dev/null; rm -f "$corrupt_file"
# Same corruption, exercised through the REAL end-to-end hook this time —
# proves the fix reaches the actual enforcement point, not just the library
# function in isolation.
rm -rf "$FAFF_MAIN_PUSH_LOCK_DIR" "$FAFF_MAIN_PUSH_AUTH_DIR"
mkdir -p "$FAFF_MAIN_PUSH_AUTH_DIR"
canon_a="$(mpg_canonical_sha "$SHA_A")"
{
  echo "sha=$canon_a"
  echo "authorized_at=2020-01-01T00:00:00Z"
  echo "authorized_by=nobody@nowhere"
  echo "expires_at_epoch=GARBAGE"
  echo "reason=hand-planted corrupt record, never produced by mpg_authorize"
} > "$FAFF_MAIN_PUSH_AUTH_DIR/$canon_a"
hook_out6="$SCRATCH/hook-corrupt-auth.out"
printf 'refs/heads/some-local-branch %s refs/heads/main %s\n' "$SHA_A" "$SAFE_REMOTE_SHA" \
  | FAFF_WATCH_FAST=1 bash "$ROOT/.githooks/pre-push" origin "https://example.invalid/repo.git" \
  > "$hook_out6" 2>&1
hook_rc6=$?
assert "end-to-end: a push authorized ONLY by a hand-corrupted record is REFUSED" "$([ "$hook_rc6" != "0" ] && echo 1 || echo 0)"
rm -rf "$FAFF_MAIN_PUSH_LOCK_DIR" "$FAFF_MAIN_PUSH_AUTH_DIR"

echo ""
echo "── CASE 12 · mpg_authorize's write is ATOMIC under concurrent writers ──────"
# The independent review's Defect 2b: the old `{ ... } > "$dir/$full_sha"` was
# several separate `echo` writes to one fd — a real two-process race (two
# concurrent `authorize` calls for the same SHA, plausible exactly when two
# people/agents both try to sign off on the same commit) produced an
# interleaved/corrupted file in 5 of 30 trials in the reviewer's run. The fix
# writes to a per-call `mktemp` file and `mv`s it into place — rename(2) is a
# single atomic syscall, so a reader can only ever see a complete prior
# version or a complete new one. This races FIVE real concurrent processes
# (not a loop of sequential calls) against the SAME sha and asserts the
# result is ALWAYS a clean, exactly-5-line, fully-parseable record — one
# whole writer's content, never a mix — across multiple trials, and that no
# stray temp file is left behind regardless of which writer wins.
race_corrupt=0
for trial in 1 2 3; do
  rm -rf "$FAFF_MAIN_PUSH_AUTH_DIR"
  mkdir -p "$FAFF_MAIN_PUSH_AUTH_DIR"
  (
    # shellcheck disable=SC1091
    source "$ROOT/scripts/lib/main-push-guard.sh"
    mpg_authorize "$SHA_B" "race writer 1 trial $trial" >/dev/null
  ) &
  (
    # shellcheck disable=SC1091
    source "$ROOT/scripts/lib/main-push-guard.sh"
    mpg_authorize "$SHA_B" "race writer 2 trial $trial, a deliberately much longer reason string so any interleave would be visible in the resulting record's shape or line count" >/dev/null
  ) &
  (
    # shellcheck disable=SC1091
    source "$ROOT/scripts/lib/main-push-guard.sh"
    mpg_authorize "$SHA_B" "race writer 3 trial $trial" >/dev/null
  ) &
  wait
  canon_b="$(mpg_canonical_sha "$SHA_B")"
  result_file="$FAFF_MAIN_PUSH_AUTH_DIR/$canon_b"
  lines="$(wc -l < "$result_file" 2>/dev/null | tr -d ' ')"
  fields_ok=1
  grep -q '^sha=' "$result_file" || fields_ok=0
  grep -q '^authorized_at=' "$result_file" || fields_ok=0
  grep -q '^authorized_by=' "$result_file" || fields_ok=0
  grep -q '^expires_at_epoch=[0-9][0-9]*$' "$result_file" || fields_ok=0
  grep -q '^reason=' "$result_file" || fields_ok=0
  if [ "$lines" != "5" ] || [ "$fields_ok" != "1" ]; then
    race_corrupt=$((race_corrupt + 1))
    echo "  trial $trial: CORRUPT — $lines lines, fields_ok=$fields_ok"
  fi
  leftover="$(find "$FAFF_MAIN_PUSH_AUTH_DIR" -name ".*.??????" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$leftover" != "0" ]; then
    race_corrupt=$((race_corrupt + 1))
    echo "  trial $trial: LEFTOVER TEMP FILE(S) after mv — $leftover found"
  fi
done
assert "3 rounds of 3-way concurrent authorize on the same sha NEVER produce a corrupted or partial record (0/3 corrupt)" "$([ "$race_corrupt" = "0" ] && echo 1 || echo 0)"
rm -rf "$FAFF_MAIN_PUSH_AUTH_DIR"

echo ""
echo "─────────────────────────────────────────────────────────────────────────"
TOTAL=$((PASS + FAIL))
if [ "$TOTAL" = "0" ]; then
  echo "UNRUNNABLE — zero assertions executed. This is the worst outcome (Rule 18)."
  exit 3
fi
echo "MAIN-PUSH-LOCK-GATE: $PASS/$TOTAL passed"
[ "$FAIL" = "0" ] && exit 0 || exit 1
