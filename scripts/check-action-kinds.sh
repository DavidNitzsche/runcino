#!/usr/bin/env bash
#
# scripts/check-action-kinds.sh · ACTIONKINDS-1 (2026-09-05)
#
# ══════════════════════════════════════════════════════════════════════════════
# THE RULE THIS ENFORCES
#
#   "No new action kind may compile without complete mapping across generator,
#    proposal, renderer and executor."   — David, 2026-09-05
#
# Half of that is already the COMPILER's job and is stated below so the two
# halves are not confused. Every one of these is exhaustive over `BrainAction`
# by a `const never: never = action` check or by being a
# `Readonly<Record<ActionKind, …>>`, so a member added to the union fails
# `tsc --noEmit` until it is handled:
#
#   validate.ts:validateAction              never
#   execute.ts:plannedWrites                never
#   executor-map.ts:executorFor             never
#   undo.ts:undoWritesFor                   never
#   ledger-facet.ts:ledgerFacetsOf          never
#   watch-facet.ts:watchBehaviorOf          never
#   decline-facet.ts:declineBehaviorOf      never
#   v5-action-render.ts:actionHeadline      never
#   serialize.ts:READERS                    total Record
#   facets.ts:GENERATOR_REGISTRY            total Record
#   facets.ts:PROPOSAL_WRITER_REGISTRY      total Record
#   evidence-facet.ts:EVIDENCE_REGISTRY     total Record
#
# So why does this script exist? Because a `never` check is only as good as the
# thing it is attached to, and CLAUDE.md Rule 18 is a list of gates in this repo
# that could not fail. Three specific ways the compiler stops noticing:
#
#   1 · SOMEBODY ADDS A `default:` ARM. It compiles, it is a one-line change, it
#       reads like defensive programming, and it silently switches the
#       exhaustiveness check off for every future kind. `serialize.ts` HAD one,
#       for exactly the reason that always looks good — it must answer null for
#       a payload written by another build — and the cost was that a
#       twenty-second kind would have compiled and come back null forever.
#   2 · SOMEBODY WIDENS A RECORD TO `Partial<>`. Same shape, same silence.
#   3 · SOMEBODY REACHES FOR `as ActionKind` OR `as never`.
#
# This asks the blunt question the compiler asks subtly: does the literal string
# appear as an arm in every owning file? It runs on a cold container with no
# TypeScript toolchain, alongside `check-doctrine.sh` and `check-palette-sync.sh`,
# and it reads the kind list OUT OF `action.ts` at run time rather than holding
# its own copy — a check that hardcodes both sides only proves it agrees with
# itself (Rule 18).
#
# ══════════════════════════════════════════════════════════════════════════════
# WHAT THIS GATE CANNOT FAIL ON (Rule 22)
#
# · WHETHER AN ARM IS CORRECT. It greps for `case 'PACE_CHANGE':`. An arm that
#   returns the wrong write, draws the wrong direction or classifies the
#   decision wrongly passes every line below. `_action_completeness.test.ts`
#   drives the behaviour; this proves the arm exists on a machine that cannot
#   run vitest.
# · A KIND THAT IS COMPLETE AND POINTLESS. Twenty-one arms for a lever no
#   evidence ever raises is fully green here.
# · A FACET THIS SCRIPT DOES NOT KNOW ABOUT. The owner list below is written
#   down; `facets.ts` holds the authoritative fourteen and the vitest gate
#   checks against that. If a facet is added there and not here, this keeps
#   passing — which is why GUARD 4 cross-checks the two counts.
# · WHETHER ANY OF IT IS DEPLOYED (Rule 19). Green is not deployed.
#
# ══════════════════════════════════════════════════════════════════════════════
# FALSIFY IT
#
#   1 · delete `case 'HOLD':` from lib/brain/proposal/undo.ts        → GUARD 2
#   2 · delete the `SAFETY_STOP:` entry from serialize.ts's READERS  → GUARD 2
#   3 · delete `HOLD:` from facets.ts's GENERATOR_REGISTRY           → GUARD 3
#   4 · add `default: return record('x');` to executor-map.ts        → GUARD 5
#   5 · empty ALL_ACTION_KINDS in action.ts                          → GUARD 1
#
set -euo pipefail

