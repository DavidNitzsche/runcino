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
import { repriceHeadline, type RepriceAnchorMove } from '@/lib/plan/reprice-payload';
import type { ActionShape, LiveRow, BrainAction, RowBefore } from './action';
import { ACTION_SCHEMA_VERSION } from './action';
import { deserializeAction } from './serialize';

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

  /* UNDOCOMPLETE-1 · the five SHAPE columns are selected too, because the
   * snapshot this read produces is what `beforeFromLive` turns into the
   * proposal's `before` — and an undo can only restore what was recorded.
   * Selecting them here is the difference between "undoable" being a promise
   * and being a fact. */
  const rows = (await pool.query<{
    id: string;
    date_iso: string;
    type: string;
    distance_mi: string | number | null;
    pace_target_s_per_mi: number | null;
    duration_min: string | number | null;
    is_quality: boolean | null;
    sub_label: string | null;
    notes: string | null;
    workout_spec: Record<string, unknown> | null;
    plan_id: string;
    last_adapted_at: Date | null;
  }>(
    `SELECT pw.id,
            pw.date_iso::text AS date_iso,
            pw.type,
            pw.distance_mi,
            pw.pace_target_s_per_mi,
            pw.duration_min,
            pw.is_quality,
            pw.sub_label,
            pw.notes,
            pw.workout_spec,
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
      durationMin: r.duration_min === null ? null : Number(r.duration_min),
      isQuality: r.is_quality,
      subLabel: r.sub_label,
      notes: r.notes,
      workoutSpec: r.workout_spec,
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
    /* Rule 11 on the SNAPSHOT: a reader that did not select a shape column
     * leaves it `undefined`, and the field is OMITTED rather than written as
     * null — "nobody read this" and "the session had none" are different facts
     * and `undoWritesFor` answers them differently. */
    ...(r.durationMin === undefined ? {} : { durationMin: r.durationMin }),
    ...(r.isQuality === undefined ? {} : { isQuality: r.isQuality }),
    ...(r.subLabel === undefined ? {} : { subLabel: r.subLabel }),
    ...(r.notes === undefined ? {} : { notes: r.notes }),
    ...(r.workoutSpec === undefined ? {} : { workoutSpec: r.workoutSpec }),
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
  /** REANCHORPROPOSES-1 · a whole-block repricing, carried as one decision.
   *
   *  `anchorMoves` is declared here as of REPRICEHEADLINE-1 because the
   *  headline names the anchor that MOVED rather than the count of sessions,
   *  so the legacy reconstruction needs the same list the writer read. Every
   *  reprice row carries it — `asRepricePayload` refuses a payload without a
   *  non-empty one — but it stays optional because this type describes a
   *  STORED blob rather than a promise about it. */
  reprice?: {
    meanAnchorDeltaSecPerMi?: number;
    workoutsAffected?: number;
    anchorMoves?: RepriceAnchorMove[] | null;
  } | null;
  /**
   * ACTIONCOMPLETE-1 (2026-09-05) · the decision as the writer stated it.
   *
   * Typed `unknown` on purpose. This is a stored jsonb blob written by some
   * earlier build, and `deserializeAction` type-checks every field before it
   * becomes an action — a declared shape here would be a claim about data this
   * process did not write.
   */
  action?: unknown;
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
/**
 * P0PROPOSALFETCH-1 (2026-09-09) · THE FIVE WORDS THE LEGACY LANE CAN READ.
 *
 * Moved here, exported, so `app/api/plan/workout-proposals/[id]/accept/
 * route.ts` (which gates on this to route into `applyAdaptations`) and
 * `lib/faff/v5-proposals.ts` (which needs to know, for a row with no stored
 * action, whether accepting it is a mutation `mutatePlan`'s ledger
 * requirement can block) read ONE set rather than two that could drift
 * (Rule 16) — a route.ts file cannot itself export an arbitrary named
 * binding without tripping Next's route-export validation, so this is the
 * shared home rather than the route.
 */
export const LEGACY_MUTATING_ACTION_KINDS: ReadonlySet<string> = new Set([
  'downgrade', 'shave', 'reschedule', 'field_test', 'mark_upgrade',
]);

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

  /* ── ACTIONCOMPLETE-1 (2026-09-05) · READ THE DECISION, DO NOT INFER IT ───
   *
   * A row written by the current writer STATES its action. Reconstructing one
   * from `action_kind` plus whichever of four legacy fields happened to be
   * populated is what limited the whole lane to five kinds: no combination of
   * those fields can express a rep count or a recovery interval.
   *
   * The stored action wins where it parses, and where it does not the switch
   * below runs exactly as before. That fallback is not politeness — the seven
   * rows already in production carry no action at all, and treating their
   * absence as a failure would blank every card on the runner's phone.
   *
   * The stored action's `before` is REPLACED by the one reconstructed above,
   * because staleness must be compared against what the ROW recorded rather
   * than against a snapshot the writer serialized; the two agree today, and if
   * they ever diverge the row is the authority.
   */
  const stored = deserializeAction(p.actionPayload?.action);
  if (stored != null) {
    return stored.kind === 'COORDINATED' ? stored : { ...stored, before };
  }

  switch (p.actionKind) {
    case 'field_test':
      return { ...base, kind: 'FIELD_TEST', direction: 'NEUTRAL', describe: 'field test' };

    case 'reprice': {
      const shape = actionShapeOfEngineKind('reprice', p.actionPayload);
      if (shape == null) return null;
      const r = p.actionPayload.reprice;
      /* A repricing is about the BLOCK, so this is the one headline that does
       * not name a weekday. The card's date already says where the change
       * starts, and saying it twice would be Rule 17.
       *
       * REPRICEHEADLINE-1 (2026-09-08) · this used to carry its own copy of
       * the sentence `actionFromReprice` writes onto the row, which is one
       * quantity with two authors (Rule 16) and would have let the legacy
       * reconstruction drift from the stored string silently. Both now call
       * `repriceHeadline`. This branch is the fallback for the rows written
       * before there was an action to store, so it must agree with the writer
       * exactly or a card changes wording depending on when it was raised. */
      const describe = repriceHeadline({
        moves: r?.anchorMoves,
        meanAnchorDeltaSecPerMi: r?.meanAnchorDeltaSecPerMi,
        workoutsAffected: r?.workoutsAffected,
      });
      return {
        ...base,
        kind: 'COORDINATED',
        direction: shape.direction,
        describe,
        // The parts are not enumerated: a repricing is applied by
        // `applyReanchorProposal` against canonical anchors, not by replaying
        // N per-row writes, and inventing seventy-seven parts here would be a
        // second description of a change this file does not own.
        parts: [],
      };
    }

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
    /* A repricing moves the paces of every future session at once, which is
     * COORDINATED: one decision, many rows, answered once. Offering it as
     * seventy-seven cards would be a worse product than offering none.
     *
     * A pace is seconds per mile, so NEGATIVE IS FASTER. A repricing whose
     * anchors do not move on balance is genuinely a HOLD — threshold can move
     * faster while marathon moves slower, and telling the runner the block is
     * being re-priced without claiming a direction is the honest answer. */
    case 'reprice': {
      const d = payload.reprice?.meanAnchorDeltaSecPerMi;
      // Rule 11 · a payload we cannot read is not a hold. Withheld.
      if (typeof d !== 'number' || !Number.isFinite(d)) return null;
      return {
        kind: 'COORDINATED',
        direction: d <= -1 ? 'MORE' : d >= 1 ? 'LESS' : 'NEUTRAL',
      };
    }
    case 'reschedule': return { kind: 'RESCHEDULE', direction: 'NEUTRAL' };
    case 'shave': return { kind: 'DISTANCE_CHANGE', direction: 'LESS' };
    case 'mark_upgrade': return { kind: 'DISTANCE_CHANGE', direction: 'MORE' };
    case 'downgrade':
      return { kind: 'WORKOUT_TYPE_CHANGE', direction: 'LESS', to: payload.newType ?? undefined };
    default: return null;
  }
}
