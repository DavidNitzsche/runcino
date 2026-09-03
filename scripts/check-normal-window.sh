#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-normal-window.sh · RULE 8 · a taper is never the runner's normal (2026-08-30)
#
# Thirteenth sibling of check-palette-sync.sh / check-doctrine.sh /
# check-swallowed-failure.sh / check-automatic-mutations.sh, wired the same way
# (web-v2 prebuild → Railway build).
#
#   check-doctrine           stops a bad NUMBER reaching a runner's legs.
#   check-swallowed-failure  stops a FAILED READ being served as a FACT.
#   check-automatic-mutations stops a JOB CHANGING TRAINING without saying so.
#   this one                 stops the engine MEASURING A RUNNER DURING A WEEK
#                            IT TOLD HIM TO REST and calling that who he is.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
#
# CLAUDE.md Rule 8, locked at the owner's explicit instruction, given twice, the
# second time as an absolute: "It cannot look at taper and recover as my
# 'normal'. Ever."
#
# Six distinct defects in one engine, every one found by the runner and none by
# any gate, because every output was well-formed and only the WINDOW was wrong:
#
#   · a 28-day mean read 31.6 mi/wk against a sustained 43.5, and the marathon
#     block opened at 31;
#   · a 14-day easy median read 4.0 mi for a runner whose easy days are 3-7.8;
#   · quality-per-week read 0 for a runner whose habit is two;
#   · a long-run ramp anchored to a 13.5 mi taper long instead of the 18.0 he
#     ran on 2026-07-25;
#   · the return-to-volume ladder switched off entirely;
#   · a six-day-a-week runner would have been capped at five.
#
# Every number was arithmetically correct against its window. That is precisely
# why no existing gate saw any of it: they all sample the OUTPUT and ask whether
# each point is legal, and a number measured over the wrong window is legal.
#
# ── FOUR GUARDS, exit 1 on any violation ────────────────────────────────────
#
#   1 · SHAPE   · the shared filter module and the registry both exist, export
#                 the symbols the rest of the app imports, and the registry has
#                 not been gutted. Pure sed and grep, so it runs on a cold
#                 container with no TypeScript toolchain — the same posture as
#                 check-doctrine.sh.
#
#   2 · GATE    · the scanner and its liveness assertion still exist. This file
#     PRESENT     cannot be made to pass by deleting the thing it runs, and it
#                 cannot be satisfied by a comment: the greps demand the real
#                 `describe`/`it` and the real predicate constants.
#
#   3 · FULL    · the vitest gate: no unguarded habit read over a rolling
#     GATE        window, the allowlist ratchet, the count-pinned file, and
#                 the scanner-liveness probe that fails LOUDLY rather than
#                 reporting clean when the predicate stops matching. Two gates
#                 in this repo have shipped green because they scanned zero
#                 files; that is the failure this probe exists to prevent.
#
#   4 · AUTHOR- · guards 1-3 police the READERS. This one polices the ROW they
#     ING         read. `lib/plan/_recovery_block_flags.test.ts` composes every
#                 recovery-block shape through the real composer and the real
#                 flag writer and asserts that none of them is authored as an
#                 ordinary week, and that none is stamped the block PEAK.
#                 Added 2026-09-03 after the replay found four production
#                 recovery weeks carrying `is_peak = TRUE`.
#
# ── IF THE GATE FIRES ───────────────────────────────────────────────────────
#
# You added a reader that answers "what does this runner normally do" without
# excluding the days the engine itself prescribed. Import the filter from
# web-v2/lib/training/normal-window.ts. Two clauses are easy to get wrong:
#
#   · EXCLUDE, DO NOT WIDEN. A longer window still contains the taper; it only
#     dilutes it. A reader "fixed" by reaching for 90 days instead of 14 has the
#     wrong shape even when the number improves.
#   · IF EXCLUDING LEAVES TOO LITTLE DATA, REFUSE — and keep that refusal
#     distinguishable from a measured zero. A zero because the plan prescribed
#     recovery and a zero because the runner is detrained are OPPOSITE FACTS.
#
# If the reader is genuinely exempt — execution rather than habit, a load model
# that is supposed to move, a race detector, or an injury guard reading what the
# tissue has ABSORBED rather than what the runner CAN DO — add an argued entry
# to NORMAL_WINDOW_EXEMPTIONS, citing the corollary's one shared text. Prefer a
# `statement` fingerprint over a file-level excuse when the file also holds
# habit readers. If the reader is answering BOTH questions under one name, SPLIT
# it, as recentPeakLongMi was. Do NOT loosen a floor to make this pass.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOD="$ROOT/web-v2/lib/training/normal-window.ts"
REG="$ROOT/web-v2/lib/audit/normal-window-registry.ts"
GATE="$ROOT/web-v2/lib/audit/_normal_window_scan.test.ts"
GATE_BEHAVIOUR="$ROOT/web-v2/lib/training/_normal_window.test.ts"
AUTHORING_GATE="$ROOT/web-v2/lib/plan/_recovery_block_flags.test.ts"
FLAG_WRITER="$ROOT/web-v2/lib/plan/generate.ts"
fail=0

