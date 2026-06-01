/**
 * lib/plan/goal-gap.ts · continuous projection-vs-goal computation.
 *
 * The keystone of the plan engine closed loop · this is what tells the
 * generator + adapter + morning brief whether the plan is actually
 * serving the goal.
 *
 * Reads:
 *   · projection_snapshots (last 14 days) · trajectory + trend
 *   · races.plan.goal.finish_time_s · the target
 *   · training_plans · race date + weeks remaining
 *
 * Returns a GoalGap envelope that drives:
 *   · drift cron · fires rebuild when status='widening' for 3+ consecutive days
 *   · readiness brief · populates the gap card
 *   · simulator · sanity-checks simulator output against real trajectory
 *   · block adapter · "does this downgrade put the goal at risk?"
 *
 * Doctrine: honest projection over heroic prescription (Architecture
 * doc §Doctrine #1). The engine never pretends the runner is on track
 * when they're not.
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.1
 * Cite: Research/22-plan-templates.md §projection-feedback-loop
 */

import { pool } from '@/lib/db/pool';
import { loadProjectionSeries } from '@/lib/training/projection-snapshots';

export type GoalGapStatus = 'closing' | 'static' | 'widening' | 'unclosable';

export interface GoalGap {
  /** Race slug this gap is anchored to. */
  raceSlug: string;
  /** Race date (ISO YYYY-MM-DD). */
  raceDateISO: string;
  /** Race distance (mi). */
  raceDistanceMi: number;
  /** Goal finish time in seconds. */
  goalSec: number;
  /** Current projected finish time in seconds (today's snapshot). */
  trajectorySec: number;
  /** Signed delta · positive = trajectory slower than goal (gap to close).
   *  Negative = trajectory faster than goal (running ahead). */
  gapSec: number;
  /** 0..1 confidence band based on data density + projection stability. */
  confidence: number;
  /** Trajectory direction over the last 14 days. */
  status: GoalGapStatus;
  /** Weeks remaining until race day (rounded down · raceWeek = 0). */
  weeksRemaining: number;
  /** 1-3 specific actions that would close (or hold) the gap. */
  whatClosesIt: string[];
  /** Research/ doctrine citation for every consumer to surface. */
  citation: string;
  /** Days the gap has been widening (drives auto-rebuild trigger). */
  consecutiveWideningDays: number;
}

/**
 * Compute the goal-gap for a runner's active race.
 *
 * Returns null when:
 *   - No active plan
 *   - No race with goal_time_sec set
 *   - No projection snapshots yet (cold start)
 *
 * Best-effort · all reads catch and return null rather than throw so
 * the morning brief never blocks on this signal.
 */
