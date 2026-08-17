/**
 * lib/race/b-goal.ts · the one resolver for a race's B · SAFE target.
 *
 * ── Why this module exists ───────────────────────────────────────────
 * Three surfaces derived the B goal independently and two of them
 * disagreed:
 *
 *   race-detail (lib/race/race-detail-pacing.ts) · stored
 *       meta.goalSafeDisplay, else effective + 3.3%.        ← correct
 *   race-week card (views/GapPanel.tsx)          · stored goalSafeSec,
 *       else effective + 3.3%.                              ← correct
 *   race-day hero (views/TodayView.tsx)          · goalSec + 420s flat,
 *       and no readback of the stored value at all.         ← wrong
 *
 * A flat +7:00 is distance-blind. On a marathon it is about +2.9%, which
 * is roughly what a safe target should be. On an 18:00 5K it is +39% —
 * a "safe" target of 25:00, which is not a race plan, it is a jog. The
 * same runner could open the race-day hero and the race page and read
 * two different B goals for the same race, one of them absurd.
 *
 * A proportional offset is the fix: the safe target has to mean the same
 * thing at every distance, and "a few percent slower than the honest
 * target" does. The absolute constant only ever looked right because it
 * was tuned on the one distance its author was training for.
 *
 * ── Semantics ────────────────────────────────────────────────────────
 * 1. A runner-entered B goal always wins. If they wrote it down, it is
 *    theirs; nothing derived may override it.
 * 2. Otherwise derive from the EFFECTIVE target, never the raw stated
 *    goal. When the goal has been demoted for being more than 5% past
 *    the projection (lib/race/effective-race-target.ts), a B derived
 *    from the goal would inherit the same fantasy and land faster than
 *    the A target the runner is actually being paced to.
 * 3. No target at all → null, and callers render '·'. A fabricated
 *    number is worse than an honest blank.
 */

/**
 * Safe-target offset as a fraction of the effective target.
 *
 * 3.3% is the value the race-detail page and the race-week card already
 * shipped, so centralising on it changes no existing surface. It is a
 * product convention rather than a cited physiological constant — if it
 * is ever tuned, or made distance-aware off a Research/08 table, this is
 * the one place to change, and the change lands everywhere at once.
 */
export const B_SAFE_FRACTION = 0.033;

export type BGoalSource = 'stored' | 'derived' | 'none';

export interface BGoalResolution {
  /** Seconds, or null when there is nothing honest to show. */
  sec: number | null;
  source: BGoalSource;
}

export function resolveBGoal(input: {
  /** What the race is actually paced off (EffectiveRaceTarget.targetSec). */
  effectiveTargetSec: number | null | undefined;
  /** Runner-entered B goal in seconds (races.meta.goalSafeDisplay). */
  storedBGoalSec?: number | null;
}): BGoalResolution {
  const stored = input.storedBGoalSec;
  if (stored != null && Number.isFinite(stored) && stored > 0) {
    return { sec: Math.round(stored), source: 'stored' };
  }

  const eff = input.effectiveTargetSec;
  if (eff == null || !Number.isFinite(eff) || eff <= 0) {
    return { sec: null, source: 'none' };
  }

  return { sec: Math.round(eff + eff * B_SAFE_FRACTION), source: 'derived' };
}
