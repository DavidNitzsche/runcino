/**
 * lib/coach/standing-recommendation.ts · live re-evaluation surface.
 *
 * Web agent brief · standing-recommendation-after-override-brief.md
 *
 * When the runner overrides an auto-adapter downgrade (via Restore
 * Original), the chip flips back to the original prescription. But
 * if the engine's reasoning STILL holds today, the runner deserves
 * to know the coach hasn't changed its mind · they're choosing to
 * override the recommendation, not erasing it.
 *
 * This composer runs the same logic the auto-adapter uses · WITHOUT
 * mutating · against TODAY's signals, and emits a recommendation
 * envelope when the engine would currently disagree with the active
 * plan_workouts row.
 *
 * Re-fires when:
 *   · live signals still suggest a different prescription
 *   · runner doesn't already have an accepted proposal for this row
 *
 * Clears when:
 *   · the canonical Readiness decision (`resolveRunnerState`) returns to
 *     `proceed` / `proceed_with_caution` — e.g. the training-gap re-entry
 *     window closes
 *   · runner accepts the recommendation (fresh adaptation fires)
 *   · workout is past (completed or archived)
 *
 * Doctrine: respect the runner's override. The engine never re-applies
 * silently. The recommendation is a respectful second opinion ·
 * forward counsel, not a replay of history.
 *
 * ── 2026-09-11 · STANDINGREC-1 · routed through the canonical Readiness
 *    owner instead of deciding from raw pillars ─────────────────────────────
 *
 * This composer used to hold its own `evaluateSignals(brief)` — a private
 * re-implementation of `convergence.ts`'s own "why the old gate had to go"
 * story: it fired a recommendation on ANY ONE of a pull-back band, a single
 * sleep streak, one elevated-RHR reading, an HRV streak, or two soft
 * pillars. `docs/BRAIN_CONSTITUTION.md`'s ownership table is explicit — "Is
 * normal training appropriate today? | Readiness" — and
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`'s "one canonical
 * resolver per derived value" rule means that question has ONE owner:
 * `resolveRunnerState()` in `lib/training/runner-state.ts`, which is
 * self-described as "ONE owning service answers 'is the planned demand
 * appropriate today'". A second, file-local answer to the same question is
 * exactly the "no side doors" violation the constitution forbids.
 *
 * `resolveRunnerState()` is ALSO what `docs/PLAN_SIMPLIFICATION_DOCTRINE.md`'s
 * "runner owns readiness" ruling (2026-09-02) already narrowed: sleep, HRV,
 * RHR and subjective readiness no longer argue for any training decision at
 * all — see that module's own header ("`gradeConvergence` is no longer an
 * input ... the owner has ruled he decides how ready he is"). Routing through
 * it rather than through `gradeConvergence` directly means this composer
 * inherits BOTH doctrine corrections at once: no single-domain trigger, and
 * no readiness-pillar trigger, full stop. The only driving signal left that
 * can carry `resolveRunnerState` past `proceed`/`proceed_with_caution` is a
 * training-gap re-entry (`runnerIsCompromised` · `gap_reentry`) — a fact about
 * what he ran, not an opinion about how he slept.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { resolveRunnerState, type RunnerState } from '@/lib/training/runner-state';
import type { ReadinessBrief } from './readiness-brief';

export type StandingRecommendationKind =
  | 'ease_down'    // engine recommends downgrading the workout type
  | 'shave'        // engine recommends cutting distance
  | 'reschedule'   // engine recommends moving to a different day
  | 'maintain'     // engine recommends holding course (rare · usually surfaces "no recommendation")
  | 'push_back';   // engine recommends delaying / extra rest

export interface StandingRecommendation {
  kind: StandingRecommendationKind;
  /** Single sentence in coach voice. No citations. Names WHY. */
  copy: string;
  /** Kind-specific payload for the "accept" action. */
  suggestion: {
    proposedType?: string;        // ease_down · 'easy' / 'recovery'
    proposedDistanceMi?: number;  // shave · the new distance
    proposedDateIso?: string;     // reschedule · new date
  } | null;
  severity: 'advisory' | 'firm';
}

