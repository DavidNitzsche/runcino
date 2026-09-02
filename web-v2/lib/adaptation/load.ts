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

import { promises as fs } from 'node:fs';
import path from 'node:path';
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
import { resolveCurrentVdotSnapshot } from '@/lib/training/projection-snapshots';
import {
  loadPrescribedWindows,
  isPrescribedNonNormal,
  representativeLookback,
  activePrescribedWindow,
  type PrescribedWindow,
} from '@/lib/training/normal-window';
import {
  classifyAdaptation,
  type AdaptationInput,
  type AdaptationVerdict,
  type KeySessionRead,
} from './adaptation-model';

/**
 * THE current-VDOT read, from THE owner
 * (`lib/training/projection-snapshots.ts#resolveCurrentVdotSnapshot`).
 *
 * F-6 (2026-09-01) · this file used to carry its OWN copy of the query, and
 * justified it in a header comment citing a "house rule" — "where a reader
 * does not exist, each caller carries its own one-line copy". Four files did
 * exactly that, byte for byte, and a reader DID exist in
 * `projection-snapshots.ts`; nobody called it. Three of the four wrapped the
 * query in `.catch(() => ({ rows: [] }))`, so a FAILED READ became "no VDOT",
 * which became `establishedPaceFor → null`, which suppressed the finding
 * entirely. A guard that switches itself off when its input fails is Rule 11's
 * defining shape.
 *
 * The resolver also closes two things no copy had: a total ORDER BY (Rule 14 —
 * production holds three rows per user per snapshot_date and the tie-break was
 * the planner's choice) and a staleness bound (a snapshot was faded as of its
 * own date and never again, so an N-day-old row is under-faded by N days).
 *
 * `null` here still means "do not spend a VDOT", which is what every caller
 * already did with it — but the REASON is now distinguishable upstream, and a
 * stale or failed read is a refusal rather than a silent zero.
 */
async function currentVdot(userUuid: string): Promise<number | null> {
  const read = await resolveCurrentVdotSnapshot(userUuid);
  return read.ok ? read.vdot : null;
}

/** How far back the adaptation read looks. Long enough for a trend, short
 *  enough to describe the block the runner is actually in. */
export const ADAPTATION_WINDOW_DAYS = 42;

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
    downgrades,
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

    /* 2026-09-02 · RUNNER-OWNS-READINESS. A `readiness_snapshots` query stood
     * here, counting days the runner sat below his own normal so the recovery
     * dimension could score them. It is deleted with the dimension: this
     * verdict drives the live progression gate, and readiness may not drive a
     * training decision. What the runner ran still speaks — `recovery` below
     * reads his measured bounce-back between hard sessions, from runs. */

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

    /* 2026-09-02 · RUNNER-OWNS-READINESS. `resolveSafety(userUuid)` stood
     * here, supplying `niggleSeverity` / `illnessActive` / `injuryActive` to
     * the classifier's vetoes. The vetoes are gone (see
     * `lib/adaptation/adaptation-model.ts`) and so is the read: this verdict
     * mutates the current week's quality-session shape through
     * `detectProgressionGate`, so an illness the runner logged was reaching a
     * live plan row. `lib/safety/load-safety.ts` still exists and is still the
     * one owner of that picture for the surfaces that DISPLAY it. */

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
 * MASKING-1 (2026-09-01). `docs/reports/absorption-dual-log-2026-09-01.md`
 * §7.2 named a real, unfixed risk: when EVERY readable session in a window
 * falls inside a prescribed taper/race/recovery block, the naive exclusion
 * below erased all of it — including genuine failures — and
 * `classifyAdaptation` fell through to its `MIN_DIMENSIONS_FOR_VERDICT`
 * refusal (Rule 11's "not enough evidence, proceed as planned"), which is a
 * `normal/PROGRESS` default. That default exists for a runner this reader
 * truly cannot see — a brand-new account, a reader that failed to load. It is
 * the wrong answer for a runner whose every visible session in the window was
 * a real, measured shortfall that happened to also land on a prescribed day.
 * Confirmed via the synthetic fixtures 3d/3e in
 * `_shadow_run_absorption_split.script.ts` — never observed on the real
 * account's 90 sampled dates (every real window this account's
 * `representativeLookback` needed to reach past always found some real
 * evidence to fall back on), but reachable, and a newer account or a runner
 * with back-to-back races and no clean gap between them would hit it easily.
 *
 * The fix rests on a distinction the risk collapsed: Rule 8 says a prescribed
 * day must not be used to PROVE a runner's normal capability — a good session
 * during taper does not show the runner can handle full load, and crediting
 * it would inflate a "can this runner progress" read on evidence that was
 * never asked to carry that weight. Rule 8 does NOT say a genuine failure on
 * that same day is excused from counting against progression — a session
 * that went badly is still evidence against progression, and the calendar it
 * fell on does not launder that away. Those are two different operations:
 * excluding a day from the pool that CORROBORATES readiness, and excluding a
 * day's NEGATIVE signal from ever being counted. This function now performs
 * only the first. A prescribed day is still excluded exactly as before in
 * every case except one: when the exclusion would leave the window's
 * evidence entirely empty, the rows it was about to erase are inspected, and
 * any that are themselves negative evidence (a real MISSED session, or a
 * PARTIAL_FAILED one — `lib/execution/interpret.ts` marks PARTIAL_FAILED
 * `evidence.adaptation: 'negative'` explicitly; MISSED carries
 * `stimulusCompletion: 0`, the most negative reading the completion scale
 * has, even though its own per-session "why" is officially unknown) survive.
 * Positive-valence rows (AS_PLANNED, EQUIVALENT, PARTIAL_PRODUCTIVE, REPLACED)
 * are excluded exactly as before, total-washout or not — MASKING-1 only ever
 * rescues evidence AGAINST progression, never evidence FOR it, so it cannot
 * become a second way for a good taper session to inflate the read. Target
 * verdicts follow the identical rule: 'slow' (a genuine miss on pace) is
 * preserved on total washout; 'on'/'fast' are not.
 *
 * This only fires on TOTAL washout, so `loadRepresentativeExecutionInput`'s
 * primary, well-verified behavior — a taper/recovery block correctly
 * dropping OUT of a read that also has real clean evidence outside the
 * window (fixture 3a, and the account's own real AFC episode in
 * `docs/reports/absorption-reader-split-2026-09-01.md` §3.1) — is completely
 * unaffected: as soon as ANY row survives the plain exclusion, that survives
 * unchanged and the fallback never runs.
 */
