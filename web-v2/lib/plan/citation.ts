/**
 * lib/plan/citation.ts · doctrine citation enforcement (Phase 1.4).
 *
 * Every plan mutation (downgrade, shave, rebuild, taper adjust,
 * prescription change) must cite a Research/ source. No silent
 * prescriptions.
 *
 * Pattern: define a typed `ResearchCitation` enum sourced from the
 * codified doctrine (system_doctrine rows + Research/ files). Every
 * plan-engine call site uses `mutateWithCitation()` which requires a
 * citation at the type layer · attempts to call without one fail to
 * compile.
 *
 * This file is the seam. Once every adapter/generator call site goes
 * through `mutateWithCitation()`, removing the citation field becomes
 * a compile error · the doctrine discipline is locked.
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.4
 * Cite: docs/SYSTEM_AUDIT_2026-05-30.md §21-row doctrine inventory
 */

import { pool } from '@/lib/db/pool';

/**
 * Canonical Research/ citation enum. Every plan mutation must reference
 * one of these. To add a new citation:
 *   1. Add the Research/ file (or open a section in an existing one)
 *   2. Insert a row into system_doctrine table
 *   3. Add the literal to this enum
 *
 * Free-form strings are NOT allowed. The type system enforces this.
 */
export type ResearchCitation =
  // === Plan generation ===
  | 'Research/00a-distance-running-training.md §Volume-Progression-Rules'     // was §progressive-overload · heading: ### Volume progression rules
  | 'Research/00a-distance-running-training.md §missed-workout-policy'        // TODO: no matching heading in Research/00a — content exists but heading not anchored
  | 'Research/00a-distance-running-training.md §Volume-Guidelines-by-Experience' // was §volume-by-experience · heading: ## Volume Guidelines by Experience and Distance
  | 'Research/00b-recovery-protocols.md §Sleep'                               // was §sleep-as-recovery · heading: ### Sleep — The Highest-ROI Recovery Tool
  | 'Research/00b-recovery-protocols.md §recovery-load-scaling'               // TODO: no matching heading in Research/00b — content exists but heading not anchored
  | 'Research/01-pace-zones-vdot.md §Recalibrate-Paces'                      // was §VDOT-recalibrate · heading: ## How to recalibrate paces
  | 'Research/01-pace-zones-vdot.md §T-pace-derivation'                      // TODO: no matching heading in Research/01 — content exists but heading not anchored
  | 'Research/04-workout-vocabulary.md §hard-easy-rule'                      // fixed filename: was 04-workouts-and-progressions.md (file does not exist)
  | 'Research/04-workout-vocabulary.md §quality-density'                     // fixed filename: was 04-workouts-and-progressions.md (file does not exist)
  | 'Research/04-workout-vocabulary.md §long-run-progression'                // fixed filename: was 04-workouts-and-progressions.md (file does not exist)
  | 'Research/08-pacing-and-race-week.md §taper'
  | 'Research/08-pacing-and-race-week.md §9.3-Race-Week-Templates'           // was §race-week-execution · heading: ### 9.3 Day-by-day race week templates
  | 'Research/15-wearable-data.md §HRV'
  | 'Research/15-wearable-data.md §RHR'                                      // was §RHR-Recovery-Indicators · heading: ## Resting Heart Rate (RHR)
  | 'Research/15-wearable-data.md §ACWR'
  | 'Research/15-wearable-data.md §HR-Recovery'                              // TODO: no matching heading in Research/15 — content exists but heading not anchored
  | 'Research/15-wearable-data.md §When-Wearable-Disagrees-Subjective'       // was §Subjective-Measures · heading: ## When Wearable Data Agrees vs. Disagrees with Subjective State
  | 'Research/15-wearable-data.md §recovery-after-quality'                   // TODO: no matching heading in Research/15 — content exists but heading not anchored
  | 'Research/22-plan-templates.md §quality-mix-by-distance'                 // TODO: no matching heading in Research/22 — content exists but heading not anchored
  | 'Research/22-plan-templates.md §minimum-base-by-level'                   // TODO: no matching heading in Research/22 — content exists but heading not anchored
  | 'Research/22-plan-templates.md §projection-feedback-loop'                // TODO: no matching heading in Research/22 — content exists but heading not anchored

  // === Doctrine docs ===
  | 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.1'   // goal-gap
  | 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.2'   // per-axis drift
  | 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.3'   // block adapter
  | 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.4'   // citation enforcement
  | 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.1'   // simulator
  | 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.2'   // calibration
  | 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.3'   // gap-report
  | 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.4'   // goal renegotiation

  // === External canonical sources (still doctrine, not Research/) ===
  | 'Daniels Running Formula §VDOT pace tables'
  | 'Pfitzinger ADM §long-run progression'
  | 'Saw et al. 2016 §subjective-wellness';

