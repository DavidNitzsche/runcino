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
import { predictRaceTime, formatRaceTime } from '@/lib/training/vdot';

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
// Each lever produces a hypothetical "projected time after this lever
// lands" and a delta vs the current projection. The deltas are doctrine
// estimates · the panel surfaces them with "would" copy to make clear
// they're projections, not promises.

const VDOT_BUMP_TUNE_UP    = 1.0;
const VDOT_BUMP_THRESHOLD  = 0.5;
const VDOT_BUMP_SHARPEN    = 0.3;
const VDOT_BUMP_VO2        = 0.4;
const VDOT_BUMP_GOAL_PACE  = 0.3;
const CORRAL_CONDITIONS_RECLAIM_PCT = 0.45;

// Runner's chosen B-target in seconds (A + ~3.3% per GapPanel raceweek).
function bTargetSec(goalSec: number): number {
  return goalSec + Math.round(goalSec * 0.033);
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
  const newVdot = Math.min(85, currentVdot + bump);
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
    const bSec = bTargetSec(input.goalSec);
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
  const row = (await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.date_iso >= CURRENT_DATE::text
        AND pw.date_iso < (CURRENT_DATE + $2::int)::text
        AND (
              LOWER(pw.type) LIKE '%threshold%' OR
              LOWER(pw.type) LIKE '%tempo%' OR
              LOWER(pw.type) LIKE '%cruise%'
            )`,
    [userUuid, windowDays],
  ).catch(() => ({ rows: [{ n: '0' }] }))).rows[0];
  return Number(row?.n ?? 0);
}
