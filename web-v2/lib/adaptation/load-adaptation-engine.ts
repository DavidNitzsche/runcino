/**
 * lib/adaptation/load-adaptation-engine.ts · the database shell for the
 * Adaptation Engine's ownership layer.
 *
 * `adaptation-engine.ts` is pure: every input arrives as an argument, so every
 * branch is falsifiable without a database. This file is the only impure part.
 * It resolves the four capacities, the runner's state, the absorption verdict,
 * the progression week and the plan's own numbers, maps the Evidence Engine's
 * per-activity output into the engine's narrow reads, and calls
 * `composeAdaptation`.
 *
 * Same split `capacity-resolver.ts` and `load-activity-evidence.ts` use, for
 * the same reason, and this file carries NO JUDGEMENT — every threshold lives
 * one file over. The one thing that looks like judgement here is the mapping
 * from `ActivityEvidenceResult` to `QualitySessionRead`, and it is a
 * projection: each field is copied, none is combined.
 *
 * ── RULE 14 · WHAT POPULATION EACH QUERY READS ──────────────────────────────
 *
 * · The plan: the ACTIVE plan only (`archived_iso IS NULL`), newest authored.
 *   Joining `plan_workouts` on `user_uuid` alone reads all 47 of the owner's
 *   plan versions and is the ACTIVEPLAN-1 defect exactly — it is what made
 *   `recentQualityPerWeek` return 36.
 * · Completed mileage: `mileageByDay`, which clusters by identity and reads
 *   canonical rows only. Never a hand-rolled SUM over `runs`.
 * · Scheduled mileage: rows of THAT plan, in the same window.
 * · Activities: `classifyRecentActivities`, which states its own scoping.
 *
 * ── RULE 11 · A FAILED READ IS NOT AN EMPTY RUNNER ──────────────────────────
 *
 * Every read that can fail is wrapped so the FAILURE is recorded on
 * `readable: false`, not flattened into "this runner has no evidence". The
 * engine refuses outright when `readable` is false, because a runner we could
 * not see and a runner with nothing to show are opposite facts and only one of
 * them is a reason to hold.
 *
 * ── RULE 8 · WHICH WINDOW, AND THE FORK THIS FILE SITS ON ───────────────────
 *
 * Three readers here, and Rule 8's corollary splits them into two groups. Both
 * sides are stated because the rule requires any reader that takes a side to
 * say which side and why.
 *
 * NOT FILTERED · `recentWeeks` asks WHAT THE RUNNER HAS RECENTLY ABSORBED,
 * which is the corollary's second case — the tissue-load question — so the
 * completed/scheduled weeks are read LITERALLY. A volume proposal sized against
 * a pre-taper self would wave through a jump the legs have not been prepared
 * for.
 *
 * FILTERED · `historicalTolerance` asks WHAT WEEKLY VOLUME THIS RUNNER HOLDS,
 * which is the habit/capability question, so it runs through
 * `normalWeeklyMileage`. It is the twin of the reader above under a different
 * name, and Rule 8's instruction for a reader that turned out to be two
 * questions is to SPLIT it, which is what these two fields are.
 *
 * EXTENDED, NOT FILTERED · the quality-session and long-run windows. Filtering
 * a genuinely good session out because it happened during a recovery block
 * would DESTROY evidence, which is the opposite of what Rule 8 is for — the
 * rule is about not reading a taper as an IDENTITY, not about pretending the
 * sessions inside it did not happen. What the taper does do is stop the plan
 * from PRESCRIBING quality, and that is the sparse-window problem: the fix is
 * to reach further back for representative training (`representativeLookback`)
 * and price the age of what turns up, never to drop what is there.
 */