function isNegativeKeySessionSignal(read: RawExecutionRow['read']): boolean {
  return read != null && (read.state === 'MISSED' || read.state === 'PARTIAL_FAILED');
}

function isNegativeVerdictSignal(row: RawVerdictRow): boolean {
  return row.verdict === 'slow';
}

/** Apply a window exclusion, but never let it erase the only evidence a
 *  window holds when everything it erases is negative. Shared by the
 *  production filter below and the comparison log's observation selection
 *  (`selectExecutionObservations` / `selectVerdictObservations`) so both
 *  answer "did representative_execution keep this row" identically — Rule 16,
 *  and the reason this lives as one function rather than two restatements. */
function applyRepresentativeWindow<T>(
  readableRows: readonly T[],
  isExcluded: (row: T) => boolean,
  isNegative: (row: T) => boolean,
): T[] {
  const representative = readableRows.filter((r) => !isExcluded(r));
  if (representative.length > 0) return representative;
  return readableRows.filter(isNegative);
}

/**
 * PURE. The one transform `representative_execution` applies that
 * `actual_load_absorption` does not: drop every row landing on a prescribed
 * taper/race/recovery day (except the MASKING-1 fallback above), then
 * re-derive the narration counts from what survives.
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
  const readableExecRows = keySessionRows.filter((s) => s.readable && s.read != null);
  const executions = applyRepresentativeWindow(
    readableExecRows,
    (s) => isPrescribedNonNormal(s.dateISO, windows),
    (s) => isNegativeKeySessionSignal(s.read),
  ).map((s) => ({
    state: s.read!.state,
    stimulusCompletion: s.read!.stimulusCompletion,
    earnsProgression: s.earnsProgression,
  }));

  const dedupedVerdictRows: RawVerdictRow[] = [];
  {
    const seenDays = new Set<string>();
    for (const p of verdictRows) {
      if (seenDays.has(p.dateISO)) continue;
      seenDays.add(p.dateISO);
      dedupedVerdictRows.push(p);
    }
  }
  const keptVerdictRows = applyRepresentativeWindow(
    dedupedVerdictRows,
    (p) => isPrescribedNonNormal(p.dateISO, windows),
    isNegativeVerdictSignal,
  );
  const verdicts = keptVerdictRows
    .map((p) => p.verdict)
    .filter((v): v is 'on' | 'fast' | 'slow' => v === 'on' || v === 'fast' || v === 'slow');

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

  // The honest, proximate reason a HOLD-shaped verdict off THIS reader should
  // reach for first — see `AdaptationInput.recentPrescribedWindow`'s own doc
  // comment and docs/reports/adaptation-reason-honesty-fix-2026-09-01.md.
  // Only this reader populates it: it is the one whose lookback widening can
  // end up citing evidence from weeks before today, and `windows`/`todayISO`
  // are already resolved right here for the filter above — a second read
  // would be a second opinion about the same question.
  const active = activePrescribedWindow(todayISO, windows);
  const recentPrescribedWindow = active
    ? { kind: active.kind, raceSlug: active.window.raceSlug, daysSinceRace: active.daysSinceRace }
    : null;

  return { ...base, ...filtered, recentPrescribedWindow };
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

/* ══════════════════════════════════════════════════════════════════════════
 * THE DUAL-READER COMPARISON LOG · added 2026-09-01
 *
 * The account owner's ruling on the split above (per
 * docs/reports/absorption-reader-split-2026-09-01.md's go/no-go): DO NOT
 * promote `representative_execution` into the live gate yet. Instead: log a
 * structured comparison EVERY time the split is read, so a promotion
 * decision is eventually made off a season of evidence rather than a
 * seven-date sample. This section is that logging — still nothing wired into
 * any live path, still nothing here mutates a plan.
 *
 * `buildAdaptationComparisonRecord` is a superset of `readAdaptationSplit`:
 * it calls the exact same three functions
 * (`loadAdaptationInput` / `loadRepresentativeExecutionInput` /
 * `classifyAdaptation`) for the verdicts — so this log can never disagree
 * with the split it is describing — and ADDITIONALLY fetches the raw dated
 * rows a second time, purely so the log can name WHICH sessions each reader
 * used. That date is real information: `AdaptationInput.keySessionExecutions`
 * throws it away once the rows reach the classifier (it only carries
 * `state`/`stimulusCompletion`/`earnsProgression`), so this is the one place
 * in the call graph the date is still attached to the verdict. The second
 * fetch is best-effort and wrapped so its failure can never take down the
 * verdicts, which are already computed by the time it runs.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * PURE. Exactly `loadAdaptationInput`'s own key-session selection
 * (`readable && read != null`, bounded to `[fromISO, toISO)`), restated so it
 * can run against a raw fetch the caller controls instead of requiring its
 * own query. Passing `windows: null` reproduces the unfiltered
 * (`actual_load_absorption`) selection; passing the runner's real prescribed
 * windows reproduces `filterExecutionEvidenceByPrescribedWindow`'s selection
 * exactly, over whatever `[fromISO, toISO)` the caller supplies. Two call
 * sites, one definition — Rule 16.
 */
