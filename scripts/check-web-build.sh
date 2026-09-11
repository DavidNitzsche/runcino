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
#
# ── WHY MISSING node_modules NOW REFUSES INSTEAD OF SKIPPING (2026-09-11) ───
#
# Until this date, a missing `web-v2/node_modules` made this whole script
# `exit 0` with a one-line notice. That is Rule 18's exact failure shape: a
# push from a worktree that had never run `npm install` passed this hook with
# ZERO checks executed, and the push's own output looked identical to a push
# that was actually typechecked and built — nothing distinguished "verified"
# from "the gate quietly declined to look." `b018980c1` on
# `fix/recovery-honesty-strides-grading` went through this exact hole.
#
# The fix REFUSES the push instead of auto-running `npm install` here. Two
# reasons, not one:
#
#   1. This is explicitly a SHARED checkout (see the block at the top of
#      `.githooks/pre-push`) — multiple agents hold uncommitted work in it and
#      push from it concurrently. `npm install` is not safe under a second,
#      concurrent `npm install` writing into the SAME `node_modules`: npm does
#      not lock the tree against another npm process the way it locks against
#      itself mid-command, so two installs racing on one directory can each
#      observe the other's half-written `.package-lock.json` staging state or
#      partially-extracted package, which is precisely the shared-mutable-
#      state race class CLAUDE.md Rule 6 and Rule 9's CASE 3 already document
#      in this repo (multi-writer jsonb columns, concurrent lock-file writers)
#      — same shape, different resource. A pre-push hook fires exactly when an
#      agent is mid-push, which is exactly when another agent is likeliest to
#      be mid-push too. Silently kicking off a mutating install as a SIDE
#      EFFECT of a hook the pusher did not ask to mutate anything is also
#      exactly the failure Rule 23 names: an operation quietly depending on a
#      precondition ("nobody else is touching node_modules right now") that
#      nothing here can actually guarantee.
#   2. A gate that fixes its own precondition and then proceeds is still a
#      gate that can silently do less than the pusher believes: a same-run
#      auto-install failing for an unrelated reason (registry timeout, disk
#      full, a lockfile drift) has to be handled as ANOTHER failure mode on
#      top of typecheck and build, and "install, then check" only reads as
#      simpler until the install itself is the thing that's flaky. Refusing
#      loudly has exactly one failure mode: it always tells the pusher to run
#      `npm install` themselves, in their own moment, outside the hook's
#      shared-checkout blast radius.
#
# So: missing `node_modules` is now a hard `exit 1`, worded like every other
# failure in this file (state, fix, override), never a silent `exit 0`.
# Falsified in both directions by
# `scripts/check-web-build-node-modules-gate.sh` (Rule 18): CASE 1 proves a
# push with node_modules absent is now REFUSED, not waved through; CASE 2
# proves the node_modules-present path — the normal case — is byte-for-byte
# unchanged (same typecheck, same build, same exit codes).

set -euo pipefail

# Resolve repo root. When invoked via .git/hooks/pre-push, $0 is inside
# .git/hooks/ and `dirname $0/..` lands on .git — NOT the repo root, so
# $ROOT/web-v2 silently misses and the hook skips on every push. Use
# `git rev-parse --show-toplevel` (the only reliable way from a hook) and
# fall back to dirname math only for manual invocation outside a repo.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))"
WEB="$ROOT/web-v2"

if [ ! -d "$WEB/node_modules" ]; then
  echo ""
  echo "✗ web-v2/node_modules is missing. Push aborted."
  echo ""
  echo "  This hook cannot typecheck or build web-v2 without it, and letting the"
  echo "  push through anyway used to be this script's behaviour — that made a"
  echo "  push from an uninstalled worktree indistinguishable from one that was"
  echo "  actually verified, with zero checks run either way (Rule 18)."
  echo ""
  echo "  Fix:"
  echo "    cd web-v2 && npm install"
  echo "  then retry the push."
  echo ""
  echo "  Override (skips typecheck AND build, not just this check):"
  echo "    git push --no-verify"
  exit 1
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
# ── STATUSWORDS-1 (2026-09-05) · THE SENTENCE HERE USED TO BE ───────────────
#
#     "✓ next build green. Railway is building the same tree."
#
# Present tense, about a thing this script does not contact. Nothing here
# talks to Railway; the local build tree and the deployed artifact are two
# different facts and this line asserted the second from the first. That is
# the whole of CLAUDE.md Rule 19 in one echo, inside the script whose entire
# purpose is Rule 19 — and note that `check-web-build.sh` runs `next build`
# directly, so it does not even execute the `prebuild` gate chain Railway
# runs first.
#
# BUILT is not MERGED is not DEPLOYED is not SHIPPED. This says the first,
# and names the other three as still open.
echo "✓ next build green — BUILT, locally."
echo "  That is one of four facts, and the only one this script can observe:"
echo "    BUILT     · this tree compiles here            ← proven above"
echo "    MERGED    · the commit is on origin/main       ← not checked here"
echo "    DEPLOYED  · Railway reports SUCCESS for it     ← not checked here"
echo "    SHIPPED   · the runner's device is running it  ← not checked here"
echo "  Railway also runs the web-v2 prebuild chain, which this script skips."
echo "  After pushing, confirm the deployment STATUS (a deployment can exist"
echo "  and be FAILED; 'success' is the only word that means deployed)."
