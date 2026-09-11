#!/usr/bin/env bash
# scripts/lib/main-push-guard.sh · machine-wide push-to-main lock + authorization
# ─────────────────────────────────────────────────────────────────────────────
#
# WHY THIS EXISTS (2026-09-11)
#
# One agent self-merged and pushed to production while its own review was
# still in progress. Nothing on the machine made that structurally hard — the
# only automated gate on a push (`.githooks/pre-push`) checks that the CODE
# builds, never who authorized shipping it, and dozens of worktrees on this
# machine can all run `git push origin main` at once with no coordination
# between them at all (see `git worktree list` — 100+ concurrent checkouts is
# routine here, not a hypothetical).
#
# This library is sourced by `.githooks/pre-push` (the enforcement point —
# see that file's Section 0) and by `scripts/main-push-lock.sh` (the CLI a
# human/agent uses to inspect state and to grant authorization explicitly).
# It does two independent jobs and both are required, not either/or:
#
#   1. SERIALIZE.   An mkdir-atomic mutex (same idiom as
#      `scripts/ship-testflight-v2.sh`'s `LOCK_DIR`, which fixed a real binary-
#      swap race between two concurrent TestFlight shippers). Only one process
#      on the machine may be validating+pushing to main at a time. The lock is
#      MACHINE-WIDE (a fixed /tmp path, not `$ROOT`-relative), because the
#      failure mode is two DIFFERENT worktrees racing, and a worktree-relative
#      lock would only ever exclude a pusher from itself — the exact defect
#      SHIPRACE-1 names in the ship script's own header.
#
#   2. AUTHORIZE.   A push to main additionally requires a standing
#      authorization record bound to the EXACT commit SHA being pushed,
#      single-use, and short-lived (default 30 min). The record can only be
#      created by a separate, explicit, out-of-band invocation
#      (`scripts/main-push-lock.sh authorize <sha> "<reason>"`) — never by the
#      push itself. This is the part that makes an UNAUTHORIZED push
#      structurally harder, not merely serialized: two agents racing to push
#      an authorized commit are serialized by (1); an agent that never had
#      authorization is blocked by (2) regardless of contention.
#
# WHAT THIS DOES NOT CLAIM TO DO (Rule 22 — say what a gate cannot fail on)
#
#   · It cannot stop `git push --no-verify` — that already bypasses the whole
#     hook, is already documented at the top of `.githooks/pre-push` as the
#     named emergency escape hatch, and already carries a disclosure
#     obligation. This library does not duplicate that policy; it makes the
#     NORMAL path (hook runs) require authorization, same as the hook's other
#     checks can be walked around the same one way.
#   · It cannot verify that "David said yes" was a real conversation — a
#     human's authorization is a fact about a chat transcript, not something a
#     shell script can observe. What it CAN enforce is that authorizing is a
#     separate, explicit, auditable action bound to one exact commit with a
#     short expiry — categorically harder to do by accident than
#     `git push origin main`, and it leaves a record (who/when/why) that a bare
#     push does not.
#   · It does not protect against the final network race at the git-protocol
#     level. It doesn't need to: git's own ref update on the remote is an
#     atomic compare-and-swap (GitHub rejects a non-fast-forward push
#     outright), so the very last millisecond of a two-writer race was already
#     safe. This lock's job is the window BEFORE that — the human-meaningful
#     "an integration is in flight" period, which on this repo includes a
#     30-120s typecheck/build/watch-gate run that two concurrent pushers would
#     otherwise both burn CPU on at once, and during which a second pusher
#     could otherwise start reviewing a tree that is about to change under it.
#
# ENV OVERRIDES (all machine-wide by default; override per-invocation for
# testing so a self-test never touches the real lock/authorization state —
# same idiom as check-watch.sh's WATCH_GATE_LOG):
#
#   FAFF_MAIN_PUSH_LOCK_DIR       default /tmp/.faff.main-push.lock
#   FAFF_MAIN_PUSH_AUTH_DIR       default /tmp/.faff.main-push.authorized
#   FAFF_MAIN_PUSH_LOCK_STALE_SEC default 1800 (30 min) — a lock older than
#                                 this is assumed to be a crashed holder and is
#                                 cleared automatically (with a loud warning),
#                                 not left to jam the machine forever.
#   FAFF_MAIN_PUSH_AUTH_TTL_SEC   default 1800 (30 min) — how long a granted
#                                 authorization remains valid before it must be
#                                 re-granted.
#   AGENT_ID                     identity recorded in lock/auth metadata;
#                                 falls back to `whoami@hostname` (same
#                                 convention as ship-testflight-v2.sh).
#
# This file only defines functions — sourcing it has no side effects beyond
# that (no directories are created, no locks are touched) until one of the
# mpg_* functions below is actually called.
# ─────────────────────────────────────────────────────────────────────────────

