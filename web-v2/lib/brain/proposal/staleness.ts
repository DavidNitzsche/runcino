/**
 * lib/brain/proposal/staleness.ts · READING THE PLAN AS IT IS NOW.
 *
 * A proposal is a decision about a plan that existed when the decision was
 * made. Between raising it and the runner tapping Accept there can be days, a
 * cron re-anchor, a manual edit, or a full rebuild. Applying regardless is how
 * a runner ends up with a change that was reasoned about a session that no
 * longer exists.
 *
 * This is the read half. `action.ts:staleAgainst` is the comparison half.
 */

import { pool } from '@/lib/db/pool';
import { planVersionOf } from '@/lib/plan/plan-version';
import type { ActionShape, LiveRow, BrainAction, RowBefore } from './action';
import { ACTION_SCHEMA_VERSION } from './action';

/**
 * The current state of the named rows, scoped to this runner's ACTIVE plan.
 *
 * Rule 14: the scope is stated. `archived_iso IS NULL` matters — the owner has
 * 47 plan versions, and a join on `user_uuid` alone reads every one of them,
 * which is precisely the defect that made a quality-density ramp read 59
 * sessions in a single week.
 */
export async function readLiveRows(
  userUuid: string,
  planWorkoutIds: readonly string[],
): Promise<ReadonlyMap<string, LiveRow>> {
  const out = new Map<string, LiveRow>();
  if (planWorkoutIds.length === 0) return out;

  const rows = (await pool.query<{
    id: string;
    date_iso: string;
    type: string;
    distance_mi: string | number | null;
    pace_target_s_per_mi: number | null;
    plan_id: string;
    last_adapted_at: Date | null;
  }>(
    `SELECT pw.id,
            pw.date_iso::text AS date_iso,
            pw.type,
            pw.distance_mi,
            pw.pace_target_s_per_mi,
            tp.id AS plan_id,
            tp.last_adapted_at
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE pw.id = ANY($1::text[])
        AND tp.user_uuid = $2::uuid
        AND tp.archived_iso IS NULL`,
    [planWorkoutIds, userUuid],
  )).rows;

  for (const r of rows) {
    out.set(r.id, {
      planWorkoutId: r.id,
      dateISO: r.date_iso,
      type: r.type,
      distanceMi: r.distance_mi === null ? null : Number(r.distance_mi),
      paceTargetSecPerMi: r.pace_target_s_per_mi,
      planVersion: planVersionOf({ id: r.plan_id, last_adapted_at: r.last_adapted_at }),
    });
  }
  return out;
}

/**
 * Snapshot the rows an action is about, at the moment it is RAISED, so the
 * accept path has something to compare against later.
 */
