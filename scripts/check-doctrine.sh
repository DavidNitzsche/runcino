#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-doctrine.sh · training-science conformance gate (2026-08-17)
#
# Sibling of check-palette-sync.sh, and wired the same way (web-v2 prebuild →
# Railway build). That script stops a bad colour reaching production; this one
# stops a bad number reaching a runner's legs.
#
# The incident it generalises: post-race recovery for a half marathon
# prescribed 15 miles across 14 days — five straight rest days — because the
# engine read Research/00b's "total recovery days (no quality)" column and
# spent it as the adjacent "days of zero/very-light running" column, then sized
# every distance off the marathon reverse taper. Fixed in 52174bcd. Nothing in
# CI could have caught it: the existing gates check that a plan is well-formed,
# not that it agrees with the research.
#
# Two guards, exit 1 on any violation:
#
#   1. CITATION      · every claim in web-v2/lib/doctrine/registry.ts names a
#      RESOLUTION      doctrine file that exists and quotes an anchor string
#                      that is still verbatim in it. A grep tripwire, not a
#                      parser — same posture as the palette script. This is the
#                      half that must run on a cold container, so it needs
#                      nothing but bash.
#
#   2. FULL GATE     · the registry's predicates (does the engine constant
#                      still satisfy the claim?) plus the structural lint, via
#                      vitest. Run when node_modules is present; a FAILURE here
#                      is fatal, but vitest being absent only prints a notice —
#                      guard 1 has already done the drift check.
#
# The registry's format contract, enforced below: each claim carries exactly
# one `id:`, one `doc:` and one `anchor:` line, each a single quoted string on
# its own line. Keep it that way — it is what makes the cheap guard possible.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="$ROOT/web-v2/lib/doctrine/registry.ts"

fail=0

if [ ! -f "$REGISTRY" ]; then
  echo "DOCTRINE FAIL · registry missing at web-v2/lib/doctrine/registry.ts"
  echo "  The doctrine gate cannot be deleted to make a build pass."
  exit 1
fi

# ── 1 · CITATION RESOLUTION ─────────────────────────────────────────────────
# Three sed passes rather than one awk program: BSD awk (macOS) and mawk (most
# Linux images) both lack gawk's 3-argument match(), and a gate with two code
# paths is a gate that is only ever tested on one of them. sed is everywhere.
# Field order per claim is fixed by the contract, so pasting the three columns
# reassembles the triples exactly.
ids=$(sed -n "s/^[[:space:]]*id:[[:space:]]*['\"]\(.*\)['\"],[[:space:]]*$/\1/p" "$REGISTRY")
docs=$(sed -n "s/^[[:space:]]*doc:[[:space:]]*['\"]\(.*\)['\"],[[:space:]]*$/\1/p" "$REGISTRY")
anchors=$(sed -n "s/^[[:space:]]*anchor:[[:space:]]*['\"]\(.*\)['\"],[[:space:]]*$/\1/p" "$REGISTRY")
triples=$(paste <(printf '%s\n' "$ids") <(printf '%s\n' "$docs") <(printf '%s\n' "$anchors"))

n_id=$(grep -cE "^[[:space:]]*id:[[:space:]]*['\"]" "$REGISTRY")
n_doc=$(grep -cE "^[[:space:]]*doc:[[:space:]]*['\"]" "$REGISTRY")
n_anchor=$(grep -cE "^[[:space:]]*anchor:[[:space:]]*['\"]" "$REGISTRY")

if [ "$n_id" -ne "$n_doc" ] || [ "$n_id" -ne "$n_anchor" ]; then
  echo "DOCTRINE FAIL · registry format contract broken"
  echo "  found $n_id id: lines, $n_doc doc: lines, $n_anchor anchor: lines"
  echo "  Every claim needs exactly one of each, single-line and quoted, so this"
  echo "  guard can run without a TypeScript toolchain. Fix the entry you just added."
  exit 1
fi

if [ "$n_id" -eq 0 ]; then
  echo "DOCTRINE FAIL · registry has no claims"
  exit 1
fi