say() { printf '%s\n' "$*"; }
bad() { printf '  FAIL · %s\n' "$*"; fail=1; }

say "check-normal-window · a taper or a recovery window is never the runner's normal"

# ── GUARD 1 · the module and the registry ───────────────────────────────────
say "guard 1 · module + registry shape"

if [ ! -f "$MOD" ]; then
  bad "shared filter missing: $MOD · Rule 8 has no single definition to point at"
else
  # The API every habit reader imports. A rename that skips this list is a
  # rename that leaves callers re-implementing the predicate by hand, which is
  # the state the module was written to end.
  for sym in \
    "export const NORMAL_TRAINING_DAY_SQL" \
    "export function normalTrainingDaySql" \
    "export function normalWindowParams" \
    "export function isPrescribedNonNormal" \
    "export function representativeDayCount" \
    "export async function loadPrescribedWindows" \
    "export async function normalWeeklyMileage" \
    "export type NormalReading" \
    "export async function sustainedWeeklyMileage" \
    "export function sustainedFromWeeks" \
    "export function representativeWeeks" \
    "export const SUSTAINED_WEEK_RANK" \
    "export const SUSTAINED_LOOKBACK_WEEKS" \
    "export const MIN_SUSTAINED_WEEKS"
  do
    grep -q "$sym" "$MOD" || bad "module lost '$sym'"
  done

  # 2026-09-02 · the sustained-volume estimator replaced the mean, at David's
  # ruling: "the question is sustainable training capacity, not arithmetic
  # average mileage". Two things must stay true of it, and both are cheap to
  # check without a toolchain:
  #
  #   1. It must not RE-DERIVE the rank. `SUSTAINED_WEEK_RANK` is bound by
  #      assertion to `RAMP_BASE_SUSTAINED_RANK` in lib/plan/generate.ts (a
  #      value import would close a module cycle), so the module has to name
  #      that constant in the argument for its own, and `_normal_window.test.ts`
  #      has to hold the equality. A module that stops mentioning it has quietly
  #      become a second definition of "sustained".
  #   2. The refusal floor must stay DERIVED from the rank rather than typed as
  #      a literal, so it cannot drift below the point where the k-th highest
  #      week stops sitting in the upper half of its own sample.
  grep -q "RAMP_BASE_SUSTAINED_RANK" "$MOD" \
    || bad "module no longer cites RAMP_BASE_SUSTAINED_RANK · 'sustained' has become a second definition"
  grep -qE "MIN_SUSTAINED_WEEKS = 2 \* SUSTAINED_WEEK_RANK" "$MOD" \
    || bad "MIN_SUSTAINED_WEEKS is no longer derived from the rank · a typed-in floor can drift"
  grep -q "sustainedFromWeeks" "$GATE_BEHAVIOUR" 2>/dev/null \
    || bad "the behaviour suite no longer exercises sustainedFromWeeks · the estimator is ungated"
  grep -q "RAMP_BASE_SUSTAINED_RANK" "$GATE_BEHAVIOUR" 2>/dev/null \
    || bad "the behaviour suite no longer holds SUSTAINED_WEEK_RANK === RAMP_BASE_SUSTAINED_RANK"

  # The doctrine numbers must be REUSED, never re-derived. A second copy of the
  # taper table is exactly the drift Rule 7's lint exists to catch, and Rule 8
  # names both sources explicitly.
  grep -q "TAPER_WEEKS_BY_DISTANCE" "$MOD" \
    || bad "module no longer reuses TAPER_WEEKS_BY_DISTANCE · it must not re-derive a taper table"
  grep -q "postRaceRecoveryWeeks" "$MOD" \
    || bad "module no longer reuses postRaceRecoveryWeeks · it must not re-derive a recovery table"
  if grep -qE "taperWeeks:\s*[0-9]" "$MOD"; then
    bad "module declares its own taperWeeks literals · reuse the doctrine-bound table"
  fi

  # Clause 2 of the rule. A module that cannot refuse will always answer.
  grep -q "not-enough-representative-training" "$MOD" \
    || bad "module lost its refusal code · it must be able to say 'too little to answer'"
