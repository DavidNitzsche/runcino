/**
 * lib/coach/adaptation-info.ts · compose the AdaptationInfo envelope
 * per plan_workouts row for the runner-facing surface.
 *
 * Web agent brief · designs/briefs/adaptation-visibility-backend-brief.md.
 * The runner needs to see "EASY · was CRUISE INTERVALS (sleep streak)"
 * on adapted days · not just a silently-mutated easy chip with the
 * threshold pace still bleeding through. Read-side only · no schema
 * changes (migration 134 added original_sub_label · this file is the
 * composer that joins everything together).
 *
 * Pattern · the underlying data is already in:
 *   · plan_workouts.original_type / original_distance_mi / original_date_iso /
 *     original_sub_label · captured by generator + atomic downgrade
 *   · coach_intents.reason like 'plan_adapt_*' + value JSON · captured
 *     by applyAdaptations writeIntent at lib/plan/adapt.ts
 *
 * This module joins them in a single query (most-recent intent per
 * workout via LEFT JOIN LATERAL) and exposes one helper:
 *   loadAdaptationInfoByPlanIds(planIds)  → Map<workoutId, AdaptationInfo>
 *
 * Both glance-state and training-state call this once with the plan
 * IDs they're already loading · no N+1.
 */

import { pool } from '@/lib/db/pool';

export type AdaptationKind = 'downgrade' | 'reschedule' | 'shave' | 'mark_dirty' | 'other';

export interface AdaptationInfo {
  /** True when current runner-facing fields (type / distance / date)
   *  differ from the as-authored originals. */
  wasAdapted: boolean;
  originalType: string | null;
  originalSubLabel: string | null;
  originalDistanceMi: number | null;
  originalDateIso: string | null;
  /** Short coach-voice reason from the matching coach_intents row.
   *  Synthesized from value.why when present, else from the reason field. */
  reason: string | null;
  /** ISO timestamp when the adaptation was applied. */
  adaptedAt: string | null;
  /** Adapter category · drives icon + copy variation on the frontend. */
  kind: AdaptationKind | null;
}

interface RawRow {
  workout_id: string;
  type: string;
  distance_mi: string | null;
  date_iso: string;
  sub_label: string | null;
  original_type: string | null;
  original_sub_label: string | null;
  original_distance_mi: string | null;
  original_date_iso: string | null;
  intent_reason: string | null;
  intent_value: { kind?: string; newType?: string; newDate?: string; shaveFraction?: number; why?: string } | null;
  intent_ts: Date | null;
}

/**
 * Load AdaptationInfo for every workout in the given plan IDs.
 * Returns a Map keyed by workout id (string). Workouts with no
 * adaptation get an entry too · wasAdapted=false, everything null.
 *
 * Caller should call once per request and lookup by workout.id ·
 * single round-trip regardless of week count.
 */
export async function loadAdaptationInfoByPlanIds(
  planIds: string[],
): Promise<Map<string, AdaptationInfo>> {
  if (planIds.length === 0) return new Map();

  // LEFT JOIN LATERAL · most-recent matching plan_adapt intent per workout
  // (the only intent we care about for adaptation visibility · readiness +
  // sick + niggle intents are surfaced elsewhere). Single query · pgool
  // can serve concurrent readers without N+1.
  const rows = (await pool.query<RawRow>(
    `SELECT pw.id::text AS workout_id, pw.type, pw.distance_mi, pw.date_iso,
            pw.sub_label, pw.original_type, pw.original_sub_label,
            pw.original_distance_mi, pw.original_date_iso,
            adapt.reason AS intent_reason,
            adapt.value::jsonb AS intent_value,
            adapt.ts AS intent_ts
       FROM plan_workouts pw
       LEFT JOIN LATERAL (
         SELECT ci.reason, ci.value, ci.ts
           FROM coach_intents ci
          WHERE ci.field = pw.id::text
            AND ci.reason LIKE 'plan_adapt%'
          ORDER BY ci.ts DESC
          LIMIT 1
       ) adapt ON TRUE
      WHERE pw.plan_id = ANY($1::text[])`,
    [planIds],
  ).catch(() => ({ rows: [] as RawRow[] }))).rows;

  const out = new Map<string, AdaptationInfo>();
  for (const r of rows) {
    out.set(r.workout_id, composeInfo(r));
  }
  return out;
}

function composeInfo(r: RawRow): AdaptationInfo {
  // wasAdapted · ANY of the runner-facing fields differs from the original.
  // Distance compared with a small float epsilon (jsonb numerics + numeric
  // column round trips can differ by ~0.001 even when they "are" the same).
  const typeChanged = r.original_type != null && r.original_type !== r.type;
  const subLabelChanged = r.original_sub_label != null &&
                          r.original_sub_label !== r.sub_label;
  const distanceChanged = r.original_distance_mi != null &&
                          r.distance_mi != null &&
                          Math.abs(Number(r.original_distance_mi) - Number(r.distance_mi)) > 0.05;
  const dateChanged = r.original_date_iso != null && r.original_date_iso !== r.date_iso;

  const wasAdapted = typeChanged || subLabelChanged || distanceChanged || dateChanged;

  // Reason · prefer the parsed why string from the intent value; fall back
  // to the reason field. Always plain English from the source · NOT
  // synthesized.
  const reasonRaw = r.intent_value?.why ?? r.intent_reason ?? null;
  const reason = reasonRaw;

  // Kind · prefer the parsed kind from value, fall back to inferring from
  // the reason suffix.
  let kind: AdaptationKind | null = null;
  if (r.intent_value?.kind) {
    const k = r.intent_value.kind;
    if (k === 'downgrade' || k === 'reschedule' || k === 'shave' || k === 'mark_dirty') {
      kind = k;
    } else {
      kind = 'other';
    }
  } else if (r.intent_reason) {
    const reasonSuffix = r.intent_reason.replace(/^plan_adapt_?/, '');
    if (['downgrade', 'reschedule', 'shave', 'mark_dirty'].includes(reasonSuffix)) {
      kind = reasonSuffix as AdaptationKind;
    } else if (wasAdapted) {
      kind = 'other';
    }
  } else if (wasAdapted) {
    // wasAdapted=true but no intent · backend-mutated row · "other" is
    // the catch-all per the brief.
    kind = 'other';
  }

  return {
    wasAdapted,
    originalType: r.original_type,
    originalSubLabel: r.original_sub_label,
    originalDistanceMi: r.original_distance_mi != null ? Number(r.original_distance_mi) : null,
    originalDateIso: r.original_date_iso,
    reason,
    adaptedAt: r.intent_ts ? r.intent_ts.toISOString() : null,
    kind,
  };
}
