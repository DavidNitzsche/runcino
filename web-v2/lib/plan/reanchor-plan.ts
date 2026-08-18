/**
 * reanchor-plan — the daily self-heal that ends a provisional anchor.
 *
 * A plan's paces are baked when it is authored. If the runner's fitness was not
 * measurable then — data not synced yet, or a true cold start — the plan was
 * anchored on `conservativeVdotFromMileage`, a VDOT invented out of a
 * self-reported weekly-mileage bucket. Nothing upgraded it, so the runner stayed
 * on fabricated paces for the life of the block. That is the Justin bug,
 * generalised.
 *
 * This runs daily inside the projection cron, which has already computed every
 * runner's measured VDOT through the canonical evidence-only loader. When a
 * measured read becomes available, or the runner's fitness has shifted
 * materially, it refreshes the FUTURE workouts' paces IN PLACE. Plan structure,
 * dates, distances, phases and any already-run history are untouched.
 *
 * It also powers the calibration intro: a plan whose opening weeks prescribe
 * quality BY EFFORT (`anchor-provenance.ts` · `CALIBRATION_INTRO_WEEKS`) commits
 * to real paces here the moment its first honest effort reads. That is what
 * makes the intro temporary rather than permanent.
 *
 * ── 2026-08-17 · COLD-4 · SCOPE AND NAME ────────────────────────────────────
 *
 * This was `reanchorMaintenancePlan`, scoped `mode = 'maintenance' AND race_id
 * IS NULL`. Every honest cold-start mechanism in this codebase was built on the
 * no-race path and race-prep — where a new runner WITH a goal lands — got none
 * of them. So a runner training for a marathon off an invented VDOT had no way
 * back: the intro could start but nothing could end it.
 *
 * The function now covers the runner's active plan whatever its mode, and the
 * name says so. The two modes need genuinely different machinery and each gets
 * the one that already exists:
 *
 *   · race-prep → `recomputePacesForPlan`, which knows the goal blend, the
 *     seal predicate, the exempt types and the sub-label derivation.
 *   · maintenance / recovery / no-race → the in-place refresh below, which is
 *     the same `buildWorkoutSpec` call shape the seeder uses, so a re-anchor
 *     and a fresh seed at the same VDOT converge.
 *
 * ── THE THREE GUARDS ────────────────────────────────────────────────────────
 *
 * 1. SEALED DAYS ARE NEVER REWRITTEN. A date the runner has already run is
 *    immutable — they trained against the prescription that was there, and
 *    changing it after the fact makes every retro lie (Rule 15). The race-prep
 *    arm inherits this from `recomputePacesForPlan`; the maintenance arm below
 *    now applies the same `EXISTS` predicate, which it previously did not.
 *
 * 2. ONLY A MEASURED READ FIRES IT. `measuredVdot` comes from
 *    `bestRecentVdot(raceCandidates, …, runCandidates)` — races, time trials and
 *    qualifying training efforts, nothing else. Re-anchoring a provisional
 *    anchor onto another provisional one would launder the same fabrication
 *    through a second column and reset the intro window for free.
 *
 * 3. IT CLEARS THE MARKS IT RESOLVES. A plan that has been re-anchored must stop
 *    advertising a calibration that has ended, or the next authoring re-opens
 *    the intro and `paceBlendAnchorIsProvisional` keeps three readers refusing
 *    an anchor that is now real.
 *
 * Cite: Research/01-pace-zones-vdot.md §"How to recalibrate paces" — update
 * VDOT and re-derive zones when a new measured signal lands.
 */

import { pool } from '@/lib/db/pool';
import { buildWorkoutSpec } from './spec-builder';
import { preserveProgressionSql } from './progression-spec';
import { tPaceFromVdot, iPaceFromVdot } from '@/lib/training/vdot';
import { paceBlendAnchorIsProvisional } from './anchor-provenance';
import { runDaySql, runNotMergedSql } from '@/lib/runs/run-shape';

/** Refresh only when fitness moved enough to matter — avoids churning paces on
 *  day-to-day VDOT jitter (the fade/candidate set wiggles ±~0.5). */
export const REANCHOR_VDOT_DELTA = 2.0;