export interface StandingRecommendationInput {
  workoutId: string;
  userUuid: string;
  /** The active workout's current row (post-restore if applicable). */
  workout: {
    type: string;
    distance_mi: number;
    date_iso: string;
    is_quality: boolean;
  };
  /** Today's readiness brief. 2026-09-11 · STANDINGREC-1 · no longer read
   *  for the RECOMMENDATION DECISION (that question now belongs entirely to
   *  `resolveRunnerState()`, see the module doc block) — kept only as a
   *  load-succeeded gate, so a brief the caller could not assemble still
   *  short-circuits to null rather than composing against nothing. Pass
   *  null when not available. */
  brief: ReadinessBrief | null;
}

/**
 * Compose the standing recommendation for a planned-day shape.
 *
 * Returns null when:
 *   · brief is null (the caller could not assemble one)
 *   · workout is not a quality day (engine doesn't recommend changes
 *     to easy / recovery / rest)
 *   · the canonical Readiness decision is `proceed` or `proceed_with_caution`
 *     (see STANDINGREC-1) — no standing disagreement to report
 *   · runner already accepted a proposal for this workoutId
 *
 * The composer is read-only · never mutates plan_workouts. The
 * runner explicitly accepts via the standing-recommendation Accept
 * action which routes through the existing adapter mutation path.
 */
export async function composeStandingRecommendation(
  input: StandingRecommendationInput,
): Promise<StandingRecommendation | null> {
  const { workout, brief, userUuid, workoutId } = input;

  // No brief · no signal to recommend from.
  if (!brief) return null;

  // Workout already past · no recommendation needed.
  const today = await runnerToday(userUuid);
  if (workout.date_iso < today) return null;

  // Only quality workouts get recommendations · easy/recovery/rest
  // are already at the floor (downgrading from easy is meaningless).
  const QUALITY_TYPES = new Set(['intervals', 'tempo', 'threshold', 'long']);
  if (!QUALITY_TYPES.has(workout.type)) return null;

  // Check if the runner already accepted a proposal for this row.
  // If so · the engine has no standing disagreement.
  const acceptedProposal = await checkAcceptedProposal(userUuid, workoutId);
  if (acceptedProposal) return null;

  // Ask THE canonical owner of "is normal training appropriate today"
  // (BRAIN_CONSTITUTION.md's ownership table · Readiness row) rather than
  // deciding from raw pillar data. See STANDINGREC-1 in the module doc
  // block for why this replaced a private, single-domain evaluator.
  const state = await resolveRunnerState(userUuid, today);
  const signal = evaluateRunnerState(state);
  if (!signal) return null;

  // Compose the recommendation envelope.
  return composeEnvelope(workout, signal);
}

// ─── signal evaluation ─────────────────────────────────────────────────

interface SignalFinding {
  trigger: 'training_gap' | 'state_other';
  /** Coach-voice-safe plain English (used by composer). Never the
   *  resolver's own `driver.detail` — `RunnerStateSignal.detail` is typed
   *  "Never runner-facing copy" in runner-state.ts, so it is read for
   *  ROUTING only and a human sentence is composed fresh here. */
  detail: string;
  severity: 'advisory' | 'firm';
}

/**
 * Map the canonical Readiness decision onto a standing-recommendation
 * signal. `proceed` and `proceed_with_caution` never produce one:
 * `prescription-resolver.ts`'s own doctrine is that `proceed_with_caution`
 * "REFUSES TO TIGHTEN" — an unreadable state or a soft signal is grounds for
 * saying nothing, never for suggesting a change.
 *
 * `reduce` is, today, reachable by exactly one driving signal —
 * `runnerIsCompromised`'s `gap_reentry` (training-gap re-entry). The
 * `replace` / `recover` / `stop` branch is not reachable by anything
 * `resolveRunnerState` currently carries (illness / injury / niggle were
 * removed at the source 2026-09-02), but is handled rather than silently
 * dropped, so a future driving signal at that severity is not swallowed here.
 */
