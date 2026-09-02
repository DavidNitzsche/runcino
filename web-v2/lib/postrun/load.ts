/**
 * lib/postrun/load.ts · the database shell for `lib/postrun/experience.ts`.
 *
 * ONE loader, called by BOTH post-run surfaces. That is the whole point: the
 * brief's first P0 is that Today-after-run and Run Detail "independently
 * compose nearly the same experience from different payloads", and two call
 * sites assembling the same arguments is a parity you have to re-prove after
 * every edit. One loader is a parity you get by construction.
 *
 * ── RULE 14 · THE POPULATION EVERY QUERY READS ──────────────────────────────
 *
 * Stated once, here, because a copy that drifts is the defect class:
 *
 *   · Runs — this `user_uuid`, CANONICAL rows only (`CANONICAL_ROW_SQL`, the
 *     one definition). A merged twin is a duplicate of an activity, not an
 *     activity.
 *   · Plan days — the ACTIVE plan only, joined through `training_plans` with
 *     `archived_iso IS NULL`. Joining `plan_workouts` on `user_uuid` alone
 *     reads every archived version of the plan (ACTIVEPLAN-1), which is how
 *     one week once counted 59 quality sessions.
 *   · Watch completion — `coach_intents` for this runner, matched on the
 *     field's own date suffix where it carries one and otherwise on the
 *     timestamp converted to the RUNNER'S timezone. Same convention as
 *     `loadPhaseBreakdown`; a treadmill completion carries no suffix and a
 *     UTC-date comparison lands it on the wrong day.
 *   · Adaptations — this runner's `plan_adapt_*` intents stamped on or after
 *     the run's own date. Anything earlier is about a different run.
 *
 * ── RULE 11 · WHAT A FAILED READ RETURNS ────────────────────────────────────
 *
 * Every optional load below distinguishes "we looked and found nothing" from
 * "the look failed", and hands the composer the difference. `adaptations` is
 * the sharp case: `[]` produces `PlanImpact.status = 'UNCHANGED'`, `null`
 * produces `'UNKNOWN'`, and printing the first when the second is true is a
 * claim the app did not earn.
 */
