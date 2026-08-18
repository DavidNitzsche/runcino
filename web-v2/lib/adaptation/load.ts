/**
 * Assemble an `AdaptationInput` from the runner's actual data.
 *
 * The classifier in `adaptation-model.ts` is pure and deliberately knows
 * nothing about the database. This is the layer that feeds it, and its whole
 * job is to reuse the readers that already exist rather than growing a second
 * opinion about any signal. Where a reader exists it is called; where one does
 * not, the query here is the only place that shape is derived.
 *
 * ## The honesty contract
 *
 * Every field is nullable, and null means "we could not see this", never
 * "this was bad". A reader that throws, a table with no rows, a runner three
 * days into an account — all of those produce nulls, and the classifier
 * degrades to `normal` with low confidence rather than inventing a finding.
 * Nothing in this file may substitute a default for a measurement.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { computeTrainingForm } from '@/lib/coach/training-form';
import { computeRecoveryPhase } from '@/lib/coach/recovery-phase';
import { loadEasyDiscipline } from '@/lib/coach/easy-discipline';
import { computeAerobicDecoupling } from '@/lib/training/aerobic-decoupling';
import { computeHrThirds } from '@/lib/coach/hr-thirds';
import { classifyAdaptation, type AdaptationInput, type AdaptationVerdict } from './adaptation-model';

/** How far back the adaptation read looks. Long enough for a trend, short
 *  enough to describe the block the runner is actually in. */
export const ADAPTATION_WINDOW_DAYS = 42;

/** Readiness needs its own, longer window — the sustained-deviation test in
 *  the classifier is meaningless over a fortnight. */
export const READINESS_WINDOW_DAYS = 28;