export async function computeGoalGap(userUuid: string): Promise<GoalGap | null> {
  // 1. Active plan + race
  const planRow = (await pool.query<{ race_id: string }>(
    `SELECT race_id FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!planRow?.race_id) return null;

  const raceRow = (await pool.query<{ slug: string; meta: any; plan: any }>(
    `SELECT slug, meta, plan FROM races
      WHERE user_uuid = $1::uuid AND slug = $2
      LIMIT 1`,
    [userUuid, planRow.race_id],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!raceRow) return null;

  const goalSec = Number(raceRow.plan?.goal?.finish_time_s);
  const raceDateISO = String(raceRow.meta?.date ?? '').slice(0, 10);
  const raceDistanceMi = Number(raceRow.meta?.distanceMi);
  if (!Number.isFinite(goalSec) || !raceDateISO || !Number.isFinite(raceDistanceMi)) {
    return null;
  }

  // 2. Recent projection series for trajectory + trend
  const series = await loadProjectionSeries(userUuid, raceDistanceMi, 14);
  const latest = series.at(-1);
  if (!latest || latest.projectionSec == null) return null;
  const trajectorySec = latest.projectionSec;
  const gapSec = trajectorySec - goalSec;

  // 3. Weeks remaining
  const today = new Date();
  const race = new Date(raceDateISO + 'T12:00:00Z');
  const daysRemaining = Math.max(0, Math.floor((race.getTime() - today.getTime()) / 86400000));
  const weeksRemaining = Math.floor(daysRemaining / 7);

  // 4. Trend + status
  const { status, consecutiveWideningDays } = classifyTrend(series, goalSec, weeksRemaining, raceDistanceMi);

  // 5. Confidence band · scales with projection stability + data density
  const confidence = computeConfidence(series);

  // 6. What closes it · status + gap-magnitude aware
  const whatClosesIt = composeWhatClosesIt(status, gapSec, weeksRemaining, raceDistanceMi);

  return {
    raceSlug: raceRow.slug,
    raceDateISO,
    raceDistanceMi,
    goalSec,
    trajectorySec,
    gapSec,
    confidence,
    status,
    weeksRemaining,
    whatClosesIt,
    consecutiveWideningDays,
    // Internal audit field · never surfaces to runner per the locked
    // "no citations anywhere" rule. Kept on the envelope so adapter/
    // simulator consumers can introspect the source.
    citation: 'goal-gap engine v1',
  };
}

// ─── trend classification ──────────────────────────────────────────────

/**
 * Classify the projection trend as closing/static/widening/unclosable.
 *
 * - **closing** · trajectory is moving toward the goal (gap shrinking)
 * - **static** · trajectory is stable, gap unchanged · normal mid-block state
 * - **widening** · trajectory is moving away from the goal (gap growing)
 * - **unclosable** · gap is too large for remaining weeks to close
 *
 * "Unclosable" thresholds scale with race distance: a 30-sec gap with
 * 1 week to go in a 5K is unclosable; the same gap in a marathon is
 * closing-territory.
 */
function classifyTrend(
  series: Array<{ date: string; projectionSec: number | null; vdot: number | null }>,
  goalSec: number,
  weeksRemaining: number,
  raceDistanceMi: number,
): { status: GoalGapStatus; consecutiveWideningDays: number } {
  const valid = series.filter((s) => s.projectionSec != null) as Array<{
    date: string; projectionSec: number; vdot: number | null;
  }>;
  if (valid.length < 3) {
    return { status: 'static', consecutiveWideningDays: 0 };
  }

  const latest = valid.at(-1)!;
  const latestGap = latest.projectionSec - goalSec;

  // Unclosable check FIRST · scales with race distance.
  // Per Daniels: realistic VDOT change in 1 week is ~0.5 pts which
  // corresponds to roughly these per-distance time changes:
  //   5K   · ~8 sec/week of finish time
  //   10K  · ~18 sec/week
  //   HM   · ~40 sec/week
  //   M    · ~90 sec/week
  const closableSecPerWeek =
      raceDistanceMi <= 3.5  ? 8
    : raceDistanceMi <= 7    ? 18
    : raceDistanceMi <= 14   ? 40
    :                          90;
  const maxClosableInRemainingTime = closableSecPerWeek * Math.max(1, weeksRemaining);
  if (latestGap > maxClosableInRemainingTime * 1.5) {
    // Gap exceeds even an optimistic close rate · unclosable
    return { status: 'unclosable', consecutiveWideningDays: 0 };
  }

  // Count consecutive widening days (most recent backwards)
  let widening = 0;
  for (let i = valid.length - 1; i > 0; i--) {
    const cur = valid[i].projectionSec - goalSec;
    const prev = valid[i - 1].projectionSec - goalSec;
    if (cur > prev + 1) widening++;  // +1s tolerance for noise
    else break;
  }

  // Trend direction · compare latest 3-day avg vs 7-day-prior avg
  const recent3 = valid.slice(-3);
  const earlier = valid.slice(-10, -3);
  if (recent3.length === 3 && earlier.length >= 3) {
    const recentAvgGap = recent3.reduce((s, p) => s + (p.projectionSec - goalSec), 0) / recent3.length;
    const earlierAvgGap = earlier.reduce((s, p) => s + (p.projectionSec - goalSec), 0) / earlier.length;
    const delta = recentAvgGap - earlierAvgGap;
    // 2% of goal time is the noise floor · stable when within
    const noiseFloor = goalSec * 0.02;
    if (delta < -noiseFloor) return { status: 'closing', consecutiveWideningDays: 0 };
    if (delta >  noiseFloor) return { status: 'widening', consecutiveWideningDays: widening };
    return { status: 'static', consecutiveWideningDays: 0 };
  }
  return { status: 'static', consecutiveWideningDays: widening };
}

// ─── confidence band ───────────────────────────────────────────────────

/**
 * Confidence in the trajectory (0..1):
 * - 1.0 when 14 days of dense snapshots + low day-to-day variance
 * - 0.5 when ~7 days of data
 * - 0.2 when only 3 days (just enough to call it)
 */
function computeConfidence(
  series: Array<{ date: string; projectionSec: number | null; vdot: number | null }>,
): number {
  const valid = series.filter((s) => s.projectionSec != null);
  if (valid.length < 3) return 0;

  // Density component · how many days have data out of 14
  const density = Math.min(1, valid.length / 14);

  // Stability component · low coefficient of variation = high confidence
  const values = valid.map((p) => p.projectionSec!) as number[];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;
  const stability = Math.max(0, 1 - cv * 10);  // 10% CV → 0 stability

  return Math.round((density * 0.6 + stability * 0.4) * 100) / 100;
}

// ─── what closes it ────────────────────────────────────────────────────

/**
 * Compose 1-3 specific actions the runner can take to close (or hold)
 * the gap. Status-aware:
 *   · closing · "here's what we need to see to keep it"
 *   · static · "one more strong long run + threshold consistency"
 *   · widening · "shift toward threshold density / cut down on lifestyle drag"
 *   · unclosable · "we'll surface goal-renegotiation when we get closer"
 *
 * Gap-magnitude aware: a 10-sec gap on a marathon is noise; a 10-sec
 * gap on a 5K is meaningful.
 */
function composeWhatClosesIt(
  status: GoalGapStatus,
  gapSec: number,
  weeksRemaining: number,
  raceDistanceMi: number,
): string[] {
  const out: string[] = [];

  if (status === 'closing') {
    out.push('Hold the threshold consistency · Trajectory is moving toward the goal.');
    if (weeksRemaining <= 4) {
      out.push('Keep the long-run progression honest · Race-pace miles are doing the work.');
    }
    return out;
  }

  if (status === 'static') {
    if (gapSec > 0) {
      out.push('One more strong long run + threshold day per week closes ~15-30s/week.');
      if (raceDistanceMi >= 13) {
        out.push('Marathon-pace integration in the long run shifts the projection by 0.5 VDOT/4wk.');
      }
    } else {
      out.push('Running ahead of the goal · Maintain rhythm, no need to push harder.');
    }
    return out;
  }

  if (status === 'widening') {
    out.push('Threshold density is the lever · 2 quality days/week vs current 1.');
    out.push('Check the readiness brief · Widening trajectory often tracks sleep + RHR drift.');
    if (weeksRemaining <= 6) {
      out.push(`${weeksRemaining} weeks left · We'll surface goal options if it keeps widening.`);
    }
    return out;
  }

  // unclosable
  out.push(`Gap is wider than what's typically closable in ${weeksRemaining} weeks.`);
  out.push('Goal renegotiation will surface in the brief when we have one more data week.');
  out.push('Training stays honest · Race-day execution still matters at any goal.');
  return out;
}