/**
 * Every plan mutation carries one of these kinds. Drives audit
 * categorization and surfacing in the briefing voice.
 */
export type MutationKind =
  | 'downgrade'        // type changed (threshold → easy)
  | 'shave'            // distance reduced
  | 'reschedule'       // date moved
  | 'recompute_paces'  // pace targets recalibrated
  | 'mark_dirty'       // prescription stale, needs regen
  | 'block_shift'      // multi-day cascade from adapt-block
  | 'goal_renegotiate' // runner accepted new goal time
  | 'auto_rebuild';    // drift / goal-gap fired a fresh generate

/**
 * A plan mutation envelope. Citation is REQUIRED · the type system
 * rejects mutations without one. Build via composer functions below.
 */
export interface PlanMutation {
  kind: MutationKind;
  workoutId: string;                    // plan_workouts.id
  userUuid: string;
  citation: ResearchCitation;           // REQUIRED at the type layer
  reason: string;                       // plain English for the brief
  changes: Record<string, unknown>;     // field → new value mapping
  /** Optional · cascade chain when this is part of a multi-step block. */
  parentMutationId?: number;
}

/**
 * Apply a mutation · writes coach_intents audit row AND mutates
 * plan_workouts in a single transaction.
 *
 * Returns the audit row ID so cascade mutations can reference their
 * parent.
 */
export async function applyMutation(m: PlanMutation): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Write audit row first · cascade descendants can reference it
    const audit = await client.query<{ id: number }>(
      `INSERT INTO coach_intents
         (user_id, user_uuid, ts, reason, field, value)
       VALUES ($1::uuid, $1::uuid, NOW(), $2::text, $3::text, $4::jsonb)
       RETURNING id`,
      [
        m.userUuid,
        `plan_${m.kind}`,
        m.workoutId,
        JSON.stringify({
          mutation_kind: m.kind,
          citation: m.citation,
          reason: m.reason,
          changes: m.changes,
          parent_mutation_id: m.parentMutationId ?? null,
        }),
      ],
    );

    // Build UPDATE SQL from the changes object
    const fields = Object.keys(m.changes);
    if (fields.length > 0) {
      const setSql = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
      const values = fields.map((f) => m.changes[f]);
      await client.query(
        `UPDATE plan_workouts SET ${setSql} WHERE id = $1::uuid`,
        [m.workoutId, ...values],
      );
    }

    await client.query('COMMIT');
    return audit.rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Composer · downgrade a quality workout to easy with required citation.
 * The signature makes the citation impossible to forget.
 */
export function composeDowngrade(args: {
  workoutId: string;
  userUuid: string;
  citation: ResearchCitation;
  reason: string;
  newType?: string;
  newDistanceMi?: number;
}): PlanMutation {
  return {
    kind: 'downgrade',
    workoutId: args.workoutId,
    userUuid: args.userUuid,
    citation: args.citation,
    reason: args.reason,
    changes: {
      ...(args.newType ? { type: args.newType } : {}),
      ...(args.newDistanceMi != null ? { distance_mi: args.newDistanceMi } : {}),
      sub_label: null,                  // clear stale sub_label per workout_spec doctrine
      pace_target_s_per_mi: null,       // clear stale pace target
      is_quality: false,
      workout_spec: null,               // clear stale spec
    },
  };
}

/**
 * Composer · shave distance off a workout with required citation.
 * Rounds to nearest 0.5 mi per the established distance-rounding rule.
 */
export function composeShave(args: {
  workoutId: string;
  userUuid: string;
  citation: ResearchCitation;
  reason: string;
  newDistanceMi: number;
}): PlanMutation {
  const rounded = Math.round(args.newDistanceMi * 2) / 2;
  return {
    kind: 'shave',
    workoutId: args.workoutId,
    userUuid: args.userUuid,
    citation: args.citation,
    reason: args.reason,
    changes: {
      distance_mi: rounded,
    },
  };
}

/**
 * Composer · reschedule a workout to a new date with required citation.
 */
export function composeReschedule(args: {
  workoutId: string;
  userUuid: string;
  citation: ResearchCitation;
  reason: string;
  newDateISO: string;
}): PlanMutation {
  return {
    kind: 'reschedule',
    workoutId: args.workoutId,
    userUuid: args.userUuid,
    citation: args.citation,
    reason: args.reason,
    changes: {
      date_iso: args.newDateISO,
    },
  };
}