export function selectExecutionObservations(
  rows: readonly RawExecutionRow[],
  fromISO: string,
  toISO: string,
  windows: readonly PrescribedWindow[] | null,
): RawExecutionRow[] {
  const readable = rows.filter((r) => r.dateISO >= fromISO && r.dateISO < toISO && r.readable && r.read != null);
  if (!windows) return readable;
  // MASKING-1: mirror `filterExecutionEvidenceByPrescribedWindow`'s fallback
  // so the comparison log reports which rows `representative_execution`
  // ACTUALLY kept, not the pre-fix selection this restatement used to
  // reproduce. See the incident note above that function in this file.
  return applyRepresentativeWindow(
    readable,
    (r) => isPrescribedNonNormal(r.dateISO, windows),
    (r) => isNegativeKeySessionSignal(r.read),
  );
}

/**
 * PURE. Exactly `loadAdaptationInput`'s / `filterExecutionEvidenceByPrescribedWindow`'s
 * verdict-row selection (first-occurrence-per-day dedup, then the same
 * `windows` gate), restated the same way and for the same reason.
 */
export function selectVerdictObservations(
  rows: readonly RawVerdictRow[],
  fromISO: string,
  toISO: string,
  windows: readonly PrescribedWindow[] | null,
): RawVerdictRow[] {
  const seen = new Set<string>();
  const deduped: RawVerdictRow[] = [];
  for (const p of rows) {
    if (p.dateISO < fromISO || p.dateISO >= toISO) continue;
    if (seen.has(p.dateISO)) continue;
    seen.add(p.dateISO);
    deduped.push(p);
  }
  // MASKING-1: same fallback as `filterExecutionEvidenceByPrescribedWindow`
  // — see the incident note above that function.
  const kept = windows
    ? applyRepresentativeWindow(deduped, (p) => isPrescribedNonNormal(p.dateISO, windows), isNegativeVerdictSignal)
    : deduped;
  return kept.filter((p) => p.verdict === 'on' || p.verdict === 'fast' || p.verdict === 'slow');
}

