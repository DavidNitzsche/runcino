/**
 * lib/plan/return-ladder.ts · the check-in-gated walk-run ladder.
 *
 * `WALK_RUN_LADDER` (`lib/plan/injury-protocols.ts`) already holds the eight
 * doctrine stages, and `stageForWeek` already advances a plan's AUTHORED
 * rows on the calendar. Neither of those is what `GET /api/v5/return` /
 * `POST /api/v5/return/checkin` need: the design (19a) asks the runner "how
 * did today go" after each session and advances (or repeats) the stage off
 * that self-report, not off `weekIdx`. This module is that separate,
 * check-in-driven state machine — it reads the SAME doctrine constants
 * (`WALK_RUN_LADDER`, `MAX_STAGE_ADVANCE_PER_WEEK`) so the two paths can
 * never disagree about what the ladder itself says, but it advances on
 * events, not on dates.
 *
 * The gate, in one sentence (Research/05-injury-return-protocols.md §1.1):
 * "Spend at least 2 sessions at each stage before progressing" (the low end
 * of doctrine's 2-4 band — `MIN_SESSIONS_PER_STAGE`, bound by
 * `RETURN.min-two-sessions-per-stage`) and a stage may advance at most once
 * a week (`MAX_STAGE_ADVANCE_PER_WEEK`, already bound by `INJURY.walk-run-
 * cadence-is-derived-from-the-ladder`). A `something_off` check-in repeats
 * the stage outright and resets the session count — the runner has not yet
 * shown two clean sessions AT THIS load.
 *
 * No DB access here. The route loads the check-in history (as
 * `coach_intents` rows, additive — no DDL) and this function is the pure
 * core that turns that history into "what stage is the runner on now".
 */
import {
  WALK_RUN_LADDER, MAX_WALK_RUN_STAGE, MAX_STAGE_ADVANCE_PER_WEEK,
  type WalkRunStage,
} from './injury-protocols';

/**
 * Research/05 §1.1 · "Spend at least 2 sessions at each stage before
 * progressing." Doctrine-bound by `RETURN.min-two-sessions-per-stage`.
 */
export const MIN_SESSIONS_PER_STAGE = 2;

/**
 * The weekly advance cap is expressed as a rolling 7-day gap between one
 * advance and the next, rather than a calendar-week bucket — the ladder is
 * self-report-driven and has no calendar of its own to bucket against.
 */
export const MIN_DAYS_BETWEEN_ADVANCES = 7;

export type ReturnCheckinOutcome = 'silent' | 'something_off';

export interface ReturnCheckinEvent {
  /** ISO date (or instant) the check-in was logged. */
  at: string;
  outcome: ReturnCheckinOutcome;
}

export interface ReturnLadderState {
  stage: number;
  /** Silent check-ins logged at the CURRENT stage since it was last entered
   *  (or since the last `something_off` reset it). */
  sessionsAtStage: number;
  /** ISO date of the most recent stage advance, or null if none yet. */
  lastAdvanceAt: string | null;
  /** True when the runner has cleared the two-session minimum at the
   *  current stage but the weekly cap is holding the advance until the
   *  gap opens. */
  advanceQueued: boolean;
}

function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(aISO.length <= 10 ? aISO + 'T12:00:00Z' : aISO);
  const b = Date.parse(bISO.length <= 10 ? bISO + 'T12:00:00Z' : bISO);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / 86400000;
}

/**
 * Replay a check-in history into the ladder's current state.
 *
 * `startStage` is the site's own `InjuryProtocol.startStage` (from
 * `resolveInjuryProtocol` — almost always 1, "run 1 · walk 4 × 5", never a
 * walk-only stage). Events are read in whatever order they arrive; this
 * function sorts them ascending by `at` before replaying, so a caller can
 * pass a DB result in either order.
 */
