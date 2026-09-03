#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-sentence-repetition.sh · RULE 17 · the runner reads a sentence once
#                                                                  (2026-09-03)
#
# Sibling of check-doctrine.sh / check-coach-voice.sh / check-normal-window.sh,
# wired the same way (web-v2 prebuild → Railway build).
#
#   check-coach-voice          stops a runner reading the WRONG WORDS.
#   this one                   stops him reading the RIGHT WORDS THIRTY-THREE
#                              TIMES.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
#
# The owner, reading his own composed fourteen-week block: remove the
# shorthand, "replace them with direct running instructions that tell me what
# to do". RUNNERLANG-1 (2026-09-02) did the replacing. Counted on a freshly
# composed block the day after it shipped:
#
#      before                                after RUNNERLANG-1
#   33 "Conversational."                  33 "Easy enough to talk in full sentences."
#   33 "Z2 HR cap."                        33 "If the heart rate drifts up, slow down …"
#   28 "Off."                              28 "Off."
#   27 "Sleep, mobility, fuel."            27 "Sleep, mobility, fuel."
#   11 the medium-long-run purpose         11 the medium-long-run purpose
#
# The words changed and the repetition did not move at all, because no check in
# this repository could count. `check-coach-voice.sh` grades WORDS one at a
# time. `_block_says_it_once.test.ts` watches ONE PAIR of strings on the Block
# screen. `runner-instruction.ts` is a substitution table and sees one string
# at a time by construction. Rule 20: a product rule with no gate is a
# hypothesis, and Rule 17 had been one since the day it was locked.
#
# ── THE RULE ────────────────────────────────────────────────────────────────
#
# A runner-facing sentence appears on at most ONE row of any one week of an
# authored block. The week is the unit because the week is the SCREEN, and the
# design contract's own rule is that no content is printed twice on one screen.
# It is also the unit that does not punish a real role line: "Recovery day
# after the long run" is a fact about one row a week for fourteen weeks, where
# the same sentence on three rows of one week is a fact about none of them.
#
# ── THREE GUARDS, exit 1 on any violation ───────────────────────────────────
#
#   1 · SHAPE   · the standing-sentence table, the role table and the exemption
#                 registry exist and export what the rest of the app imports,
#                 and the registry has not been gutted. Pure sed and grep, so
#                 it runs on a cold container with no TypeScript toolchain —
#                 the same posture as check-doctrine.sh.
#
#   2 · GATE    · the vitest gate and its liveness probe still exist. This file
#     PRESENT     cannot be satisfied by deleting the thing it runs, and it
#                 cannot be satisfied by a comment: the greps demand the real
#                 `describe`/`it` and the real symbols. (GATEAUDIT-4:
#                 check-automatic-mutations.sh's tamper-check was once
#                 `grep -q "GUARD 0"`, which any comment satisfies.)
#
#   3 · FULL    · run it. The corpus count, the per-week duplicate check, the
#     GATE        exemption ratchet, the role distribution and both
#                 falsification directions.
#
# ── IF THE GATE FIRES ───────────────────────────────────────────────────────
#
# A sentence is printed more than once in one week. Three answers, in order of
# preference:
#
#   · IT BELONGS TO THE BLOCK. True of every row of its kind. Add it to
#     `BLOCK_STANDING_SENTENCES` in web-v2/lib/plan/runner-instruction.ts and
#     `applyRunnerVoice` will say it once, on the first row that would have
#     carried it. This is the answer most of the time.
#   · IT BELONGS TO THE ROW, AND THE ROW SHOULD SAY WHY IT IS DIFFERENT. That
#     is what `EASY_DAY_ROLE_LINES` is: a fixed table keyed on decisions the
#     composer already made. Do NOT add a branch on runner state — the owner's
#     binding constraint is "all explanations must derive from structured
#     canonical decisions, do not create a separate prose brain".
#   · IT IS A PRESCRIPTION THE ROW CANNOT LOSE. A strides rep count, a race-week
#     duration. Argue it into web-v2/lib/audit/sentence-repetition-registry.ts.
#     The bar is that cutting the sentence would leave the row telling the
#     runner to do LESS, not just to read less.
#
# Do not widen the rule. "At most twice a week" relocates the defect; it does
# not remove it.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VOICE="$ROOT/web-v2/lib/plan/runner-instruction.ts"
REG="$ROOT/web-v2/lib/audit/sentence-repetition-registry.ts"
GATE="$ROOT/web-v2/lib/plan/_sentence_repetition.test.ts"
COMPOSER="$ROOT/web-v2/lib/plan/generate.ts"
fail=0

say() { printf '%s\n' "$*"; }
bad() { printf '  FAIL · %s\n' "$*"; fail=1; }

say "check-sentence-repetition · the runner reads a sentence once"

# ── GUARD 1 · the tables and the registry ───────────────────────────────────
say "guard 1 · tables + registry shape"