/**
 * Should we re-anchor? Yes when a measured read exists AND either the plan is
 * still on a provisional / calibrating anchor (one-time upgrade), or measured
 * fitness has diverged from the plan's anchor by >= the threshold.
 */
export function shouldReanchor(
  anchorSource: string | null,
  anchorVdot: number | null,
  measuredVdot: number | null,
): boolean {
  if (measuredVdot == null) return false;
  if (anchorSource !== 'measured_run') return true; // provisional / calibrating → upgrade
  if (anchorVdot == null) return true;
  return Math.abs(measuredVdot - anchorVdot) >= REANCHOR_VDOT_DELTA;
}

/**
 * The race-prep arm's gate, in the vocabulary `composePlan` persists.
 *
 * `pace_blend.season_anchor_source` / `season_anchor_provisional`
 * (`anchor-provenance.ts`) rather than `authored_state.anchorSource`, which is
 * the maintenance seeder's key and is absent on a race-prep plan. Same three
 * conditions as `shouldReanchor`, and deliberately symmetric with it:
 *
 *   · a provisional anchor upgrades on the first measurement
 *   · NO anchor recorded at all also upgrades on the first measurement
 *   · a measured anchor moves only when fitness genuinely has
 *
 * The middle case is not hypothetical. The live `apple-review@faff.run` plan —
 * the account this whole fix exists for — carries `pace_blend: null`, because it
 * was authored before the provenance column existed. It was anchored on the
 * mileage estimate all the same: nine weeks of tempo work from 8:23/mi off zero
 * recorded runs. `paceBlendAnchorIsProvisional` correctly returns false for it
 * (its contract is about what a READER may believe, and an unmarked anchor is
 * not evidence of fabrication), so without this branch that plan would get
 * neither the calibration intro — which needs a fresh authoring — nor the
 * self-heal, and would run its whole block on the invented pace.
 *
 * Upgrading it is safe in the direction that matters: a measured read is
 * strictly better information than an anchor we cannot account for, and the
 * maintenance arm has treated an absent `anchorSource` exactly this way since it
 * was written.
 */
export function shouldReanchorRacePrep(
  paceBlend: unknown,
  measuredVdot: number | null,
): boolean {
  if (measuredVdot == null) return false;
  if (paceBlendAnchorIsProvisional(paceBlend)) return true;
  const pb = (paceBlend ?? {}) as Record<string, unknown>;
  const anchor = pb.season_anchor_vdot != null ? Number(pb.season_anchor_vdot) : null;
  if (anchor == null || !Number.isFinite(anchor)) return true;  // nothing recorded → take the measurement
  return Math.abs(measuredVdot - anchor) >= REANCHOR_VDOT_DELTA;
}

/**
 * The refreshed pace + spec for one workout at a new fitness level — IDENTICAL
 * to what the seeder emits at that VDOT (same buildWorkoutSpec call shape:
 * lthr/maxHr null, prescription default, goal-build I-pace when a TT goal
 * exists), so re-anchor and fresh-seed produce the same numbers.
 *
 * Note the absent tenth argument: a re-anchor never emits `effortCued`. That is
 * the whole point — this function only runs when a measurement exists, and a
 * measured pace is exactly what the calibration intro was waiting for.
 */
export function refreshedPaceAndSpec(
  type: string,
  distanceMi: number | null,
  newVdot: number,
  ttDistance: string | null,
): { paceTargetSPerMi: number | null; spec: unknown } {
  const tPaceSec = tPaceFromVdot(newVdot) ?? 480;
  const iPaceSec = ttDistance ? iPaceFromVdot(newVdot) : null;
  const built = buildWorkoutSpec(type, distanceMi, tPaceSec, null, undefined, null, null, iPaceSec);
  return { paceTargetSPerMi: built.paceTargetSPerMi, spec: built.spec };
}

export interface ReanchorResult {
  planId: string;
  /** Which arm ran. */
  mode: 'race-prep' | 'maintenance';
  fromVdot: number | null;
  toVdot: number;
  fromSource: string | null;
  workoutsUpdated: number;
  /** Future dates skipped because a run already exists on them (Rule 15). */
  workoutsSealed: number;
  /** True when this run ended a provisional anchor rather than tracking a
   *  fitness change — i.e. it is what closed a calibration intro. */
  clearedProvisional: boolean;
}