mpg_lock_dir()  { printf '%s' "${FAFF_MAIN_PUSH_LOCK_DIR:-/tmp/.faff.main-push.lock}"; }
mpg_auth_dir()  { printf '%s' "${FAFF_MAIN_PUSH_AUTH_DIR:-/tmp/.faff.main-push.authorized}"; }
mpg_lock_stale_sec() { printf '%s' "${FAFF_MAIN_PUSH_LOCK_STALE_SEC:-1800}"; }
mpg_auth_ttl_sec()   { printf '%s' "${FAFF_MAIN_PUSH_AUTH_TTL_SEC:-1800}"; }
mpg_agent_id() { printf '%s' "${AGENT_ID:-$(whoami)@$(hostname -s 2>/dev/null || hostname)}"; }
mpg_now_iso()   { date -u +%Y-%m-%dT%H:%M:%SZ; }
mpg_now_epoch() { date +%s; }

# Portable ISO8601(Z) -> epoch, matching the pattern already proven in
# ship-testflight-v2.sh's acquire_lock. Prints 0 (never "stale-immune") on any
# parse failure so a corrupt timestamp reads as "ancient", not as "fresh" —
# the safe direction for a staleness check to fail in.
mpg_iso_to_epoch() {
  local iso="$1" stripped
  stripped="${iso%%Z}"
  date -j -f "%Y-%m-%dT%H:%M:%S%z" "${stripped}+0000" "+%s" 2>/dev/null || printf '0'
}

# Is a git ref valid in this repo? (used to reject authorizing/checking a SHA
# that does not exist rather than silently writing/reading garbage)
mpg_sha_exists() {
  git cat-file -e "$1" 2>/dev/null
}

mpg_canonical_sha() {
  git rev-parse --verify "$1^{commit}" 2>/dev/null
}

# ── Lock ─────────────────────────────────────────────────────────────────────
#
# mkdir is POSIX-atomic: exactly one caller's mkdir succeeds when several race
# it at once, so this needs no separate compare-and-swap step. Fails FAST
# (does not block/poll) on contention, matching the ship lock's idiom — a
# blocking lock here would mean N agents all sitting in the pre-push hook at
# once, which is worse than one clear "try again shortly" message.
#
# Returns 0 and leaves $(mpg_lock_dir)/meta written on success.
# Returns 1 on contention, having printed who holds it and since when.
mpg_acquire_lock() {
  local sha="${1:-}" remote_name="${2:-}" remote_url="${3:-}"
  local dir; dir="$(mpg_lock_dir)"

  if mkdir "$dir" 2>/dev/null; then
    : # acquired clean
  else
    if [ -f "$dir/meta" ]; then
      local held_at agent_id age
      held_at="$(awk -F= '/^held_at=/{print $2}' "$dir/meta" 2>/dev/null)"
      agent_id="$(awk -F= '/^agent_id=/{print $2}' "$dir/meta" 2>/dev/null)"
      age=$(( $(mpg_now_epoch) - $(mpg_iso_to_epoch "$held_at") ))
      if [ "$age" -gt "$(mpg_lock_stale_sec)" ] && [ "$age" -lt 99999999 ]; then
        echo "→ main-push lock: stale lock from $agent_id (held $((age/60)) min ago) — clearing" >&2
        rm -rf "$dir"
        mkdir "$dir" 2>/dev/null || { echo "main-push lock: failed to re-acquire after clearing stale lock" >&2; return 1; }
      else
        {
          echo "ERROR: another push-to-main is already validating or in flight."
          echo "  Lock held since: ${held_at:-unknown}"
          echo "  Held by:         ${agent_id:-unknown}"
          echo "  Worktree:        $(awk -F= '/^worktree=/{print $2}' "$dir/meta" 2>/dev/null)"
          echo "  Metadata:        $dir/meta"
          echo ""
          echo "  This is expected under normal concurrent-agent operation — retry"
          echo "  once that push finishes. If you are SURE it crashed (lock older"
          echo "  than $(( $(mpg_lock_stale_sec) / 60 )) min is auto-cleared; younger than that"
          echo "  needs a human call): scripts/main-push-lock.sh clear-lock --force"
        } >&2
        return 1
      fi
    else
      echo "ERROR: $dir exists but has no metadata file — needs manual cleanup (rm -rf $dir)." >&2
      return 1
    fi
  fi

  {
    echo "held_at=$(mpg_now_iso)"
    echo "agent_id=$(mpg_agent_id)"
    echo "pid=$$"
    echo "sha=$sha"
    echo "remote=$remote_name"
    echo "remote_url=$remote_url"
    echo "worktree=$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    echo "branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  } > "$dir/meta"
  return 0
}

mpg_release_lock() {
  rm -rf "$(mpg_lock_dir)" 2>/dev/null || true
}

# Installs a trap in the CALLER's shell (this must be `source`d, not run in a
# subshell, for the trap to attach to the right process) that releases the
# lock on every exit path — success, failure, or a killed hook. Combined with
# the staleness ceiling above, a process that dies WITHOUT running its trap
# (SIGKILL, a crashed simulator taking the shell with it) still self-heals
# after the ceiling instead of jamming every future push permanently.
mpg_install_release_trap() {
  trap 'mpg_release_lock' EXIT INT TERM
}