cd "$(dirname "$0")/../web-v2"
FAIL=0
say() { printf '%s\n' "$*"; }
bad() { printf '  FAIL · %s\n' "$*"; FAIL=1; }

ACTION_TS="lib/brain/proposal/action.ts"

# ── GUARD 1 · THE KIND LIST, READ OUT OF THE SOURCE ──────────────────────────
#
# Extracted from `ALL_ACTION_KINDS` rather than typed here. A list this script
# owned would drift from the union and would eventually be checking a
# vocabulary the app no longer has.
say "GUARD 1 · reading the action kinds out of $ACTION_TS"
[ -f "$ACTION_TS" ] || { say "  FAIL · $ACTION_TS does not exist"; exit 1; }

# `|| true` is load-bearing, and the falsification is what put it there. With
# `set -euo pipefail`, a `grep -o` that matches nothing exits 1, the command
# substitution fails, and the whole script dies BEFORE the liveness message
# below can print. So emptying ALL_ACTION_KINDS made this gate exit 1 saying
# NOTHING — a gate that fails without naming the defect is barely better than
# one that passes, because the next person has no idea what it found.
KINDS="$(
  awk '/^export const ALL_ACTION_KINDS/,/\];/' "$ACTION_TS" \
    | grep -o "'[A-Z_]\{3,\}'" | tr -d "'" | sort -u || true
)"
KIND_COUNT="$(printf '%s\n' "$KINDS" | grep -c . || true)"

# LIVENESS (Rule 18 point 2). A gate that reports clean because it read nothing
# is the worst outcome available, since it also reports confidence.
if [ "$KIND_COUNT" -lt 10 ]; then
  say "  FAIL · read only $KIND_COUNT action kinds; ALL_ACTION_KINDS is empty or unparseable"
  exit 1
fi
say "  read $KIND_COUNT action kinds"

# ── GUARD 2 · EVERY KIND HAS AN ARM IN EVERY OWNING FILE ─────────────────────
#
# `serialize.ts` is checked with a different pattern because its dispatch is a
# Record and not a switch — deliberately, so a foreign kind can still answer
# null while a KNOWN kind cannot silently fall through (see that file's header).
say "GUARD 2 · every kind has an arm in every owning file"

SWITCH_OWNERS="
lib/brain/proposal/validate.ts
lib/brain/proposal/execute.ts
lib/brain/proposal/executor-map.ts
lib/brain/proposal/undo.ts
lib/brain/proposal/ledger-facet.ts
lib/brain/proposal/watch-facet.ts
lib/brain/proposal/decline-facet.ts
lib/faff/v5-action-render.ts
"

ARMS_CHECKED=0
for f in $SWITCH_OWNERS; do
  if [ ! -f "$f" ]; then bad "$f is named as an owner and does not exist"; continue; fi
  for k in $KINDS; do
    ARMS_CHECKED=$((ARMS_CHECKED + 1))
    grep -q "case '$k':" "$f" || bad "$f has no arm for $k"
  done
done

SER="lib/brain/proposal/serialize.ts"
if [ ! -f "$SER" ]; then bad "$SER does not exist"; else
  for k in $KINDS; do
    ARMS_CHECKED=$((ARMS_CHECKED + 1))
    grep -qE "^  $k: \(" "$SER" || bad "$SER's READERS record has no entry for $k"
  done
fi

if [ "$ARMS_CHECKED" -eq 0 ]; then
  say "  FAIL · checked zero arms"; exit 1
fi
say "  checked $ARMS_CHECKED arms"

