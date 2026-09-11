#!/usr/bin/env bash
# scripts/main-push-lock.sh · CLI for the machine-wide push-to-main lock
# ─────────────────────────────────────────────────────────────────────────────
# The mechanics live in scripts/lib/main-push-guard.sh — this is the
# human/agent-facing entry point. `.githooks/pre-push` enforces the lock and
# authorization automatically; this script is how you INSPECT state and how
# you GRANT authorization once David has actually given the go-ahead for a
# specific integration. Granting authorization is the one action here that is
# never automatic — nothing calls `authorize` on its own.
#
# Usage:
#   scripts/main-push-lock.sh status
#   scripts/main-push-lock.sh authorize <sha> "<reason — cite the approval>"
#   scripts/main-push-lock.sh check <sha>          # non-destructive peek
#   scripts/main-push-lock.sh clear-lock [--force]
#
# Env overrides (see scripts/lib/main-push-guard.sh header for the full list):
#   FAFF_MAIN_PUSH_LOCK_DIR, FAFF_MAIN_PUSH_AUTH_DIR,
#   FAFF_MAIN_PUSH_LOCK_STALE_SEC, FAFF_MAIN_PUSH_AUTH_TTL_SEC
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))"
# shellcheck disable=SC1091
source "$ROOT/scripts/lib/main-push-guard.sh"

cmd="${1:-}"
shift || true

case "$cmd" in
  status)
    mpg_lock_status
    echo ""
    mpg_auth_status
    ;;

  authorize)
    sha="${1:-}"
    shift || true
    reason="$*"
    if [ -z "$sha" ] || [ -z "$reason" ]; then
      echo "usage: $0 authorize <sha> \"<reason — name who approved and what>\"" >&2
      exit 2
    fi
    mpg_authorize "$sha" "$reason"
    exit $?
    ;;

  check)
    sha="${1:-}"
    if [ -z "$sha" ]; then
      echo "usage: $0 check <sha>" >&2
      exit 2
    fi
    if mpg_check_authorization "$sha"; then
      echo "→ $sha IS currently authorized to push to main."
      exit 0
    else
      echo "→ $sha is NOT currently authorized to push to main."
      exit 1
    fi
    ;;

  clear-lock)
    force=0
    [ "${1:-}" = "--force" ] && force=1
    dir="$(mpg_lock_dir)"
    if [ ! -d "$dir" ]; then
      echo "lock already free."
      exit 0
    fi
    if [ "$force" = "1" ]; then
      echo "→ force-clearing lock (bypassing staleness check):"
      mpg_lock_status
      mpg_release_lock
      echo "→ cleared."
      exit 0
    fi
    # Non-forced: only clear if actually stale, by asking acquire to do the
    # staleness math for us (it will re-acquire and hold the lock — release it
    # again immediately since this is a "clear" not a "hold" operation).
    if mpg_acquire_lock "manual-clear" "" "" >/tmp/.faff.main-push.clear-check.$$ 2>&1; then
      grep -q "stale lock" /tmp/.faff.main-push.clear-check.$$ && echo "→ stale lock cleared." || echo "→ lock was already free; nothing to do."
      mpg_release_lock
      rm -f /tmp/.faff.main-push.clear-check.$$
      exit 0
    else
      cat /tmp/.faff.main-push.clear-check.$$ >&2
      rm -f /tmp/.faff.main-push.clear-check.$$
      echo "" >&2
      echo "Lock is NOT stale — refusing to clear a live lock without --force." >&2
      exit 1
    fi
    ;;

  *)
    sed -n '2,20p' "$0"
    exit 2
    ;;
esac