/** One dated piece of evidence, and whether each reader's selection kept it. */
export interface AdaptationComparisonObservation {
  dateISO: string;
  kind: 'key_session' | 'target_verdict';
  /** `KeySessionRead['state']` for a key session, the plain verdict for a
   *  target-verdict row. */
  detail: string;
  inAbsorption: boolean;
  inRepresentative: boolean;
  /** Set when `actual_load_absorption` kept this row and
   *  `representative_execution` dropped it — the Rule 8 exclusion firing. */
  excludedFromRepresentativeReason: 'prescribed_non_normal' | null;
  /** Set when `representative_execution` kept a row `actual_load_absorption`
   *  never even looked at, because `representativeLookback` reached back
   *  past the unfiltered reader's fixed 42-day window to find it. */
  onlyInRepresentativeReason: 'representative_lookback_reach' | null;
}

/** Restated from `adaptation-engine.ts`'s own (unexported)
 *  `absorptionPermitsLoadProgression` — `decision === 'PROGRESS'`
 *  null` — rather than imported, because that file is owned by a concurrent
 *  session tonight and is on this task's do-not-touch list. The predicate is
 *  one line and doctrine-cited there; if it ever moves, this restatement
 *  goes stale in the same silent way `progressionLean` in the shadow-run
 *  script already accepted for the same reason. Flagged, not fixed. */
function permitsLoadProgression(v: AdaptationVerdict): boolean {
  return v.decision === 'PROGRESS';
}

export interface DurationLeverRead {
  band: AdaptationVerdict['band'];
  decision: AdaptationVerdict['decision'];
  /** Would `detectDuration`'s `absorptionPermitsLoadProgression` gate open,
   *  reading THIS verdict? */
  permitsLoadProgression: boolean;
}

export interface AdaptationComparisonRecord {
  userUuid: string;
  todayISO: string;
  resolvedAt: string;
  absorptionWindow: { fromISO: string; toISO: string };
  representativeWindow: {
    fromISO: string;
    toISO: string;
    extendedByDays: number;
    reachedOuterBound: boolean;
  };
  prescribedWindows: PrescribedWindow[];
  /** Best-effort. Empty when the second, log-only fetch failed — the
   *  verdicts below are unaffected either way. */
  observations: AdaptationComparisonObservation[];
  actual_load_absorption: AdaptationVerdict;
  representative_execution: AdaptationVerdict;
  /** DURATION is the lever this reader actually gates today
   *  (`detectDuration`'s first check) — see
   *  docs/reports/absorption-reader-split-2026-09-01.md §6. VOLUME is a
   *  separate question this record does not answer. */
  durationLever: {
    absorption: DurationLeverRead;
    representative: DurationLeverRead;
    /** Which reader is the one actually holding DURATION back, when they
     *  disagree. `'agree'` when both permit or both block. When absorption
     *  blocks and representative would permit, absorption is decisive
     *  TODAY (it is the live, unpromoted reader). When representative
     *  blocks and absorption would permit, representative is decisive only
     *  in the counterfactual sense — "if this were promoted, this is what
     *  would newly hold DURATION back." */
    decisiveLimiter: 'actual_load_absorption' | 'representative_execution' | 'agree';
  };
  disagreesOnBandOrDecision: boolean;
}

/**
 * Build one comparison record for `userUuid` at `todayArg` (default: the
 * runner's local today). Returns null only when the underlying inputs
 * themselves could not be loaded — the same posture `readAdaptationSplit`
 * takes.
 */
