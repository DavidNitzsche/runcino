/**
 * lib/coach/projection-levers.ts · Hit list for the Targets GapPanel.
 *
 * Composes the 2-3 cheapest levers that would actually move the runner's
 * projection toward their A-goal. Used by `goalRace.levers` in the seed
 * → GapPanel renders the hit list directly.
 *
 * Doctrine: no new doctrine. This file COMPOSES existing pieces.
 *   · `predictRaceTime(vdot, distanceMi)` from lib/training/vdot.ts
 *     drives the projection math when a lever bumps VDOT
 *     (tune-up race ≈ +1 VDOT · threshold block ≈ +0.5 · sharpen ≈ +0.3).
 *   · The `races` table tells us what tune-up candidates exist in the
 *     runner's window.
 *   · The active `training_plans` + `plan_workouts` tell us whether
 *     threshold work is already in flight.
 *
 * Generic across all users · queries by userUuid + goalRace, no hardcoded
 * runner identity. Every lever's `linkTo` is a real surface that exists.
 *
 * See designs/briefs/targets-gap-panel-backend-brief.md §2.4 for the
 * decision tree this implements.
 */

import { pool } from '@/lib/db/pool';
import { predictRaceTime, formatRaceTime, DANIELS_VDOT_MAX } from '@/lib/training/vdot';
import { VDOT_PER_ASSESSMENT_BLOCK } from '@/lib/training/vdot-gain-rate';
import { researchSpanBasePct } from '@/lib/training/goal-projection';

export type LeverKind =
  | 'tune_up_race'
  | 'threshold_block'
  | 'vo2_block'
  | 'cooler_corral'
  | 'goal_pace_block'
  | 'hold_fitness'
  | 'set_b_target'
  | 'sharpen';

export interface Lever {
  icon: 'flag' | 'bolt' | 'clock' | 'shield' | 'spark';
  kind: LeverKind;
  title: string;        // "Drop a tune-up 10K"
  detail: string;       // "Carlsbad 10K · Jun 22 re-rates VDOT 49+"
  projectedTime: string;// "1:32:30"
  deltaSec: number;     // negative = faster than current projection
  controllability: 'Trainable' | 'Logistics' | 'Smart';
  linkTo?: string;      // "/races/carlsbad-10k" if applicable
  lvtag: string;        // sub-label for the row
}

export interface ProjectionLeversInput {
  userUuid: string;
  goalRace: {
    slug: string;
    name: string;
    date: string;
    daysAway: number;
    distanceMi: number | null;
    location: string | null;
  };
  /** Current VDOT-based projection in seconds. */
  projectionSec: number;
  /** A-goal in seconds. */
  goalSec: number;
  /** Current runner VDOT (drives lever projection math). */
  currentVdot: number | null;
  /** Per-chunk gap (after baseline subtraction, all ≥ 0). */
  gap: {
    fitness: number;
    conditions: number;
    course: number;
    execution: number;
  };
}

// ─── Lever projection math · per-kind VDOT/seconds delta ───
//
// Each lever produces a hypothetical "projected time after this lever lands"
// and a delta vs the current projection. Every number here is MODELLED — none
// of it has happened — and the panel renders them with "would" copy.
//
// ── LEVER-CITE-1 (2026-08-19) · where these came from ─────────────────────
//
// This block used to be six bare literals under a comment calling them
// "doctrine estimates", with no citation anywhere in the file and no pointer
// into `Research/`. They convert directly into a sentence the runner reads —
// "doing a tune-up race would take X seconds off your projection" — so an
// uncited number here is a promise the app cannot back. Two of the six turn
// out to have real doctrine behind them; the rest are ours, and now say so.

/**
 * A TUNE-UP RACE · +1.0 VDOT. DOCTRINE.
 *
 * The lever does not claim that racing makes a runner fitter. It claims that
 * racing MEASURES them about a point higher than the solo effort their anchor
 * currently rests on, which is what `Research/01-pace-zones-vdot.md`
 * §"Field-test protocols (when no recent race exists)" states outright: a solo
 * 5K time trial's "VDOT may under-read by 1–2 points (no competition)", output
 * "VDOT (apply +1 correction)". The same number falls out of §"Testing cadence"
 * from the other side — one VDOT point per reassessment, and the doc's own
 * example of a reassessment is "(tune-up race, hard tempo session)".
 *
 * Read from `VDOT_PER_ASSESSMENT_BLOCK` rather than re-typed, so there is one
 * definition of doctrine's VDOT point in the engine.
 */
