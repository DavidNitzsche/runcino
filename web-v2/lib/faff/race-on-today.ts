/**
 * lib/faff/race-on-today.ts
 *
 * Race-day content for Today (Decision 2: "race information should appear
 * on Today, not only after opening the Run lobby"). This is NOT a third
 * composer of any race fact — every value here is read from the SAME
 * canonical functions `lib/watch/build-workout.ts` and the race-detail
 * route already call:
 *
 *   · lib/race/effective-race-target.ts's `loadEffectiveRaceTarget` — which
 *     is itself a thin adapter over `lib/race/race-outlook.ts`, "the one
 *     race-pace brain." `execution.targetSec` is the CURRENT PRESCRIBED
 *     EXECUTION TARGET; the stated/coach goal is a SEPARATE field, never
 *     merged into it (EXECTARGET-1, docs/BRAIN_CONSTITUTION.md row G's hard
 *     rule: "goal ≠ current training capacity").
 *   · lib/race/race-hr-guidance.ts's `raceHrLine` — the one canonical HR
 *     sentence, including the checkpoint abort criterion.
 *   · lib/race/fuel-resolve.ts + lib/race/execution-plan.ts's
 *     `computeRaceFueling` — the same fueling resolution the watch and the
 *     race-detail execution-plan route use.
 *
 * docs/BRAIN_CONSTITUTION.md row P (UI / Coaching Presentation): "May
 * summarize... May NOT independently calculate... race projection...
 * UI displays intelligence. UI does not create intelligence." Everything
 * below summarizes; nothing here computes a race fact from scratch.
 *
 * Gate: the caller (route.ts) only calls this once it has already
 * established `todayPlan.type === 'race'` — this file does not re-derive
 * that predicate, and returns `null` on any failure so a broken resolver
 * degrades Today to its ordinary rendering rather than failing the request
 * (Rule 3: additive, never load-bearing for the whole page).
 *
 * DELIBERATELY NOT REPLICATED: `build-workout.ts`'s ad hoc `strategyLabel`
 * built from raw `races.meta.goalDisplay` text is a KNOWN, separate
 * divergence from `outlook.execution.strategyLabel` (the opening-pacing
 * sentence) — see the audit that found it. This file reads
 * `execution.strategyLabel` only, so Today agrees with race-detail rather
 * than replicating the watch's own divergent copy a third time.
 *
 * DELIBERATELY NOT REPLICATED (2): `loadCoachGoalForRace` (a coach-set
 * goal when the runner typed none) is only called from inside
 * `build-workout.ts`'s own race-pacing flow today. Adding a second call
 * site here for a "concise summary" was judged not worth the duplication
 * risk — a race with no stated goal simply shows no goal line on Today,
 * which is an honest, if incomplete, answer (Rule 11: absence, not a
 * fabricated number).
 */
import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { parseRaceTime as parseRaceGoalSec } from '@/lib/training/vdot';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { loadEffectiveRaceTarget } from '@/lib/race/effective-race-target';
import { raceHrLine } from '@/lib/race/race-hr-guidance';
import { resolveRaceFuel } from '@/lib/race/fuel-resolve';
import { computeRaceFueling } from '@/lib/race/execution-plan';

export interface V5RaceOnToday {
  slug: string;
  name: string;
  distanceMi: number;
  /** `outlook.execution.effortCharacter`, verbatim — 'race' or
   *  'controlled_c_effort'. Today's own word for "race role." */
  role: 'race' | 'controlled_c_effort';
  priority: string | null;
  /** THE CURRENT PRESCRIBED EXECUTION TARGET. Never the goal — see
   *  `goalSec` below, a deliberately separate field. */
  executionTargetSec: number | null;
  /** The runner's STATED goal, kept visibly distinct from the execution
   *  target. `null` when none was stated (Rule 11: absence, not a zero). */
  goalSec: number | null;
  strategyLabel: string | null;
  /** The one canonical HR sentence, `raceHrLine()` verbatim — includes the
   *  checkpoint abort framing in its own words when one applies. */
  hrLine: string | null;
  checkpointMi: number | null;
  checkpointAbortBpm: number | null;
  fuelingSummary: string | null;
}

export async function buildRaceOnToday(
  userId: string,
  dateISO: string,
  planRaceId: string | null,
): Promise<V5RaceOnToday | null> {
  // The date IS the join — same predicate build-workout.ts's MIDGOAL-2 uses,
  // not re-derived: the race a runner is running today is the one whose
  // date is today, never "the next priority-A race" (which on a tune-up day
  // is a different race entirely).
  const todaysRace = await rowOrNull<{ slug: string; meta: Record<string, unknown> | null }>(
    'v5today/todays-race',
    pool.query(
      `SELECT slug, meta FROM races
        WHERE user_uuid = $1 AND meta->>'date' = $2
        ORDER BY (meta->>'priority' = 'A') DESC LIMIT 1`,
      [userId, dateISO],
    ),
  );
  const planRace = planRaceId
    ? await rowOrNull<{ slug: string; meta: Record<string, unknown> | null }>(
        'v5today/plan-race',
        pool.query(
          `SELECT slug, meta FROM races WHERE user_uuid = $1 AND slug = $2 LIMIT 1`,
          [userId, planRaceId],
        ),
      )
    : null;

  const slug = todaysRace?.slug ?? planRace?.slug ?? null;
  const raceMeta = (todaysRace?.meta ?? planRace?.meta ?? null) as Record<string, unknown> | null;
  if (!slug || !raceMeta) return null;

  const statedGoalSec = parseRaceGoalSec((raceMeta.goalDisplay as string | null) ?? '');
  const distanceMi = Number(raceMeta.distanceMi)
    || distanceMiFromLabel(raceMeta.distanceLabel as string | null)
    || 0;
  if (distanceMi <= 0) return null;

  let effective;
  try {
    effective = await loadEffectiveRaceTarget(userId, statedGoalSec, distanceMi, { slug });
  } catch {
    return null; // additive — Today falls back to its ordinary rendering
  }
  const execution = effective.outlook?.execution ?? null;

  let fuelingSummary: string | null = null;
  if (execution?.targetSec) {
    try {
      const fuelDefaults = await pool.query<{
        fuel_brand: string | null; fuel_gel_carbs_g: number | null; fuel_target_g_per_hr: number | null;
      }>(
        `SELECT fuel_brand, fuel_gel_carbs_g, fuel_target_g_per_hr FROM users WHERE id = $1 LIMIT 1`,
        [userId],
      ).then((r) => r.rows[0] ?? null).catch(() => null);
      const { fuel } = resolveRaceFuel(raceMeta, fuelDefaults);
      const plan = computeRaceFueling({
        goalSec: execution.targetSec,
        distanceMi,
        goalPaceSPerMi: execution.targetSec / distanceMi,
        fuel,
      });
      fuelingSummary = plan.shortLine || null;
    } catch { /* additive */ }
  }

  return {
    slug,
    name: (raceMeta.name as string | null) ?? slug,
    distanceMi,
    role: execution?.effortCharacter ?? 'race',
    priority: (raceMeta.priority as string | null) ?? null,
    executionTargetSec: execution?.targetSec ?? null,
    goalSec: statedGoalSec,
    strategyLabel: execution?.strategyLabel ?? null,
    hrLine: execution?.hr ? raceHrLine(execution.hr) : null,
    checkpointMi: execution?.hr?.checkpointMi ?? null,
    checkpointAbortBpm: execution?.hr?.checkpointAbortBpm ?? null,
    fuelingSummary,
  };
}