import { pool } from '@/lib/db/pool';
import { roundTo } from '@/lib/format/run';
import { runDaySql, runNotMergedSql } from '@/lib/runs/run-shape';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { mileageByDay } from '@/lib/runs/volume';
import { readTierUpper } from '@/lib/plan/adaptive-ramp';
import {
  diagnoseProgressionWeek,
  resolveWeekProgression,
  type ProgressionResolution,
  type ProgressionWeekSkip,
} from '@/lib/plan/progression-pass';
import {
  evidenceStalenessFactor,
  normalWeeklyMileage,
  representativeLookback,
} from '@/lib/training/normal-window';
import {
  resolveThresholdCapacity,
  resolveHighIntensityCapacity,
  resolveEasyCeiling,
  resolveDurability,
} from '@/lib/training/capacity-resolver';
import { resolveRunnerState } from '@/lib/training/runner-state';
import { readAdaptation } from './load';

import { classifyRecentActivities, type ClassifiedActivity } from '@/lib/evidence/load-activity-evidence';
import type { ResolvedCapacity } from '@/lib/training/prescription-resolver';
import {
  composeAdaptation,
  sessionDemonstratesControl,
  unreadableProposalSet,
  type AdaptationEngineInput,
  type AdaptationProposalSet,
  type DensityGateState,
  type EvidenceLookback,
  type LongRunRead,
  type PacePhaseRead,
  type QualitySessionRead,
  type VolumeToleranceRead,
} from './adaptation-engine';

/**
 * How far back the engine looks for quality-session and long-run evidence.
 *
 * 28 days · the same window `CAPACITY_CONFIDENCE_HALF_LIFE_DAYS` and
 * `REEXAMINATION_WINDOW_DAYS` use, so the engine cannot count a session as
 * corroboration that the capacity resolver has already aged out of confidence.
 * One window, three consumers.
 */
export const ADAPTATION_EVIDENCE_WINDOW_DAYS = 28;

/** How many whole weeks of completed-versus-scheduled the load picture reads. */
export const ADAPTATION_LOAD_WEEKS = 4;

/**
 * How far back the HABIT reader for weekly volume looks.
 *
 * 90 days · long enough to hold a whole mesocycle either side of a race window
 * (a marathon's taper-plus-recovery is 49 of them), and the window
 * `normalWeeklyMileage`'s own filter is designed to survive. This answers "what
 * does this runner hold", so unlike `ADAPTATION_LOAD_WEEKS` it is Rule 8
 * filtered and its denominator is representative days.
 */
export const ADAPTATION_VOLUME_TOLERANCE_WINDOW_DAYS = 90;

/** The progression gate's skip reason, translated into the engine's own state.
 *  A pure mapping, so the loader still carries no judgement. */