const VDOT_BUMP_TUNE_UP = VDOT_PER_ASSESSMENT_BLOCK;

/**
 * The four TRAINING-BLOCK levers · CONVENTION, bounded by doctrine.
 *
 * `Research/` states no VDOT delta for adding a block of one flavour of work.
 * It states a rate (§"Testing cadence": one point per 4-6 weeks, which is
 * `VDOT_GAIN_PER_WEEK_MAX`) and it states what each session type trains
 * (`Research/04` §5-§7), but nothing anywhere prices "one more threshold block"
 * in VDOT. So these four are OURS. They are written as fractions of the one
 * quantum doctrine does state so that the thing they are relative to is
 * explicit, and so a future edit cannot quietly put a lever above a full
 * reassessment cycle's worth of fitness.
 *
 * The ORDER is not arbitrary even though the values are: threshold work above
 * VO2max work above sharpening, which is `Research/04` §5.1's own framing of
 * threshold as the highest-yield sustainable stimulus and §7's repetition work
 * as economy/neuromuscular rather than aerobic. The MAGNITUDES are a judgement
 * call, held between zero and doctrine's point by
 * `PROJECTION.lever-bumps-under-doctrine-quantum`.
 */
const VDOT_BUMP_THRESHOLD  = VDOT_PER_ASSESSMENT_BLOCK * 0.5;
const VDOT_BUMP_VO2        = VDOT_PER_ASSESSMENT_BLOCK * 0.4;
const VDOT_BUMP_SHARPEN    = VDOT_PER_ASSESSMENT_BLOCK * 0.3;
const VDOT_BUMP_GOAL_PACE  = VDOT_PER_ASSESSMENT_BLOCK * 0.3;

/**
 * How much of the CONDITIONS gap a better corral/wave reclaims · CONVENTION.
 *
 * `Research/02` §13.3 prices heat, and §13.6 prices pacing execution, but
 * nothing in `Research/` says what share of a weather-and-crowding penalty a
 * different start wave gives back — it depends on the race, the field and the
 * hour of the start, none of which the app knows. Just under half is ours, and
 * it is deliberately under half so the lever never reads as the bigger part of
 * the answer.
 */
const CORRAL_CONDITIONS_RECLAIM_PCT = 0.45;

/**
 * The B-target · the slow edge of the honest confidence band.
 *
 * LEVER-CITE-1 · this was a flat 3.3% of the goal at every distance, from
 * nowhere. A B-target is the time a runner should still be happy with, which
 * is the pessimistic edge of what the app already tells them the range is — so
 * it now reads the SAME `Research/02` §13.7 span table `computeConfidenceInterval`
 * sizes the band off, at the target distance. That makes it 2.0% over 5K and
 * 3.0% over the marathon instead of 3.3% at both, and it means the B-target and
 * the band can never disagree about how wide the uncertainty is.
 *
 * Cite: Research/02-race-time-prediction.md §13.7 (confidence intervals)
 */
function bTargetSec(goalSec: number, raceDistanceMi: number): number {
  return goalSec + Math.round(goalSec * researchSpanBasePct(raceDistanceMi) / 100);
}

// Known multi-wave races · keyed by goal race slug. As wave_options
// land on race editorial, this stub goes away.
const KNOWN_MULTI_WAVE: ReadonlySet<string> = new Set([
  'americas-finest-city',
  'big-sur-marathon',
  'cim',
  'la-marathon-2026',
  'los-angeles-marathon',
  'boston-marathon',
  'nyc-marathon',
]);

function projWithVdotBump(currentVdot: number | null, bump: number, distMi: number): number | null {
  if (currentVdot == null || !isFinite(currentVdot)) return null;
  const newVdot = Math.min(DANIELS_VDOT_MAX, currentVdot + bump);
  return predictRaceTime(newVdot, distMi);
}

function fmtClock(sec: number): string {
  return formatRaceTime(Math.round(sec)) ?? '·';
}

/**
 * Compose the Hit list.
 *
 * Returns a 0-3 length array · the panel hides the hit-list section
 * when empty.
 */
