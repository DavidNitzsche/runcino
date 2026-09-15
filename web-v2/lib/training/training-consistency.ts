/**
 * lib/training/training-consistency.ts · THE canonical `TRAINING_CONSISTENCY`
 * reader (`lib/runner-state/ownership.ts`) — "how regularly does he actually
 * train."
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 *
 * `ownership.ts`'s own survey found this belief `OPEN` with `canonical: null`
 * and named the defect precisely: "The only implementation is a private
 * function inside a weighted dimension score [`adaptation-model.ts`'s
 * `readConsistency`], and Constitution 11 warns against exactly that shape...
 * A surface asking how consistent this runner has been has nowhere to call."
 *
 * IPR-20260914-006 (IPR) traced why that matters concretely: repeated PARTIAL
 * non-adherence — skipping every quality session for six weeks while still
 * logging easy miles — tripped nothing. `detectMissedKeyWorkout` is stateless
 * per 7-day pass; `detectTrainingGap`/`runnerIsCompromised` key on consecutive
 * zero-run days, so easy mileage alone defeats it. Neither one asks "has the
 * SAME stressor failed to land, repeatedly" — this file is that question,
 * finally given one name and one owner.
 *
 * ── THE DOMAIN STATEMENT, PER THE COACHING CONSULT (not invented here) ────
 * `for coaching consult/consult-log/2026-09-14-019-f077-non-adherence-design.md`
 * ruled what this reader has to measure, against
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`'s Modified Workout
 * doctrine test ("achieved stimulus evaluated, not workout geometry"):
 *
 *   1. Scoped to QUALITY-SESSION DELIVERY SPECIFICALLY, never blended
 *      mileage — a runner's easy miles must not be able to mask a quality
 *      session that keeps failing to land.
 *   2. Reads whether the STIMULUS LANDED, not whether a calendar entry
 *      exists — a fartlek swapped in for a track session at comparable
 *      effort is not the same fact as running every quality day easy.
 *   3. A rolling window, not a per-pass one, so one bad week or a single
 *      life event (already handled correctly by the single-miss handler)
 *      does not trip it.
 *
 * `for coaching consult/consult-log/2026-09-15-025-delegated-calibration-
 * rulings.md` Ruling 1 supplies the number: 2-3 CONSECUTIVE/corroborating
 * missed quality sessions, keyed on session COUNT rather than a week count —
 * deliberately, because David's own training runs 1-2 quality/wk
 * (`docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md`), and a week-count would trip the
 * SAME missed-session count at different real elapsed times depending on a
 * runner's own frequency (Rule 9). Directly reuses the corroboration-count
 * discipline `docs/ADAPTATION_PROGRESSION_DOCTRINE.md` already states for the
 * OPPOSITE (upward) direction — "two or three corroborating sessions" —
 * applied symmetrically per Rule 22 (a gate should not be laxer or stricter
 * than its opposite number without an argued reason). `NON_ADHERENCE_TRIGGER
 * _STREAK` below is set to the SMALLER end of that stated range (2): the
 * doctrine names "2-3" as the believable band, and 2 is the point a pattern
 * first becomes believable rather than the point it becomes undeniable —
 * consistent with the progression side's own single-corroboration threshold
 * for a candidate upward update.
 *
 * ── WHY THIS IS NEW CODE, NOT A ROUTE TO ANY OF THE THREE NAMED READERS ────
 * `ownership.ts`'s survey named three "competing" symbols, and this module
 * was built only after confirming, by reading each one, that none of them
 * actually computes the domain statement above:
 *
 *   · `lib/faff/week-mileage.ts#computeWeekMileage` answers "how many miles
 *     did he run this week", a presentation-layer aggregate with no memory
 *     across weeks ("No belief is kept" — ownership.ts's own words). Its
 *     `hardSessionsDone` counts quality sessions RUN, not whether the
 *     stimulus landed, and is not scoped to a rolling consecutive-miss
 *     window. Different question. Left untouched.
 *   · `lib/coach/runner-calibration.ts#loadRunnerCalibration` answers "how
 *     much of this runner's data can the plan engine trust" (cold-start /
 *     building / calibrated, off raw workout counts) — ownership.ts's own
 *     audit already flags this as "Account maturity, not training
 *     consistency." Different question. Left untouched.
 *   · `lib/adaptation/adaptation-model.ts`'s private `readConsistency` is
 *     the one genuine attempt at a consistency-shaped score, and it is
 *     BLENDED WEEKLY MILEAGE (planned-vs-actual ratio and its spread) folded
 *     into the load-absorption composite `classifyAdaptation` returns — the
 *     exact shape doctrine rules 1 and 2 above say NOT to build a
 *     non-adherence detector on. Its dimension answers a real, still-valid
 *     question ("has weekly training LOAD followed the planned shape closely
 *     enough to call the stimulus well absorbed") that is not the same
 *     question as "has quality-session delivery specifically kept failing".
 *     Redefining that dimension to consume this reader instead would change
 *     live progression-affecting scoring for every runner on this account —
 *     `_adaptation_model.test.ts` pins the current volume/spread behaviour
 *     directly (e.g. "chronically over-running the plan is not scored as
 *     good consistency") and a full replay-verified pass plus product/coach
 *     sign-off is the honest bar for that change, not a same-session
 *     migration. Recorded as a deliberately deferred follow-up in
 *     `lib/runner-state/ownership.ts`'s `TRAINING_CONSISTENCY` entry, not
 *     silently left unmentioned.
 *
 * The raw material this reader needs — did the prescribed stimulus land,
 * session by session — already exists and is reused verbatim rather than
 * re-derived: `loadKeySessionExecutions` (`lib/execution/load.ts`) already
 * resolves every prescribed quality (`plan_workouts.is_quality`) session to
 * one of doctrine's seven `ExecutionState`s, and `earnsProgressionCredit`
 * (`lib/execution/interpret.ts`) already answers "did this session clear the
 * bar" — AS_PLANNED / EQUIVALENT / PARTIAL_PRODUCTIVE credit it,
 * MISSED / PARTIAL_FAILED / a cross-domain REPLACED do not. That is exactly
 * the fartlek-vs-easy distinction the Modified Workout doctrine test asks
 * for, already built, already tested elsewhere — this file adds no new
 * stimulus-grading logic of its own.
 */