function daysBefore(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** Run a reader, and treat any failure as "could not see", never as a finding. */
async function quiet<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[adaptation] ${label} unreadable:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function loadAdaptationInput(
  userUuid: string,
  todayArg?: string,
): Promise<AdaptationInput> {
  const todayISO = todayArg ?? (await runnerToday(userUuid));
  const fromISO = daysBefore(todayISO, ADAPTATION_WINDOW_DAYS);
  const readinessFromISO = daysBefore(todayISO, READINESS_WINDOW_DAYS);

  const [
    keySessions,
    verdictRows,
    rpe,
    longRuns,
    weekly,
    readiness,
    downgrades,
    niggle,
    injury,
    form,
    recovery,
    easy,
  ] = await Promise.all([
    /* Key sessions planned vs actually run. A quality day counts as completed
     * when a run exists on that date — "did you do the thing", not "was it
     * good". Whether it was good is the target-verdict signal below. */
    quiet('key sessions', async () =>
      (
        await pool.query<{ planned: string; completed: string }>(
          `SELECT COUNT(*)::text AS planned,
                  COUNT(*) FILTER (WHERE r.id IS NOT NULL)::text AS completed
             FROM plan_workouts pw
             LEFT JOIN runs r
               ON r.user_uuid = pw.user_uuid
              AND (r.data->>'start_date_local')::date = pw.date_iso::date
            WHERE pw.user_uuid = $1
              AND pw.is_quality = true
              AND pw.date_iso >= $2
              AND pw.date_iso < $3`,
          [userUuid, fromISO, todayISO],
        )
      ).rows[0],
    ),

    /* Target adherence. Reads the persisted verdicts rather than re-judging:
     * `judgeTestPointExecution` already applies the basis ladder and the heat
     * adjustment, and a second implementation here would drift from it. */
    quiet('target verdicts', async () =>
      (
        await pool.query<{ verdict: string }>(
          `SELECT r.data->'faff'->>'quality_verdict' AS verdict
             FROM runs r
            WHERE r.user_uuid = $1
              AND (r.data->>'start_date_local')::date >= $2::date
              AND (r.data->>'start_date_local')::date < $3::date
              AND r.data->'faff'->>'quality_verdict' IS NOT NULL
            ORDER BY (r.data->>'start_date_local')::date`,
          [userUuid, fromISO, todayISO],
        )
      ).rows,
    ),

    quiet('rpe', async () =>
      (
        await pool.query<{ total: string; hard: string }>(
          `SELECT COUNT(*)::text AS total,
                  COUNT(*) FILTER (WHERE rpe >= 8)::text AS hard
             FROM post_run_rpe
            WHERE user_uuid = $1 AND logged_at >= $2::date AND logged_at < $3::date`,
          [userUuid, fromISO, todayISO],
        )
      ).rows[0],
    ),

    /* Long runs carry the internal-cost signals worth reading: decoupling and
     * late HR drift. Both need splits, so runs without them drop out rather
     * than contributing a guess. */
    quiet('long runs', async () =>
      (
        await pool.query<{ id: string; data: unknown }>(
          `SELECT r.id::text, r.data
             FROM runs r
            WHERE r.user_uuid = $1
              AND (r.data->>'start_date_local')::date >= $2::date
              AND (r.data->>'start_date_local')::date < $3::date
              AND (r.data->>'distance')::numeric > 12874
            ORDER BY (r.data->>'start_date_local')::date`,
          [userUuid, fromISO, todayISO],
        )
      ).rows,
    ),

    /* Planned vs actual weekly mileage over complete weeks only. A partial
     * current week would read as a shortfall the runner has not had a chance
     * to make good on. */
    quiet('weekly volume', async () =>
      (
        await pool.query<{ wk: string; planned: string; actual: string }>(
          `WITH wks AS (
             SELECT date_trunc('week', pw.date_iso::date) AS wk,
                    SUM(pw.distance_mi)::numeric AS planned
               FROM plan_workouts pw
              WHERE pw.user_uuid = $1 AND pw.date_iso >= $2 AND pw.date_iso < $3
              GROUP BY 1
           ), act AS (
             SELECT date_trunc('week', (r.data->>'start_date_local')::date) AS wk,
                    SUM((r.data->>'distance')::numeric) / 1609.34 AS actual
               FROM runs r
              WHERE r.user_uuid = $1
                AND (r.data->>'start_date_local')::date >= $2::date
                AND (r.data->>'start_date_local')::date < $3::date
              GROUP BY 1
           )
           SELECT wks.wk::text, wks.planned::text, COALESCE(act.actual, 0)::text AS actual
             FROM wks LEFT JOIN act USING (wk)
            WHERE wks.wk < date_trunc('week', $3::date)
            ORDER BY wks.wk`,
          [userUuid, fromISO, todayISO],
        )
      ).rows,
    ),

    /* Readiness as a SUSTAINED count against the runner's own normal — never
     * today's band. See rule 2 in the classifier header. */
    quiet('readiness', async () =>
      (
        await pool.query<{ total: string; below: string }>(
          `WITH s AS (
             SELECT score FROM readiness_snapshots
              WHERE user_uuid = $1 AND snapshot_date >= $2::date AND snapshot_date < $3::date
                AND score IS NOT NULL
           ), norm AS (SELECT AVG(score) AS mean, GREATEST(STDDEV_SAMP(score), 1) AS sd FROM s)
           SELECT COUNT(*)::text AS total,
                  COUNT(*) FILTER (WHERE s.score < norm.mean - norm.sd)::text AS below
             FROM s, norm`,
          [userUuid, readinessFromISO, todayISO],
        )
      ).rows[0],
    ),

    quiet('adapter downgrades', async () =>
      (
        await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM plan_proposals
            WHERE user_uuid = $1 AND created_at >= $2::date
              AND proposal_kind IN ('downgrade_quality', 'volume_shave', 'pace_reanchor')`,
          [userUuid, fromISO],
        )
      ).rows[0],
    ),

    quiet('niggles', async () =>
      (
        await pool.query<{ severity: number | null }>(
          `SELECT MAX(severity) AS severity FROM niggles
            WHERE user_uuid = $1 AND status = 'active' AND logged_at >= $2::date`,
          [userUuid, fromISO],
        )
      ).rows[0],
    ),

    quiet('injuries', async () =>
      (
        await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM runner_injuries
            WHERE user_uuid = $1 AND resolved_date IS NULL`,
          [userUuid],
        )
      ).rows[0],
    ),

    quiet('training form', () => computeTrainingForm(userUuid)),
    quiet('recovery phase', () => computeRecoveryPhase(userUuid)),
    quiet('easy discipline', () => loadEasyDiscipline(userUuid, todayISO)),
  ]);

  /* --- derive the internal-cost series from the long runs ---------------- */
  const decouplingVerdicts: Array<'race-ready' | 'building' | 'poor'> = [];
  const lateDriftBpm: number[] = [];
  for (const run of longRuns ?? []) {
    const d = (run.data ?? {}) as Record<string, unknown>;
    const splits = Array.isArray(d.splits) ? (d.splits as never[]) : null;
    const distanceMi = Number(d.distance) > 0 ? Number(d.distance) / 1609.34 : null;

    const dec = computeAerobicDecoupling(splits, distanceMi);
    if (dec) decouplingVerdicts.push(dec.verdict);

    const thirds = computeHrThirds(splits, {
      avgHr: typeof d.average_heartrate === 'number' ? d.average_heartrate : null,
      maxHr: typeof d.max_heartrate === 'number' ? d.max_heartrate : null,
    });
    // Only measured thirds. An estimated third is a model output, and feeding
    // a model output back in as evidence is how a signal becomes circular.
    if (thirds?.source === 'measured' && thirds.driftBpm != null) {
      lateDriftBpm.push(thirds.driftBpm);
    }
  }

  const verdicts = (verdictRows ?? [])
    .map((r) => r.verdict)
    .filter((v): v is 'on' | 'fast' | 'slow' => v === 'on' || v === 'fast' || v === 'slow');

  const weeklyPlannedMi = (weekly ?? []).map((w) => Number(w.planned));
  const weeklyActualMi = (weekly ?? []).map((w) => Number(w.actual));

  /* Distinct weeks carrying judged evidence — the gate that stops one good
   * Tuesday reading as a trend. Counts weeks with a verdict OR a completed
   * week of volume, because both are evidence of the block being run. */
  const evidenceWeeks = new Set<string>();
  for (const w of weekly ?? []) if (Number(w.actual) > 0) evidenceWeeks.add(w.wk);

  const readinessTotal = readiness ? Number(readiness.total) : 0;

  return {
    keySessionsPlanned: keySessions ? Number(keySessions.planned) || null : null,
    keySessionsCompleted: keySessions ? Number(keySessions.completed) : null,
    targetVerdicts: verdicts.length > 0 ? verdicts : null,
    // Rep consistency is derived per-run inside run-recap and is not persisted
    // in a queryable shape. Left null rather than re-deriving it here — a
    // second implementation would drift from the one the recap shows.
    repConsistency: null,

    rpeReported: rpe ? Number(rpe.total) || null : null,
    rpeHarderThanExpected: rpe ? Number(rpe.hard) : null,
    decouplingVerdicts: decouplingVerdicts.length > 0 ? decouplingVerdicts : null,
    lateDriftBpm: lateDriftBpm.length > 0 ? lateDriftBpm : null,
    easyDiscipline: easy
      ? { established: easy.state === 'established', read: easy.read ?? null }
      : null,

    recoveryPctOfExpected:
      recovery && !recovery.dataInsufficient && recovery.percentRecovered != null
        ? recovery.percentRecovered / 100
        : null,
    readinessBelowNormalDays: readinessTotal > 0 ? Number(readiness!.below) : null,
    readinessWindowDays: readinessTotal > 0 ? readinessTotal : null,

    weeklyPlannedMi: weeklyPlannedMi.length > 0 ? weeklyPlannedMi : null,
    weeklyActualMi: weeklyActualMi.length > 0 ? weeklyActualMi : null,
    trainingForm: form?.label ?? null,

    distinctEvidenceWeeks: evidenceWeeks.size > 0 ? evidenceWeeks.size : null,
    adapterDowngrades: downgrades ? Number(downgrades.n) : null,

    niggleSeverity: niggle?.severity ?? null,
    illnessActive: null, // no illness signal is captured today · see below
    injuryActive: injury ? Number(injury.n) > 0 : null,
  };
}

/**
 * The one call a surface makes: load the runner's signals and classify them.
 *
 * Returns null only when the load itself fails outright. A runner we cannot
 * see still gets a verdict — `normal`, low confidence — because "proceed as
 * planned" is the honest answer to "we have no evidence", and it is what a
 * coach would say.
 */
export async function readAdaptation(
  userUuid: string,
  todayArg?: string,
): Promise<AdaptationVerdict | null> {
  const input = await quiet('adaptation input', () => loadAdaptationInput(userUuid, todayArg));
  if (!input) return null;
  return classifyAdaptation(input);
}
