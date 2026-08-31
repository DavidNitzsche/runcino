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
import { getCanonicalRunIds } from '@/lib/runs/volume';
import { ownedDaysSql } from '@/lib/plan/owned-days';
import {
  runDaySql,
  runDistanceMiSql,
  runSplitsSql,
  runNotMergedSql,
  asRunData,
  runDistanceMi,
  runAvgHr,
  runMaxHr,
} from '@/lib/runs/run-shape';
import { computeTrainingForm } from '@/lib/coach/training-form';
import { computeRecoveryPhase } from '@/lib/coach/recovery-phase';
import { loadEasyDiscipline, HEAT_CONFOUND_TEMP_F } from '@/lib/coach/easy-discipline';
import { computeAerobicDecoupling } from '@/lib/training/aerobic-decoupling';
import { DECOUPLING_ENDURANCE_GAP_PCT, DECOUPLING_HEAT_ARTIFACT_PCT } from '@/lib/coach/limiter';
import { computeHrThirds } from '@/lib/coach/hr-thirds';
import { loadRecentTestPoints } from '@/lib/training/goal-projection';
import { loadKeySessionExecutions } from '@/lib/execution/load';
import {
  loadPrescribedWindows,
  isPrescribedNonNormal,
  representativeLookback,
  type PrescribedWindow,
} from '@/lib/training/normal-window';
import {
  classifyAdaptation,
  type AdaptationInput,
  type AdaptationVerdict,
  type KeySessionRead,
} from './adaptation-model';

/**
 * The measured anchor, as the daily snapshot cron computed it from
 * `bestRecentVdot`. Read rather than recomputed: this is only used to size the
 * easy-pace leg of a blended verdict, and re-running selection here would put
 * a second opinion about fitness in the adaptation path.
 */
