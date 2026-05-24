/**
 * Goal-adjustment proposal generator. Per spec §23.4 L4.
 *
 * Closed-loop feature: when fitness has moved enough against the
 * current A-race goal, the coach surfaces a proposal — runner decides.
 * Acceptance triggers downstream re-computation; rejection acknowledges
 * and waits ≥2 weeks before re-proposing.
 *
 * Framework version: the trigger threshold + decision logic is here,
 * but the call-site that fires this on every state change is wired
 * separately (e.g. nightly cron, or after every activity ingest).
 */

import type { CoachState } from '@/lib/coach-state';
import { createProposal, listPendingProposals, revokePendingProposals } from '@/lib/proposal-store';
import { logCoachAction } from '@/lib/coach-actions-store';
import { coach } from './coach';

export interface GoalAdjustmentPayload {
  raceSlug: string;
  raceName: string;
  raceDate: string;
  current: {
    goalFinishS: number;
    goalPaceSPerMi: number;
  };
  proposed: {
    finishS: number;
    paceSPerMi: number;
    direction: 'faster' | 'slower';
  };
  /** Sustained fitness delta (sec/mi) over the window that triggered
   *  this proposal. Positive = faster than goal. */
  sustainedDeltaSPerMi: number;
  windowDays: number;
  headline: string;
  reasoning: string;
}

/** Threshold in sec/mi sustained over 2+ weeks before proposing.
 *  Per spec — meaningful goal change, not noise. */
const PROPOSAL_THRESHOLD_S_PER_MI = 15;
const PROPOSAL_WINDOW_DAYS = 14;
const MIN_RACES_INFORMING = 1; // at least one race result anchoring fitness

/** Idempotent — if a pending goal-change proposal already exists for
 *  this race, returns null (don't double-propose). Otherwise evaluates
 *  the gap and writes a proposal when warranted.
 *
 *  CRITICAL CONTEXT FILTER (CLAUDE.md "Per-finding context filters",
 *  locked 2026-05-19): during the post-race recovery window, fitness
 *  readings are depressed and NOT representative of the runner's true
 *  trajectory — proposing a goal change off that data would be insane
 *  coaching. The whole proposal is suppressed during the window. Same
 *  applies to a heavy-block (stacked races in 30 days). Per-finding
 *  filtering: this check is at the FINDING level, not just the surface
 *  level — the parent surface might suppress its banner during race-
 *  week but this finding fires independently and needs its own guard. */
