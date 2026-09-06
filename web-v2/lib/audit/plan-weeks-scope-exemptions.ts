/**
 * lib/audit/plan-weeks-scope-exemptions.ts · PLANWEEKS-1's ratchet.
 *
 * See `_plan_weeks_scope_scan.test.ts` for the bug class: `plan_weeks.user_uuid`
 * is NULL on 88 of 672 production rows — including every week of the owner's
 * currently active plan — because the column stopped being populated at some
 * point after migration 143 backfilled it. A statement that filters on it
 * directly does not error; it silently reads an empty or truncated result,
 * which is a worse failure than a crash because nothing looks wrong.
 *
 * Confirmed instances, same shape, three different files, found in one sweep
 * on 2026-09-05: `lib/plan/volume-evidence-loader.ts` (fixed by the agent that
 * found it and named it), `lib/adaptation/volume-evidence/
 * _replay_real_history.script.ts` (that agent's own header names this file as
 * still carrying the defect; fixed here), and
 * `lib/adaptation-harness/substrate.ts` (found in this sweep — the harness that
 * copies the owner's real rows and slides them onto today was leaving
 * `plan_weeks.week_start_iso` un-shifted while `plan_workouts.date_iso` moved,
 * because the substrate is a copy of exactly the NULL rows the loader named).
 *
 * Every entry below MUST be an argued reason a statement legitimately reads
 * `plan_weeks.user_uuid` (or `.user_id`) directly rather than scoping through
 * `training_plans`, or a plan to fix it. This list is a RATCHET — it may
 * shrink, never grow — and Rule 18 clause 4 means a stale entry (one whose
 * file no longer trips the scanner) fails the suite until deleted.
 */
export interface PlanWeeksScopeExemption {
  readonly file: string;
  /**
   * Restrict the exemption to one statement. Omit only for a file-wide reason
   * that predates statement-level scoping; every new exemption should name a
   * fingerprint substring of the offending statement so nothing ELSE in the
   * same file is excused by accident.
   */
  readonly statement?: string;
  readonly reason: string;
}

// Deliberately empty as of 2026-09-05. The two migrations that WRITE
// `plan_weeks.user_uuid` FROM `training_plans` (143_plan_chain_user_uuid.sql
// and migrations-manual/2026-08-17-backfill-plan-workouts-user-uuid.sql) sit
// outside the scanner's directories (lib/app/scripts hold no `db/migrations`
// or `migrations-manual` path) and are never walked, so an exemption entry for
// them would be stale from the moment it was written — the ratchet test below
// would fail on it immediately. They are not exemptions; they are the fix's
// source of truth, named here for the next reader rather than encoded as a
// row this file cannot verify against.
export const PLAN_WEEKS_SCOPE_EXEMPTIONS: readonly PlanWeeksScopeExemption[] = [];
