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
 *   · signals that prompted the prior recommendation have resolved
 *     (sleep streak broke, RHR back to baseline)
 *   · runner accepts the recommendation (fresh adaptation fires)
 *   · workout is past (completed or archived)
 *
 * Doctrine: respect the runner's override. The engine never re-applies
 * silently. The recommendation is a respectful second opinion ·
 * forward counsel, not a replay of history.
 */

import { pool } from '@/lib/db/pool';
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
  /** Today's readiness brief (Phase 1 architecture · the multi-signal
   *  composite the adapter reads). Pass null when not available · the
   *  composer returns null in that case. */
  brief: ReadinessBrief | null;
}

/**
 * Compose the standing recommendation for a planned-day shape.
 *
 * Returns null when:
 *   · brief is null (cold start · no signal to recommend from)
 *   · workout is not a quality day (engine doesn't recommend changes
 *     to easy / recovery / rest)
 *   · live signals don't fire any recommendation
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
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  if (workout.date_iso < today) return null;

  // Only quality workouts get recommendations · easy/recovery/rest
  // are already at the floor (downgrading from easy is meaningless).
  const QUALITY_TYPES = new Set(['intervals', 'tempo', 'threshold', 'long']);
  if (!QUALITY_TYPES.has(workout.type)) return null;

  // Check if the runner already accepted a proposal for this row.
  // If so · the engine has no standing disagreement.
  const acceptedProposal = await checkAcceptedProposal(userUuid, workoutId);
  if (acceptedProposal) return null;

  // Evaluate live signals · same logic the auto-adapter uses, but
  // non-mutating. The readiness brief carries the multi-signal
  // composite (Plews HRV + sleep streak + RHR + ACWR + composite).
  const signal = evaluateSignals(brief);
  if (!signal) return null;

  // Compose the recommendation envelope.
  return composeEnvelope(workout, signal);
}

// ─── signal evaluation ─────────────────────────────────────────────────

interface SignalFinding {
  trigger: 'sleep_streak' | 'rhr_elevated' | 'hrv_below' | 'multi_pillar' | 'composite_low';
  /** Plain-English description of the signal (used by composer). */
  detail: string;
  severity: 'advisory' | 'firm';
}

/**
 * Evaluate the readiness brief for trigger signals · mirrors the
 * day-of adapter's detectReadinessPullback logic but stays
 * non-mutating.
 */
function evaluateSignals(brief: ReadinessBrief): SignalFinding | null {
  // No-data case · no recommendation
  if (brief.band === 'no-data') return null;

  // Hard pullback · composite score in pullback band
  if (brief.band === 'pull-back') {
    return {
      trigger: 'composite_low',
      detail: `composite readiness in pull-back band (${brief.score})`,
      severity: 'firm',
    };
  }

  // Sleep streak ≥ 5 days · firm recommendation
  const sleepStreak = brief.streaks.find((s) => s.pillar === 'sleep' && s.direction === 'below');
  if (sleepStreak && sleepStreak.days >= 5) {
    return {
      trigger: 'sleep_streak',
      detail: `sleep below target ${sleepStreak.days} nights running`,
      severity: 'firm',
    };
  }

  // RHR elevated · firm recommendation when ≥ 5 bpm above baseline
  const rhrTile = brief.pillars.find((p) => p.key === 'rhr');
  if (rhrTile && rhrTile.band === 'pull-back') {
    return {
      trigger: 'rhr_elevated',
      detail: `resting HR running elevated vs your baseline`,
      severity: 'firm',
    };
  }

  // HRV streak · 3+ days below baseline
  const hrvStreak = brief.streaks.find((s) => s.pillar === 'hrv' && s.direction === 'below');
  if (hrvStreak && hrvStreak.days >= 3) {
    return {
      trigger: 'hrv_below',
      detail: `HRV below baseline ${hrvStreak.days} days in a row`,
      severity: 'advisory',
    };
  }

  // Multi-pillar amber · 2+ pillars in moderate or pull-back band
  const cautionPillars = brief.pillars.filter((p) => p.band === 'pull-back' || p.band === 'moderate');
  if (cautionPillars.length >= 2) {
    return {
      trigger: 'multi_pillar',
      detail: `multiple recovery signals running soft (${cautionPillars.map((p) => p.label).join(', ')})`,
      severity: 'advisory',
    };
  }

  return null;
}

// ─── envelope composer ─────────────────────────────────────────────────

function composeEnvelope(
  workout: StandingRecommendationInput['workout'],
  signal: SignalFinding,
): StandingRecommendation {
  // Quality workouts always get the ease_down recommendation as the
  // canonical response to recovery signals.
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
  const phrase = signal.detail;
  if (workout.type === 'intervals') {
    return `Coach still recommends easing this run · ${phrase}.`;
  }
  if (workout.type === 'long') {
    return `Coach still recommends pulling back today's long · ${phrase}.`;
  }
  // tempo / threshold
  return `Coach still recommends easing this run · ${phrase}.`;
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