export function densityGateFor(skip: ProgressionWeekSkip | null): DensityGateState {
  switch (skip) {
    case null: return 'RESOLVED';
    case 'PASS_NOT_DUE': return 'PASS_NOT_DUE_THIS_WEEK';
    case 'NO_ACTIVE_PLAN': return 'NO_ACTIVE_PLAN';
    case 'WEEK_TAKES_NO_STEP': return 'WEEK_TAKES_NO_PROGRESSION_STEP';
    case 'NO_ROWS_IN_WEEK':
    case 'NO_AUTHORED_PROGRESSION_BLOCK': return 'NO_AUTHORED_PROGRESSION_BLOCK';
  }
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const isoMinusDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

const isoPlusDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Project one classified activity into the PACE lever's read, or null when the
 * activity produced no quality-capacity evidence at all.
 *
 * A PROJECTION, not a judgement: `executionQuality`, `lateRunPacingCollapse`
 * and the internal-cost magnitude are all carried through unchanged from the
 * Evidence Engine. Rule 11 is preserved across the boundary — a refusal arm
 * becomes `null`, never `false`.
 */
export function qualitySessionFrom(c: ClassifiedActivity): QualitySessionRead | null {
  const r = c.result;
  const threshold = r.capacities.threshold;
  const high = r.capacities.high_intensity;
  const chosen = threshold.kind === 'evidence'
    ? { capacity: 'threshold' as const, ev: threshold }
    : high.kind === 'evidence'
      ? { capacity: 'high_intensity' as const, ev: high }
      : null;
  if (!chosen) return null;

  return {
    activityId: c.runId,
    dateISO: c.dateISO,
    capacity: chosen.capacity,
    weight: chosen.ev.weight,
    anchorMoveCandidate: r.anchorMoveCandidate,
    executionQuality: r.executionQuality,
    lateRunPacingCollapse: r.qualityUnderLoad.ok ? r.qualityUnderLoad.lateRunPacingCollapse : null,
    internalCostMagnitude: r.internalCost.ok ? r.internalCost.magnitude : null,
    internalCostWithinNormalBand: r.internalCost.ok ? r.internalCost.withinDoctrineNormalBand : null,
  };
}

/**
 * Project one classified activity into the DURATION lever's read.
 *
 * `plannedIntent === 'LONG'` is not required: the structured-long-run
 * reference case is an UNLABELLED long run, and BRIEF 02's rule is that labels
 * describe intent rather than physiological truth. What qualifies is the
 * distance actually covered.
 */
export function longRunFrom(c: ClassifiedActivity, minLongMi: number): LongRunRead | null {
  const r = c.result;
  const distanceMi = r.ledger[0]?.distanceMi ?? null;
  if (distanceMi == null || distanceMi < minLongMi) return null;
  return {
    activityId: c.runId,
    dateISO: c.dateISO,
    distanceMi,
    durabilityEvidence: r.capacities.durability.kind === 'evidence',
    lateRunPacingCollapse: r.qualityUnderLoad.ok ? r.qualityUnderLoad.lateRunPacingCollapse : null,
    residualCardiovascularLoad: r.qualityUnderLoad.ok
      ? r.qualityUnderLoad.residualCardiovascularLoad
      : null,
    executionQuality: r.executionQuality,
  };
}

/**
 * What counts as a long run for the DURATION lever's evidence window.
 *
 * A FRACTION of what the plan itself prescribes as its long run, not an
 * absolute mileage — 10 miles is a long run for one runner and a midweek easy
 * day for another, which is Rule 12's argument applied to the other end of the
 * distance scale. 0.80 so a long run the runner cut slightly short still counts
 * as evidence about the distance, which is the honest reading: they went out to
 * do the long run and mostly did it.
 */
export const LONG_RUN_EVIDENCE_SHARE = 0.80;

export interface AdaptationEngineLoad {
  input: AdaptationEngineInput | null;
  proposals: AdaptationProposalSet | null;
  /** Everything the loader could not read, named. */
  failures: string[];
}

/**
 * THE canonical adaptation decision for one runner (§2), resolved.
 *
 * SHADOW MODE. Nothing calls this on a live path and it writes nothing.
 * `lib/plan/adapt.ts` still owns every mutation, unchanged — this is the §21
 * step that has to come first.
 */
export async function resolveAdaptationProposals(
  userUuid: string,
  todayISO?: string,
): Promise<AdaptationEngineLoad> {
  const today = todayISO ?? await runnerToday(userUuid);
  const failures: string[] = [];

  const note = (what: string, err: unknown): null => {
    failures.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  };

  /* ── 1 · THE ACTIVE PLAN · resolved, never assumed (Rule 14) ───────────── */
  const planRow = await pool.query<{
    id: string; authored_state: Record<string, unknown> | null;
  }>(
    `SELECT id, authored_state
       FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC
      LIMIT 1`,
    [userUuid],
  ).then((r) => r.rows[0] ?? null).catch((e) => note('active plan', e));

  /* ── 2 · CAPACITY · the four canonical resolvers, nothing re-derived ───── */
  const capacity = await Promise.all([
    resolveThresholdCapacity(userUuid, today),
    resolveHighIntensityCapacity(userUuid, today),
    resolveEasyCeiling(userUuid, today),
    resolveDurability(userUuid, today),
  ]).then(([threshold, highIntensity, easyCeiling, durability]): ResolvedCapacity => ({
    threshold, highIntensity, easyCeiling, durability,
  })).catch((e) => note('capacity', e));

  /* ── 3 · STATE · the consolidator, which invents no readiness rule ─────── */
  const state = await resolveRunnerState(userUuid, today).catch((e) => note('state', e));

  /* ── 4 · ABSORPTION · classifyAdaptation's verdict, consumed whole ─────── */
  const absorption = await readAdaptation(userUuid, today).catch((e) => note('absorption', e));

  /* ── 5 · ACTIVITY EVIDENCE · one batched classification pass ─────────────
   *
   * THE WINDOW IS NOT FIXED AT 28 DAYS ANY MORE, and this is the 2026-08-31
   * review's central change. `representativeLookback` reaches further back only
   * when the base window holds too few days of ORDINARY training — that is,
   * only when the engine's own taper or post-race block is the reason it is
   * looking at nothing. It never admits a prescribed day at any width; it only
   * keeps going until it has as many representative days as the gate was
   * designed against.
   *
   * A refusal is still possible: the outer bound binds, and reaching it with
   * too little representative training is reported rather than papered over. */
  const lookbackWindow = await representativeLookback(
    userUuid, today, ADAPTATION_EVIDENCE_WINDOW_DAYS,
  ).catch((e) => note('representative lookback', e));
  const from = lookbackWindow?.fromISO ?? isoMinusDays(today, ADAPTATION_EVIDENCE_WINDOW_DAYS);
  const classified = await classifyRecentActivities(userUuid, from, today, {
    currentBelief: capacity
      ? {
          thresholdPaceSecPerMi: capacity.threshold.paceSecPerMi,
          thresholdConfidence: capacity.threshold.confidence,
          asOf: today,
        }
      : null,
  }).catch((e) => note('activity evidence', e));

  /* ── 6 · THE PLAN'S OWN NUMBERS ────────────────────────────────────────── */
  const weekAheadEnd = isoPlusDays(today, 6);
  const planNumbers = planRow
    ? await pool.query<{
        long_ahead: string | number | null;
        week_ahead_mi: string | number | null;
      }>(
        `SELECT
           (SELECT MAX(distance_mi)
              FROM plan_workouts
             WHERE plan_id = $1 AND date_iso BETWEEN $2 AND $3 AND type = 'long') AS long_ahead,
           (SELECT SUM(distance_mi)
              FROM plan_workouts
             WHERE plan_id = $1 AND date_iso BETWEEN $2 AND $3) AS week_ahead_mi`,
        [planRow.id, today, weekAheadEnd],
      ).then((r) => r.rows[0] ?? null).catch((e) => note('plan numbers', e))
    : null;

  /* ── 6b · THE PRESCRIBED PACE, GROUPED BY PHASE ───────────────────────────
   *
   * PART 1 OF THE 2026-09-01 DECISION (`docs/PRODUCT_DECISIONS.md` §2). The
   * query this replaced was one `AVG(pace_target_s_per_mi)` across EVERY
   * remaining threshold/tempo/cruise row through the end of the visible
   * plan — no upper bound on `date_iso`, so it blended QUALITY, RACE-SPECIFIC
   * and TAPER pricing (407-475 s/mi on the owner's real account) into one
   * number and moved every future row by the same delta off it.
   *
   * `plan_phases`/`plan_weeks` already carry the grouping the plan itself
   * authored — `plan_workouts.week_id` → `plan_weeks.id` →
   * `plan_weeks.phase_id` → `plan_phases.label` — so this reads the plan's
   * OWN phase boundaries rather than inventing a second one. A row whose week
   * carries no phase (`LEFT JOIN`, `phase_label IS NULL`) is grouped as its
   * own null-labelled bucket, never folded into a neighbour's average.
   */
  const phaseRows = planRow
    ? await pool.query<{
        phase_label: string | null;
        avg_s: number | null;
        row_count: string;
        first_date: string;
        last_date: string;
      }>(
        `SELECT ph.label AS phase_label,
                ROUND(AVG(pw.pace_target_s_per_mi))::int AS avg_s,
                COUNT(*)::int AS row_count,
                MIN(pw.date_iso) AS first_date,
                MAX(pw.date_iso) AS last_date
           FROM plan_workouts pw
           LEFT JOIN plan_weeks wk ON wk.id = pw.week_id
           LEFT JOIN plan_phases ph ON ph.id = wk.phase_id
          WHERE pw.plan_id = $1 AND pw.date_iso >= $2
            AND pw.type IN ('threshold','tempo','cruise')
            AND pw.pace_target_s_per_mi IS NOT NULL
          GROUP BY ph.id, ph.label
          ORDER BY MIN(pw.date_iso)`,
        [planRow.id, today],
      ).then((r) => r.rows).catch((e) => note('plan phase pricing', e))
    : null;

  /* ── 7 · THE LOAD PICTURE · completed against scheduled, per whole week ── */
  const loadWeeks: Array<{ weekStartISO: string; completedMi: number; scheduledMi: number | null }> = [];
  if (planRow) {
    const oldest = isoMinusDays(today, 7 * ADAPTATION_LOAD_WEEKS);
    const [completedByDay, scheduledRows] = await Promise.all([
      mileageByDay(userUuid, oldest, today).catch((e) => note('completed mileage', e)),
      pool.query<{ date_iso: string; distance_mi: string | number | null }>(
        `SELECT date_iso, distance_mi
           FROM plan_workouts
          WHERE plan_id = $1 AND date_iso BETWEEN $2 AND $3`,
        [planRow.id, oldest, today],
      ).then((r) => r.rows).catch((e) => note('scheduled mileage', e)),
    ]);
    if (completedByDay && scheduledRows) {
      const scheduledByDay = new Map<string, number>();
      for (const r of scheduledRows) {
        scheduledByDay.set(r.date_iso, (scheduledByDay.get(r.date_iso) ?? 0) + (num(r.distance_mi) ?? 0));
      }
      // WHOLE weeks only, ending yesterday — a week still in progress would
      // read as under-completed for no reason other than that it is Tuesday.
      for (let w = 1; w <= ADAPTATION_LOAD_WEEKS; w += 1) {
        const start = isoMinusDays(today, 7 * w);
        const end = isoMinusDays(today, 7 * (w - 1) + 1);
        let completedMi = 0;
        let scheduledMi = 0;
        let anyScheduled = false;
        for (let d = start; d <= end; d = isoPlusDays(d, 1)) {
          completedMi += completedByDay.get(d)?.mi ?? 0;
          const s = scheduledByDay.get(d);
          if (s != null) { scheduledMi += s; anyScheduled = true; }
        }
        loadWeeks.push({
          weekStartISO: start,
          completedMi: roundTo(completedMi, 1),
          // Rule 11 · a week with no schedule is not a week scheduled at zero.
          scheduledMi: anyScheduled ? roundTo(scheduledMi, 1) : null,
        });
      }
    }
  }

  /* ── 8 · DENSITY · the progression gate's own resolutions, carried ───────
   *
   * The gate's SKIP REASON is carried too. It returns null for five different
   * reasons and the engine used to report all five as an authoring gap; see
   * `diagnoseProgressionWeek`'s header for what that cost. */
  let resolutions: ProgressionResolution[] = [];
  let densityGate: DensityGateState = 'UNREADABLE';
  if (absorption) {
    const diag = await diagnoseProgressionWeek(userUuid).catch((e) => note('progression week', e));
    if (diag == null) {
      densityGate = 'UNREADABLE';
    } else {
      densityGate = densityGateFor(diag.skip);
      if (diag.week && diag.week.targets.length > 0) {
        resolutions = resolveWeekProgression({
          targets: diag.week.targets,
          prior: diag.week.prior,
          verdict: absorption,
          weeklyMi: diag.week.weeklyMi,
        });
      }
    }
  }

  /* ── 8b · HISTORICAL VOLUME TOLERANCE · the OTHER volume question ────────
   *
   * Rule 8 FILTERED, unlike `loadWeeks` immediately above, because this one
   * asks what the runner holds rather than what his legs have just taken. The
   * refusal branch is carried straight through: `normalWeeklyMileage` returns a
   * `NormalReading` whose refusal arm has no `value`, and flattening that to a
   * zero here would put the one-quality-day defect back in a new file. */
  const tolerance = await normalWeeklyMileage(
    userUuid, today, ADAPTATION_VOLUME_TOLERANCE_WINDOW_DAYS,
  ).catch((e) => note('volume tolerance', e));
  const historicalTolerance: VolumeToleranceRead = tolerance == null
    ? { ok: false, reason: 'UNREADABLE' }
    : tolerance.ok
      ? {
          ok: true,
          sustainedWeeklyMi: tolerance.value,
          representativeDays: tolerance.representativeDays,
          oldestISO: isoMinusDays(today, ADAPTATION_VOLUME_TOLERANCE_WINDOW_DAYS),
        }
      : { ok: false, reason: 'NOT_ENOUGH_REPRESENTATIVE_TRAINING' };

  /* ── 9 · SCHEDULE · prescribed key sessions with no run against them ───── */
  const schedule = planRow
    ? await pool.query<{ out_of_place: string; clear_slots: string }>(
        `WITH missed AS (
           SELECT pw.date_iso
             FROM plan_workouts pw
            WHERE pw.plan_id = $1
              AND pw.is_quality = true
              AND pw.date_iso BETWEEN $2 AND $3
              AND NOT EXISTS (
                SELECT 1 FROM runs r
                 WHERE r.user_uuid = $4::uuid
                   AND ${runNotMergedSql('r')}
                   AND ${runDaySql('r')} = pw.date_iso
              )
         ),
         clear AS (
           SELECT pw.date_iso
             FROM plan_workouts pw
            WHERE pw.plan_id = $1
              AND pw.date_iso BETWEEN $3 AND $5
              AND pw.is_quality = false
              AND pw.type NOT IN ('long','race','race_week_tuneup','shakeout')
              AND COALESCE(pw.distance_mi, 0) > 0
         )
         SELECT (SELECT COUNT(*) FROM missed)::text AS out_of_place,
                (SELECT COUNT(*) FROM clear)::text  AS clear_slots`,
        [planRow.id, isoMinusDays(today, 7), isoMinusDays(today, 1), userUuid, weekAheadEnd],
      ).then((r) => r.rows[0] ?? null).catch((e) => note('schedule', e))
    : null;

  /* ── 10 · COMPOSE ──────────────────────────────────────────────────────── */
  // Rule 11 · the engine only runs on a complete read. The three inputs below
  // are the ones no lever can work without; a missing PLAN is a legitimate
  // "this runner has no plan", which is a different fact and not a failure.
  const readable = capacity != null && state != null && absorption != null && classified != null
    && lookbackWindow != null;
  if (!readable) {
    const missing = [
      capacity == null ? 'capacity' : null,
      state == null ? 'state' : null,
      absorption == null ? 'absorption' : null,
      classified == null ? 'activity evidence' : null,
      lookbackWindow == null ? 'evidence lookback' : null,
    ].filter((x): x is string => x != null);
    return {
      input: null,
      proposals: unreadableProposalSet(
        today,
        `Could not read: ${missing.join(', ')}. No proposal is made from a failed read.`,
      ),
      failures,
    };
  }

  const prescribedLongMi = num(planNumbers?.long_ahead ?? null);
  const minLongMi = prescribedLongMi != null ? prescribedLongMi * LONG_RUN_EVIDENCE_SHARE : Infinity;

  const sessions = classified
    .map(qualitySessionFrom)
    .filter((s): s is QualitySessionRead => s != null);
  const longRuns = classified
    .map((c) => longRunFrom(c, minLongMi))
    .filter((l): l is LongRunRead => l != null);

  /**
   * The lookback each episodic lever spends, with the discount priced off the
   * dates of THE EVIDENCE THAT WOULD ACTUALLY CARRY THE DECISION.
   *
   * Per-lever rather than shared, and that is the point: the pace lever's
   * sessions and the duration lever's long runs can sit at very different ages
   * inside the same window, and one factor for both would charge the fresher
   * lever for the staler one's evidence.
   *
   * And per-lever means the QUALIFYING subset, not everything in the slice. The
   * owner's instruction is a penalty "proportional to how far back the evidence
   * that ended up mattering actually is" — a session the control test throws
   * out is not evidence that mattered, and letting it sit in the median moves
   * the discount for a run that changed no decision.
   */
  const lookbackFor = (datesISO: string[]): EvidenceLookback => ({
    baseWindowDays: ADAPTATION_EVIDENCE_WINDOW_DAYS,
    windowDays: lookbackWindow.windowDays,
    representativeDays: lookbackWindow.representativeDays,
    excludedDays: lookbackWindow.excludedDays,
    stalenessFactor: evidenceStalenessFactor(
      datesISO, today, ADAPTATION_EVIDENCE_WINDOW_DAYS,
    ),
    reachedOuterBound: lookbackWindow.reachedOuterBound,
  });

  const input: AdaptationEngineInput = {
    todayISO: today,
    capacity,
    state,
    absorption,
    pace: {
      phases: (phaseRows ?? [])
        .map((r): PacePhaseRead | null => {
          const avg = num(r.avg_s);
          if (avg == null) return null;
          return {
            phaseLabel: r.phase_label,
            prescribedSecPerMi: avg,
            rowCount: Number(r.row_count),
            firstDateISO: r.first_date,
            lastDateISO: r.last_date,
          };
        })
        .filter((p): p is PacePhaseRead => p != null),
      sessions,
      // The CONTROLLED ones — `sessionDemonstratesControl` is the engine's own
      // exported predicate, called rather than re-implemented (Rule 16).
      lookback: lookbackFor(
        sessions.filter(sessionDemonstratesControl).map((s) => s.dateISO),
      ),
    },
    load: {
      currentWeeklyMi: num(planNumbers?.week_ahead_mi ?? null),
      recentWeeks: loadWeeks,
      historicalTolerance,
      tierWeeklyUpperMi: planRow?.authored_state
        ? (readTierUpper(planRow.authored_state, 'tier_peak_weekly_band') || null)
        : null,
    },
    longRun: {
      prescribedLongMi,
      longRunCapMi: planRow?.authored_state
        ? (readTierUpper(planRow.authored_state, 'tier_peak_long_band') || null)
        : null,
      // `validate.ts` sets 30% for every distance category, so this is that
      // number rather than a second opinion about it. Written as a fraction
      // because the engine's cap arithmetic is in fractions.
      longRunWoWMaxFraction: 0.30,
      recent: longRuns,
      // The TOLERATED ones, by the same argument. Mirrors `detectDuration`'s
      // own filter so the discount is priced off the runs that would carry the
      // decision, not off every long run in the window.
      lookback: lookbackFor(
        longRuns
          .filter((l) => l.durabilityEvidence
            && l.lateRunPacingCollapse !== true
            && l.executionQuality !== 'variable')
          .map((l) => l.dateISO),
      ),
    },
    density: { resolutions, gate: densityGate },
    schedule: {
      sessionsOutOfPlace: Number(schedule?.out_of_place ?? 0),
      clearSlotsAvailable: Number(schedule?.clear_slots ?? 0),
    },
    readable: true,
  };

  return { input, proposals: composeAdaptation(input), failures };
}