/**
 * Re-anchor a user's ACTIVE plan to their measured fitness, whatever its mode.
 *
 * No-op (returns null) when there is no active plan, no measured VDOT, or no
 * refresh is warranted. Best-effort by design — the cron catches per-user.
 */
export async function reanchorActivePlan(
  userId: string,
  measuredVdot: number | null,
  today: string,
): Promise<ReanchorResult | null> {
  // GUARD 2 · a measured read, or nothing happens. A provisional anchor is
  // never upgraded off another provisional one.
  if (measuredVdot == null || !Number.isFinite(measuredVdot) || measuredVdot <= 0) return null;

  const planRow = (await pool.query<{
    id: string; mode: string | null; race_id: string | null;
    authored_state: Record<string, unknown> | null;
  }>(
    `SELECT id, mode, race_id, authored_state FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  )).rows[0];
  if (!planRow) return null;

  const st = (planRow.authored_state ?? {}) as Record<string, any>;
  const isRacePrep = planRow.mode === 'race-prep' || planRow.race_id != null;

  return isRacePrep
    ? reanchorRacePrep(userId, planRow.id, st, measuredVdot)
    : reanchorMaintenance(userId, planRow.id, st, measuredVdot, today);
}

// ── race-prep arm ────────────────────────────────────────────────────────────

/**
 * Clear the provenance marks, THEN recompute.
 *
 * Order matters and is deliberate. `recomputePacesForPlan` reads
 * `pace_blend.season_anchor_vdot` to compute `measuredProgressFraction` — "how
 * much of the goal gap has the runner banked". Clearing first makes the new
 * anchor the measurement itself, so the fraction is 0 and the blend is the
 * standing `BLEND_GRACE_FRACTION` and nothing more. That is precisely what a
 * FRESH authoring at this VDOT would produce, which keeps the codebase's
 * convergence property: a re-anchor and a fresh author at the same fitness
 * agree.
 *
 * Clearing afterwards would instead leave `vdotAtAuthoring` null for one cycle,
 * pinning every week at exactly current-fitness T and holding the first quality
 * progression step shut — the case the grace exists to open.
 *
 * Rule 6 · the write is a field-level jsonb merge on `pace_blend`, never a
 * full-column replace. `authored_state` has several writers with different field
 * coverage and this one knows about three keys.
 */
async function reanchorRacePrep(
  userId: string,
  planId: string,
  st: Record<string, any>,
  measuredVdot: number,
): Promise<ReanchorResult | null> {
  const paceBlend = st.pace_blend ?? null;
  if (!shouldReanchorRacePrep(paceBlend, measuredVdot)) return null;

  const wasProvisional = paceBlendAnchorIsProvisional(paceBlend);
  const fromVdot = paceBlend?.season_anchor_vdot != null
    ? Number(paceBlend.season_anchor_vdot) : null;
  const fromSource = (paceBlend?.season_anchor_source as string) ?? null;

  const client = await pool.connect();
  let recomputed: Awaited<ReturnType<typeof import('./recompute-paces')['recomputePacesForPlan']>> = null;
  try {
    await client.query('BEGIN');
    // GUARD 3 · the marks this run resolves are cleared, so the plan stops
    // advertising a calibration that has ended. `jsonb ||` is a shallow merge,
    // so building the new pace_blend from the old object preserves goal_vdot,
    // build_weeks and anything a future writer adds.
    await client.query(
      `UPDATE training_plans
          SET authored_state = COALESCE(authored_state, '{}'::jsonb) || jsonb_build_object(
                'pace_blend',
                COALESCE(authored_state->'pace_blend', '{}'::jsonb) || $2::jsonb
              )
        WHERE id = $1`,
      [planId, JSON.stringify({
        season_anchor_vdot: measuredVdot,
        season_anchor_source: 'measured_vdot',
        season_anchor_provisional: false,
        reanchored_at: new Date().toISOString(),
      })],
    );
    // GUARD 1 · sealed days · owned by recomputePacesForPlan, which skips any
    // future date that already has a run and reports the count.
    const { recomputePacesForPlan } = await import('./recompute-paces');
    recomputed = await recomputePacesForPlan(planId, measuredVdot, {
      source: wasProvisional ? 'reanchor_calibration_end' : 'reanchor_fitness_shift',
      client,
    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => null);
    throw e;
  } finally {
    client.release();
  }

  try { (await import('./lookup')).bustPlanLookupCache(userId); } catch { /* best-effort */ }

  return {
    planId,
    mode: 'race-prep',
    fromVdot,
    toVdot: measuredVdot,
    fromSource,
    workoutsUpdated: recomputed?.workoutsUpdated ?? 0,
    workoutsSealed: recomputed?.workoutsSealed ?? 0,
    clearedProvisional: wasProvisional,
  };
}

// ── maintenance / no-race arm ────────────────────────────────────────────────

async function reanchorMaintenance(
  userId: string,
  planId: string,
  st: Record<string, any>,
  measuredVdot: number,
  today: string,
): Promise<ReanchorResult | null> {
  const anchorVdot = st.anchorVdot != null ? Number(st.anchorVdot) : null;
  const anchorSource = (st.anchorSource as string) ?? null;
  if (!shouldReanchor(anchorSource, anchorVdot, measuredVdot)) return null;

  const ttDistance = (st.onboarding_goals?.ttDistance as string) ?? null;

  // Future, pace-bearing workouts only — rest/cross/strength/shakeout carry no
  // pace target and are exempt from the workout_spec CHECK.
  //
  // GUARD 1 · sealed days. This arm used to rewrite every row dated >= today,
  // including today's, which the runner may already have run — the race-prep
  // arm has honoured Rule 15 since it was written and this one did not. Same
  // EXISTS predicate as `recomputePacesForPlan` and `adapt.ts`
  // filterUnsealedWorkouts: a date with a non-merged run on it is immutable.
  const wkos = (await pool.query<{ id: string; type: string; distance_mi: string | null; sealed: boolean }>(
    `SELECT pw.id, pw.type, pw.distance_mi,
            EXISTS (
              SELECT 1 FROM runs r
               WHERE r.user_uuid = $3::uuid
                 AND ${runDaySql('r')}::date = pw.date_iso::date
                 AND ${runNotMergedSql('r')}
            ) AS sealed
       FROM plan_workouts pw
      WHERE pw.plan_id = $1 AND pw.date_iso >= $2
        AND pw.type NOT IN ('rest','cross','strength','shakeout')`,
    [planId, today, userId],
  )).rows;

  const client = await pool.connect();
  let updated = 0;
  let sealedCount = 0;
  try {
    await client.query('BEGIN');
    for (const w of wkos) {
      if (w.sealed) { sealedCount++; continue; }
      const { paceTargetSPerMi, spec } = refreshedPaceAndSpec(
        w.type, w.distance_mi != null ? Number(w.distance_mi) : null, measuredVdot, ttDistance,
      );
      await client.query(
        // Rule 6 · a maintenance re-anchor rewrites the same session's paces;
        // the trajectory's shape survives it.
        `UPDATE plan_workouts SET pace_target_s_per_mi = $1,
                workout_spec = ${preserveProgressionSql('$2')} WHERE id = $3`,
        [paceTargetSPerMi, spec ? JSON.stringify(spec) : null, w.id],
      );
      updated++;
    }
    const tPaceSec = tPaceFromVdot(measuredVdot) ?? 480;
    const iPaceSec = ttDistance ? iPaceFromVdot(measuredVdot) : null;
    // GUARD 3 · the calibration marks this arm owns.
    const newState = {
      ...st,
      anchorVdot: measuredVdot,
      anchorSource: 'measured_run',
      tPaceSec, iPaceSec,
      calibrating: false,
      reanchored_at: today,
    };
    await client.query(
      `UPDATE training_plans SET authored_state = $1 WHERE id = $2`,
      [JSON.stringify(newState), planId],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  try { (await import('./lookup')).bustPlanLookupCache(userId); } catch { /* best-effort */ }

  return {
    planId,
    mode: 'maintenance',
    fromVdot: anchorVdot,
    toVdot: measuredVdot,
    fromSource: anchorSource,
    workoutsUpdated: updated,
    workoutsSealed: sealedCount,
    clearedProvisional: anchorSource !== 'measured_run',
  };
}