fi

if [ ! -f "$REG" ]; then
  bad "registry missing: $REG"
else
  exempt=$(grep -cE "^\s+file: '[^']+'," "$REG" || true)
  reasons=$(grep -cE "^\s+reason:$|^\s+reason: '" "$REG" || true)

  if [ "$exempt" -lt 10 ]; then
    bad "only $exempt file entries · the registry has been gutted (expected 10+)"
  fi
  if [ "$reasons" -lt "$exempt" ]; then
    bad "$exempt file entries but $reasons reasons · every entry is argued or it is not an entry"
  fi

  for sym in "NORMAL_WINDOW_EXEMPTIONS" "NORMAL_WINDOW_FILE_PINS" "HABIT_READERS"; do
    grep -q "export const $sym" "$REG" || bad "registry lost '$sym'"
  done

  # The corollary has to be stated ONCE and cited, not re-argued ad hoc at each
  # site — that is how two guards exempted for the same reason drift into two
  # different reasons and then into two different rules.
  grep -q "ABSORBED_LOAD_NOT_CAPABILITY" "$REG" \
    || bad "the corollary's shared reason is gone · absorbed-load exemptions must cite one text"

  # The file pin is a count, or it cannot expire when a repair lands.
  grep -qE "^\s+findings: [0-9]+," "$REG" \
    || bad "no count-pinned file entry · a pin without a number cannot expire"

  [ "$fail" = "0" ] && say "  ok · module exports intact, $exempt registry entries, all argued"
fi

# ── GUARD 2 · the gate still exists ─────────────────────────────────────────
say "guard 2 · gate present"
if [ ! -f "$GATE" ]; then
  bad "gate missing: $GATE · this check cannot be satisfied by deleting it"
else
  # Demand the real describe/it, not prose mentioning them. A tamper-check a
  # tamperer passes by writing a comment is not a tamper-check (GATEAUDIT-4).
  grep -qE "describe\(['\"]NORMALWINDOW-1" "$GATE" \
    || bad "gate lost its NORMALWINDOW-1 describe block"
  grep -qE "it\(['\"]the scanner still reads real source" "$GATE" \
    || bad "gate lost its liveness probe · a scanner that reads nothing reports clean"
  for sym in "ROLLING_WINDOW" "HABIT_AGGREGATE" "FILTER_MODULE" "extractStringLiterals"; do
    grep -q "$sym" "$GATE" || bad "gate lost '$sym'"
  done
  [ "$fail" = "0" ] && say "  ok · gate present with its liveness probe"
fi

# ── GUARD 3 · run it ────────────────────────────────────────────────────────
say "guard 3 · full gate"
if [ ! -d "$ROOT/web-v2/node_modules" ]; then
  say "  skip · no node_modules (cold container) · guards 1 and 2 stand"
