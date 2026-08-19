/**
 * plan-target.ts — what does this plan train you TOWARD, and is it a marathon
 * block?
 *
 * Two reads off the runner's active plan, both feeding the projection:
 *
 *   · `loadPlannedTargetVdot` — the plan's STIMULUS CEILING: the fittest the
 *     plan is prescribing you to be by peak. `fitness-trajectory.ts` caps the
 *     projected gain at it and derives `planBuiltForGoal` / `planUnderBuilt`
 *     from it.
 *   · `loadMarathonSpecificTraining` — whether the plan meets `Research/02`
 *     §13.1's stated minima for marathon-specific training, which decides which
 *     of §13.7's two marathon rows sizes the confidence band.
 *
 * ── CEIL-ZONE-1 (2026-08-19) · a session is read at ITS OWN ZONE ───────────
 *
 * The ceiling used to re-score a race-week tune-up as a race at the goal
 * distance, which was false at four of the five distances and produced a
 * marathon VDOT ~8 points above the runner the plan was written for. The whole
 * account of that bug, and the zone reading that replaces it, is in
 * `lib/training/zone-stimulus.ts` — the pure half, so the doctrine gate can
 * exercise it without the database. This file is the query.
 *
 * What IS counted is the block's threshold and rep work — T, ST, HM, I, 5K, 3K,
 * 10K, R, mile — which `generate.ts` paces off `tPaceForWeek`, a blend from the
 * runner's CURRENT threshold toward the goal's, clamped to `achievableFloorT`
 * (current fitness plus a bounded seasonal gain). That clamp is what makes the
 * ceiling a real signal rather than an echo: an over-ambitious goal produces a
 * plan whose peak quality work lands SHORT of the goal's VDOT, and
 * `planBuiltForGoal` says so.
 *
 * Returns null when the plan has no readable quality zone — the trajectory then
 * falls back to the research build rate alone.
 */

import { pool } from '@/lib/db/pool';
import type { PaceZone } from '@/lib/workout-catalogue/types';
import { primaryZone } from '@/lib/plan/prescription-parser';
import { CEILING_TYPES, GOAL_ECHO_ZONES, stimulusVdotForRow } from './zone-stimulus';

export {
  vdotFromZonePace,
  zonePaceAtVdot,
  stimulusVdotForRow,
  type PlannedStimulusRow,
} from './zone-stimulus';

/**
 * The plan's stimulus ceiling, or null when it prescribes nothing readable.
 *
 * The goal distance used to be a parameter, because the old reading re-scored a
 * tune-up as a race AT that distance. The reading is goal-independent by design
 * now and the parameter is gone — a ceiling derived from the goal cannot test
 * whether the plan reaches the goal, and leaving the argument in place would
 * leave the door open for the next reader to use it that way again.
 */
export async function loadPlannedTargetVdot(
  userUuid: string,
): Promise<number | null> {
  const rows = (await pool.query<{ type: string; sub_label: string | null; tgt: number | string | null }>(
    `SELECT pw.type, pw.sub_label, pw.pace_target_s_per_mi AS tgt
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.type = ANY($2::text[])
        AND pw.pace_target_s_per_mi IS NOT NULL`,
    [userUuid, CEILING_TYPES],
  ).catch(() => ({ rows: [] }))).rows;

  let best: number | null = null;
  for (const r of rows) {
    const read = stimulusVdotForRow(r.type, r.sub_label, r.tgt != null ? Number(r.tgt) : null);
    if (read && (best == null || read.vdot > best)) best = read.vdot;
  }
  return best;
}

/**
 * `Research/02-race-time-prediction.md` §13.1's stated minima for
 * marathon-specific training.
 *
 * "With insufficient long runs (< 18 mi peak), insufficient mileage (< 50 mpw),
 * and no marathon-pace work, the actual marathon time is 5–15% slower than
 * predicted." The two numbers are read out of that sentence by
 * `PREDICTION.marathon-specificity-minima`.
 */
export const MARATHON_SPECIFIC_PEAK_LONG_RUN_MI = 18;
export const MARATHON_SPECIFIC_PEAK_WEEKLY_MI = 50;

/**
 * CI-CROSS-1 (2026-08-19) · is marathon-specific training in place?
 *
 * All three of §13.1's conditions, because §13.1 lists all three: peak long run
 * at or above 18 mi, peak week at or above 50 mi, and at least one
 * marathon-pace session.
 *
 * `null` — no active plan, or the read failed — is NOT `false` dressed up. The
 * band-sizing caller treats "unknown" and "absent" the same way (doctrine's
 * instruction on which way to lean here is unambiguous: §14.7, "coaches who
 * report point estimates for marathon goals from 5K times systematically
 * over-predict"), but the distinction is kept here so nothing downstream can
 * present "we did not look" as "we looked and there is no block".
 *
 * Cite: Research/02-race-time-prediction.md §13.1 (training specificity)
 */
export async function loadMarathonSpecificTraining(
  userUuid: string,
): Promise<boolean | null> {
  const rows = (await pool.query<{
    date_iso: string; type: string; sub_label: string | null; distance_mi: number | string | null;
  }>(
    `SELECT pw.date_iso, pw.type, pw.sub_label, pw.distance_mi
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.distance_mi IS NOT NULL`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows;
  if (rows.length === 0) return null;

  let peakLongRunMi = 0;
  let hasMarathonPaceWork = false;
  const weekMi = new Map<string, number>();
  for (const r of rows) {
    const mi = r.distance_mi != null ? Number(r.distance_mi) : 0;
    if (!Number.isFinite(mi) || mi <= 0) continue;
    if (r.type === 'long' && mi > peakLongRunMi) peakLongRunMi = mi;
    // "marathon-pace work" · the M/MP zone, read off the prescription the same
    // way the ceiling reads every other zone.
    const zone = primaryZone(r.sub_label) as PaceZone | null;
    if (zone != null && GOAL_ECHO_ZONES.has(zone)) hasMarathonPaceWork = true;
    // Weeks are buckets of the plan's own dates. The exact week boundary does
    // not matter for a ">= 50" test — a session cannot land in two buckets and
    // the peak is a max over buckets either way.
    const wk = isoWeekKey(r.date_iso);
    if (wk) weekMi.set(wk, (weekMi.get(wk) ?? 0) + mi);
  }
  const peakWeeklyMi = weekMi.size ? Math.max(...weekMi.values()) : 0;

  return peakLongRunMi >= MARATHON_SPECIFIC_PEAK_LONG_RUN_MI
    && peakWeeklyMi >= MARATHON_SPECIFIC_PEAK_WEEKLY_MI
    && hasMarathonPaceWork;
}

/** The Monday-anchored week an ISO date falls in, as a sortable key. Pure —
 *  no clock, no locale. Null on an unparseable date. */
function isoWeekKey(dateISO: string | null | undefined): string | null {
  if (!dateISO || dateISO.length < 10) return null;
  const ms = Date.parse(dateISO.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  // getUTCDay: 0 = Sunday. Shift so Monday is 0.
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(ms - back * 86_400_000).toISOString().slice(0, 10);
}