async function currentVdot(userUuid: string): Promise<number | null> {
  const r = await pool.query<{ vdot: string | null }>(
    `SELECT vdot::text FROM projection_snapshots
      WHERE user_uuid = $1 AND vdot IS NOT NULL
      ORDER BY snapshot_date DESC LIMIT 1`,
    [userUuid],
  );
  const v = r.rows[0]?.vdot;
  return v != null ? Number(v) : null;
}

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

  /* Two things every query below depends on, and both were wrong the first
   * time this file was written. Both were caught by running the loader against
   * real data rather than by a test, which is the argument for doing that.
   *
   * 1 · WHICH PLAN OWNED EACH DAY. `plan_workouts` carries every plan the
   *     runner has ever had — 45 of them over 3904 rows in the case that
   *     caught this — and rebuilds mean many plans cover the SAME dates. An
   *     unscoped count read 431 quality sessions in a 42-day window.
   *
   *     Scoping to the active plan is the obvious fix and it is also wrong:
   *     the day after a goal race the active plan is a fresh recovery block
   *     with no history, so the whole executed block vanishes into an archived
   *     row and the runner reads as having done nothing. The body does not
   *     know the plan was archived. So: for each DATE, take the workout from
   *     the most recently authored plan that covered that date. Rebuilds
   *     collapse to one, and executed history survives the rollover.
   *
   * 2 · DEDUP RUNS. This data multi-ingests (watch, Strava, HealthKit), and
   *     `getCanonicalRunIds` is the single source of truth for which row is
   *     the real one. Counting raw rows inflates completion and volume alike. */
  const canonicalIds = await getCanonicalRunIds(userUuid, fromISO, todayISO).catch(() => [] as string[]);

  /** One row per planned day — the version that was live for that date.
   *  Both failure modes described above now live in `lib/plan/owned-days.ts`
   *  along with the query, so the next surface to ask this question inherits
   *  the answer instead of re-deriving it. */
  const OWNED_DAYS = ownedDaysSql();

  /* The measured anchor, read once. Both the verdict path and the execution
   * reconstruction need it — the first to grade pace against it, the second to
   * name the domain a piece of work landed in and the pace this runner has
   * established there. Two independent reads would be two opinions. */
  const vdot = await quiet('current vdot', () => currentVdot(userUuid));

  const [
    keySessions,
    keySessionReads,
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
    /* Key sessions planned vs actually run.
     *
     * NARRATION ONLY since 2026-08-17. This counts a quality day as completed
     * when a run exists on that date, which cannot tell an EQUIVALENT session
     * from a MISSED one — the sentence the runner recognises, and no longer
     * the number the model scores. The states below are what it scores. */
    quiet('key sessions', async () =>
      (
        await pool.query<{ planned: string; completed: string }>(
          `WITH owned AS (${OWNED_DAYS})
           SELECT COUNT(*)::text AS planned,
                  COUNT(*) FILTER (WHERE r.id IS NOT NULL)::text AS completed
             FROM owned
             LEFT JOIN runs r
               ON r.id::text = ANY($4::text[])
              AND ${runDaySql('r')} = owned.date_iso
            WHERE owned.is_quality = true`,
          [userUuid, fromISO, todayISO, canonicalIds],
        )
      ).rows[0],
    ),

    /* Every key session, INTERPRETED — the execution dimension's real input.
     *
     * `interpretExecution` resolves each prescribed session to one of
     * doctrine's seven states and a stimulus completion, reconstructing the
     * planned stimulus from `workout_spec` and the actual one from the watch's
     * own phases (falling back to splits, then the whole run). Sessions whose
     * work no basis could describe come back `readable: false` and are dropped
     * here rather than passed as a state — a session we cannot judge is
     * missing evidence, not a failed one. */
    quiet('key session executions', () =>
      loadKeySessionExecutions(userUuid, fromISO, todayISO, vdot)),

    /* Target adherence. Calls the SAME judge the projection uses rather than
     * re-deriving: `loadRecentTestPoints` carries the basis ladder (work-phase
     * watch pace, then splits, then a blended whole-run expectation, then an
     * honest abstention), the heat adjustment, and the double-ingest dedup.
     * A second implementation here would drift from the verdicts the runner
     * sees on the run itself. Windowed to the adaptation window and uncapped,
     * where the projection takes only the newest three. */
    // includeArchivedPlans: the block the runner just finished lives in an
    // archived plan the moment the next one is authored. His body does not
    // know that. The projection keeps the active-plan-only default.
    quiet('target verdicts', () =>
      loadRecentTestPoints(userUuid, vdot, 200, fromISO, true)),

    quiet('rpe', async () =>
      (
        await pool.query<{ total: string; hard: string }>(
          `SELECT COUNT(*)::text AS total,
                  COUNT(*) FILTER (WHERE rpe >= 8)::text AS hard
             FROM post_run_rpe
            -- Both user columns: post_run_rpe.user_id is TEXT and predates
            -- user_uuid, so older rows carry 'me' and no uuid. A reader
            -- narrower than the writer counts a logged effort as unlogged.
            WHERE (user_uuid = $1 OR user_id::text = $1::text)
              AND logged_at >= $2::date AND logged_at < $3::date`,
          [userUuid, fromISO, todayISO],
        )
      ).rows[0],
    ),

    /* Long runs carry the internal-cost signals worth reading: decoupling and
     * late HR drift. Both need splits, so runs without them drop out rather
     * than contributing a guess. */
    /* One row per long-run DAY, choosing the richest.
     *
     * This data carries two split shapes: Strava-raw (`moving_time`,
     * `average_speed`, no heart rate) and faff-normalised (`hr`, `pace`). Both
     * can exist for the same run, and the canonical picker optimises for
     * mileage truth rather than for signal richness — so it can land on the
     * HR-less row and take the entire internal-cost dimension dark.
     *
     * Picking per day rather than per row keeps this dedup-safe: a day
     * contributes exactly one observation either way. Ordering prefers splits
     * that actually carry HR, then more splits, then the longer run. */
    quiet('long runs', async () =>
      (
        await pool.query<{ id: string; data: unknown }>(
          `SELECT DISTINCT ON (day) r.id::text, r.data,
                  ${runDaySql('r')} AS day
             FROM runs r
            WHERE r.user_uuid = $1
              AND ${runDaySql('r')} >= $2
              AND ${runDaySql('r')} < $3
              AND ${runDistanceMiSql('r')} >= 8
              AND ${runNotMergedSql('r')}
            ORDER BY day,
                     (${runSplitsSql('r')}->0 ? 'hr') DESC,
                     jsonb_array_length(COALESCE(${runSplitsSql('r')}, '[]'::jsonb)) DESC,
                     ${runDistanceMiSql('r')} DESC,
                     r.id DESC`,
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
          `WITH owned AS (${OWNED_DAYS}),
           wks AS (
             SELECT date_trunc('week', owned.date_iso::date) AS wk,
                    SUM(owned.distance_mi)::numeric AS planned
               FROM owned
              GROUP BY 1
           ), act AS (
             SELECT date_trunc('week', ${runDaySql('r')}::date) AS wk,
                    SUM(${runDistanceMiSql('r')}) AS actual
               FROM runs r
              WHERE r.id::text = ANY($4::text[])
                AND ${runDaySql('r')} >= $2
                AND ${runDaySql('r')} < $3
              GROUP BY 1
           )
           SELECT wks.wk::text, wks.planned::text, COALESCE(act.actual, 0)::text AS actual
             FROM wks LEFT JOIN act USING (wk)
            WHERE wks.wk < date_trunc('week', $3::date)
            ORDER BY wks.wk`,
          [userUuid, fromISO, todayISO, canonicalIds],
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
    const d = asRunData(run.data);
    const splits = Array.isArray(d.splits) ? (d.splits as never[]) : null;
    const distanceMi = runDistanceMi(d);

    /* Decoupling, heat-filtered PER OBSERVATION.
     *
     * `Research/03` §12: heat manufactures 2-5% of decoupling on its own. So a
     * hot-day reading must clear the endurance threshold BY that artifact
     * before it is allowed to say anything about the runner's aerobic base —
     * otherwise the finding is about the weather.
     *
     * CLAUDE.md's per-finding context-filter rule is explicit that a guard on
     * the parent surface does not protect a sub-finding, and this is exactly
     * the case it describes. Without this filter, a 90°F long run reading 13.2%
     * drift counted as poor absorption, held the adaptation band at `normal`
     * instead of `strong`, and would have withheld a progression step the
     * runner had actually earned. Being conservative for a wrong reason is
     * still being wrong.
     *
     * The same constants the limiter uses, deliberately — two filters
     * disagreeing about what counts as hot is its own bug. */
    const dec = computeAerobicDecoupling(splits, distanceMi);
    if (dec) {
      const tempF = Number(d.tempF ?? (d.weather as Record<string, unknown> | undefined)?.tempF);
      const heatConfounded = Number.isFinite(tempF) && tempF >= HEAT_CONFOUND_TEMP_F;
      const threshold = heatConfounded
        ? DECOUPLING_ENDURANCE_GAP_PCT + DECOUPLING_HEAT_ARTIFACT_PCT
        : DECOUPLING_ENDURANCE_GAP_PCT;
      // A hot day that does not clear the raised bar is not evidence either
      // way — dropped, never recorded as a clean run, because inventing a good
      // verdict is the same error in the other direction.
      if (dec.driftPct >= threshold) decouplingVerdicts.push('poor');
      else if (!heatConfounded) decouplingVerdicts.push(dec.verdict);
    }

    // NOTE · `computeHrThirds` reads `phase === 'work'` splits, which a long
    // run does not have — it is built for structured work blocks, and on a
    // long run it falls through to the summary estimate. That estimate is a
    // model output, and feeding a model output back in as evidence is how a
    // signal becomes circular, so only measured thirds contribute and long
    // runs contribute none. Aerobic decoupling above is the long-run read.
    const thirds = computeHrThirds(splits, {
      avgHr: runAvgHr(d),
      maxHr: runMaxHr(d),
    });
    if (thirds?.source === 'measured' && thirds.driftBpm != null) {
      lateDriftBpm.push(thirds.driftBpm);
    }
  }

  /* One verdict per DAY.
   *
   * `loadRecentTestPoints` dedups runs per workout row, not workout rows per
   * date — fine for its own use, where only the active plan is in scope. Once
   * archived plans are included every rebuild contributes its own copy of the
   * same day, which read as 130 quality sessions in a six-week window. Keeping
   * the first per date restores one session per session.
   *
   * Points whose verdict abstained (no honest basis to judge on) are dropped
   * rather than counted as misses. An unjudgeable session is missing evidence,
   * not a failed one. */
  const seenDays = new Set<string>();
  const verdicts: Array<'on' | 'fast' | 'slow'> = [];
  for (const p of verdictRows ?? []) {
    if (seenDays.has(p.dateISO)) continue;
    seenDays.add(p.dateISO);
    if (p.verdict === 'on' || p.verdict === 'fast' || p.verdict === 'slow') verdicts.push(p.verdict);
  }

  const weeklyPlannedMi = (weekly ?? []).map((w) => Number(w.planned));
  const weeklyActualMi = (weekly ?? []).map((w) => Number(w.actual));

  /* Distinct weeks carrying judged evidence — the gate that stops one good
   * Tuesday reading as a trend. Counts weeks with a verdict OR a completed
   * week of volume, because both are evidence of the block being run. */
  const evidenceWeeks = new Set<string>();
  for (const w of weekly ?? []) if (Number(w.actual) > 0) evidenceWeeks.add(w.wk);

  const readinessTotal = readiness ? Number(readiness.total) : 0;

  /* Only the sessions a basis could actually describe. `readable: false`
   * covers two cases and neither is a finding about the runner: a plan row
   * whose intended stimulus we cannot state, and a run whose work no basis
   * could locate. Passing either as a state would put a fabricated judgement
   * into the dimension that gates his progression. */
  const executions = (keySessionReads ?? [])
    .filter((s) => s.readable && s.read != null)
    .map((s) => ({
      state: s.read!.state,
      stimulusCompletion: s.read!.stimulusCompletion,
      earnsProgression: s.earnsProgression,
    }));

  return {
    keySessionExecutions: executions.length > 0 ? executions : null,
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

    // COERCE-EVIDENCE-1 (2026-08-30) · Rule 11. `evidenceWeeks.size > 0 ? size
    // : null` collapsed two opposite facts. `weekly` empty means the window
    // holds no plan weeks at all — nothing to judge, and null is right. But
    // `weekly` NON-empty with every week at zero miles means the runner did not
    // train, which is a measurement, and `readTrend` scores it at
    // `clamp((0 - 2) * 0.8) = -1.6`. Erasing it dropped that negative reading
    // out of the weighted mean entirely, so a block nobody ran read no worse
    // than a block nobody could see — the permissive direction, in the
    // dimension that gates progression.
    distinctEvidenceWeeks: (weekly?.length ?? 0) > 0 ? evidenceWeeks.size : null,
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
 *
 * THIS IS THE LIVE CALL. `progression-pass.ts`'s `resolveProgressionStep` (via
 * `adapt.ts`'s `detectProgressionGate`) consumes this verdict directly and
 * mutates the current week's quality-session shape from it, so this function's
 * behaviour is preserved byte-for-byte — see `loadAdaptationInput` above and
 * the split below. Nothing here changes until a human explicitly promotes
 * `representative_execution` to replace it (PRODUCT_DECISIONS.md 2026-09-01
 * §1).
 */
export async function readAdaptation(
  userUuid: string,
  todayArg?: string,
): Promise<AdaptationVerdict | null> {
  const input = await quiet('adaptation input', () => loadAdaptationInput(userUuid, todayArg));
  if (!input) return null;
  return classifyAdaptation(input);
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE ABSORPTION/EXECUTION SPLIT · added 2026-09-01, Rule 8 fork
 *
 * `loadAdaptationInput` above answers ONE question honestly and a SECOND one
 * by accident. Its `execution` dimension (`readExecution` in
 * `adaptation-model.ts`) reads `keySessionExecutions` / `targetVerdicts` over
 * the raw 42-day `ADAPTATION_WINDOW_DAYS` window with no taper/race/recovery
 * exclusion at all — correct for "how much load has this runner actually
 * absorbed" (tissue doesn't care why volume was low, Rule 8's corollary says
 * leave this literal), wrong for "has this runner demonstrated capability /
 * earned progression" (Rule 8 proper: a taper is never read as this runner's
 * normal).
 *
 * `classifyAdaptation`'s verdict off the UNFILTERED input is
 * `actual_load_absorption` — identical to what `readAdaptation` above
 * produces, because that call must not change (see its own doc comment).
 *
 * `representative_execution` is the SAME classifier, called on the SAME
 * `AdaptationInput` shape, differing ONLY in the fields `readExecution`
 * consumes: `keySessionExecutions`, `keySessionsPlanned/Completed` and
 * `targetVerdicts` are re-read with every prescribed taper/race/recovery day
 * dropped, widening the search window with `representativeLookback` (never
 * diluting — see `normal-window.ts`'s clause 1) when the base 42 days do not
 * hold enough representative days. Every OTHER field — internal_cost,
 * recovery, consistency, trend — is carried through from the unfiltered input
 * unchanged, because those dimensions are tissue-load/recovery/consistency
 * questions, not capability questions, and Rule 8's corollary is explicit that
 * over-applying the filter to a tissue-load reader makes a safety-adjacent
 * signal MORE permissive exactly where it should not be. If a future review
 * decides one of those four also forks, that is a separate, scoped decision —
 * not made here.
 *
 * NEITHER OUTPUT IS WIRED ANYWHERE. `readAdaptationSplit` below is called only
 * by the shadow-replay script and its own tests, per PRODUCT_DECISIONS.md
 * 2026-09-01 §1's sequence: preserve live behaviour, shadow-run both, report
 * the diff, promote only after a human reviews it.
 * ═══════════════════════════════════════════════════════════════════════ */

/** The two raw row shapes the execution dimension is built from — narrowed to
 *  exactly the fields `filterExecutionEvidenceByPrescribedWindow` reads, so
 *  the pure function stays testable without importing `loadKeySessionExecutions`
 *  / `loadRecentTestPoints`'s full return types. */
interface RawExecutionRow {
  dateISO: string;
  readable: boolean;
  read: { state: KeySessionRead['state']; stimulusCompletion: number } | null;
  earnsProgression: boolean;
}
interface RawVerdictRow {
  dateISO: string;
  verdict: 'on' | 'fast' | 'slow' | null;
}

/**
 * PURE. The one transform `representative_execution` applies that
 * `actual_load_absorption` does not: drop every row landing on a prescribed
 * taper/race/recovery day, then re-derive the narration counts from what
 * survives.
 *
 * Split out from `loadRepresentativeExecutionInput` so this — the part that
 * actually encodes the Rule 8 fork — is falsifiable without a database
 * (Rule 18), the same posture `adaptation-model.ts` takes for the classifier
 * itself. The caller supplies rows already widened to whatever lookback it
 * chose; this function only excludes, it never decides how far back to look.
 */
export function filterExecutionEvidenceByPrescribedWindow(
  keySessionRows: readonly RawExecutionRow[],
  verdictRows: readonly RawVerdictRow[],
  windows: readonly PrescribedWindow[],
): Pick<AdaptationInput, 'keySessionExecutions' | 'keySessionsPlanned' | 'keySessionsCompleted' | 'targetVerdicts'> {
  const executions = keySessionRows
    .filter((s) => s.readable && s.read != null && !isPrescribedNonNormal(s.dateISO, windows))
    .map((s) => ({
      state: s.read!.state,
      stimulusCompletion: s.read!.stimulusCompletion,
      earnsProgression: s.earnsProgression,
    }));

  const seenDays = new Set<string>();
  const verdicts: Array<'on' | 'fast' | 'slow'> = [];
  for (const p of verdictRows) {
    if (seenDays.has(p.dateISO)) continue;
    if (isPrescribedNonNormal(p.dateISO, windows)) continue;
    seenDays.add(p.dateISO);
    if (p.verdict === 'on' || p.verdict === 'fast' || p.verdict === 'slow') verdicts.push(p.verdict);
  }

  return {
    keySessionExecutions: executions.length > 0 ? executions : null,
    // Narration only (see the field docs on `AdaptationInput`) — derived from
    // the filtered set itself rather than a second SQL query, so there is one
    // definition of "how many representative key sessions" per this reader.
    keySessionsPlanned: executions.length > 0 ? executions.length : null,
    keySessionsCompleted: executions.length > 0
      ? executions.filter((e) => e.state !== 'MISSED').length
      : null,
    targetVerdicts: verdicts.length > 0 ? verdicts : null,
  };
}

/**
 * The `representative_execution` half of the split.
 *
 * Reuses `loadAdaptationInput`'s unfiltered read for every field the
 * execution dimension does not touch, and re-derives only the three fields it
 * does, over a Rule-8-filtered, `representativeLookback`-extended window, via
 * the pure `filterExecutionEvidenceByPrescribedWindow` above.
 */
export async function loadRepresentativeExecutionInput(
  userUuid: string,
  todayArg?: string,
): Promise<AdaptationInput> {
  const todayISO = todayArg ?? (await runnerToday(userUuid));
  const base = await loadAdaptationInput(userUuid, todayISO);

  const windows = await loadPrescribedWindows(userUuid, todayISO);
  const lookback = await representativeLookback(userUuid, todayISO, ADAPTATION_WINDOW_DAYS);
  const vdot = await quiet('current vdot (representative)', () => currentVdot(userUuid));

  const [keySessionReadsWide, verdictRowsWide] = await Promise.all([
    /* Same reader `loadAdaptationInput` calls, over the WIDENED window. The
     * exclusion still has to run explicitly below — `representativeLookback`
     * only grows how far back the query is allowed to look; it does not, by
     * itself, drop the prescribed days that fall inside that wider range. */
    quiet('representative key session executions', () =>
      loadKeySessionExecutions(userUuid, lookback.fromISO, todayISO, vdot)),
    quiet('representative target verdicts', () =>
      loadRecentTestPoints(userUuid, vdot, 200, lookback.fromISO, true)),
  ]);

  const filtered = filterExecutionEvidenceByPrescribedWindow(
    keySessionReadsWide ?? [],
    verdictRowsWide ?? [],
    windows,
  );

  return { ...base, ...filtered };
}

/** Both halves of the split, for the shadow-replay tooling and its tests.
 *  Never called from a live path — see the header above. */
export interface AdaptationAbsorptionSplit {
  actual_load_absorption: AdaptationVerdict;
  representative_execution: AdaptationVerdict;
}

export async function readAdaptationSplit(
  userUuid: string,
  todayArg?: string,
): Promise<AdaptationAbsorptionSplit | null> {
  const todayISO = todayArg ?? (await runnerToday(userUuid));
  const [unfiltered, representative] = await Promise.all([
    quiet('adaptation input (unfiltered)', () => loadAdaptationInput(userUuid, todayISO)),
    quiet('adaptation input (representative)', () => loadRepresentativeExecutionInput(userUuid, todayISO)),
  ]);
  if (!unfiltered || !representative) return null;
  return {
    actual_load_absorption: classifyAdaptation(unfiltered),
    representative_execution: classifyAdaptation(representative),
  };
}