import {
  loadKeySessionExecutions,
  type KeySessionExecution,
} from '@/lib/execution/load';
import type { ExecutionState } from '@/lib/execution/interpret';
import { resolveCurrentVdotSnapshot } from '@/lib/training/projection-snapshots';
import {
  isPrescribedNonNormal,
  loadPrescribedWindows,
  type PrescribedWindow,
} from '@/lib/training/normal-window';
import { isoDaysBefore } from '@/lib/runs/volume';

/**
 * Per consult-log 2026-09-15-025 Ruling 1: the smaller end of the doctrine's
 * "2-3 consecutive" band — see the file header for the full citation and the
 * Rule 22 symmetry argument. A single miss stays the single-miss handler's
 * job (already correct, per the IPR); this constant is the point a REPEATED
 * pattern first becomes believable.
 */
export const NON_ADHERENCE_TRIGGER_STREAK = 2;

/** Default lookback for the loader. Generous relative to the 2-3-session
 *  trigger — at David's own 1-2 quality/wk cadence this covers roughly a
 *  full block, so a genuine break earlier in the window cannot be confused
 *  with "no evidence" the way a tight window could. Not itself a doctrine
 *  number: widening it cannot lower the trigger below
 *  `NON_ADHERENCE_TRIGGER_STREAK`, since the trigger reads only the TRAILING
 *  streak, never the count of sessions available. */
const DEFAULT_LOOKBACK_DAYS = 90;

/** One representative quality session, ready for the trailing-streak read.
 *  Deliberately narrower than `KeySessionExecution`: this reader only ever
 *  needs order and pass/fail, never the reconstructed stimulus itself. */
export interface ConsistencySession {
  readonly dateISO: string;
  readonly state: ExecutionState;
  /** `earnsProgressionCredit` from `lib/execution/interpret.ts`, carried
   *  verbatim. This is the ONE fact this reader counts. */
  readonly earnsProgression: boolean;
}