if [ ! -f "$VOICE" ]; then
  bad "voice module missing: $VOICE · Rule 17 has no table to point at"
else
  for sym in \
    "export const BLOCK_STANDING_SENTENCES" \
    "export const EASY_DAY_ROLE_LINES" \
    "export function easyDayRole" \
    "export type EasyDayRole" \
    "export class BlockScopedSpeaker"
  do
    grep -q "$sym" "$VOICE" || bad "voice module lost '$sym'"
  done
  # The table is a ratchet in the other direction: it may GROW as sentences are
  # retired, and a gutted one would let every repetition back in at once.
  standing=$(grep -cE "^\s+\{ id: '[^']+', text: '" "$VOICE" || true)
  if [ "$standing" -lt 10 ]; then
    bad "only $standing standing sentences · the table has been gutted (expected 10+)"
  fi
fi

if [ ! -f "$COMPOSER" ]; then
  bad "composer missing: $COMPOSER"
else
  # The pass has to be CALLED, not merely defined. A dead pass is the shape
  # Rule 21 names: wired, tested and inert.
  grep -q "export function applyRunnerVoice" "$COMPOSER" \
    || bad "generate.ts lost applyRunnerVoice · the standing sentences are never said once"
  grep -qE "^\s+applyRunnerVoice\(composed\);" "$COMPOSER" \
    || bad "applyRunnerVoice is defined but never called from finalizeComposedPlan"
fi

if [ ! -f "$REG" ]; then
  bad "exemption registry missing: $REG"
else
  grep -q "export const SENTENCE_REPEAT_EXEMPTIONS" "$REG" \
    || bad "registry lost 'SENTENCE_REPEAT_EXEMPTIONS'"
  entries=$(grep -cE "^\s+id: '[^']+'," "$REG" || true)
  reasons=$(grep -cE "^\s+reason:$|^\s+reason: '" "$REG" || true)
  if [ "$reasons" -lt "$entries" ]; then
    bad "$entries exemptions but $reasons reasons · every entry is argued or it is not an entry"
  fi
  # An exemption that is not anchored can widen into a prefix and forgive its
  # neighbours. The suite asserts this too; it is here so a cold container
  # still catches it.
  if grep -qE "^\s+pattern: /[^^]" "$REG"; then
    bad "an exemption pattern is not anchored at the start"
  fi
  [ "$fail" = "0" ] && say "  ok · $standing standing sentences, $entries exemptions, all argued"
fi

# ── GUARD 2 · the gate still exists ─────────────────────────────────────────
say "guard 2 · gate present"
if [ ! -f "$GATE" ]; then
  bad "gate missing: $GATE · this check cannot be satisfied by deleting it"
else
  grep -qE "describe\(['\"]SENTENCEREP-1 · liveness" "$GATE" \
    || bad "gate lost its liveness describe block"
  grep -qE "it\(['\"]states what it read, and fails on nothing" "$GATE" \
    || bad "gate lost its liveness probe · a scanner that reads nothing reports clean"
  grep -qE "it\(['\"]no sentence appears on two rows of one week" "$GATE" \
    || bad "gate lost the rule itself"
  grep -qE "it\(['\"]every exemption still matches a real finding" "$GATE" \
    || bad "gate lost the exemption ratchet · a stale allowlist stops meaning anything"
  grep -qE "describe\(['\"]SENTENCEREP-1 · falsification" "$GATE" \
    || bad "gate lost its falsification block · Rule 18.1"
  for sym in "readCorpus" "SENTENCE_REPEAT_EXEMPTIONS" "buildSimPlan" "renderRunnerInstruction"; do
    grep -q "$sym" "$GATE" || bad "gate lost '$sym'"
  done
  [ "$fail" = "0" ] && say "  ok · gate present with its liveness probe and both falsifiers"
fi

# ── GUARD 3 · run it ────────────────────────────────────────────────────────
say "guard 3 · full gate"
if [ ! -d "$ROOT/web-v2/node_modules" ]; then
  say "  skip · no node_modules (cold container) · guards 1 and 2 stand"
else
  if ( cd "$ROOT/web-v2" && npx vitest run lib/plan/_sentence_repetition.test.ts >/tmp/_sentrep.log 2>&1 ); then
    say "  ok · $(grep -oE 'Tests  [0-9]+ passed' /tmp/_sentrep.log | tail -1)"
    grep -oE 'SENTENCEREP-1 · [0-9]+/[0-9]+ blocks composed .*' /tmp/_sentrep.log | tail -1 | sed 's/^/  /'
    grep -oE 'SENTENCEREP-1 · role distribution .*' /tmp/_sentrep.log | tail -1 | sed 's/^/  /'
  else
    bad "vitest gate failed · output follows"
    tail -40 /tmp/_sentrep.log
  fi
fi

if [ "$fail" != "0" ]; then
  say ""
  say "FAILED · read the header of this file before changing anything."
  exit 1
fi
say "PASS"
