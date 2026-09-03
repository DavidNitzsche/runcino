#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-goal-sanity-removed.sh · THE GOAL-VDOT SANITY SCREEN STAYS DELETED
#                                (GOALSANITY-DELETE-1, gated 2026-09-02)
#
# Successor to check-goal-sanity-naming.sh, which is deleted with the mechanism
# it policed. Sibling of check-goal-immutability.sh, wired the same way
# (web-v2 prebuild → Railway build).
#
#   check-goal-immutability      stops the coach ASKING THE RUNNER TO CHANGE
#                                THE GOAL HE STATED.
#   this one                     stops a SECOND, NARROWER ANSWER to "is my goal
#                                realistic" coming back at all.
#
# ── WHY THE MECHANISM WENT ──────────────────────────────────────────────────
#
# `authored_state.goal_realism.flag` — renamed `goal_vdot_sanity
# .beyondSanityBand` earlier the same day — screened a typed goal against
# demonstrated threshold capacity and published a boolean. Two facts settled it:
#
#   1 · NO LIVE CONSUMER. Traced end to end: the only reader outside the plan
#       composer was `GET /api/coach/read`, which returned it verbatim on a
#       response nothing in this repository fetches — no page, no route, no
#       Swift call site. `app/api/v5/today/route.ts` says so in its own comment:
#       "its only importer was /api/coach/read, and nothing called that."
#   2 · COMPETING OWNERSHIP. Constitution §L assigns "how does the runner's goal
#       compare with the current race outlook?" to Goal Feasibility
#       (`lib/race/race-outlook.ts` §7). On 2026-09-02 the two answered the
#       owner's own block differently at the same instant. A narrow screen
#       wearing a wide name is fixed by a better name only when something needs
#       the screen. Nothing did.
#
# Renaming it was the right call while it had a consumer. Deleting it is the
# right call now that the trace shows it has none.
#
# ── TWO GUARDS, exit 1 on any violation ─────────────────────────────────────
#
#   1 · GONE      · the resolver module and its gate do not exist, and no source
#                   file mentions the retired identifiers. Pure grep, so it runs
#                   on a cold container with no TypeScript toolchain — the
#                   posture check-doctrine.sh set.
#   2 · LIVENESS  · the scanner states how many files it read and fails on zero.
#                   A scanner reporting clean because it looked at nothing is the
#                   worst outcome available, since it also reports confidence
#                   (Rule 18).
#
# ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
#
#   · It cannot see the same screen REBUILT UNDER A NEW NAME. It matches
#     identifiers, so `goalPlausibility` / `ambitionCheck` / anything else would
#     pass. The structural defence against that is Constitution §L's single
#     owner plus `check-goal-immutability.sh`, not this file.
#   · It cannot read a persisted `authored_state` row. Blocks authored before
#     2026-09-02 still carry the old key in the database and that is fine — this
#     asserts nothing WRITES or READS it any more, which is what "observational
#     only" means for historical data.
#   · It cannot tell whether Goal Feasibility's own answer is correct.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0

say() { printf '%s\n' "$*"; }
bad() { printf '  FAIL · %s\n' "$*"; fail=1; }

say "check-goal-sanity-removed · the goal-VDOT sanity screen stays deleted"

# ── GUARD 1 · gone ──────────────────────────────────────────────────────────
say "guard 1 · resolver, gate and every reference are gone"

for gone in \
  "$ROOT/web-v2/lib/plan/goal-vdot-sanity.ts" \
  "$ROOT/web-v2/lib/plan/_goal_vdot_sanity_gate.test.ts" \
  "$ROOT/scripts/check-goal-sanity-naming.sh"
do
  [ -e "$gone" ] && bad "back from the dead: $gone"
done

# The retired identifiers. `goal_realism` and `goal_vdot_sanity` are the
# authored_state keys; the rest are the resolver's exports.
#
# Comments are NOT exempt: this gate's own header and the deletion notes in
# `lib/plan/generate.ts` are the argued exceptions, listed by path. Everything
# else — including a comment that reintroduces the vocabulary as if it were
# live — is a finding worth reading.
PATTERN='goal_realism|goalRealism|goal_vdot_sanity|goalVdotSanity|assessGoalVdotSanity|beyondSanityBand|GOAL_VDOT_SANITY_BAND|goalVdotSanityFromLegacyRecord'

# The ratchet. It may SHRINK, never grow. Each entry carries its reason.
#   lib/plan/generate.ts          · the GOALSANITY-DELETE-1 deletion note, which
#                                   has to name what was deleted to be readable.
#   lib/plan/_coldstart_doctrine  · the vitest half of this ratchet. It asserts
#     .test.ts                      the authored_state keys are ABSENT, so it has
#                                   to name them. Removing it would delete the
#                                   only behavioural check that the composer
#                                   stopped writing them.
#   lib/plan/_evidence_tier_band  · the vitest half's other guard. It asserts the
#     .test.ts                      resolver file is gone and that neither key is
#                                   written, so it has to name both.
#   scripts/p0-proof/*            · offline snapshot tools that print whichever
#                                   authored_state keys a HISTORICAL row happens
#                                   to carry. Observational by construction.
ALLOW='lib/plan/generate\.ts|lib/plan/_coldstart_doctrine\.test\.ts|lib/plan/_evidence_tier_band\.test\.ts|scripts/p0-proof/'

scanned=0
findings=""
while IFS= read -r f; do
  scanned=$((scanned + 1))
  rel="${f#"$ROOT/"}"
  case "$rel" in
    web-v2/*) rel="${rel#web-v2/}" ;;
  esac
  if grep -qE "$PATTERN" "$f"; then
    printf '%s\n' "$rel" | grep -qE "$ALLOW" || findings="$findings$rel"$'\n'
  fi
done < <(find "$ROOT/web-v2/lib" "$ROOT/web-v2/app" "$ROOT/web-v2/components" "$ROOT/web-v2/scripts" \
  -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null)

if [ -n "$findings" ]; then
  bad "the retired goal-realism screen is referenced outside the argued allowlist:"
  # Quoted: the repo lives under a path with spaces, and an unquoted expansion
  # word-splits a filename into three lines.
  printf '    %s\n' "$findings"
fi

# Every allowlist entry must still be EARNED. A stale exemption fails until it
# is deleted (Rule 18 · an allowlist is a ratchet).
for entry in "web-v2/lib/plan/generate.ts" "web-v2/lib/plan/_coldstart_doctrine.test.ts" "web-v2/lib/plan/_evidence_tier_band.test.ts"; do
  if [ -f "$ROOT/$entry" ] && ! grep -qE "$PATTERN" "$ROOT/$entry"; then
    bad "stale allowlist entry · $entry no longer mentions the retired screen · delete its exemption"
  fi
done

[ "$fail" = "0" ] && say "  ok · resolver deleted, no live reference"

# ── GUARD 2 · liveness ──────────────────────────────────────────────────────
say "guard 2 · liveness"
say "  scanned $scanned TypeScript files"
if [ "$scanned" -lt 200 ]; then
  bad "the scanner read $scanned files · it is looking at the wrong tree and cannot fail honestly"
fi

if [ "$fail" != "0" ]; then
  say ""
  say "FAILED · read the header of this file before changing anything."
  say "If you need to know whether a goal is realistic, call Goal Feasibility:"
  say "lib/race/race-outlook.ts's goalFeasibility. It is Constitution §L's owner,"
  say "it reads runway and uncertainty, and it already exists."
  exit 1
fi
say "PASS"