export async function buildAdaptationComparisonRecord(
  userUuid: string,
  todayArg?: string,
): Promise<AdaptationComparisonRecord | null> {
  const todayISO = todayArg ?? (await runnerToday(userUuid));
  const fromISO = daysBefore(todayISO, ADAPTATION_WINDOW_DAYS);

  const [unfiltered, representative, windows, lookback, vdot] = await Promise.all([
    quiet('adaptation input (unfiltered, comparison log)', () => loadAdaptationInput(userUuid, todayISO)),
    quiet('adaptation input (representative, comparison log)', () => loadRepresentativeExecutionInput(userUuid, todayISO)),
    quiet('prescribed windows (comparison log)', () => loadPrescribedWindows(userUuid, todayISO)),
    quiet('representative lookback (comparison log)', () => representativeLookback(userUuid, todayISO, ADAPTATION_WINDOW_DAYS)),
    quiet('current vdot (comparison log)', () => currentVdot(userUuid)),
  ]);
  if (!unfiltered || !representative) return null;

  const absorptionVerdict = classifyAdaptation(unfiltered);
  const representativeVerdict = classifyAdaptation(representative);

  const windowsList = windows ?? [];
  const wideFromISO = lookback?.fromISO ?? fromISO;

  /* Best-effort second fetch, purely to name which dated rows each selection
   * kept. Never allowed to affect the verdicts above, which are already
   * final by the time this runs. */
  const observations: AdaptationComparisonObservation[] = [];
  try {
    const [wideExec, wideVerdicts] = await Promise.all([
      loadKeySessionExecutions(userUuid, wideFromISO, todayISO, vdot),
      loadRecentTestPoints(userUuid, vdot, 200, wideFromISO, true),
    ]);

    const absorptionExecDates = new Set(
      selectExecutionObservations(wideExec, fromISO, todayISO, null).map((r) => r.dateISO));
    const representativeExecDates = new Set(
      selectExecutionObservations(wideExec, wideFromISO, todayISO, windowsList).map((r) => r.dateISO));
    const absorptionVerdDates = new Set(
      selectVerdictObservations(wideVerdicts, fromISO, todayISO, null).map((r) => r.dateISO));
    const representativeVerdDates = new Set(
      selectVerdictObservations(wideVerdicts, wideFromISO, todayISO, windowsList).map((r) => r.dateISO));

    for (const row of wideExec) {
      const inA = absorptionExecDates.has(row.dateISO);
      const inR = representativeExecDates.has(row.dateISO);
      if (!inA && !inR) continue; // unreadable, or outside both windows — not a candidate for either reader
      observations.push({
        dateISO: row.dateISO,
        kind: 'key_session',
        detail: row.read?.state ?? 'UNREADABLE',
        inAbsorption: inA,
        inRepresentative: inR,
        excludedFromRepresentativeReason: inA && !inR ? 'prescribed_non_normal' : null,
        onlyInRepresentativeReason: !inA && inR ? 'representative_lookback_reach' : null,
      });
    }
    for (const row of wideVerdicts) {
      const inA = absorptionVerdDates.has(row.dateISO);
      const inR = representativeVerdDates.has(row.dateISO);
      if (!inA && !inR) continue;
      observations.push({
        dateISO: row.dateISO,
        kind: 'target_verdict',
        detail: row.verdict ?? 'null',
        inAbsorption: inA,
        inRepresentative: inR,
        excludedFromRepresentativeReason: inA && !inR ? 'prescribed_non_normal' : null,
        onlyInRepresentativeReason: !inA && inR ? 'representative_lookback_reach' : null,
      });
    }
    observations.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));
  } catch (err) {
    console.warn('[adaptation] comparison observation detail unreadable:', err instanceof Error ? err.message : err);
  }

  const absorptionLever: DurationLeverRead = {
    band: absorptionVerdict.band,
    decision: absorptionVerdict.decision,
    permitsLoadProgression: permitsLoadProgression(absorptionVerdict),
  };
  const representativeLever: DurationLeverRead = {
    band: representativeVerdict.band,
    decision: representativeVerdict.decision,
    permitsLoadProgression: permitsLoadProgression(representativeVerdict),
  };
  let decisiveLimiter: 'actual_load_absorption' | 'representative_execution' | 'agree' = 'agree';
  if (absorptionLever.permitsLoadProgression !== representativeLever.permitsLoadProgression) {
    decisiveLimiter = absorptionLever.permitsLoadProgression
      ? 'representative_execution'
      : 'actual_load_absorption';
  }

  return {
    userUuid,
    todayISO,
    resolvedAt: new Date().toISOString(),
    absorptionWindow: { fromISO, toISO: todayISO },
    representativeWindow: {
      fromISO: wideFromISO,
      toISO: todayISO,
      extendedByDays: lookback?.extendedByDays ?? 0,
      reachedOuterBound: lookback?.reachedOuterBound ?? false,
    },
    prescribedWindows: windowsList,
    observations,
    actual_load_absorption: absorptionVerdict,
    representative_execution: representativeVerdict,
    durationLever: {
      absorption: absorptionLever,
      representative: representativeLever,
      decisiveLimiter,
    },
    disagreesOnBandOrDecision:
      absorptionVerdict.band !== representativeVerdict.band
      || absorptionVerdict.decision !== representativeVerdict.decision,
  };
}