export async function computeProjectionLevers(
  input: ProjectionLeversInput,
): Promise<Lever[]> {
  if (!input.goalRace.distanceMi || input.goalSec <= 0) return [];
  const distMi = input.goalRace.distanceMi;
  const goalDate = new Date(input.goalRace.date + 'T00:00:00Z').getTime();
  if (!Number.isFinite(goalDate)) return [];

  // Parallel reads · all best-effort, all null-tolerant.
  const [upcomingRaces, planThresholdCount] = await Promise.all([
    findTuneUpCandidates(input.userUuid, input.goalRace.slug, goalDate, distMi),
    countUpcomingThresholdWorkouts(input.userUuid, 28),
  ]);

  const out: Lever[] = [];

  // Rule 4 · low-fitness-gap → lead with hold_fitness.
  // (Brief order says lead with this when gap.fitness ≤ 30s.)
  if (input.gap.fitness <= 30 && input.gap.fitness >= 0) {
    out.push({
      icon: 'shield',
      kind: 'hold_fitness',
      title: 'Hold the fitness',
      detail: `You only owe ${fmtDelta(input.gap.fitness)} of fitness. ` +
        `Bank freshness instead of chasing more.`,
      projectedTime: fmtClock(Math.max(input.goalSec, input.projectionSec - input.gap.fitness)),
      deltaSec: -input.gap.fitness,
      controllability: 'Trainable',
      lvtag: 'Already there · don\'t over-cook the taper',
    });
  }

  // Rule 1 · tune-up race candidate exists?
  for (const r of upcomingRaces) {
    const proj = projWithVdotBump(input.currentVdot, VDOT_BUMP_TUNE_UP, distMi);
    if (proj == null) break;  // no VDOT → can't project the bump
    const delta = proj - input.projectionSec;  // negative = faster
    out.push({
      icon: 'flag',
      kind: 'tune_up_race',
      title: `Drop a tune-up ${r.distanceLabel}`,
      detail: `${r.name} · ${r.dateShort} re-rates your VDOT. ` +
        `A confirmed result tightens this projection overnight.`,
      projectedTime: fmtClock(Math.max(input.goalSec, proj)),
      deltaSec: Math.round(delta),
      controllability: 'Logistics',
      linkTo: `/races/${r.slug}`,
      lvtag: 'Logistics · register before deadline',
    });
    break;  // only the soonest tune-up
  }

  // Rule 2 · threshold block vs sharpen
  if (input.gap.fitness > 60 && planThresholdCount < 2) {
    const proj = projWithVdotBump(input.currentVdot, VDOT_BUMP_THRESHOLD, distMi);
    if (proj != null) {
      out.push({
        icon: 'bolt',
        kind: 'threshold_block',
        title: 'Threshold block · 3 weeks of cruise intervals',
        detail: `T-pace work consolidates the VDOT you already have. ` +
          `Lowest race wear of the trainable levers.`,
        projectedTime: fmtClock(Math.max(input.goalSec, proj)),
        deltaSec: Math.round(proj - input.projectionSec),
        controllability: 'Trainable',
        lvtag: 'Trainable · 3 weeks of Tue/Thu cruise intervals',
      });
    }
  } else if (planThresholdCount >= 2) {
    // Already on it · the sharpen lever protects the work in flight.
    const proj = projWithVdotBump(input.currentVdot, VDOT_BUMP_SHARPEN, distMi);
    if (proj != null) {
      out.push({
        icon: 'spark',
        kind: 'sharpen',
        title: 'Sharpen the threshold work already in your plan',
        detail: `You already have ${planThresholdCount} threshold sessions ` +
          `scheduled in the next 4 weeks. Hold the doses, don't add more.`,
        projectedTime: fmtClock(Math.max(input.goalSec, proj)),
        deltaSec: Math.round(proj - input.projectionSec),
        controllability: 'Trainable',
        lvtag: 'Trainable · already on the calendar',
      });
    }
  }

  // Rule 3 · cooler corral (only for known multi-wave races AND when
  // conditions chunk meaningfully matters)
  if (KNOWN_MULTI_WAVE.has(input.goalRace.slug) && input.gap.conditions >= 30) {
    const reclaim = Math.round(input.gap.conditions * CORRAL_CONDITIONS_RECLAIM_PCT);
    out.push({
      icon: 'clock',
      kind: 'cooler_corral',
      title: 'Take the cooler corral',
      detail: `Starting in cooler air on ${input.goalRace.name} day claws ` +
        `back more time than training does in the final weeks.`,
      projectedTime: fmtClock(Math.max(input.goalSec, input.projectionSec - reclaim)),
      deltaSec: -reclaim,
      controllability: 'Logistics',
      lvtag: 'Logistics · earlier wave at registration',
    });
  }

  // Rule 5 · off-track? always include set_b_target lever.
  if (input.projectionSec / input.goalSec > 1.08) {
    const bSec = bTargetSec(input.goalSec, distMi);
    out.push({
      icon: 'shield',
      kind: 'set_b_target',
      title: 'Set the B-target now',
      detail: `An honest B-target keeps race day a win instead of a ` +
        `referendum. You can move it back to A if mid-race feels right.`,
      projectedTime: fmtClock(bSec),
      deltaSec: bSec - input.goalSec,
      controllability: 'Smart',
      linkTo: `/races/${input.goalRace.slug}`,
      lvtag: 'Smart · editable on the race page',
    });
  }

  // Rank · trainable first, then logistics, then smart; within tier
  // by impact size (most-negative deltaSec wins).
  const tierWeight: Record<Lever['controllability'], number> = {
    Trainable: 0, Logistics: 1, Smart: 2,
  };
  out.sort((a, b) => {
    const t = tierWeight[a.controllability] - tierWeight[b.controllability];
    if (t !== 0) return t;
    return a.deltaSec - b.deltaSec;  // most-negative (biggest improvement) first
  });

  return out.slice(0, 3);
}

