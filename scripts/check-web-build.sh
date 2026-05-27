#!/usr/bin/env bash
#
# Pre-push sanity check: typecheck the web/ workspace before anything
# touches Railway. Catches the class of bug that broke ~16 consecutive
# deploys (an imported file that exists locally but was never staged →
# "module not found" on the Railway build).
#
# Runs `npx tsc --noEmit` against web/. tsc resolves imports at compile
# time, so any reference to a missing file or unexported symbol fails
# loud here — exit 1 → git push aborts.
#
# To wire as a git hook:
#   ln -sf ../../scripts/check-web-build.sh .git/hooks/pre-push
#
# To skip in emergencies:
#   git push --no-verify
#
# To run manually:
#   bash scripts/check-web-build.sh

set -euo pipefail

# Resolve repo root. When invoked via .git/hooks/pre-push, $0 is inside
# .git/hooks/ and `dirname $0/..` lands on .git — NOT the repo root, so
# $ROOT/web-v2 silently misses and the hook skips on every push. Use
# `git rev-parse --show-toplevel` (the only reliable way from a hook) and
# fall back to dirname math only for manual invocation outside a repo.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))"
WEB="$ROOT/web-v2"

if [ ! -d "$WEB/node_modules" ]; then
  echo "→ web-v2/node_modules missing — skipping pre-push typecheck (run 'cd web-v2 && npm install' to enable)"
  exit 0
fi

echo "→ Typechecking web/ before push (catches missing imports / unstaged files)…"
cd "$WEB"

if ! npx tsc --noEmit; then
  echo ""
  echo "✗ Web typecheck FAILED. Push aborted."
  echo "  Fix the errors above, or override with: git push --no-verify"
  echo "  (every Railway deploy will fail if you push as-is.)"
  exit 1
fi

echo "✓ Web typecheck clean."