export interface TrainingConsistencyVerdict {
  /** Representative quality sessions in the lookback, oldest → newest.
   *  Prescribed taper/race/recovery days and unreadable sessions (a run
   *  that happened but could not be described, or a telemetry-compromised
   *  capture — RULE8CLOSE-1) are already excluded; neither is a runner
   *  shortfall and neither should count toward or against the streak. */
  readonly sessions: readonly ConsistencySession[];
  /** How many of the MOST RECENT representative quality sessions in a row
   *  failed to earn progression credit. Resets to 0 the moment a session
   *  lands — this is a trailing streak, not a lifetime or windowed count,
   *  because the doctrine question is "is the SAME stressor failing to
   *  land right now", not "did it ever". */
  readonly consecutiveMissedQuality: number;
  /** `consecutiveMissedQuality >= NON_ADHERENCE_TRIGGER_STREAK`. This is the
   *  ONLY thing F077's detector should read to decide whether to offer
   *  RECOMMIT/RECALIBRATE (`docs/PUSH_THE_RUNNER_FORWARD_DOCTRINE.md`) — see
   *  `lib/coach/non-adherence-offer.ts`. This module answers the reading
   *  question only; it never decides or narrates the coach's response
   *  (Rule 16 — one function, one question). */
  readonly triggersNonAdherenceOffer: boolean;
  /** Share of representative quality sessions in the WHOLE lookback that
   *  earned progression credit. Narration-only context — deliberately NOT
   *  what `triggersNonAdherenceOffer` is keyed on. A share can look fine on
   *  average while the last three in a row all failed, which is precisely
   *  the runner IPR-20260914-006 describes and precisely why the trigger
   *  reads the trailing streak instead. Null when there is nothing to read. */
  readonly qualityDeliveryShare: number | null;
}

/**
 * PURE. Rule 18: falsifiable with a hand-built session list, no database.
 *
 * `sessions` must already be oldest → newest and already restricted to
 * representative quality sessions (see `loadTrainingConsistency`, the only
 * production caller). This function does no filtering of its own — it only
 * counts — so a caller that hands it an unfiltered list gets an unfiltered
 * answer; the filtering is a separate, named, independently testable step.
 */
export function resolveTrainingConsistency(
  sessions: readonly ConsistencySession[],
): TrainingConsistencyVerdict {
  let consecutiveMissedQuality = 0;
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].earnsProgression) break;
    consecutiveMissedQuality++;
  }
  const qualityDeliveryShare = sessions.length > 0
    ? sessions.filter((s) => s.earnsProgression).length / sessions.length
    : null;
  return {
    sessions,
    consecutiveMissedQuality,
    triggersNonAdherenceOffer: consecutiveMissedQuality >= NON_ADHERENCE_TRIGGER_STREAK,
    qualityDeliveryShare,
  };
}

/**
 * Assemble `ConsistencySession[]` from the runner's real training data and
 * resolve it. Best-effort like every other loader on this seam
 * (`loadPartialFitnessEvidenceFindings`, `loadRunnerCalibration`) — a failed
 * read here means "say nothing today", never a crashed caller, and never a
 * false accusation of non-adherence manufactured from a read failure.
 */
export async function loadTrainingConsistency(
  userUuid: string,
  todayISO: string,
  opts?: { lookbackDays?: number },
): Promise<TrainingConsistencyVerdict> {
  try {
    const fromISO = isoDaysBefore(todayISO, opts?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
    const vdotRead = await resolveCurrentVdotSnapshot(userUuid);
    const vdot = vdotRead.ok ? vdotRead.vdot : null;
    const [executions, windows]: [KeySessionExecution[], PrescribedWindow[]] = await Promise.all([
      loadKeySessionExecutions(userUuid, fromISO, todayISO, vdot),
      loadPrescribedWindows(userUuid, todayISO),
    ]);
    const sessions: ConsistencySession[] = executions
      // Real evidence only — a run that happened but could not be described,
      // or a telemetry-compromised capture, is missing evidence, never a
      // demonstrated failure (RULE8CLOSE-1, restated in `interpret.ts`).
      .filter((e) => e.readable && e.read != null && !e.read.telemetryCompromised)
      // `NEVER_TAPER` / doctrine's own neverMovesOn note on this belief: "A
      // cutback week the plan authored is adherence, not inconsistency."
      // Excluded from the read entirely rather than scored as a pass, so a
      // taper cannot manufacture a false RECOMMIT signal either.
      .filter((e) => !isPrescribedNonNormal(e.dateISO, windows))
      .map((e) => ({ dateISO: e.dateISO, state: e.read!.state, earnsProgression: e.earnsProgression }))
      .sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));
    return resolveTrainingConsistency(sessions);
  } catch (err) {
    console.warn('[training-consistency] loadTrainingConsistency failed:', err);
    return resolveTrainingConsistency([]);
  }
}