function evaluateRunnerState(state: RunnerState): SignalFinding | null {
  switch (state.decision) {
    case 'proceed':
    case 'proceed_with_caution':
      return null;
    case 'reduce':
      return {
        trigger: 'training_gap',
        detail: "you're building back up after a gap in training",
        severity: 'firm',
      };
    case 'replace':
    case 'recover':
    case 'stop':
      return {
        trigger: 'state_other',
        detail: 'today calls for a full recovery day, not a modified session',
        severity: 'firm',
      };
  }
}

// ─── envelope composer ─────────────────────────────────────────────────

function composeEnvelope(
  workout: StandingRecommendationInput['workout'],
  signal: SignalFinding,
): StandingRecommendation {
  // `state_other` (replace/recover/stop) is not a modified session · it is
  // "don't run the plan as written today", which `push_back` names and
  // `ease_down`'s same-distance-easy suggestion does not. Not reachable by
  // any driving signal today (see evaluateRunnerState's doc), kept so a
  // future one is not silently coerced into the wrong kind.
  if (signal.trigger === 'state_other') {
    return {
      kind: 'push_back',
      copy: composeCopy(workout, signal),
      suggestion: null,
      severity: signal.severity,
    };
  }
  // training_gap · quality workouts get the ease_down recommendation as the
  // canonical response, same as before.
  return {
    kind: 'ease_down',
    copy: composeCopy(workout, signal),
    suggestion: {
      proposedType: workout.type === 'long' ? 'easy' : 'easy',
      // Keep distance · the standard ease_down preserves volume but
      // drops intensity. (Future · multi-suggestion stacking could
      // emit a shave + ease combo when load also too high.)
      proposedDistanceMi: workout.distance_mi,
    },
    severity: signal.severity,
  };
}

function composeCopy(
  workout: StandingRecommendationInput['workout'],
  signal: SignalFinding,
): string {
  // Sentence case · capitalize the phrase after the · so each clause
  // reads as its own sentence (Davids locked copy rule 2026-06-01).
  const phrase = signal.detail.charAt(0).toUpperCase() + signal.detail.slice(1);
  // RULE FOUR · the app does not refer to itself in the third person. "Coach
  // still recommends" is software describing its own output; a coach says
  // the thing. Nothing else in the v5 voice names the coach as an actor.
  if (signal.trigger === 'state_other') {
    return `Sitting this one out still stands · ${phrase}.`;
  }
  if (workout.type === 'long') {
    return `Pulling back today's long still stands · ${phrase}.`;
  }
  // intervals / tempo / threshold
  return `Easing this run still stands · ${phrase}.`;
}

// ─── accepted-proposal check ───────────────────────────────────────────

async function checkAcceptedProposal(userUuid: string, workoutId: string): Promise<boolean> {
  // Look for a recent (last 7 days) accepted plan_proposals row that
  // mutated this workoutId. We check coach_intents for the
  // plan_adapt_overridden record · if the user overrode WITHIN the
  // last hour, we still want to show standing recommendation (they
  // just made the call). If older, the override is the standing
  // state and no new recommendation needed unless live signals fire.
  // ACTUALLY · the brief says re-evaluate live every render. So this
  // function only checks for ACCEPTED proposals (runner clicked
  // "Accept ease" which fires a fresh adaptation). Not overrides.
  const r = (await pool.query<{ id: number }>(
    `SELECT id FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1::uuid
        AND field = $2
        AND reason = 'plan_adapt_accepted'
        AND ts >= NOW() - INTERVAL '7 days'
      LIMIT 1`,
    [userUuid, workoutId],
  ).catch(() => ({ rows: [] }))).rows[0];
  return r != null;
}
