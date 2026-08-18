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
 * Cite: Research/22-plan-templates.md §projection-feedback-loop  // TODO: no matching heading in Research/22 — content exists but heading not anchored
 */

import { pool } from '@/lib/db/pool';
import { loadProjectionSeries } from '@/lib/training/projection-snapshots';
import { diagnoseLimiter, type LimiterRead, type PerformancePoint } from '@/lib/coach/limiter';
import { recentWeeklyMileageMi } from '@/lib/runs/volume';
import { distanceMiFromLabel } from '@/lib/race/distance';

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
  /** 1-3 specific actions that would close (or hold) the gap. Composed from
   *  `limiter` below · these used to be hardcoded prose that told every runner
   *  threshold density was their lever regardless of whether it was. */
  whatClosesIt: string[];
  /** 2026-08-17 · what is actually preventing the goal, per
   *  `Design/adaptive-progression-engine.md` §11. Null when the limiter read
   *  could not be assembled (cold start, or a read failed) — `whatClosesIt`
   *  degrades to status-only guidance in that case rather than to the old
   *  invented prose. */
  limiter: LimiterRead | null;
  /** Research/ doctrine citation for every consumer to surface. */
  citation: string;
  /** Days the gap has been widening (drives auto-rebuild trigger). */
  consecutiveWideningDays: number;
  /** 2026-08-17 · days (most recent backwards) the gap has exceeded the
   *  unclosable threshold. Drives the goal-renegotiation proposal in the
   *  plan-drift cron (sustained ≥5 days → propose a revised target band
   *  while the stated goal stays the season ambition). */
  consecutiveUnclosableDays: number;
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
  const planRow = (await pool.query<{ race_id: string; authored_iso: string | null }>(
    `SELECT race_id, authored_iso::text AS authored_iso FROM training_plans
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
  const { status, consecutiveWideningDays, consecutiveUnclosableDays } =
    classifyTrend(series, goalSec, weeksRemaining, raceDistanceMi);

  // 5. Confidence band · scales with projection stability + data density
  const confidence = computeConfidence(series);

  // 6. Limiter · WHY the runner is short, not just by how much. Best-effort:
  //    a failure here degrades whatClosesIt, it never blocks the gap.
  const limiter = await loadLimiterForGoal({
    userUuid,
    goalDistanceMi: raceDistanceMi,
    goalSec,
    raceDateISO,
    planAuthoredISO: planRow.authored_iso,
    excludeSlug: raceRow.slug,
  }).catch(() => null);

  // 7. What closes it · limiter-led, status- and gap-magnitude aware
  const whatClosesIt = composeWhatClosesIt(status, gapSec, weeksRemaining, raceDistanceMi, limiter);

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
    limiter,
    consecutiveWideningDays,
    consecutiveUnclosableDays,
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
export function classifyTrend(
  series: Array<{ date: string; projectionSec: number | null; vdot: number | null }>,
  goalSec: number,
  weeksRemaining: number,
  raceDistanceMi: number,
): { status: GoalGapStatus; consecutiveWideningDays: number; consecutiveUnclosableDays: number } {
  const valid = series.filter((s) => s.projectionSec != null) as Array<{
    date: string; projectionSec: number; vdot: number | null;
  }>;
  if (valid.length < 3) {
    return { status: 'static', consecutiveWideningDays: 0, consecutiveUnclosableDays: 0 };
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
  // 2026-08-17 · count consecutive days (latest backwards) over the
  // unclosable threshold, so the renegotiation proposal only fires on a
  // SUSTAINED read (≥5 days at the cron), not one bad snapshot. The
  // threshold uses TODAY's weeksRemaining for every snapshot — a ±1-day
  // approximation at week boundaries, conservative in the direction of
  // firing later, never earlier.
  let unclosableDays = 0;
  for (let i = valid.length - 1; i >= 0; i--) {
    const gap = valid[i].projectionSec - goalSec;
    if (gap > maxClosableInRemainingTime * 1.5) unclosableDays++;
    else break;
  }
  if (latestGap > maxClosableInRemainingTime * 1.5) {
    // Gap exceeds even an optimistic close rate · unclosable
    return { status: 'unclosable', consecutiveWideningDays: 0, consecutiveUnclosableDays: unclosableDays };
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
    if (delta < -noiseFloor) return { status: 'closing', consecutiveWideningDays: 0, consecutiveUnclosableDays: 0 };
    if (delta >  noiseFloor) return { status: 'widening', consecutiveWideningDays: widening, consecutiveUnclosableDays: 0 };
    return { status: 'static', consecutiveWideningDays: 0, consecutiveUnclosableDays: 0 };
  }
  return { status: 'static', consecutiveWideningDays: widening, consecutiveUnclosableDays: 0 };
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

// ─── limiter assembly ──────────────────────────────────────────────────

/**
 * Assemble what this surface can cheaply see into a limiter read.
 *
 * Deliberately partial. The performance curve and the volume check are the two
 * signals available for one extra query each; fade/decoupling, threshold
 * history and recovery gaps need heavier reads and are left null. The limiter
 * model degrades honestly on nulls — an unreadable dimension lowers confidence
 * rather than inventing a finding — so a partial input produces a weaker read,
 * never a wrong one.
 *
 * Race-data rules (CLAUDE.md, locked 2026-05-19): a performance curve IS a
 * race-result consumer, so it reads `races.actual_result.finishS` first and
 * curated `meta.finishTime` second, and never touches `strava_activities` —
 * an auto-detected 5K split inside a long run would bend the curve toward a
 * speed bias the runner does not have. Watch-provisional results are included
 * (they are real efforts) but flagged, and cost the read a confidence notch.
 */
async function loadLimiterForGoal(args: {
  userUuid: string;
  goalDistanceMi: number;
  goalSec: number;
  raceDateISO: string;
  planAuthoredISO: string | null;
  excludeSlug: string;
}): Promise<LimiterRead | null> {
  const { userUuid, goalDistanceMi, goalSec, raceDateISO, planAuthoredISO, excludeSlug } = args;
  const todayMs = Date.now();

  const rows = (await pool.query<{ slug: string; meta: any; actual_result: any }>(
    `SELECT slug, meta, actual_result FROM races
      WHERE user_uuid = $1::uuid AND slug <> $2
      ORDER BY (meta->>'date') DESC NULLS LAST
      LIMIT 40`,
    [userUuid, excludeSlug],
  ).catch(() => ({ rows: [] }))).rows;

  const performances: PerformancePoint[] = [];
  for (const r of rows) {
    const m = r.meta ?? {};
    const ar = r.actual_result ?? {};
    const dateISO = String(m.date ?? '').slice(0, 10);
    if (!dateISO) continue;
    const ageDays = Math.floor((todayMs - Date.parse(dateISO + 'T12:00:00Z')) / 86400000);
    if (ageDays < 0) continue; // upcoming race · not a performance

    const distanceMi = m.distanceMi ? Number(m.distanceMi) : distanceMiFromLabel(m.distanceLabel ?? null);
    if (!distanceMi || !(distanceMi > 0)) continue;

    // The ladder, per the race-data lock · curated chip time beats stale meta.
    let finishSeconds: number | null = null;
    let provisional = false;
    if (ar?.finishS && Number(ar.finishS) > 0) {
      finishSeconds = Math.round(Number(ar.finishS));
      provisional = ar.provisional === true || ar.source === 'watch_provisional';
    } else if (typeof m.finishTime === 'string') {
      const parts = m.finishTime.split(':').map(Number);
      if (parts.length >= 2 && parts.every((n: number) => Number.isFinite(n))) {
        finishSeconds =
          parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
      }
    }
    if (!finishSeconds || !(finishSeconds > 0)) continue;

    performances.push({ distanceMi, finishSeconds, ageDays, provisional });
  }

  const recentWeeklyMi = await recentWeeklyMileageMi(userUuid).catch(() => null);

  // How far through the block we are · volume under the peak band is the plan
  // working early and a finding late, and the limiter model needs to know which.
  let blockProgressFraction: number | null = null;
  if (planAuthoredISO) {
    const start = Date.parse(String(planAuthoredISO).slice(0, 10) + 'T12:00:00Z');
    const end = Date.parse(raceDateISO + 'T12:00:00Z');
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      blockProgressFraction = Math.max(0, Math.min(1, (todayMs - start) / (end - start)));
    }
  }

  return diagnoseLimiter({
    goalDistanceMi,
    goalPaceSecPerMi: goalDistanceMi > 0 ? goalSec / goalDistanceMi : null,
    experienceLevel: null,
    blockProgressFraction,
    performances: performances.length > 0 ? performances : null,
    fadeObservations: null,
    thresholdPaceStartSecPerMi: null,
    thresholdPaceNowSecPerMi: null,
    thresholdWindowWeeks: null,
    weeklyMiAtWindowStart: null,
    recentWeeklyMi,
    observedHardDayGaps: null,
    sessionsMissingPacesInARow: null,
  });
}

// ─── what closes it ────────────────────────────────────────────────────

/**
 * Compose 1-3 specific actions the runner can take to close (or hold) the gap.
 *
 * 2026-08-17 · this used to return hardcoded prose. Every runner whose
 * trajectory was widening was told "Threshold density is the lever · 2 quality
 * days/week vs current 1", whether or not threshold was their limiter — because
 * the engine had no way to know what their limiter was. That string was the
 * clearest evidence of the §11 hole. The levers now come from the limiter
 * diagnosis, so an endurance-limited runner is told to lengthen the long run
 * and a speed-limited runner is told to add strides.
 *
 * Status still shapes the framing:
 *   · closing · what to hold
 *   · static / widening · what to change, taken from the limiter's lever order
 *   · unclosable · renegotiation, with the limiter named
 *
 * Exported for tests · pure, and the only place the gap turns into advice.
 */
export function composeWhatClosesIt(
  status: GoalGapStatus,
  gapSec: number,
  weeksRemaining: number,
  raceDistanceMi: number,
  limiter: LimiterRead | null,
): string[] {
  const out: string[] = [];
  const levers = limiter?.levers ?? [];
  /** A limiter we are not confident in suggests rather than instructs. */
  const hedged = limiter != null && limiter.confidence === 'low';

  if (status === 'closing') {
    out.push('Hold what you are doing · trajectory is moving toward the goal.');
    if (levers[0]) out.push(`Keep progressing the same lever · ${levers[0]}`);
    if (weeksRemaining <= 4) {
      out.push('Keep the long-run progression honest · the race-specific work is doing it now.');
    }
    return out;
  }

  if (status === 'static' || status === 'widening') {
    if (gapSec <= 0) {
      out.push('Running ahead of the goal · maintain rhythm, no need to push harder.');
      return out;
    }
    if (limiter && levers.length > 0) {
      out.push(
        hedged
          ? `Most likely lever · ${levers[0]}`
          : `${limiter.summary.split('.')[0]} · ${levers[0]}`,
      );
      if (levers[1]) out.push(levers[1]);
    } else {
      // No limiter read · say what is true rather than inventing a lever.
      out.push('Not enough evidence yet to say which lever closes this · training to the demands of the distance.');
    }
    if (status === 'widening') {
      out.push('Check the readiness brief · a widening trajectory often tracks sleep and RHR drift.');
      if (weeksRemaining <= 6) {
        out.push(`${weeksRemaining} weeks left · goal options surface if it keeps widening.`);
      }
    }
    return out;
  }

  // unclosable
  out.push(`Gap is wider than what is typically closable in ${weeksRemaining} weeks.`);
  if (limiter && levers[0] && !hedged) {
    out.push(`The work does not change · ${levers[0]}`);
  }
  out.push('Goal renegotiation will surface in the brief when we have one more data week.');
  out.push('Training stays honest · race-day execution still matters at any goal.');
  return out;
}