else
  if ( cd "$ROOT/web-v2" && npx vitest run lib/audit/_normal_window_scan.test.ts >/tmp/_normwin.log 2>&1 ); then
    say "  ok · $(grep -oE 'Tests  [0-9]+ passed' /tmp/_normwin.log | tail -1)"
  else
    bad "vitest gate failed · output follows"
    tail -40 /tmp/_normwin.log
  fi
fi

# ── GUARD 4 · the AUTHORING side ────────────────────────────────────────────
#
# Guards 1-3 police the READERS: nothing may answer "what does this runner
# normally do" over a window that contains a taper. They cannot see a row that
# LIES about which weeks those were, and on 2026-09-03 the replay found one:
# `pln_eb73331e19230ad9`, `mode: 'recovery'`, authored the day after the owner's
# A-race half, with `is_peak = TRUE` on the second of its two prescribed
# recovery weeks. Four of the six recovery weeks in production carry it. A
# reader that has to correct its own input is one reader away from being wrong,
# so the row is gated here too.
say "guard 4 · authoring · a recovery block is never written as ordinary"
if [ ! -f "$AUTHORING_GATE" ]; then
  bad "authoring gate missing: $AUTHORING_GATE · Rule 20 · the writer is ungated again"
else
  grep -qE "describe\(['\"]RECOVERYFLAGS-1" "$AUTHORING_GATE" \
    || bad "authoring gate lost its RECOVERYFLAGS-1 describe block"
  grep -qE "it\(['\"]LIVENESS" "$AUTHORING_GATE" \
    || bad "authoring gate lost its liveness probe · a sweep that composes nothing reports clean"
  # It must drive the REAL composer and the REAL writer, or it proves only that
  # the test agrees with itself (Rule 18).
  for sym in "composeRecoveryPlan" "planWeekFlags" "isNonBuildingPhaseLabel" "weekRowNoStepReason"; do
    grep -q "$sym" "$AUTHORING_GATE" || bad "authoring gate no longer drives '$sym'"
  done
  # And the writer must still read the one owner of "deliberately not building"
  # rather than spelling the phase list a second time (Rule 16).
  #
  # GATEAUDIT · the bare symbol is NOT enough. `generate.ts` names
  # `isNonBuildingPhaseLabel` in planWeekFlags' own doc comment, so a grep for
  # the word survives deleting the code — which is exactly how
  # check-automatic-mutations' guard 2 shipped satisfiable by a comment.
  # Demand the expression, on the eligibility predicate, with its argument.
  grep -qE '!isNonBuildingPhaseLabel\(weeks\[i\]\.phase\)' "$FLAG_WRITER" \
    || bad "planWeekFlags no longer excludes non-building weeks from is_peak · a recovery block will be stamped with a PEAK week again"
  [ "$fail" = "0" ] && say "  ok · authoring gate present, drives the real composer"
fi

if [ -d "$ROOT/web-v2/node_modules" ]; then
  # --reporter=verbose so the sweep's own liveness line reaches the log. A
  # guard that prints "ok ·" with nothing after it is the hollow-green shape
  # this rule exists to prevent, so the count is REQUIRED, not just echoed.
  if ( cd "$ROOT/web-v2" && npx vitest run --reporter=verbose lib/plan/_recovery_block_flags.test.ts >/tmp/_recflags.log 2>&1 ); then
    swept=$(grep -oE 'swept [0-9]+ recovery blocks, [0-9]+ weeks' /tmp/_recflags.log | tail -1)
    if [ -z "$swept" ]; then
      bad "authoring gate passed but printed no sweep count · it may have composed nothing"
    else
      say "  ok · $swept"
    fi
  else
    bad "authoring gate failed · output follows"
    tail -40 /tmp/_recflags.log
  fi
else
  say "  skip · no node_modules (cold container) · the shape checks above stand"
fi

if [ "$fail" != "0" ]; then
  say ""
  say "FAILED · read the header of this file before changing anything."
  exit 1
fi
say "PASS"