function fmtDelta(sec: number): string {
  const m = Math.floor(Math.abs(sec) / 60);
  const s = Math.abs(sec) % 60;
  return m > 0 ? `${m}:${s < 10 ? '0' : ''}${s}` : `${s}s`;
}

// ─── data fetch helpers ───

interface TuneUpCandidate {
  slug: string;
  name: string;
  date: string;
  distanceMi: number;
  distanceLabel: string;
  dateShort: string;
}

/**
 * Tune-up race candidates: races on the user's calendar that are
 *   · BEFORE the goal race
 *   · 4-10 weeks BEFORE the goal race (right phase distance)
 *   · ≤ goal race's distance
 *   · NOT the goal race itself
 *   · NOT A-priority (A races are too important to use as tune-ups)
 */
async function findTuneUpCandidates(
  userUuid: string,
  goalSlug: string,
  goalDateMs: number,
  goalDistMi: number,
): Promise<TuneUpCandidate[]> {
  const fourWeeksBeforeGoal = new Date(goalDateMs - 4 * 7 * 86400 * 1000).toISOString().slice(0, 10);
  const tenWeeksBeforeGoal = new Date(goalDateMs - 10 * 7 * 86400 * 1000).toISOString().slice(0, 10);

  const rows = (await pool.query(
    `SELECT slug, meta->>'name' AS name, meta->>'date' AS date,
            meta->>'priority' AS priority,
            (meta->>'distanceMi')::numeric AS distance_mi
       FROM races
      WHERE user_uuid = $1
        AND slug <> $2
        AND (meta->>'priority') IS DISTINCT FROM 'A'
        AND (meta->>'date')::date >= $3::date
        AND (meta->>'date')::date <= $4::date
        AND (meta->>'distanceMi')::numeric <= $5::numeric
      ORDER BY (meta->>'date')::date ASC`,
    [userUuid, goalSlug, tenWeeksBeforeGoal, fourWeeksBeforeGoal, goalDistMi],
  ).catch(() => ({ rows: [] as Array<{ slug: string; name: string; date: string; priority: string; distance_mi: string }> }))).rows;

  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    date: r.date,
    distanceMi: Number(r.distance_mi),
    distanceLabel: distanceLabelFor(Number(r.distance_mi)),
    dateShort: niceDate(r.date),
  }));
}

function distanceLabelFor(distMi: number): string {
  if (distMi < 3.5) return '5K';
  if (distMi < 7) return '10K';
  if (distMi < 14) return 'half';
  return 'marathon';
}

function niceDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
      .format(new Date(iso + 'T12:00:00Z'));
  } catch { return iso; }
}

/**
 * Count threshold workouts scheduled in the active plan over the next
 * windowDays. "Threshold work" matches type LIKE '%threshold%' OR
 * '%tempo%' OR '%cruise%' · the plan generator uses these inconsistently.
 */
async function countUpcomingThresholdWorkouts(
  userUuid: string,
  windowDays: number,
): Promise<number> {
  // 2026-06-03 · runner TZ for "today" + future cutoff.
  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  const today = await runnerToday(userUuid);
  const row = (await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.date_iso >= $3::text
        AND pw.date_iso < ($3::date + $2::int)::text
        AND (
              LOWER(pw.type) LIKE '%threshold%' OR
              LOWER(pw.type) LIKE '%tempo%' OR
              LOWER(pw.type) LIKE '%cruise%'
            )`,
    [userUuid, windowDays, today],
  ).catch(() => ({ rows: [{ n: '0' }] }))).rows[0];
  return Number(row?.n ?? 0);
}