/* ── persistence ──────────────────────────────────────────────────────────
 *
 * `db/migrations/160_adaptation_shadow_log.sql` IS APPLIED — verified against
 * production 2026-09-01, `to_regclass('public.adaptation_shadow_log')` resolves
 * and the table holds rows. This paragraph said "drafted tonight by a
 * concurrent session, NOT RUN — pending David's per-statement go", which was
 * true when written and is not now; the argument below does not depend on it
 * either way, because the table being PACE-lever-only is a statement about its
 * COLUMN SHAPE, not about whether it exists. Corrected rather than left,
 * because a reader who trusts "NOT RUN" concludes the fallback is the only
 * option available rather than the only option that FITS.
 *
 * It is PACE-lever-only by its own header comment and by
 * its column shape: `engine_previous`/`engine_proposed` are typed as
 * `PaceMagnitude`, `phase_breakdown` as `PacePhaseOutcome[]`. This record is
 * a DURATION-lever absorption/execution comparison with a materially
 * different shape (a dated observation list, a duration-lever read per
 * side, a decisive-limiter verdict) — inserting it into that table would
 * either fail the column types or force a lossy reshape into columns named
 * for a different lever. Not a clean additive fit, and this task is not
 * authorized to draft a second migration (CLAUDE.md: DDL needs David's
 * explicit per-statement go; only the already-proposed migration 160 is
 * even a candidate for someone else to apply tonight).
 *
 * So persistence here follows the exact fallback pattern
 * `lib/adaptation/shadow-compare.ts` established tonight for the identical
 * problem: append one JSON line per call to a git-tracked file. A distinct
 * filename (`*.absorption-duration.jsonl`) in the SAME directory, so the two
 * shadow logs never interleave two different record shapes inside one file,
 * while still landing in the one place a human already knows to look. Like
 * the PACE mechanism, this is real, inspectable persistence for the
 * verification and replay work in this task — and, same caveat, NOT the
 * production answer once this is ever wired into a cron: a Railway/Vercel
 * filesystem is ephemeral and a file write there would not survive the next
 * deploy. That is a promotion-time concern; nothing here is wired into a
 * cron today. */

const COMPARISON_LOG_DIR = path.join(process.cwd(), '..', 'docs', 'reports', 'adaptation-shadow-log');

export interface AdaptationComparisonPersistResult {
  posture: 'file' | 'skipped';
  detail: string;
}

async function persistComparisonRecordToFile(record: AdaptationComparisonRecord): Promise<string> {
  await fs.mkdir(COMPARISON_LOG_DIR, { recursive: true });
  const file = path.join(COMPARISON_LOG_DIR, `${record.userUuid}.absorption-duration.jsonl`);
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  return file;
}

/** Persist one comparison record. NEVER throws — a persistence failure is
 *  best-effort and logged, matching every other non-fatal step in this
 *  file's neighbourhood (`shadow-compare.ts`'s `persistShadowCompareRecord`). */
export async function persistAdaptationComparisonRecord(
  record: AdaptationComparisonRecord,
): Promise<AdaptationComparisonPersistResult> {
  try {
    const file = await persistComparisonRecordToFile(record);
    return { posture: 'file', detail: file };
  } catch (e) {
    console.warn('[adaptation] comparison record persist failed:', e instanceof Error ? e.message : e);
    return { posture: 'skipped', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * THE SIBLING OF `readAdaptationSplit` THAT LOGS. Every call builds a
 * comparison record and appends it to the git-tracked shadow log before
 * returning — the "ongoing logging... every time it's called" the account
 * owner asked for in place of promoting `representative_execution`. Still
 * not called from any live path; still never mutates a plan.
 */
export async function readAdaptationSplitWithLog(
  userUuid: string,
  todayArg?: string,
): Promise<{
  split: AdaptationAbsorptionSplit;
  record: AdaptationComparisonRecord;
  persisted: AdaptationComparisonPersistResult;
} | null> {
  const record = await buildAdaptationComparisonRecord(userUuid, todayArg);
  if (!record) return null;
  const persisted = await persistAdaptationComparisonRecord(record);
  return {
    split: {
      actual_load_absorption: record.actual_load_absorption,
      representative_execution: record.representative_execution,
    },
    record,
    persisted,
  };
}