export async function maybeProposeGoalAdjustment(
  state: CoachState,
  userUuid: string,
  predictedFinishS: number,
  sustainedDeltaSPerMi: number,
  windowDays: number,
): Promise<GoalAdjustmentPayload | null> {
  if (!userUuid) return null;
  const nextA = state.races.nextA;
  if (!nextA || !nextA.goalFinishS) return null;

  // Post-race recovery window — fitness is depressed, not representative.
  // Suppress proposals AND revoke any pending ones that were created
  // before the window started (or by a broken earlier version of this
  // filter). The runner will see fresh proposals naturally once fitness
  // after recovery has stabilized.
  const inPostRaceWindow = state.recoveryWindowEndsISO != null && state.now <= state.recoveryWindowEndsISO;
  if (inPostRaceWindow) {
    await revokePendingProposals(userUuid, 'goal_time_change').catch(() => 0);
    return null;
  }
  // Heavy-block (stacked races) — same logic. Recent racing skews fitness
  // either way; let it settle before renegotiating goals.
  if (state.flags?.heavyBlockSuspected) {
    await revokePendingProposals(userUuid, 'goal_time_change').catch(() => 0);
    return null;
  }

  if (Math.abs(sustainedDeltaSPerMi) < PROPOSAL_THRESHOLD_S_PER_MI) return null;
  if (windowDays < PROPOSAL_WINDOW_DAYS) return null;
  if (((state.races.bestForVdot ?? []).length) < MIN_RACES_INFORMING) return null;

  // Don't re-propose if one is already pending for this race.
  const pending = await listPendingProposals(userUuid);
  const dup = pending.find(
    (p) =>
      p.proposalType === 'goal_time_change' &&
      (p.payload as { raceSlug?: string })?.raceSlug === nextA.slug,
  );
  if (dup) return null;

  const direction: 'faster' | 'slower' = sustainedDeltaSPerMi > 0 ? 'faster' : 'slower';
  const proposedFinishS = Math.round(predictedFinishS);
  const proposedPaceSPerMi = Math.round(predictedFinishS / nextA.distanceMi);
  const currentPaceSPerMi = Math.round(nextA.goalFinishS / nextA.distanceMi);
  const deltaMin = Math.abs(nextA.goalFinishS - proposedFinishS) / 60;

  const headline = direction === 'faster'
    ? `Drop the goal time by ${deltaMin.toFixed(0)} minutes?`
    : `Soften the goal by ${deltaMin.toFixed(0)} minutes?`;

  const reasoning = direction === 'faster'
    ? `Trajectory says you could run ${formatHMS(proposedFinishS)} (${formatPace(proposedPaceSPerMi)}/mi) — ${Math.round(Math.abs(sustainedDeltaSPerMi))} sec/mi inside your current goal of ${formatHMS(nextA.goalFinishS)} (${formatPace(currentPaceSPerMi)}/mi) and held there for ${windowDays} days. Want to bring the goal time down, or hold the goal and bank the buffer for race-day heat?`
    : `Recent fitness reads place you at ${formatHMS(proposedFinishS)} (${formatPace(proposedPaceSPerMi)}/mi) — ${Math.round(Math.abs(sustainedDeltaSPerMi))} sec/mi off your goal of ${formatHMS(nextA.goalFinishS)} (${formatPace(currentPaceSPerMi)}/mi) sustained for ${windowDays} days. Want to soften the target to a realistic finish, or hold and push hard in the remaining build?`;

  const payload: GoalAdjustmentPayload = {
    raceSlug: nextA.slug,
    raceName: nextA.name,
    raceDate: nextA.date,
    current: {
      goalFinishS: nextA.goalFinishS,
      goalPaceSPerMi: currentPaceSPerMi,
    },
    proposed: {
      finishS: proposedFinishS,
      paceSPerMi: proposedPaceSPerMi,
      direction,
    },
    sustainedDeltaSPerMi,
    windowDays,
    headline,
    reasoning,
  };

  await createProposal<GoalAdjustmentPayload>({
    userUuid,
    proposalType: 'goal_time_change',
    payload,
    // Expires after 30 days — refresh signal if still sustained.
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

  await logCoachAction(
    userUuid,
    'propose_goal_adjustment',
    'propose',
    payload,
    'fitness_shift',
    `${direction === 'faster' ? 'Fitness ahead of goal' : 'Fitness behind goal'} by ${Math.round(Math.abs(sustainedDeltaSPerMi))} sec/mi for ${windowDays} days.`,
  );

  return payload;
}

/** Higher-level trigger — call from any path where state has just
 *  changed in a way that could affect race-fitness vs goal (Strava
 *  sync, race result write, daily cron). Pulls the prediction from
 *  raceFitnessPrediction (now real per L1), computes the gap, and
 *  fires maybeProposeGoalAdjustment when warranted.
 *
 *  Cheap to call repeatedly — idempotent via the pending-proposal
 *  check inside maybeProposeGoalAdjustment. Safe to throw — caller
 *  ignores failure (we never want to break the activity ingest path
 *  over a missed proposal).
 *
 *  Window-days approximation: until we cache prediction history,
 *  use the freshness of the underlying race signal as the window
 *  proxy. A 14-day-old race result IS the sustained signal for an
 *  immediate fitness shift — multiple recent races would say it
 *  even louder, but one race within freshness is enough to fire. */
export async function checkAndProposeGoalAdjustment(
  state: CoachState,
  userUuid: string,
  today: string,
): Promise<GoalAdjustmentPayload | null> {
  if (!userUuid) return null;
  const nextA = state.races.nextA;
  if (!nextA || !nextA.goalFinishS) return null;

  // Run the prediction. If the engine can't infer fitness (no recent
  // race), there's nothing to compare against.
  try {
    const pred = await coach.raceFitnessPrediction({
      today,
      state,
      raceName: nextA.name,
      raceDateISO: nextA.date,
      raceDistanceMi: nextA.distanceMi,
      goalTimeS: nextA.goalFinishS,
    });
    const headroom = pred.answer.headroomSPerMi; // positive = predicted faster than goal
    // Window: use freshness of the anchoring race. bestForVdot is sorted
    // newest first; the first one's daysAgo is the signal age. Default
    // 14 days when we can't tell.
    const anchor = state.races.bestForVdot?.[0];
    const windowDays = anchor?.daysAgo != null ? Math.max(anchor.daysAgo, 14) : 14;
    return await maybeProposeGoalAdjustment(
      state,
      userUuid,
      pred.answer.predictedTimeS,
      headroom,
      windowDays,
    );
  } catch {
    return null;
  }
}

function formatHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPace(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