mpg_lock_status() {
  local dir; dir="$(mpg_lock_dir)"
  if [ ! -d "$dir" ]; then
    echo "lock: free"
    return 0
  fi
  if [ ! -f "$dir/meta" ]; then
    echo "lock: HELD (no metadata — likely corrupt; consider clear-lock --force)"
    return 0
  fi
  local held_at agent_id age
  held_at="$(awk -F= '/^held_at=/{print $2}' "$dir/meta")"
  agent_id="$(awk -F= '/^agent_id=/{print $2}' "$dir/meta")"
  age=$(( $(mpg_now_epoch) - $(mpg_iso_to_epoch "$held_at") ))
  echo "lock: HELD by $agent_id since $held_at (${age}s ago)"
  sed 's/^/  /' "$dir/meta"
}

# ── Authorization ────────────────────────────────────────────────────────────
#
# One file per authorized SHA under $(mpg_auth_dir)/<sha>. The filename IS the
# scope: an authorization for commit A can never be read as covering commit B,
# so there is no separate "which commit does this cover" field to get wrong.

mpg_authorize() {
  local sha="$1" reason="$2"
  if [ -z "$sha" ] || [ -z "$reason" ]; then
    echo "authorize: requires <sha> and a non-empty <reason>" >&2
    return 2
  fi
  local full_sha; full_sha="$(mpg_canonical_sha "$sha")"
  if [ -z "$full_sha" ]; then
    echo "authorize: '$sha' does not resolve to a commit in this repo" >&2
    return 2
  fi
  local dir; dir="$(mpg_auth_dir)"
  mkdir -p "$dir"
  local now expires
  now="$(mpg_now_epoch)"
  expires=$(( now + $(mpg_auth_ttl_sec) ))
  {
    echo "sha=$full_sha"
    echo "authorized_at=$(mpg_now_iso)"
    echo "authorized_by=$(mpg_agent_id)"
    echo "expires_at_epoch=$expires"
    echo "reason=$reason"
  } > "$dir/$full_sha"
  echo "→ authorized push of $full_sha to main (expires in $(( $(mpg_auth_ttl_sec) / 60 )) min, single-use)"
  echo "  recorded by: $(mpg_agent_id)"
  return 0
}

# Non-destructive: does a VALID (unexpired) authorization exist for this SHA?
# Prints why not, to stderr, on failure — "missing" and "expired" are
# different facts (Rule 11) and the caller-facing message should say which.
mpg_check_authorization() {
  local sha="$1" full_sha file now expires reason authorized_by
  full_sha="$(mpg_canonical_sha "$sha")"
  [ -z "$full_sha" ] && full_sha="$sha"
  file="$(mpg_auth_dir)/$full_sha"
  if [ ! -f "$file" ]; then
    echo "no authorization on file for $full_sha" >&2
    return 1
  fi
  expires="$(awk -F= '/^expires_at_epoch=/{print $2}' "$file")"
  now="$(mpg_now_epoch)"
  if [ -z "$expires" ] || [ "$now" -gt "$expires" ]; then
    reason="$(awk -F= '/^reason=/{print $2}' "$file")"
    authorized_by="$(awk -F= '/^authorized_by=/{print $2}' "$file")"
    echo "authorization for $full_sha EXPIRED (granted by $authorized_by: \"$reason\")" >&2
    return 1
  fi
  return 0
}

# Destructive: validate + consume (single-use). Prints the audit line on
# success. Call this only once the caller is certain the push will actually
# proceed — burning it on a build failure just means re-authorizing a retry,
# which is the intended, safer-by-default tradeoff (never let a stale
# "already checked once" fact silently cover a second, later push).
mpg_consume_authorization() {
  local sha="$1" full_sha file
  full_sha="$(mpg_canonical_sha "$sha")"
  [ -z "$full_sha" ] && full_sha="$sha"
  file="$(mpg_auth_dir)/$full_sha"
  if ! mpg_check_authorization "$full_sha"; then
    return 1
  fi
  local authorized_by reason authorized_at
  authorized_by="$(awk -F= '/^authorized_by=/{print $2}' "$file")"
  reason="$(awk -F= '/^reason=/{print $2}' "$file")"
  authorized_at="$(awk -F= '/^authorized_at=/{print $2}' "$file")"
  rm -f "$file"
  echo "→ consumed authorization for $full_sha (granted $authorized_at by $authorized_by: \"$reason\")"
  return 0
}

mpg_auth_status() {
  local dir; dir="$(mpg_auth_dir)"
  if [ ! -d "$dir" ] || [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
    echo "authorizations: none pending"
    return 0
  fi
  echo "authorizations pending:"
  local f now expires remaining
  now="$(mpg_now_epoch)"
  for f in "$dir"/*; do
    [ -f "$f" ] || continue
    expires="$(awk -F= '/^expires_at_epoch=/{print $2}' "$f")"
    remaining=$(( expires - now ))
    printf '  %s  (%s)\n' "$(basename "$f")" "$([ "$remaining" -gt 0 ] && echo "expires in ${remaining}s" || echo "EXPIRED $(( -remaining ))s ago")"
    sed 's/^/    /' "$f"
  done
}
