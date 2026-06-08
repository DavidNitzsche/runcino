/**
 * POST /api/plan/restore · runner override of an adapter downgrade.
 *
 * Body: { workoutId: string }
 * → 200 { ok: true, restored: { type, sub_label, distance_mi, date_iso, workout_spec } }
 * → 400 { ok: false, error: 'not_adapted' | 'missing_originals' | 'cannot_restore_past' }
 * → 404 { ok: false, error: 'workout_not_found' }
 *
 * The runner is the human in the loop. The auto-adapter is doing the
 * right thing most of the time, but when the runner reads the reason
 * and decides to do the original workout anyway, they should have a
 * one-tap way to say so.
 *
 * Behavior (single transaction):
 *   1. Read plan_workouts by id, owner-scoped via training_plans.user_uuid
 *   2. Reject if completed (past · already happened, restoring is meaningless)
 *   3. Reject if no originals to restore from
 *   4. Promote originals back to active columns, clear original_*
 *   5. Re-derive workout_spec + pace_target_s_per_mi for quality types
 *      via buildWorkoutSpec (deterministic from type + distance + VDOT,
 *      so we don't need to persist the original spec)
 *   6. Write coach_intents row (reason=plan_adapt_overridden) so the
 *      override is visible in the briefing surface + can inform future
 *      adapter confidence
 *   7. Return the restored row's fresh state
 *
 * Web agent brief: designs/briefs/restore-original-workout-endpoint-brief.md
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.4 (composer + audit)
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { buildWorkoutSpec, tPaceFromGoal } from '@/lib/plan/spec-builder';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }

  const workoutId = typeof body.workoutId === 'string' ? body.workoutId.trim() : '';
  if (!workoutId) {
    return NextResponse.json({ ok: false, error: 'workoutId_required' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Read · owner-scoped via training_plans.user_uuid join.
    const row = (await client.query<{
      id: string;
      plan_id: string;
      type: string;
      sub_label: string | null;
      distance_mi: string | null;
      date_iso: string;
      is_quality: boolean;
      workout_spec: any;
      original_type: string | null;
      original_sub_label: string | null;
      original_distance_mi: string | null;
      original_date_iso: string | null;
      race_id: string | null;
    }>(
      // plan_workouts.id is TEXT (legacy schema), not UUID · do not cast.
      // training_plans.user_uuid IS uuid so $2::uuid is correct.
      `SELECT pw.id, pw.plan_id, pw.type, pw.sub_label, pw.distance_mi::text,
              pw.date_iso::text, pw.is_quality, pw.workout_spec,
              pw.original_type, pw.original_sub_label,
              pw.original_distance_mi::text, pw.original_date_iso::text,
              tp.race_id
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE pw.id = $1
          AND tp.user_uuid = $2::uuid
          AND tp.archived_iso IS NULL
        LIMIT 1`,
      [workoutId, userId],
    )).rows[0];

    if (!row) {
      await client.query('ROLLBACK');
      return NextResponse.json({ ok: false, error: 'workout_not_found' }, { status: 404 });
    }

    // 2. Reject past workouts · already happened, restoration is meaningless.
    const today = await runnerToday(userId);
    if (row.date_iso < today) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { ok: false, error: 'cannot_restore_past' },
        { status: 400 },
      );
    }

    // 3. Reject if nothing to restore.
    const hasOriginals =
      row.original_type != null ||
      row.original_distance_mi != null ||
      row.original_date_iso != null ||
      row.original_sub_label != null;
    if (!hasOriginals) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { ok: false, error: 'not_adapted' },
        { status: 400 },
      );
    }

    // 4. Compute restored values.
    const restoredType = row.original_type ?? row.type;
    const restoredDistanceMi = row.original_distance_mi != null
      ? Number(row.original_distance_mi)
      : (row.distance_mi != null ? Number(row.distance_mi) : null);
    const restoredDateIso = row.original_date_iso ?? row.date_iso;
    const isRestoredQuality = ['tempo', 'threshold', 'intervals'].includes(restoredType);

    // 5. Re-derive workout_spec + pace_target via buildWorkoutSpec.
    //    Spec is deterministic from type + distance + VDOT · doesn't need
    //    to be persisted on the row alongside `original_*`.
    let workoutSpec: unknown = null;
    let paceTargetSPerMi: number | null = null;
    if (restoredDistanceMi != null && restoredType !== 'rest') {
      const tPaceSec = await deriveTPaceSec(client, userId, row.race_id);
      if (tPaceSec != null) {
        const result = buildWorkoutSpec(restoredType, restoredDistanceMi, tPaceSec, null);
        workoutSpec = result.spec;
        paceTargetSPerMi = result.paceTargetSPerMi;
      }
    }

    // 2026-06-04 · derive sub_label from the FRESH spec instead of using
    // the stale original_sub_label. David's QC: original_sub_label said
    // "2 mi WU · 4 mi @ T · 2 mi CD" but the rebuilt spec split as
    // 1.5/5/1.5 (different distance bucket than when the plan was
    // originally written). Two surfaces, two numbers, one workout. Spec
    // is canonical · derive label from it. Falls back to the stored
    // original_sub_label when subLabelFromSpec returns null (e.g.
    // easy/long/rest where the spec doesn't carry the full label).
    const { subLabelFromSpec } = await import('@/lib/training/expand-spec');
    const derivedFromSpec = workoutSpec
      ? subLabelFromSpec(workoutSpec as Parameters<typeof subLabelFromSpec>[0])
      : null;
    const restoredSubLabel = derivedFromSpec
      ?? row.original_sub_label
      ?? row.sub_label;

    // 6. UPDATE · promote originals back + clear original_* + restore quality
    //    flag + re-derive spec.
    await client.query(
      // plan_workouts.id is TEXT · do not cast $1 to uuid.
      `UPDATE plan_workouts
          SET type                  = $2::text,
              sub_label             = $3,
              distance_mi           = $4,
              date_iso              = $5::date,
              is_quality            = $6,
              workout_spec          = $7::jsonb,
              pace_target_s_per_mi  = $8,
              original_type         = NULL,
              original_sub_label    = NULL,
              original_distance_mi  = NULL,
              original_date_iso     = NULL
        WHERE id = $1`,
      [
        workoutId,
        restoredType,
        restoredSubLabel,
        restoredDistanceMi,
        restoredDateIso,
        isRestoredQuality,
        workoutSpec != null ? JSON.stringify(workoutSpec) : null,
        paceTargetSPerMi,
      ],
    );

    // 7. Audit · coach_intents row captures the override.
    //    Visible in CoachActivityTimeline + signals to the adapter that
    //    this runner pushes back when we downgrade.
    await client.query(
      `INSERT INTO coach_intents
         (user_id, user_uuid, ts, reason, field, value)
       VALUES ($1::uuid, $1::uuid, NOW(), 'plan_adapt_overridden', $2::text, $3::jsonb)`,
      [
        userId,
        workoutId,
        JSON.stringify({
          domain: 'plan',
          severity: 'soft',
          body: `Runner overrode the auto-adapter · proceeding with original ${restoredSubLabel ?? restoredType}.`,
          source: 'runner_override',
          restored_type: restoredType,
          restored_sub_label: restoredSubLabel,
          restored_distance_mi: restoredDistanceMi,
          citation: 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.4',
        }),
      ],
    );

    await client.query('COMMIT');

    // Bust the briefing cache so the next render reflects the restore.
    try {
      const { bustBriefingCacheForEvent } = await import('@/lib/coach/cache');
      await bustBriefingCacheForEvent(userId, 'plan_swap');
    } catch {/* non-blocking */}

    return NextResponse.json({
      ok: true,
      restored: {
        id: workoutId,
        type: restoredType,
        sub_label: restoredSubLabel,
        distance_mi: restoredDistanceMi,
        date_iso: restoredDateIso,
        is_quality: isRestoredQuality,
        workout_spec: workoutSpec,
        pace_target_s_per_mi: paceTargetSPerMi,
      },
    });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[plan/restore] error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

/**
 * Derive T-pace from the race goal. Used to populate workout_spec on
 * restored quality workouts.
 *
 * Returns null when the runner has no goal time set · caller should
 * fall back to leaving spec null (the runner can still execute the
 * workout by feel · the chip just won't show a headline pace).
 */
async function deriveTPaceSec(
  client: { query: typeof pool.query },
  userId: string,
  raceId: string | null,
): Promise<number | null> {
  if (!raceId) return null;
  const race = (await client.query<{ meta: any; plan: any }>(
    `SELECT meta, plan FROM races
      WHERE user_uuid = $1::uuid AND slug = $2
      LIMIT 1`,
    [userId, raceId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!race) return null;
  const goalSec = Number(race.plan?.goal?.finish_time_s);
  const goalDistanceMi = Number(race.meta?.distanceMi);
  const fromGoal = tPaceFromGoal(goalSec, goalDistanceMi);
  if (fromGoal != null) return fromGoal;
  // No goal time set · the restored quality workout's spec will be
  // null. Runner can still execute by feel · the chip just won't show
  // a headline pace. This is honest cold-start behavior.
  return null;
}
