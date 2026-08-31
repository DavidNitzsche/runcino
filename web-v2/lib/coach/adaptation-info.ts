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
import { stripResearchCitations } from '@/lib/plan/strip-citations';

/** 2026-08-17 · 'reshape' · the progression gate held, eased or accelerated a
 *  session's dose. Named rather than left to fall through to 'other' because
 *  the runner's question about this one is different: the day is the same
 *  workout at a different size, not a workout that was replaced. */
/** 2026-08-30 · 'upgrade' · the adaptive ramp raised this day's distance.
 *
 *  THE ONE KIND THE PRODUCT EXISTS FOR HAD NO NAME ON THIS SURFACE.
 *  `tryAdaptiveBump` applies `kind: 'mark_upgrade'`, which `applyAdaptations`
 *  records as `plan_adapt_upgrade` with `value.kind = 'mark_upgrade'`. Neither
 *  spelling was in the accepted set below, so both fell through to `'other'` —
 *  the catch-all that also covers "a row differs from its authored self and we
 *  have no idea why". A push would have rendered as an anonymous change.
 *
 *  It has never mattered until now because `plan_adapt_upgrade` has zero rows
 *  in production; the ramp could not fire (see `lib/plan/adaptive-ramp.ts`
 *  gate 2). Now that it can, this surface is the first thing the runner sees. */
export type AdaptationKind =
  | 'downgrade' | 'reschedule' | 'shave' | 'mark_dirty' | 'reshape' | 'upgrade' | 'other';

/** The action kinds a persisted intent may carry, and the surface name each
 *  maps to. `mark_upgrade` is the adapter's internal action name; `upgrade` is
 *  what the runner's surface calls it. */
const KIND_FROM_ACTION: Readonly<Record<string, AdaptationKind>> = {
  downgrade: 'downgrade',
  reschedule: 'reschedule',
  shave: 'shave',
  mark_dirty: 'mark_dirty',
  reshape: 'reshape',
  mark_upgrade: 'upgrade',
};

/** `coach_intents.reason` suffix → surface name, for rows whose `value` carries
 *  no `kind`. `plan_adapt_progression` is the cycle's name, not the row's:
 *  what happened to the row is a reshape. */
const KIND_FROM_REASON: Readonly<Record<string, AdaptationKind>> = {
  downgrade: 'downgrade',
  reschedule: 'reschedule',
  shave: 'shave',
  mark_dirty: 'mark_dirty',
  reshape: 'reshape',
  upgrade: 'upgrade',
  progression: 'reshape',
};

/**
 * ONE resolver, because there were two and they had already drifted (Rule 16).
 *
 * `lib/coach/readiness-brief.ts` carried its own copy whose accepted set was a
 * strict subset — no `reshape`, no `upgrade` — so the same adaptation rendered
 * with one name on Today and a different one in the readiness brief. Both now
 * call this.
 *
 * Returns null only when nothing changed AND nothing is recorded: an unadapted
 * row has no kind, which is different from an adapted row we cannot classify.
 */
export function resolveAdaptationKind(args: {
  intentActionKind: string | null | undefined;
  intentReason: string | null | undefined;
  wasAdapted: boolean;
}): AdaptationKind | null {
  if (args.intentActionKind) {
    return KIND_FROM_ACTION[args.intentActionKind] ?? 'other';
  }
  if (args.intentReason) {
    const suffix = args.intentReason.replace(/^plan_adapt_?/, '');
    return KIND_FROM_REASON[suffix] ?? (args.wasAdapted ? 'other' : null);
  }
  // No intent at all · a backend-mutated row. "other" is the catch-all per the
  // adaptation-visibility brief, and only when something actually differs.
  return args.wasAdapted ? 'other' : null;
}

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
  //
  // 2026-08-17 · citation-scrubbed on the way out. New whys are scrubbed
  // at the write site (applyAdaptations / writeWorkoutProposals); this
  // read-side pass covers rows written BEFORE that landed, which still
  // carry "Research/22 §14" fragments the runner should never see.
  const reasonRaw = r.intent_value?.why ?? r.intent_reason ?? null;
  const reason = reasonRaw ? stripResearchCitations(reasonRaw) : null;

  // Kind · one resolver, shared with the readiness brief. See
  // `resolveAdaptationKind` for why there is only one now.
  const kind = resolveAdaptationKind({
    intentActionKind: r.intent_value?.kind ?? null,
    intentReason: r.intent_reason,
    wasAdapted,
  });

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
