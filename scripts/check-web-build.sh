#!/usr/bin/env bash
#
# Pre-push sanity check: prove web-v2 BUILDS before anything touches Railway.
#
# ── WHY THIS GREW A SECOND HALF (2026-08-30) ────────────────────────────────
#
# This script used to run `npx tsc --noEmit` and stop there. On 2026-08-30
# `main` failed to deploy for a full day — five merged commits, a marathon
# block's worth of engine fixes among them, never live — because a `'use
# client'` component imported a module that reached `lib/db/pool` three hops
# down, webpack pulled `pg` into the browser graph, and `next build` died on
# fs/dns/net/tls.
#
# `tsc --noEmit` passed. All twelve prebuild gates passed. Every one of them
# runs BEFORE `next build`, and none of them is a build. The gate chain
# verified everything except whether the thing builds, so the only process
# that could see the break was Railway, hours later, in a place nobody watches.
#
# `check-client-graph.sh` now closes that specific hole in prebuild. This
# closes the CLASS: prerender failures, invalid route segment config, a bad
# `metadata` export, a server-only API at client module scope — anything that
# is a build error and not a type error.
#
# ── WHY HERE AND NOT IN prebuild ────────────────────────────────────────────
#
# Putting `next build` in `prebuild` is circular: prebuild runs on Railway
# immediately before the build Railway is already about to run. It would
# double every deploy's build minutes and learn nothing thirty seconds earlier
# than the deploy itself. The gap is not that Railway fails to notice — it is
# that the failure happens AFTER the push, where noticing is somebody's job
# rather than a machine's.
#
# A pre-push hook is the first moment the whole tree exists and the last moment
# before it becomes everyone's problem. It costs the pusher ~30s of their own
# CPU (measured: 30s warm against a populated .next cache, this repo, 2026-08-30)
# and zero Railway minutes.
#
# ── HOW THIS IS INVOKED (checked, not assumed) ──────────────────────────────
#
# `core.hooksPath` is set to `.githooks`, so the ACTIVE hook is the versioned
# dispatcher `.githooks/pre-push`, which calls this script by path on every
# push. Edits here therefore take effect immediately, with no re-linking.
#
# The older `.git/hooks/pre-push` symlink still exists and points here too, but
# it is inert while `core.hooksPath` is set. An earlier draft of this header
# said the hook was a stale byte copy needing `ln -sf`. That was wrong — it was
# written from reading `.git/hooks/` without checking `core.hooksPath` first,
# which is the same mistake as trusting `lthr-reanchor.ts`'s purity claim.
# Verified by observation: the build step below ran on the push of 49035f0b.
#
# On a fresh clone the dispatcher needs activating once:
#   git config core.hooksPath .githooks
#
# To skip in emergencies:
#   git push --no-verify              # skip the hook entirely
#   FAFF_SKIP_BUILD=1 git push        # typecheck only, no build
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
  echo "→ web-v2/node_modules missing — skipping pre-push checks (run 'cd web-v2 && npm install' to enable)"
  exit 0
fi

cd "$WEB"

# ── 1 · types ───────────────────────────────────────────────────────────────
# First because it is faster and its errors point at a line. A type error found
# here saves waiting for webpack to reach the same file.
echo "→ Typechecking web-v2 before push (catches missing imports / unstaged files)…"
if ! npx tsc --noEmit; then
  echo ""
  echo "✗ Web typecheck FAILED. Push aborted."
  echo "  Fix the errors above, or override with: git push --no-verify"
  echo "  (every Railway deploy will fail if you push as-is.)"
  exit 1
fi
echo "✓ Web typecheck clean."

# ── 2 · the build itself ────────────────────────────────────────────────────
if [ "${FAFF_SKIP_BUILD:-0}" = "1" ]; then
  echo "→ FAFF_SKIP_BUILD=1 — skipping the build."
  echo "  NOTE: tsc passing is NOT evidence that Railway will deploy. That is"
  echo "  exactly the gap that cost a full day on 2026-08-30."
  exit 0
fi

echo "→ Building web-v2 (~30s warm) — the only check that sees what Railway sees…"
if ! npx next build; then
  echo ""
  echo "✗ next build FAILED. Push aborted."
  echo ""
  echo "  This is the check that did not exist on 2026-08-30, when main sat"
  echo "  undeployed for a day with tsc and twelve gates all reporting green."
  echo "  If the error names fs / dns / net / tls, a client component is"
  echo "  reaching the database: run 'npm run test:clientgraph' for the path."
  echo ""
  echo "  Override with: git push --no-verify   (prod WILL fail to deploy)"
  exit 1
fi
echo "✓ next build green. Railway is building the same tree."