checked=0
while IFS=$'\t' read -r id doc anchor; do
  [ -z "${id:-}" ] && continue
  if [ ! -f "$ROOT/$doc" ]; then
    echo "DOCTRINE FAIL · $id"
    echo "  cited file does not exist: $doc"
    echo "  Either the doc moved (update doc: on the claim) or the claim is stale."
    fail=1
    continue
  fi
  # -F: the anchor is literal text, table pipes and all. Never a regex.
  if ! grep -qF -- "$anchor" "$ROOT/$doc"; then
    echo "DOCTRINE FAIL · $id"
    echo "  anchor no longer present in $doc"
    echo "  anchor: $anchor"
    echo "  The doctrine passage this claim binds to has moved, been reworded, or been"
    echo "  deleted. Do NOT relax the claim to make this pass. Open the doc, read what"
    echo "  the passage says now, then either re-anchor the claim on the new wording and"
    echo "  re-check the engine constant against it, or — if doctrine genuinely changed —"
    echo "  change the engine constant first and the claim second."
    fail=1
    continue
  fi
  checked=$((checked + 1))
done <<< "$triples"

if [ "$checked" -ne "$n_id" ] && [ "$fail" -eq 0 ]; then
  echo "DOCTRINE FAIL · resolved $checked citations but the registry declares $n_id"
  echo "  The extractor and the registry disagree · check the format of the newest entry."
  fail=1
fi

# ── 2 · FULL GATE (predicates + structural lint) ────────────────────────────
VITEST="$ROOT/web-v2/node_modules/.bin/vitest"
if [ "${DOCTRINE_SKIP_VITEST:-}" = "1" ]; then
  echo "doctrine · vitest stage skipped (DOCTRINE_SKIP_VITEST=1)"
elif [ -x "$VITEST" ]; then
  # NOT `--silent`, and not `--silent` again. Until 2026-09-01 this line read
  # `"$VITEST" run lib/doctrine --silent`, which suppressed the gate's own
  # report — `=== DOCTRINE · 323 claims · 12 recorded violations ===` and the
  # twelve reasons under it — on every single build. Three of those twelve open
  # with the words "REAL VIOLATION, RUNNER-FACING, NOT FIXED HERE", and the only
  # thing anybody ever saw was "doctrine OK · 323 citations resolve".
  #
  # `--disable-console-intercept` because vitest buffers console output by
  # default and drops it for a passing file; the report is printed by a passing
  # test on purpose, so without this it is suppressed a second way.
  #
  # A recorded violation is a thing the build should have to look at.
  if ! (cd "$ROOT/web-v2" && "$VITEST" run lib/doctrine --disable-console-intercept); then
    echo "DOCTRINE FAIL · a claim's predicate or the structural lint failed (see above)."
    echo "  Fix the engine constant, not the claim. A real violation you are not fixing"
    echo "  now goes in that claim's \`exempt\` map with an honest reason — never widen"
    echo "  the claim to swallow it."
    echo "  If the failure names a RUNNER-FACING exemption, it is a number on somebody's"
    echo "  phone: fix the constant, or acknowledge it by name with an owner in"
    echo "  web-v2/lib/doctrine/runner-facing-violations.ts. Acknowledging is not resolving."
    fail=1
  fi
else
  # ── RULE 18 point 2 · A GATE THAT CHECKS NOTHING MAY NOT REPORT OK ────────
  #
  # Until 2026-09-01 this branch printed a caveat and then fell through to
  # `exit 0` with "doctrine OK · 323 citations resolve against Research/". Four gate stages did the
  # same. Railway builds with `npm install` and vitest is a devDependency, so
  # any environment that omits devDeps turned four gates into registry-SHAPE
  # checks that still announced confidence — reporting clean because they
  # looked at nothing, which is the worst outcome available.
  #
  # The COLD-CONTAINER case is real and stays honest: with no `node_modules`
  # at all, the shape checks above genuinely stand on their own (that is what
  # the sed-and-grep format contract is FOR) and the newer gates
  # (check-normal-window, check-client-graph, check-automatic-mutations,
  # check-goal-immutability) say exactly this. But `node_modules` PRESENT and
  # vitest missing is a pruned install, not a cold container, and the two must
  # not report the same way.
  if [ -d "$ROOT/web-v2/node_modules" ]; then
    echo "DOCTRINE FAIL · node_modules is present but $VITEST is not executable"
    echo "  devDependencies were pruned. The shape checks above ran; the SCANNER did not,"
    echo "  and this stage will not report OK over a check it did not perform."
    echo "  Install devDependencies, or set DOCTRINE_SKIP_VITEST=1 to skip it deliberately."
    fail=1
  else
    echo "doctrine · no node_modules (cold container) · ran the shape check only"
  echo "  ($checked anchors verified; run 'npm test' for the predicates and the lint)"
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "doctrine OK · $checked citations resolve against Research/"
fi
exit $fail