import { pool } from '@/lib/db/pool';
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';
import { runDaySql } from '@/lib/runs/run-shape';
import { runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { resolveWorkoutVerdict, phasesFromCompletion } from '@/lib/execution/verdict';
import { classifyStoredActivity } from '@/lib/evidence/load-activity-evidence';
import { displayTypeFor } from '@/lib/faff/v5-today';
import { workHrCeiling, overallHrCeiling } from '@/lib/prescription/hr-ceiling';
import { runAvgHr } from '@/lib/runs/run-shape';
import {
  composePostRunExperience,
  type PostRunAdaptation,
  type PostRunExperienceV1,
  type PostRunInput,
} from './experience';
import type { ActivityEvidenceResult } from '@/lib/evidence/activity-evidence';

/** Which `coach_intents.reason` values are a PLAN CHANGE.
 *
 *  An explicit list, not a `LIKE 'plan_adapt%'`, so a future reason has to be
 *  classified deliberately rather than inherited by its prefix. `vdot_auto_recalc`
 *  is here because a re-anchor reprices every unsealed workout, which is a plan
 *  change the runner can see. */
export const PLAN_CHANGE_REASONS: readonly string[] = [
  'plan_adapt_downgrade',
  'plan_adapt_reschedule',
  'plan_adapt_drop_missed',
  'plan_adapt_overridden',
  'plan_adapt_long_floor',
  'plan_adapt_gap',
  'vdot_auto_recalc',
];

/**
 * The engine's own sentence, minus the parts written for an engineer.
 *
 * `plan_adapt_*` rows carry a `why` that a runner could mostly read, with a
 * doctrine citation welded onto the end — "First run back is easy, not
 * quality. Research/22 §14: 1-7 days, resume plan, one easy day instead of
 * first quality." Quoting it whole puts a research reference on the runner's
 * phone; re-wording it invents a claim about a decision this file did not
 * make. So: keep the sentences that carry no citation, drop the ones that do,
 * and return null when nothing survives.
 *
 * ASSERTS THE SHAPE OF WHAT SURVIVES, not the absence of the citation — the
 * citation-scrub bug this repo already shipped ("Cruise intervals · Research/04
 * §5.3." became "Cruise intervals.3.") passed an absence-only test.
 */
export function runnerSafeWhy(why: unknown): string | null {
  if (typeof why !== 'string') return null;
  const kept = why
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/Research\//i.test(s) && !/§/.test(s));
  if (kept.length === 0) return null;
  const out = kept.join(' ').trim();
  if (out.length === 0) return null;
  return out;
}

export interface PostRunRef {
  /** Either an explicit run id (any spelling the app uses) … */
  runId?: string;
  /** … or the runner's local day, for the Today-after-run surface. */
  dateISO?: string;
}

interface RunRow { id: string; data: Record<string, any> }

async function loadRun(userId: string, ref: PostRunRef): Promise<RunRow | null> {
  if (ref.runId) {
    const r = await pool.query<RunRow>(
      `SELECT id::text AS id, data
         FROM runs
        WHERE user_uuid = $1
          AND ${CANONICAL_ROW_SQL}
          AND (id::text = $2 OR data->>'activityId' = $2 OR data->>'id' = $2)
        LIMIT 1`,
      [userId, String(ref.runId)],
    );
    if (r.rows[0]) return r.rows[0];
  }
  if (ref.dateISO) {
    // The day's LONGEST canonical run — the same pick `/api/v5/today` makes
    // for its poster, so the two cannot describe different runs.
    const r = await pool.query<RunRow>(
      `SELECT id::text AS id, data
         FROM runs
        WHERE user_uuid = $1
          AND ${CANONICAL_ROW_SQL}
          AND ${runDaySql()} = $2
        ORDER BY (data->>'distanceMi')::numeric DESC NULLS LAST
        LIMIT 1`,
      [userId, ref.dateISO],
    );
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}

/**
 * Compose the canonical post-run experience for one run.
 *
 * Returns null ONLY when there is no such run for this runner. Every other
 * failure is expressed inside the object, because a surface that draws nothing
 * cannot tell a missing run from a failed load and the runner then sees an
 * empty screen with no reason on it (Rule 11).
 */
export async function loadPostRunExperience(
  userId: string,
  ref: PostRunRef,
): Promise<PostRunExperienceV1 | null> {
  const runRow = await loadRun(userId, ref);
  if (!runRow) return null;
  const data = runRow.data ?? {};
  const dateISO = String(data.date ?? String(data.startLocal ?? '').slice(0, 10));

  // ── the ACTIVE plan's row for the day ────────────────────────────────────
  const planRes = await pool.query<{
    plan_id: string; type: string | null; distance_mi: string | number | null;
    workout_spec: Record<string, unknown> | null; sub_label: string | null;
  }>(
    `SELECT pw.plan_id, pw.type, pw.distance_mi, pw.workout_spec, pw.sub_label
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.date_iso = $2
      ORDER BY pw.id ASC
      LIMIT 1`,
    [userId, dateISO],
  );
  const planRow = planRes.rows[0] ?? null;

  const activePlanRes = await pool.query<{ id: string }>(
    `SELECT id FROM training_plans WHERE user_uuid = $1::uuid AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  );
  const activePlanId = planRow?.plan_id ?? activePlanRes.rows[0]?.id ?? null;

  // ── the wrist's completion payload for the day ───────────────────────────
  // NOT wrapped in a catch. `runnerTimezoneOrPacific` already answers the
  // "this runner has no stored timezone" case by name; a catch here would also
  // swallow a database failure and answer it with Pacific, which is a guess
  // wearing a default's clothes (Rule 11).
  const tz = await runnerTimezoneOrPacific(userId);
  const intentRes = await pool.query<{ value: unknown }>(
    `SELECT value FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1 AND reason = 'watch_completion'
        AND (CASE WHEN field ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}(#[0-9]+)?$'
                  THEN field ~ ('-' || $2::text || '(#[0-9]+)?$')
                  ELSE (ts AT TIME ZONE $3::text)::date = $2::date END)
      ORDER BY ts DESC LIMIT 1`,
    [userId, dateISO, tz],
  );
  const phases = intentRes.rows[0]
    ? phasesFromCompletion(intentRes.rows[0].value)
    : phasesFromCompletion(data.phases);

  // THE canonical grade. Never re-derived on a surface.
  const verdict = resolveWorkoutVerdict({
    type: planRow?.type ?? (data.workoutType as string | null) ?? null,
    spec: planRow?.workout_spec ?? null,
    phases,
  });

  // ── the Evidence Engine ──────────────────────────────────────────────────
  // Null on a failed or impossible classification, which the composer renders
  // as `UNREAD` rather than as "not enough evidence".
  //
  // NOT wrapped in a catch. `classifyStoredActivity` already returns null for
  // "no such canonical row", which is the answer `UNREAD` renders; a catch
  // would fold a database failure into that same null and the runner would
  // read "has not been read yet" over an outage. A throw reaches the route,
  // which omits the section rather than filling it with a guess.
  let evidence: ActivityEvidenceResult | null = null;
  if (/^-?\d+$/.test(runRow.id)) {
    evidence = await classifyStoredActivity(userId, runRow.id);
  }

  // ── the runner's own effort answer ───────────────────────────────────────
  const rpeIds = Array.from(new Set(
    [data.activityId, data.id, runRow.id].filter((v) => v != null).map(String),
  ));
  const rpeRes = await pool.query<{ rpe: number | null }>(
    `SELECT rpe FROM post_run_rpe
      WHERE (user_uuid = $1 OR user_id::text = $1::text)
        AND activity_id = ANY($2::text[])
      -- THE RUNNER'S OWN ANSWER WINS. pullSync auto-imports Strava's
      -- perceived_exertion and stamps it 'auto-imported from strava', so a run
      -- the runner answered can still collect a later row from the importer.
      -- Ordering by time alone replaces what he said with what Strava guessed.
      -- Same clause as /api/v5/today and lib/watch/build-workout.ts.
      ORDER BY (notes IS DISTINCT FROM 'auto-imported from strava') DESC,
               logged_at DESC
      LIMIT 1`,
    [userId, rpeIds],
  );
  const rpe = rpeRes.rows[0]?.rpe ?? null;

  // ── what moved in the plan since this run ────────────────────────────────
  // `null` on a failed read. See the header.
  let adaptations: PostRunAdaptation[] | null = null;
  try {
    const rows = await pool.query<{ reason: string; value: unknown }>(
      `SELECT reason, value FROM coach_intents
        WHERE COALESCE(user_uuid, user_id) = $1
          AND reason = ANY($2::text[])
          AND ts >= $3::date
        ORDER BY ts DESC
        LIMIT 8`,
      [userId, PLAN_CHANGE_REASONS as string[], dateISO],
    );
    adaptations = rows.rows.map((r): PostRunAdaptation => {
      let v: any = r.value;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
      return { reason: r.reason, display: runnerSafeWhy(v?.why) ?? 'The plan was adjusted.' };
    });
  } catch {
    adaptations = null;
  }

  /* THE CEILINGS, PER SCOPE, from their one owner.
   *
   * `workHrCeiling` reads the spec's own `pass` rule — "Pass: avgHr <= 164 on
   * the work" on the owner's 2026-09-01 threshold session — which no server
   * reader had ever looked at. `overallHrCeiling` is `hr_cap_bpm` and nothing
   * else. Neither falls through to the other: they bound different quantities
   * and `readCost` pairs each with the mean it may honestly be read against. */
  const workCeiling = workHrCeiling(planRow?.workout_spec ?? null);
  const overallCeiling = overallHrCeiling(planRow?.workout_spec ?? null);

  // SENSOR-LIMITED comes from the Evidence Engine's own per-signal grading
  // where we have it, and from the row's bare facts where we do not. It is
  // never inferred from an absent number alone.
  const sig = evidence?.eligibility.signals ?? null;
  const sensorLimited = sig
    ? (sig.hr === 'unusable' || sig.hr === 'low') && (sig.pace === 'unusable' || sig.pace === 'low')
    : evidence != null
      ? !evidence.eligibility.admissible
      : false;

  const input: PostRunInput = {
    runId: runRow.id,
    dateISO,
    plannedType: planRow?.type ?? null,
    plannedTypeDisplay: planRow?.type ? displayTypeFor(planRow.type, planRow.sub_label) : null,
    plannedDistanceMi: planRow?.distance_mi != null ? Number(planRow.distance_mi) : null,
    verdict,
    evidence,
    workHrCeilingBpm: workCeiling?.bpm ?? null,
    overallHrCeilingBpm: overallCeiling?.bpm ?? null,
    wholeRunHrBpm: runAvgHr(data as any),
    rpe: rpe != null ? Number(rpe) : null,
    adaptations,
    hasActivePlan: activePlanId != null,
    activePlanId,
    sensorLimited,
  };
  return composePostRunExperience(input);
}