# ── GUARD 3 · EVERY KIND HAS A KEY IN EVERY REGISTRY ─────────────────────────
#
# A registry entry may be `null` — that is the ratchet's business, and
# `_action_completeness.test.ts` cross-checks a null against a declared gap. The
# KEY may not be absent, because an absent key is what a widened `Partial<>`
# would produce and is exactly what this script exists to catch.
say "GUARD 3 · every kind has a key in every registry"
KEYS_CHECKED=0
check_registry() {
  local file="$1" start="$2"
  if [ ! -f "$file" ]; then bad "$file does not exist"; return; fi
  local body
  body="$(awk "/^export const $start/,/^};/" "$file")"
  if [ -z "$body" ]; then bad "$file: $start not found or unparseable"; return; fi
  for k in $KINDS; do
    KEYS_CHECKED=$((KEYS_CHECKED + 1))
    printf '%s\n' "$body" | grep -qE "^  $k:" \
      || bad "$file: $start has no key for $k"
  done
}
check_registry "lib/brain/proposal/facets.ts" "GENERATOR_REGISTRY"
check_registry "lib/brain/proposal/facets.ts" "PROPOSAL_WRITER_REGISTRY"
check_registry "lib/brain/proposal/evidence-facet.ts" "EVIDENCE_REGISTRY"
if [ "$KEYS_CHECKED" -eq 0 ]; then say "  FAIL · checked zero registry keys"; exit 1; fi
say "  checked $KEYS_CHECKED registry keys"

# ── GUARD 4 · THE FACET LIST HERE AND THE FACET LIST THERE AGREE ─────────────
#
# `facets.ts` is authoritative about how many facets a kind owes. This script
# knows about a subset (the ones with a greppable arm). If a facet is added
# there, this must be looked at rather than silently keeping its old answer.
say "GUARD 4 · the facet count this script assumes matches facets.ts"
FACET_COUNT="$(
  awk '/^export const ALL_FACETS/,/\];/' lib/brain/proposal/facets.ts \
    | grep -o "'[A-Z_]\{3,\}'" | tr -d "'" | sort -u | grep -c . || true
)"
EXPECTED_FACETS=14
if [ "$FACET_COUNT" -ne "$EXPECTED_FACETS" ]; then
  bad "facets.ts declares $FACET_COUNT facets and this script was written against $EXPECTED_FACETS; \
re-read the owner list above and update both"
fi
say "  facets.ts declares $FACET_COUNT"

# ── GUARD 5 · NO `default:` ARM IN AN EXHAUSTIVE SWITCH ──────────────────────
#
# The one-line change that switches the compiler's exhaustiveness check off for
# every future kind. Each owning file is allowed EXACTLY the `default:` that
# carries the `never` assertion, and that is what is checked: a `default:` arm
# must be followed within four lines by `const never: never`.
say "GUARD 5 · every default arm is the never check and not a fallthrough"
DEFAULTS_CHECKED=0
for f in $SWITCH_OWNERS; do
  [ -f "$f" ] || continue
  while IFS=: read -r line _; do
    [ -n "$line" ] || continue
    DEFAULTS_CHECKED=$((DEFAULTS_CHECKED + 1))
    if ! sed -n "${line},$((line + 4))p" "$f" | grep -q 'const never: never'; then
      bad "$f:$line has a default arm that is not the exhaustiveness check; \
adding one silences the compiler for every future action kind"
    fi
  done <<EOF
$(grep -n '^\s*default:' "$f" || true)
EOF
done
# Liveness: these files ALL end in a never check, so finding none means the
# grep stopped matching and this guard has quietly stopped guarding.
if [ "$DEFAULTS_CHECKED" -eq 0 ]; then
  say "  FAIL · found no default arms at all; the predicate has stopped matching"
  exit 1
fi
say "  checked $DEFAULTS_CHECKED default arms"

# ── GUARD 6 · THE AUTHORITY SWITCH IS STILL THE LITERAL FALSE ────────────────
#
# Not this script's own subject, and checked anyway because every file this
# gate covers is one hop from the propose lane, and the one thing none of them
# may do is widen automatic authority. `_seal_single_seam.test.ts` owns the
# question; this is the cold-container copy of its sharpest line.
say "GUARD 6 · the automatic-adaptation seam is still typed false"
grep -q 'export const AUTOMATIC_ADAPTATION_AUTHORITY: false = false;' \
  lib/plan/adaptation-authority.ts \
  || bad "AUTOMATIC_ADAPTATION_AUTHORITY is no longer the literal false"

# ── result ───────────────────────────────────────────────────────────────────
if [ "$FAIL" -ne 0 ]; then
  say ""
  say "check-action-kinds · FAILED"
  exit 1
fi
say ""
say "check-action-kinds · OK · $KIND_COUNT kinds, $ARMS_CHECKED arms, $KEYS_CHECKED registry keys"
