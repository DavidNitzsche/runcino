/**
 * lib/plan/gap-report.ts · honest projection for the morning brief
 * (Phase 2.3).
 *
 * Composes the daily gap card that shows up in the runner's morning
 * brief. Reads goal-gap (Phase 1.1) + simulator output (Phase 2.1)
 * and frames the trajectory in plain English plus alternative ranges
 * when the gap is widening or unclosable.
 *
 * This is the "honest projection over heroic prescription" surface
 * from Architecture doctrine §1 · the engine never pretends the runner
 * is on track when they're not, and it always offers alternatives when
 * the gap is too wide to close.
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.3
 */

import { computeGoalGap, type GoalGap } from './goal-gap';
import { simulateActivePlan, type SimulatorResult } from './simulator';

export interface GapReport {
  /** Header line · "Tracking 1:32:30 · 2:30 behind goal". */
  headline: string;
  /** Current trajectory in seconds. */
  trajectorySec: number;
  /** Goal time in seconds. */
  goalSec: number;
  /** Signed gap · positive = behind goal. */
  gapSec: number;
  /** 'closing' | 'static' | 'widening' | 'unclosable'. */
  status: GoalGap['status'];
  /** Confidence band from simulator (p25/median/p75 finish times). */
  confidenceBand: {
    p25Sec: number;
    medianSec: number;
    p75Sec: number;
  } | null;
  /** 1-3 specific actions to close (or hold) the gap. */
  whatClosesIt: string[];
  /** Alternative ranges · populated when status != 'closing'. */
  alternativeRanges: {
    a: { sec: number; label: string };  // stretch goal
    b: { sec: number; label: string };  // current trajectory
    c: { sec: number; label: string };  // safe / executable
  } | null;
  /** Weeks remaining until race. */
  weeksRemaining: number;
  /** Days until the renegotiation card surfaces (null = don't surface). */
  daysToRenegotiate: number | null;
  /** Risk flags from the simulator (volume ramps, density issues). */
  riskFlags: string[];
}

/**
 * Goal-renegotiation timing scales with race distance.
 *
 * Surface the renegotiation card when status='unclosable' AND we're
 * within this many weeks of race day. The window scales with distance
 * because:
 *   - 5K: trajectory stable enough to renegotiate at T-2 weeks
 *   - 10K: T-3 weeks
 *   - HM: T-3 weeks
 *   - M: T-4 weeks (more taper volatility, more lead time needed)
 */
const RENEGOTIATION_WINDOW_WEEKS: Record<'5k' | '10k' | 'hm' | 'm', number> = {
  '5k': 2,
  '10k': 3,
  'hm':  3,
  'm':   4,
};

function distanceCategory(mi: number): '5k' | '10k' | 'hm' | 'm' {
  if (mi <= 3.5) return '5k';
  if (mi <= 7)   return '10k';
  if (mi <= 14)  return 'hm';
  return 'm';
}

/**
 * Compose the daily gap report. Returns null when the runner has no
 * active plan / goal / projection data (brand-new user · the brief
 * just doesn't render the gap card).
 */
export async function composeGapReport(userUuid: string): Promise<GapReport | null> {
  const [gap, sim] = await Promise.all([
    computeGoalGap(userUuid),
    simulateActivePlan(userUuid),
  ]);

  if (!gap) return null;

  const headline = composeHeadline(gap);
  const confidenceBand = sim?.finalProjection.medianSec != null
    ? {
        p25Sec: sim.finalProjection.p25Sec ?? sim.finalProjection.medianSec,
        medianSec: sim.finalProjection.medianSec,
        p75Sec: sim.finalProjection.p75Sec ?? sim.finalProjection.medianSec,
      }
    : null;

  // Alternative ranges · populated when not 'closing'
  const alternativeRanges = composeAlternativeRanges(gap, confidenceBand);

  // Renegotiation window · null when not applicable
  const cat = distanceCategory(gap.raceDistanceMi);
  const renegWeeks = RENEGOTIATION_WINDOW_WEEKS[cat];
  const daysToRenegotiate = gap.status === 'unclosable' && gap.weeksRemaining <= renegWeeks
    ? 0   // surface NOW
    : gap.status === 'unclosable'
      ? Math.max(0, (gap.weeksRemaining - renegWeeks) * 7)
      : null;

  return {
    headline,
    trajectorySec: gap.trajectorySec,
    goalSec: gap.goalSec,
    gapSec: gap.gapSec,
    status: gap.status,
    confidenceBand,
    whatClosesIt: gap.whatClosesIt,
    alternativeRanges,
    weeksRemaining: gap.weeksRemaining,
    daysToRenegotiate,
    riskFlags: sim?.riskFlags ?? [],
  };
}

// ─── helpers ───────────────────────────────────────────────────────────

function composeHeadline(gap: GoalGap): string {
  const traj = formatTime(gap.trajectorySec);
  const absGap = Math.abs(gap.gapSec);
  const gapStr = formatGapShort(absGap);
  if (gap.status === 'closing') {
    return `Tracking ${traj} · gap closing toward ${formatTime(gap.goalSec)}.`;
  }
  if (gap.status === 'static') {
    if (gap.gapSec > 0) {
      return `Tracking ${traj} · ${gapStr} behind your ${formatTime(gap.goalSec)} goal.`;
    }
    return `Tracking ${traj} · ${gapStr} ahead of your ${formatTime(gap.goalSec)} goal.`;
  }
  if (gap.status === 'widening') {
    return `Tracking ${traj} · ${gapStr} behind goal and trending wider.`;
  }
  // unclosable
  return `Tracking ${traj} · gap to ${formatTime(gap.goalSec)} is wider than ` +
    `${gap.weeksRemaining} weeks can close.`;
}

function composeAlternativeRanges(
  gap: GoalGap,
  band: GapReport['confidenceBand'],
): GapReport['alternativeRanges'] {
  if (gap.status === 'closing') return null;  // no renegotiation needed yet
  if (!band) return null;

  // A-goal · stretch · use p25 (faster end of confidence band)
  // B-goal · current trajectory · use median
  // C-goal · executable · use p75 (slower end)
  return {
    a: { sec: band.p25Sec, label: 'A-goal · stretch but possible' },
    b: { sec: band.medianSec, label: 'B-goal · where you\'re tracking' },
    c: { sec: band.p75Sec, label: 'C-goal · safe + executable' },
  };
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatGapShort(absSec: number): string {
  if (absSec < 60) return `${absSec}s`;
  const m = Math.floor(absSec / 60);
  const s = absSec % 60;
  if (s === 0) return `${m}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