export function beforeFromLive(live: ReadonlyMap<string, LiveRow>): readonly RowBefore[] {
  return [...live.values()].map((r) => ({
    planWorkoutId: r.planWorkoutId,
    dateISO: r.dateISO,
    type: r.type,
    distanceMi: r.distanceMi,
    paceTargetSecPerMi: r.paceTargetSecPerMi,
    planVersion: r.planVersion,
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE ONE-WAY LEGACY UPGRADE
 * ═══════════════════════════════════════════════════════════════════════ */

/** The three fields the old payload could carry, and nothing else. */
export interface LegacyPayload {
  newType?: string | null;
  newDate?: string | null;
  shaveFraction?: number | null;
  newDistanceMi?: number | null;
  why?: string | null;
}

/**
 * Read an old row as a `BrainAction`. ONE DIRECTION ONLY — nothing writes this
 * shape any more, and this exists so the seven rows already in production stay
 * acceptable rather than becoming dead cards on the runner's phone.
 *
 * Rule 11: an unrecognisable payload returns null. It does NOT fall back to a
 * no-op action, because a proposal that applies nothing while reporting success
 * is worse than one that refuses out loud.
 */
export function upgradeLegacyPayload(
  payload: LegacyPayload,
  before: readonly RowBefore[],
): BrainAction | null {
  const base = { schemaVersion: ACTION_SCHEMA_VERSION, before } as const;

  if (typeof payload.newDate === 'string' && payload.newDate.length > 0) {
    return { ...base, kind: 'RESCHEDULE', direction: 'NEUTRAL', toDateISO: payload.newDate, swapWithId: null };
  }
  if (typeof payload.newType === 'string' && payload.newType.length > 0) {
    return { ...base, kind: 'WORKOUT_TYPE_CHANGE', direction: 'LESS', to: payload.newType };
  }
  if (typeof payload.shaveFraction === 'number' && payload.shaveFraction > 0) {
    const row = before[0];
    if (!row || row.distanceMi === null || row.distanceMi === undefined) return null;
    const to = Math.round(row.distanceMi * (1 - payload.shaveFraction) * 10) / 10;
    return { ...base, kind: 'DISTANCE_CHANGE', direction: 'LESS', to: { unit: 'mi', value: to } };
  }
  return null;
}

/**
 * A stored proposal row, read as an action.
 *
 * This is the bridge that lets ONE renderer draw both the five engine kinds
 * that exist today and the twenty-one the schema can express — rather than the
 * phone growing a second mapping the day the brain learns a new lever.
 *
 * `before` is reconstructed from the row's own evidence blob rather than from
 * the database, because the render path has no business issuing a query and
 * the two fields it needs (`planned_type`, `planned_distance_mi`) are exactly
 * what every trigger already records. A row with no evidence yields a `before`
 * with nulls, and a percentage-style headline degrades to a plain one instead
 * of inventing a denominator.
 */
export function actionFromPending(p: {
  actionKind: string;
  planWorkoutId: string;
  workoutDateISO: string;
  actionPayload: LegacyPayload;
  evidence?: Record<string, unknown>;
}): BrainAction | null {
  const ev = p.evidence ?? {};
  /**
   * OMIT what the evidence blob did not record. Writing `null` for a field the
   * trigger never wrote would claim the session had no distance, and the
   * staleness check would then read the live distance as a change and refuse
   * every card. Absent and null are different facts and this is where the
   * difference is created.
   */
  const before: readonly RowBefore[] = [{
    planWorkoutId: p.planWorkoutId,
    dateISO: p.workoutDateISO,
    ...(typeof ev.planned_type === 'string' && ev.planned_type !== ''
      ? { type: ev.planned_type } : {}),
    ...(typeof ev.planned_distance_mi === 'number'
      ? { distanceMi: ev.planned_distance_mi } : {}),
  }];
  const base = { schemaVersion: ACTION_SCHEMA_VERSION, before } as const;

  switch (p.actionKind) {
    case 'field_test':
      return { ...base, kind: 'FIELD_TEST', direction: 'NEUTRAL', describe: 'field test' };

    case 'reschedule': {
      const to = p.actionPayload.newDate;
      if (typeof to !== 'string' || to === '') return null;
      return { ...base, kind: 'RESCHEDULE', direction: 'NEUTRAL', toDateISO: to, swapWithId: null };
    }

    case 'downgrade': {
      const t = p.actionPayload.newType;
      if (typeof t !== 'string' || t === '') return null;
      return { ...base, kind: 'WORKOUT_TYPE_CHANGE', direction: 'LESS', to: t };
    }

    case 'shave': {
      const frac = p.actionPayload.shaveFraction;
      if (typeof frac !== 'number' || !(frac > 0)) return null;
      const from = before[0].distanceMi ?? null;
      return {
        ...base,
        kind: 'DISTANCE_CHANGE',
        direction: 'LESS',
        // The proportion is what was decided; the mileage is what it prices to
        // when the session's own distance is on record, and null when it is not.
        ofBefore: frac,
        to: from === null ? null : { unit: 'mi', value: Math.round(from * (1 - frac) * 10) / 10 },
      };
    }

    case 'mark_upgrade': {
      const mi = p.actionPayload.newDistanceMi;
      return {
        ...base,
        kind: 'DISTANCE_CHANGE',
        direction: 'MORE',
        to: typeof mi === 'number' && Number.isFinite(mi) ? { unit: 'mi', value: mi } : null,
      };
    }

    // Rule 11: a kind this bridge has not been taught is not a no-op. It is a
    // kind nobody decided how to draw, and the caller withholds the card.
    default:
      return null;
  }
}

/**
 * Engine kind to the SHAPE of the action it becomes — kind and direction only,
 * no specifics.
 *
 * Direction is answerable from the engine kind alone for four of the five
 * kinds, and from `newType` for the fifth. Requiring a fully-resolved action
 * first would have made the card's direction depend on whether the payload
 * happened to carry a distance, which is a different question entirely.
 *
 * One table, so `directionOf` and `actionFromPending` cannot drift apart about
 * which engine kind is which action (Rule 16).
 */
export function actionShapeOfEngineKind(
  kind: string,
  payload: LegacyPayload,
): ActionShape | null {
  switch (kind) {
    case 'field_test': return { kind: 'FIELD_TEST', direction: 'NEUTRAL' };  // see phoneDirectionOf: the KIND decides this one
    case 'reschedule': return { kind: 'RESCHEDULE', direction: 'NEUTRAL' };
    case 'shave': return { kind: 'DISTANCE_CHANGE', direction: 'LESS' };
    case 'mark_upgrade': return { kind: 'DISTANCE_CHANGE', direction: 'MORE' };
    case 'downgrade':
      return { kind: 'WORKOUT_TYPE_CHANGE', direction: 'LESS', to: payload.newType ?? undefined };
    default: return null;
  }
}