export function computeReturnLadderState(
  events: readonly ReturnCheckinEvent[],
  startStage: number = 1,
): ReturnLadderState {
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  let stage = Math.max(1, Math.min(MAX_WALK_RUN_STAGE, startStage));
  let sessionsAtStage = 0;
  let lastAdvanceAt: string | null = null;

  for (const ev of sorted) {
    if (ev.outcome === 'something_off') {
      // The stage repeats. The runner has not shown two clean sessions at
      // this load, so the count toward the minimum resets rather than
      // merely pausing — the next silent session is the first of a fresh
      // pair, per doctrine's own "spend at least 2 sessions" framing.
      sessionsAtStage = 0;
      continue;
    }
    // outcome === 'silent'
    sessionsAtStage += 1;
    if (stage >= MAX_WALK_RUN_STAGE) continue; // nothing further to advance to
    if (sessionsAtStage < MIN_SESSIONS_PER_STAGE) continue;
    // Minimum cleared · gated by the weekly cap (MAX_STAGE_ADVANCE_PER_WEEK
    // is 1, so the gate is simply "has a week opened since the last one").
    const canAdvanceNow =
      lastAdvanceAt == null || daysBetween(ev.at, lastAdvanceAt) >= MIN_DAYS_BETWEEN_ADVANCES;
    if (canAdvanceNow) {
      stage = Math.min(MAX_WALK_RUN_STAGE, stage + MAX_STAGE_ADVANCE_PER_WEEK);
      sessionsAtStage = 0;
      lastAdvanceAt = ev.at;
    }
    // else: held. sessionsAtStage stays at/above the minimum, so the very
    // next silent check-in (once the gap opens) advances immediately —
    // `advanceQueued` on the final state reports this to the caller.
  }

  const advanceQueued =
    stage < MAX_WALK_RUN_STAGE
    && sessionsAtStage >= MIN_SESSIONS_PER_STAGE
    && lastAdvanceAt != null
    && daysBetween(sorted[sorted.length - 1]?.at ?? lastAdvanceAt, lastAdvanceAt) < MIN_DAYS_BETWEEN_ADVANCES;

  return { stage, sessionsAtStage, lastAdvanceAt, advanceQueued };
}

export function currentStageRow(state: ReturnLadderState): WalkRunStage {
  return WALK_RUN_LADDER[Math.min(MAX_WALK_RUN_STAGE, Math.max(1, state.stage)) - 1];
}

/**
 * Apply ONE new check-in to a state and return the state after it — the
 * shape `POST /api/v5/return/checkin` needs (it always has exactly one new
 * event to fold in). Equivalent to re-running `computeReturnLadderState`
 * over `[...history, event]`, exposed separately so the route does not have
 * to re-sort/re-replay a potentially long history just to describe "what
 * changed" versus "what the state already was".
 */
export function applyCheckin(
  before: ReturnLadderState,
  event: ReturnCheckinEvent,
): ReturnLadderState {
  if (event.outcome === 'something_off') {
    return { ...before, sessionsAtStage: 0, advanceQueued: false };
  }
  const sessionsAtStage = before.sessionsAtStage + 1;
  if (before.stage >= MAX_WALK_RUN_STAGE || sessionsAtStage < MIN_SESSIONS_PER_STAGE) {
    return { ...before, sessionsAtStage, advanceQueued: false };
  }
  const canAdvanceNow =
    before.lastAdvanceAt == null || daysBetween(event.at, before.lastAdvanceAt) >= MIN_DAYS_BETWEEN_ADVANCES;
  if (!canAdvanceNow) {
    return { ...before, sessionsAtStage, advanceQueued: true };
  }
  return {
    stage: Math.min(MAX_WALK_RUN_STAGE, before.stage + MAX_STAGE_ADVANCE_PER_WEEK),
    sessionsAtStage: 0,
    lastAdvanceAt: event.at,
    advanceQueued: false,
  };
}

/**
 * The advancement gate, in one sentence — silent during, silent the next
 * morning, or the stage repeats. Coach voice: short, direct, no hype.
 */
export function advancementGateLine(state: ReturnLadderState): string {
  if (state.stage >= MAX_WALK_RUN_STAGE) {
    return 'This is the last stage. Stay here until running feels normal again.';
  }
  const remaining = Math.max(0, MIN_SESSIONS_PER_STAGE - state.sessionsAtStage);
  if (remaining > 0) {
    return remaining === 1
      ? 'One more silent session here and the next stage opens.'
      : `${remaining} more silent sessions here and the next stage opens.`;
  }
  return state.advanceQueued
    ? 'Silent again next time out and the stage moves — one advance a week.'
    : 'Silent during and silent the next morning moves you on. Anything else repeats the stage.';
}
