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
import { loadProjectionSeries, loadLatestVdotWithAnchor } from '@/lib/training/projection-snapshots';
import { diagnoseLimiter, type LimiterRead, type PerformancePoint } from '@/lib/coach/limiter';
import { normalWeeklyMileage } from '@/lib/training/normal-window';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { vdotFromRace, goalDistanceMiFromCode, parseRaceTime } from '@/lib/training/vdot';
import { closableSecPerWeek } from '@/lib/training/vdot-gain-rate';
import { taperWeeksForDistance } from '@/lib/training/fitness-trajectory';
import { assessGoal, type GoalAssessment } from '@/lib/training/goal-assessment';
import { distanceCategoryOrNull } from '@/lib/race/distance-category';
import { postRaceRecoveryWeeks } from './goal-tiers';
import { runnerToday } from '@/lib/runtime/runner-tz';

export type GoalGapStatus = 'closing' | 'static' | 'widening' | 'unclosable';

export interface GoalGap {
  /** 2026-08-18 · WHERE the target came from.
   *   · 'race' · a booked race row with plan.goal.finish_time_s
   *   · 'goal' · a no-race distance goal in profile.tt_goal_* (the plan is a
   *              GOAL-MODE plan with race_id NULL)
   *  This engine used to refuse goal mode outright (`if (!planRow?.race_id)
   *  return null`), so a runner with a distance goal and no race booked was
   *  never told their goal was out of reach — the one population that has
   *  nothing else to tell them. */
  mode: 'race' | 'goal';
  /** Race slug this gap is anchored to. Null in goal mode (there is no race). */
  raceSlug: string | null;
  /** Race date (ISO YYYY-MM-DD). In goal mode, the goal plan's deadline
   *  (training_plans.goal_iso); null when the goal has no date at all. */
  raceDateISO: string | null;
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
  /** Weeks remaining until race day (rounded down · raceWeek = 0). Null when
   *  the goal carries no date — an open-ended distance goal has no runway to
   *  count down, and inventing one would make every downstream verdict wrong. */
  weeksRemaining: number | null;
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
  /** 2026-08-18 · the honest read on the goal itself: is it reachable, what
   *  is this build genuinely worth (safe / stretch), and what is the limiter.
   *  Null when there is not enough to say. See lib/training/goal-assessment.ts.
   *  Everything inside it is PROJECTED, never measured. */
  assessment: GoalAssessment | null;
  /** Days the gap has been widening (drives auto-rebuild trigger). */
  consecutiveWideningDays: number;
  /** 2026-08-17 · days (most recent backwards) the gap has exceeded the
   *  unclosable threshold. Drives the goal-OUTLOOK note in the plan-drift
   *  cron (sustained ≥5 days → state where the evidence puts him while the
   *  stated goal stays untouched). 2026-08-30 · it used to drive a
   *  goal-RENEGOTIATION proposal with a button that rewrote `goalSec`; that
   *  is retired, see lib/plan/goal-immutability.ts. */
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
  // 1. Active plan · race-anchored OR goal-mode.
  //
  // 2026-08-18 · this used to be `if (!planRow?.race_id) return null`, which
  // made the whole engine blind to no-race goal mode. Those runners have a
  // real target (profile.tt_goal_*) and a real deadline (the goal plan's
  // goal_iso), and they are the population with NO race-day reckoning coming
  // to correct an unrealistic goal for them.
  const planRow = (await pool.query<{
    race_id: string | null; authored_iso: string | null; goal_iso: string | null; goal_mode: string | null;
  }>(
    `SELECT race_id,
            authored_iso::text AS authored_iso,
            goal_iso,
            authored_state->>'goal_mode' AS goal_mode
       FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC
      LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!planRow) return null;

  let mode: GoalGap['mode'];
  let raceSlug: string | null = null;
  let goalSec: number;
  let raceDateISO: string | null;
  let raceDistanceMi: number;

  if (planRow.race_id) {
    mode = 'race';
    const raceRow = (await pool.query<{ slug: string; meta: any; plan: any }>(
      `SELECT slug, meta, plan FROM races
        WHERE user_uuid = $1::uuid AND slug = $2
        LIMIT 1`,
      [userUuid, planRow.race_id],
    ).catch(() => ({ rows: [] }))).rows[0];
    if (!raceRow) return null;

    goalSec = Number(raceRow.plan?.goal?.finish_time_s);
    raceDateISO = String(raceRow.meta?.date ?? '').slice(0, 10) || null;
    raceDistanceMi = Number(raceRow.meta?.distanceMi);
    raceSlug = raceRow.slug;
    if (!Number.isFinite(goalSec) || !raceDateISO || !Number.isFinite(raceDistanceMi)) {
      return null;
    }
  } else {
    // ── GOAL MODE ───────────────────────────────────────────────────────
    // The target lives in profile.tt_goal_* rather than in a race row, and
    // the deadline is the goal plan's own goal_iso (persistPlan writes the
    // synthetic target date there). Same resolution the Targets projection
    // route already does for these runners — one shape, two callers.
    mode = 'goal';
    const prof = (await pool.query<{ d: string | null; t: string | null; s: number | string | null }>(
      `SELECT tt_goal_distance AS d, tt_goal_time AS t, tt_goal_time_seconds AS s
         FROM profile WHERE user_uuid = $1::uuid LIMIT 1`,
      [userUuid],
    ).catch(() => ({ rows: [] }))).rows[0];
    const dMi = goalDistanceMiFromCode(prof?.d);
    if (!prof?.d || dMi == null) return null;
    // tt_goal_time_seconds is authoritative (written by /api/profile/goal);
    // legacy onboarding rows carry only a display string, and a bucket range
    // like "22-25" correctly fails to parse rather than being guessed at.
    const secs = prof.s != null ? Number(prof.s) : parseRaceTime(prof.t);
    if (secs == null || !Number.isFinite(secs) || secs <= 0) return null;
    goalSec = secs;
    raceDistanceMi = dMi;
    raceDateISO = planRow.goal_iso ? String(planRow.goal_iso).slice(0, 10) : null;
  }

  // 2. Recent projection series for trajectory + trend
  const series = await loadProjectionSeries(userUuid, raceDistanceMi, 14);
  const latest = series.at(-1);
  if (!latest || latest.projectionSec == null) return null;
  const trajectorySec = latest.projectionSec;
  const gapSec = trajectorySec - goalSec;

  // 3. Weeks remaining · null when the goal carries no date (open-ended
  //    distance goal). Nothing downstream may substitute a runway it does
  //    not have.
  const todayISO = await runnerToday(userUuid).catch(() => new Date().toISOString().slice(0, 10));
  let weeksRemaining: number | null = null;
  if (raceDateISO) {
    const today = Date.parse(todayISO + 'T12:00:00Z');
    const race = Date.parse(raceDateISO + 'T12:00:00Z');
    const daysRemaining = Math.max(0, Math.floor((race - today) / 86400000));
    weeksRemaining = Math.floor(daysRemaining / 7);
  }

  // 4. Trend + status
  const { status, consecutiveWideningDays, consecutiveUnclosableDays } =
    classifyTrend(series, goalSec, weeksRemaining, raceDistanceMi);

  // 5. Confidence band · scales with projection stability + data density
  const confidence = computeConfidence(series);

  // Measured weekly volume · one read, two consumers (the limiter's volume
  // signal and the assessment's volume caution).
  //
  // RULE 8 (2026-08-30) · both consumers ask a HABIT question — "is this
  // runner's normal volume too low for the distance he has entered" — so this
  // reads `normalWeeklyMileage`, not `recentWeeklyMileageMi`. The raw 28-day
  // mean is the right number for a drift check ("how much did he run") and the
  // wrong one here: measured the fortnight after a half marathon it reports
  // the taper the engine itself prescribed and then blames him for it.
  //
  // The per-finding guard already in `composeCautions` is not enough on its
  // own, and that is the point of the rule. It suppresses the caution while
  // the runner is INSIDE the taper; a week after the recovery block closes,
  // `inTaperOrRaceWeek` is false again while the 28-day mean is still almost
  // entirely taper, and the caution fires off a number that was never his.
  //
  // A refusal becomes `null`, which is this parameter's existing "cannot say"
  // — the same channel a cold-start runner uses — and is checked by every
  // consumer before it speaks. It is NOT zero: `composeCautions` would read a
  // zero as a real volume and stay silent for the opposite reason.
  const weeklyReading = await normalWeeklyMileage(userUuid, todayISO).catch(() => null);
  const recentWeeklyMi = weeklyReading && weeklyReading.ok ? weeklyReading.value : null;

  // 6. Limiter · WHY the runner is short, not just by how much. Best-effort:
  //    a failure here degrades whatClosesIt, it never blocks the gap.
  const limiter = await loadLimiterForGoal({
    userUuid,
    goalDistanceMi: raceDistanceMi,
    goalSec,
    raceDateISO,
    planAuthoredISO: planRow.authored_iso,
    excludeSlug: raceSlug,
    recentWeeklyMi,
  }).catch(() => null);

  // 7. The honest read on the GOAL itself (safe / stretch / feasibility).
  //    Every input gets its own context resolution below, per CLAUDE.md
  //    §"Per-finding context filters" — the assessment's cautions do NOT
  //    inherit a single surface-level guard.
  const assessment = await loadGoalAssessment({
    userUuid,
    distanceMi: raceDistanceMi,
    goalSec,
    goalDateISO: raceDateISO,
    todayISO,
    currentVdot: latest.vdot ?? null,
    weeksRemaining,
    recentWeeklyMi,
  }).catch(() => null);

  // 8. What closes it · limiter-led, status- and gap-magnitude aware
  const whatClosesIt = composeWhatClosesIt(status, gapSec, weeksRemaining, raceDistanceMi, limiter);

  return {
    mode,
    raceSlug,
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
    assessment,
    consecutiveWideningDays,
    consecutiveUnclosableDays,
    // Internal audit field · never surfaces to runner per the locked
    // "no citations anywhere" rule. Kept on the envelope so adapter/
    // simulator consumers can introspect the source.
    citation: 'goal-gap engine v1',
  };
}

// ─── goal assessment · per-finding context resolution ──────────────────

/**
 * Gather the assessment's inputs, resolving a SEPARATE context filter for each
 * finding rather than one guard for the surface (CLAUDE.md §"Per-finding
 * context filters", locked 2026-05-19 round 4).
 *
 * Concretely, three independent questions are asked here and each answer feeds
 * exactly one caution inside the assessment:
 *
 *   · IS VOLUME DELIBERATELY LOW? Two separate reasons, resolved separately:
 *     inside this distance's taper (weeksRemaining <= its taperWeeks), or
 *     inside the post-race recovery block doctrine prescribes for the last
 *     race actually run. Either one suppresses the volume caution and NOTHING
 *     else — a runner in a taper still gets the evidence and runway cautions.
 *
 *   · HOW OLD IS THE FITNESS ANCHOR? Its own read, feeding only the evidence
 *     caution. A fresh anchor silences that caution regardless of how the
 *     volume or runway findings landed.
 *
 *   · WHAT DISTANCE IS THE ANCHOR? Its own read, feeding only the
 *     marathon-specific lag caution.
 */
async function loadGoalAssessment(args: {
  userUuid: string;
  distanceMi: number;
  goalSec: number;
  goalDateISO: string | null;
  todayISO: string;
  currentVdot: number | null;
  weeksRemaining: number | null;
  recentWeeklyMi: number | null;
}): Promise<GoalAssessment | null> {
  const { userUuid, distanceMi, goalSec, goalDateISO, todayISO, weeksRemaining, recentWeeklyMi } = args;

  const anchor = await loadLatestVdotWithAnchor(userUuid).catch(() => null);
  const currentVdot = args.currentVdot ?? anchor?.vdot ?? null;

  // FILTER 1a · inside this distance's taper. Read off the SAME per-distance
  // taper table the trajectory builds against, never a flat two weeks.
  const inTaper =
    weeksRemaining != null && weeksRemaining <= taperWeeksForDistance(distanceMi);

  // FILTER 1b · inside the post-race recovery block for the last race the
  // runner actually ran. Doctrine sizes that block per distance AND per race
  // priority (goal-tiers postRaceRecoveryWeeks), so this asks the question at
  // the RACE's distance, not the goal's.
  const lastRace = (await pool.query<{ date: string | null; dist: number | null; priority: string | null }>(
    `SELECT meta->>'date' AS date,
            (meta->>'distanceMi')::float AS dist,
            meta->>'priority' AS priority
       FROM races
      WHERE user_uuid = $1::uuid
        AND meta->>'date' IS NOT NULL
        AND (meta->>'date')::date <= CURRENT_DATE
        AND (actual_result IS NOT NULL OR meta->>'finishTime' IS NOT NULL)
      ORDER BY (meta->>'date')::date DESC
      LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  let inPostRaceRecovery = false;
  if (lastRace?.date && lastRace.dist != null) {
    const cat = distanceCategoryOrNull(Number(lastRace.dist));
    if (cat != null) {
      const weeks = postRaceRecoveryWeeks(cat, lastRace.priority);
      const daysSince = Math.floor(
        (Date.parse(todayISO + 'T12:00:00Z') - Date.parse(String(lastRace.date).slice(0, 10) + 'T12:00:00Z')) / 86400000,
      );
      inPostRaceRecovery = daysSince >= 0 && daysSince < weeks * 7;
    }
  }

  // FILTER 2 · anchor age, for the evidence caution only.
  const anchorAgeDays = anchor?.anchorDateISO
    ? Math.floor(
        (Date.parse(todayISO + 'T12:00:00Z') - Date.parse(anchor.anchorDateISO.slice(0, 10) + 'T12:00:00Z')) / 86400000,
      )
    : null;

  return assessGoal({
    distanceMi,
    goalSec,
    goalDateISO,
    todayISO,
    currentVdot,
    recentWeeklyMi,
    context: {
      inTaperOrRaceWeek: inTaper,
      inPostRaceRecovery,
      // FILTER 3 · the anchor's own distance, for the marathon-lag caution.
      anchorDistanceMi: anchor?.anchorDistanceMi ?? null,
      anchorAgeDays,
      // Unknown, and deliberately not guessed: the caution suppresses on null
      // rather than assuming a runner has or has not done a marathon block.
      marathonSpecificBlockDone: null,
    },
  });
}

// ─── trend classification ──────────────────────────────────────────────

/**
 * Benefit of the doubt applied to the closable ceiling before the engine will
 * call a goal unclosable.
 *
 * Not physiology and not dressed as it: it is how wrong the projection is
 * allowed to be before the app says something a runner will not want to hear.
 * The 1.5 predates this file's doctrine work and is unchanged by it; what
 * changed is the quantity it multiplies, which is now derived from Research/01
 * rather than from a fabricated rate.
 */
const UNCLOSABLE_MARGIN = 1.5;

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
  weeksRemaining: number | null,
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

  // Unclosable check FIRST · derived per runner, per distance.
  //
  // 2026-08-18 · THE FABRICATION THIS REPLACES. This block used to open with
  // `Per Daniels: realistic VDOT change in 1 week is ~0.5 pts`, and justify a
  // hardcoded 8 / 18 / 40 / 90 sec-per-week ladder with it. That 0.5 figure is
  // nowhere in Research/. The only passage that puts VDOT change on a clock is
  // Research/01 §"Testing cadence" — reassess every 4-6 weeks, +1 VDOT — i.e.
  // 0.167-0.25 VDOT/wk, half to a third of what the comment claimed. The
  // ladder it justified was therefore ~1.5-2x too permissive, so this engine
  // kept telling runners a goal was "still closable" well past the point an
  // honest read supports. It slipped the 2026-08-17 book-citation sweep only
  // because it wrote `Per Daniels:` where that sweep grepped for `Cite:`.
  //
  // The replacement takes the doctrine rate (fast edge, deliberately: this
  // test should fail only when even the most permissive supported rate cannot
  // get there) through the Daniels table at THIS runner's own fitness. A VDOT
  // point is worth far more seconds to a 4:10 marathoner than to a 2:30 one,
  // which four hardcoded rows could never express.
  //
  // currentVdot comes from the snapshot when present; otherwise it is
  // recovered by inverting the projection itself, which IS a predicted finish
  // time at this distance. When neither resolves (an ultra past the Daniels
  // validity range, or an unusable projection) there is no honest closable
  // rate, so the unclosable verdict is withheld rather than guessed.
  const currentVdot = latest.vdot ?? vdotFromRace(latest.projectionSec, raceDistanceMi);
  const perWeek = closableSecPerWeek(currentVdot, raceDistanceMi);
  // No deadline (an open-ended distance goal) means no runway to run out of,
  // so nothing can be unclosable. Trend is still meaningful and is read below.
  const maxClosableInRemainingTime =
    perWeek != null && weeksRemaining != null ? perWeek * Math.max(1, weeksRemaining) : null;
  // 2026-08-17 · count consecutive days (latest backwards) over the
  // unclosable threshold, so the renegotiation proposal only fires on a
  // SUSTAINED read (≥5 days at the cron), not one bad snapshot. The
  // threshold uses TODAY's weeksRemaining for every snapshot — a ±1-day
  // approximation at week boundaries, conservative in the direction of
  // firing later, never earlier.
  if (maxClosableInRemainingTime != null) {
    const ceiling = maxClosableInRemainingTime * UNCLOSABLE_MARGIN;
    let unclosableDays = 0;
    for (let i = valid.length - 1; i >= 0; i--) {
      const gap = valid[i].projectionSec - goalSec;
      if (gap > ceiling) unclosableDays++;
      else break;
    }
    if (latestGap > ceiling) {
      // Gap exceeds even an optimistic close rate · unclosable
      return { status: 'unclosable', consecutiveWideningDays: 0, consecutiveUnclosableDays: unclosableDays };
    }
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
  /** Null in goal mode when the goal carries no date · blockProgressFraction
   *  then stays null, which the limiter model already degrades honestly on. */
  raceDateISO: string | null;
  planAuthoredISO: string | null;
  /** Null in goal mode · there is no race row to exclude from the curve. */
  excludeSlug: string | null;
  /** Measured recent weekly volume, loaded once by the caller. */
  recentWeeklyMi: number | null;
}): Promise<LimiterRead | null> {
  const { userUuid, goalDistanceMi, goalSec, raceDateISO, planAuthoredISO, excludeSlug, recentWeeklyMi } = args;
  const todayMs = Date.now();

  const rows = (await pool.query<{ slug: string; meta: any; actual_result: any }>(
    `SELECT slug, meta, actual_result FROM races
      WHERE user_uuid = $1::uuid AND ($2::text IS NULL OR slug <> $2)
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

  // How far through the block we are · volume under the peak band is the plan
  // working early and a finding late, and the limiter model needs to know which.
  let blockProgressFraction: number | null = null;
  if (planAuthoredISO && raceDateISO) {
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
  weeksRemaining: number | null,
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
    if (weeksRemaining != null && weeksRemaining <= 4) {
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
      if (weeksRemaining != null && weeksRemaining <= 6) {
        out.push(`${weeksRemaining} weeks left · goal options surface if it keeps widening.`);
      }
    }
    return out;
  }

  // unclosable · only reachable with a real runway (the classifier withholds
  // the verdict without one), so weeksRemaining is non-null here in practice.
  out.push(
    weeksRemaining != null
      ? `Gap is wider than what is typically closable in ${weeksRemaining} weeks.`
      : 'Gap is wider than what is typically closable on this runway.',
  );
  if (limiter && levers[0] && !hedged) {
    out.push(`The work does not change · ${levers[0]}`);
  }
  // 2026-08-30 · this line used to read "Goal renegotiation will surface in the
  // brief when we have one more data week." It promised the runner the exact
  // thing the owner's locked rule says must never exist — a card asking him to
  // lower his stated goal. The goal stays; what surfaces is the projection.
  // See lib/plan/goal-immutability.ts and lib/plan/goal-outlook.ts.
  out.push('The goal stays on the board · the projection is what moves.');
  out.push('Training stays honest · race-day execution still matters at any goal.');
  return out;
}
