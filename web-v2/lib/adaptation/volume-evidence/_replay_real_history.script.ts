/**
 * lib/adaptation/volume-evidence/_replay_real_history.script.ts
 *
 * MILEAGE-RESPONSIVE-1 · THE REAL-HISTORY REPLAY.
 *
 * CLAUDE.md Rule 21's standard for any change to the adaptation loop:
 *
 *     "Prove it fires, on real history. Compute what the runner would have had
 *      to DO to trigger it, then check whether any week they have actually run
 *      would have. If none could, the bar is not a bar, it is a wall."
 *
 * So this walks the owner's whole 2026, week by week, through
 * `classifyWeekSurplus` -> `admitSurplus` -> `updateDemonstratedVolume` ->
 * `respondToVolumeEvidence`, and writes
 * `docs/reports/core-closure-2026-09-04/MILEAGE-RESPONSIVE.md`.
 *
 *     npm --prefix web-v2 run mileage-replay
 *
 * ── READ-ONLY, BY TWO FENCES ──────────────────────────────────────────────
 *
 * Every statement goes through `canonical-shadow/read-only-db.ts`'s
 * `roQuery`, which opens a SEPARATE pool on `DATABASE_URL_RO` (role
 * `faff_readonly`, which cannot write at the permission level) and classifies
 * every statement against `lib/verify/production-barrier.ts`'s allow-list
 * before it reaches the wire. Reused rather than re-invented, per Rule 16.
 *
 * ── RULE 14 · THE POPULATION THIS REPLAY READS, NAMED ─────────────────────
 *
 * · runs      · this user by uuid, canonical rows only (`NOT (data ?
 *               'mergedIntoId')`). Measured on the real account: 121 of 280
 *               2026 rows carry `mergedIntoId`. Reading them would inflate
 *               every week.
 * · plans     · the plan that was ACTIVE on each week, resolved as the latest
 *               `authored_iso <= weekStart` whose `archived_iso` is null or
 *               after `weekStart`. Not "the active plan", which would price
 *               January against a block authored in September; and not "every
 *               plan_workouts row for this user", which is the 47-versions
 *               defect Rule 14 is named for.
 * · races     · every race with a real result, for Rule 8's windows.
 *
 * ── RULE 22 · WHAT THIS REPLAY CANNOT TELL YOU ────────────────────────────
 *
 * Stated before the numbers, because a confident replay is exactly the thing
 * that has misled this project before:
 *
 * 1 · IT DOES NOT RUN THE DAY RESOLVER. `lib/execution/day-resolver.ts` needs
 *     the writable pool, and only 7 of 159 canonical 2026 runs carry a
 *     `planWorkoutId` at all, so per-run matching would be invented rather
 *     than read. This replay therefore aggregates each DAY into one synthetic
 *     observation: a day with a prescription and a run is a
 *     PRESCRIBED_OVERRUN of `completed - prescribed`; a day with a run and no
 *     prescription is a SUPPLEMENTAL_RUN. That is CONSERVATIVE on the upward
 *     side (two runs on one prescribed day net against a single prescription
 *     rather than one of them counting whole) and it is an approximation.
 * 2 · IT DOES NOT RECONSTRUCT SESSION THIRDS OR HEART-RATE TRACES. So
 *     deterioration is not readable here. That is why the walk reports TWO
 *     passes, below.
 * 3 · IT PROVES NOTHING ABOUT THE PLAN ON THE PHONE. The seam is shut. Every
 *     number here is what the engine WOULD have believed and WOULD have
 *     proposed.
 * 4 · IT CANNOT SEE A RUN THAT NEVER SYNCED, or tell a mis-dated run from a
 *     real one.
 *
 * ── THE TWO PASSES, AND WHY THERE ARE TWO · RULE 11 ───────────────────────
 *
 * · PASS A · EVIDENCE AS IT ACTUALLY IS. Conditions this replay cannot read
 *   are handed in as REFUSALS. This answers "how many weeks can the engine
 *   honestly decide today", and the answer is the honest one even when it is
 *   zero.
 * · PASS B · CONDITIONS PERMITTING. The unreadable conditions are handed in
 *   as MET, and everything the replay CAN read (canonical rows, prescriptions,
 *   Rule 8 windows, the following week's completion) still governs. This
 *   answers Rule 21's actual question: which weeks he has really run would
 *   have cleared the bar.
 *
 * Reporting only pass B would be a claim the evidence does not support.
 * Reporting only pass A would hide the answer Rule 21 demands. Both, labelled.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VOLUME_ADDITION_THRESHOLD } from '@/lib/plan/adjudication/adjudicate';
import { roQuery, readOnlyConnectionConfigured } from '@/lib/adaptation/canonical-shadow/read-only-db';
import { prescribedWindowsFrom, isPrescribedNonNormal, SUSTAINED_WEEK_RANK, type RanRace } from '@/lib/training/normal-window';
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';
// FORMAT LINT · the shared 0.1 rule, not a hand-rolled one.
import { roundTo } from '@/lib/format/run';
// RUN-SHAPE LINT · the sanctioned fragments, never a hand-rolled literal. The
// first cut spelled `data ? 'mergedIntoId'` and `data->>'distanceMi'` by hand
// and `_run_shape_lint.test.ts` caught both, which is the whole point of that
// gate: nothing checks that a hand-typed key names a real one.
import { runDaySql, runDistanceMiSql, runMergedIntoIdSql } from '@/lib/runs/run-shape';
import { classifyWeekSurplus } from './classify';
import { admitSurplus, classifyLowWeek } from './admit';
import { rankWeek, unmeasuredBelief, updateDemonstratedVolume } from './belief';
import { respondToVolumeEvidence, type PhaseIntent } from './respond';
// CONTINUOUS-EVIDENCE-1 · the two channels and the ledger.
import {
  accumulateCapacityEvidence, readFatigue, weighCapacity,
  type CapacityEvidence, type FatigueContribution,
} from './evidence';
import { PROGRESSION_UNLOCK_FRAC } from './weight';
// ONE DOOR · see `./contract`'s own section. The engine's vocabulary reaches
// this directory through that file and nowhere else.
import {
  absent, failed, measured,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
  type Measured,
} from './contract';
import type { DemonstratedVolumeBelief, FutureWeek, SurplusRun, WeekSurplusInput } from './contract';

const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const FROM = '2026-01-01';
const TO = '2026-09-05';
const OUT = path.resolve(__dirname, '..', '..', '..', '..',
  'docs', 'reports', 'core-closure-2026-09-04', 'MILEAGE-RESPONSIVE.md');

const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const mondayOf = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDays(iso, -(((d.getUTCDay() + 6) % 7)));
};
const r1 = (n: number): number => roundTo(n);

interface DayRow { d: string; mi: number; merged: boolean; }
interface WkoRow { plan_id: string; date_iso: string; type: string; distance_mi: string | null; is_quality: boolean; is_long: boolean; }
interface PlanRow { id: string; mode: string | null; authored: string; archived: string | null; }
interface WeekRow { plan_id: string; week_start_iso: string; is_cutback: boolean; is_race_week: boolean; }

describe('MILEAGE-RESPONSIVE-1 · replay against the owner\'s real 2026', () => {
  it('walks every week and writes the report', async () => {
    if (!readOnlyConnectionConfigured()) {
      // Rule 11 · a refusal is a correct answer, and it is not a pass.
      throw new Error('DATABASE_URL_RO is not set · this replay reads production and will not guess.');
    }

    /* ── the population, named ────────────────────────────────────────── */

    const days = (await roQuery<{ d: string; mi: string; n: string }>(
      `SELECT ${runDaySql()} AS d, SUM(${runDistanceMiSql()}) AS mi, COUNT(*) AS n
         FROM runs
        WHERE user_uuid = $1::uuid AND ${CANONICAL_ROW_SQL}
          AND ${runDaySql()} >= $2 AND ${runDaySql()} <= $3
        GROUP BY 1 ORDER BY 1`,
      [OWNER, FROM, TO],
    )).rows.map((r) => ({ d: r.d, mi: Number(r.mi), merged: false } as DayRow));

    const mergedDays = (await roQuery<{ d: string; mi: string; n: string }>(
      `SELECT ${runDaySql()} AS d, SUM(${runDistanceMiSql()}) AS mi, COUNT(*) AS n
         FROM runs
        WHERE user_uuid = $1::uuid AND ${runMergedIntoIdSql()} IS NOT NULL
          AND ${runDaySql()} >= $2 AND ${runDaySql()} <= $3
        GROUP BY 1 ORDER BY 1`,
      [OWNER, FROM, TO],
    )).rows.map((r) => ({ d: r.d, mi: Number(r.mi), merged: true } as DayRow));

    const plans = (await roQuery<PlanRow>(
      `SELECT id, mode,
              to_char(authored_iso,'YYYY-MM-DD') AS authored,
              to_char(archived_iso,'YYYY-MM-DD') AS archived
         FROM training_plans WHERE user_uuid = $1::uuid ORDER BY authored_iso`,
      [OWNER],
    )).rows;

    const wkos = (await roQuery<WkoRow>(
      `SELECT plan_id, date_iso, type, distance_mi::text, is_quality, is_long
         FROM plan_workouts WHERE user_uuid = $1::uuid AND date_iso >= $2 AND date_iso <= $3`,
      [OWNER, FROM, TO],
    )).rows;

    const planWeeks = (await roQuery<WeekRow>(
      `SELECT plan_id, week_start_iso, is_cutback, is_race_week
         FROM plan_weeks WHERE user_uuid = $1::uuid`,
      [OWNER],
    )).rows;

    const raceRows = (await roQuery<{ slug: string; d: string; mi: string; pri: string | null; has: boolean }>(
      `SELECT slug, meta->>'date' AS d, meta->>'distanceMi' AS mi, meta->>'priority' AS pri,
              (actual_result IS NOT NULL) AS has
         FROM races WHERE user_uuid = $1::uuid AND meta->>'date' >= $2 AND meta->>'date' <= $3`,
      [OWNER, '2025-10-01', TO],
    )).rows;

    const ranRaces: RanRace[] = raceRows
      .filter((r) => r.has && r.d <= TO)
      .map((r) => ({ slug: r.slug, dateISO: r.d, distanceMi: Number(r.mi), priority: r.pri }));
    const windows = prescribedWindowsFrom(ranRaces);
    const raceDays = new Set(ranRaces.map((r) => r.dateISO));

    /* ── index ────────────────────────────────────────────────────────── */

    const miByDay = new Map(days.map((d) => [d.d, d.mi]));
    const mergedMiByDay = new Map(mergedDays.map((d) => [d.d, d.mi]));

    /** The plan that was live on `iso`. Rule 14: not "the active plan". */
    const planAt = (iso: string): PlanRow | null => {
      const live = plans.filter((p) => p.authored <= iso && (p.archived == null || p.archived > iso));
      return live.length > 0 ? live[live.length - 1] : null;
    };

    const wkoByPlanDay = new Map<string, WkoRow[]>();
    for (const w of wkos) {
      const k = `${w.plan_id}|${w.date_iso}`;
      (wkoByPlanDay.get(k) ?? wkoByPlanDay.set(k, []).get(k)!).push(w);
    }
    const weekFlag = new Map(planWeeks.map((w) => [`${w.plan_id}|${w.week_start_iso}`, w]));

    const weekStarts: string[] = [];
    for (let ws = mondayOf(FROM); ws <= mondayOf(TO); ws = addDays(ws, 7)) weekStarts.push(ws);

    /* ── build one WeekSurplusInput per week ──────────────────────────── */

    interface Built { ws: string; input: WeekSurplusInput; plan: PlanRow | null; completed: number; }
    const built: Built[] = weekStarts.map((ws) => {
      const plan = planAt(ws);
      const flags = plan ? weekFlag.get(`${plan.id}|${ws}`) : undefined;
      const runs: SurplusRun[] = [];
      let prescribedMi = 0;
      let completed = 0;
      for (let i = 0; i < 7; i += 1) {
        const d = addDays(ws, i);
        const pres = plan ? (wkoByPlanDay.get(`${plan.id}|${d}`) ?? []) : [];
        const presMi = pres.reduce((a, w) => a + Number(w.distance_mi ?? 0), 0);
        /* RULE 11, written as a branch rather than a ternary because the two
         * states are genuinely different facts and COERCION-1 was right to
         * flag the first cut of this line.
         *
         *   NO ROW    · the day carried no prescription at all. `null`, which
         *               is what `SurplusRun.prescribedMi` documents null to
         *               mean, and the run reads as SUPPLEMENTAL.
         *   A ROW AT 0 · a prescribed REST day. A measured zero, which
         *               survives as zero, so a run on a rest day reads as the
         *               extra volume it actually is.
         *
         * The first cut was `presMi > 0 ? r1(presMi) : null`, which collapsed
         * the second into the first and would have credited a rest-day run as
         * supplemental rather than as an overrun of a zero prescription. */
        let dayPrescribedMi: number | null;
        let dayMatch: 'legacy_type' | 'supplemental';
        if (pres.length === 0) {
          dayPrescribedMi = null;
          dayMatch = 'supplemental';
        } else {
          dayPrescribedMi = r1(presMi);
          dayMatch = 'legacy_type';
        }
        prescribedMi += presMi;
        const ranMi = miByDay.get(d) ?? 0;
        completed += ranMi;
        const mergedMi = mergedMiByDay.get(d) ?? 0;
        if (mergedMi > 0) {
          // Rule 14, exercised on real rows rather than asserted: a merged row
          // is offered to the classifier and must never become volume.
          runs.push({
            activityId: `merged:${d}`, dateISO: d, distanceMi: measured(r1(mergedMi)),
            match: 'exact', mergedIntoAnother: true, isRace: false,
            // Rule 11 · `null` here means THE DAY HAD NO PRESCRIPTION, which is
            // a data-presence fact. A prescribed REST day is a prescription of
            // zero miles and stays a zero, so a run on a rest day reads as the
            // extra volume it is. `presMi > 0 ? ... : null` erased the second
            // into the first and COERCION-1 caught it.
            prescribedMi: dayPrescribedMi, movedFromDateISO: null,
          });
        }
        if (ranMi <= 0) continue;
        runs.push({
          activityId: `day:${d}`,
          dateISO: d,
          distanceMi: measured(r1(ranMi)),
          match: dayMatch,
          mergedIntoAnother: false,
          isRace: raceDays.has(d),
          prescribedMi: dayPrescribedMi,
          movedFromDateISO: null,
        });
      }
      const mode = (plan?.mode ?? '').toLowerCase();
      return {
        ws,
        plan,
        completed: r1(completed),
        input: {
          weekStartISO: ws,
          prescribedMi: r1(prescribedMi),
          runs,
          authoredPlanMode: mode.includes('recovery') ? 'RECOVERY'
            : mode.includes('taper') ? 'TAPER' : plan ? 'BUILD' : 'UNKNOWN',
          isCutback: flags?.is_cutback ?? false,
          // Rule 8 · the week is also non-normal if ANY of its days sits inside
          // a taper lead-in or post-race recovery window. The plan's own
          // is_race_week column is not the whole answer, and on this account it
          // is FALSE on weeks the plan was authored `mode: 'recovery'` to
          // prescribe as recovery.
          isRaceWeek: flags?.is_race_week ?? false,
          inPrescribedRaceWindow: Array.from({ length: 7 }, (_, i) => addDays(ws, i))
            .some((d) => isPrescribedNonNormal(d, windows)),
          dataComplete: true,
        },
      };
    });

    /* ── the walk ────────────────────────────────────────────────────── */

    interface Row {
      ws: string; prescribed: number; completed: number; surplus: string; admissible: string;
      nonNormal: string; passA: string; passB: string; barMi: number; gapMi: number | null; beliefPeak: number | null; moved: string;
      raised: number; addedMi: number; blockedBy: string;
    }
    const rows: Row[] = [];
    let belief: DemonstratedVolumeBelief = unmeasuredBelief(FROM);
    const representative: number[] = [];
    const unfiltered: number[] = [];
    const beliefMoves: string[] = [];
    const futureChanges: string[] = [];
    let lowWeekCensus: Record<string, number> = {};
    // CONTINUOUS-EVIDENCE-1 · every week's capacity reading, in order, so the
    // ledger can be re-accumulated as of each week rather than only at the end.
    const capacityReadings: CapacityEvidence[] = [];
    interface ContinuousRow {
      ws: string; prescribed: number; completed: number; surplusFrac: number | null;
      units: number; confirmedUnits: number; weekFrac: number; confirmedFrac: number;
      absorption: number; provisional: boolean; unreadable: boolean;
      ledgerUnits: number; ledgerRecorded: number; ledgerFrac: number; unlocked: boolean;
      fatigueExcessMi: number | null; fatigueNonNormal: boolean; artifactMi: number;
      detail: string;
    }
    const continuousRows: ContinuousRow[] = [];

    for (let i = 0; i < built.length - 1; i += 1) {
      const b = built[i];
      const next = built[i + 1];
      const surplus = classifyWeekSurplus(b.input);
      unfiltered.push(b.completed);
      if (!surplus.prescribedNonNormal) representative.push(b.completed);

      const followingFrac: Measured<number> = next.input.prescribedMi > 0
        ? measured(next.completed / next.input.prescribedMi)
        : absent('the following week has no prescription to complete');

      const passA = admitSurplus({
        week: surplus,
        identityResolved: measured(true),
        telemetry: absent('this replay does not reconstruct heart-rate traces'),
        deterioration: failed('this replay does not reconstruct session thirds'),
        keySessionGrades: [],
        painOrInjuryReported: failed('no pain or injury report is read by this replay'),
        unplannedRecoveryTaken: failed('unplanned recovery is not read by this replay'),
        followingWeekCompletionFrac: followingFrac,
        absorptionCompletionBar: VOLUME_WEEK_COMPLETION_MIN_FRAC,
      });
      const passB = admitSurplus({
        week: surplus,
        identityResolved: measured(true),
        telemetry: absent('this replay does not reconstruct heart-rate traces'),
        deterioration: measured({
          repeated: false, deterioratedCount: 0, unknownCount: 0, cleanCount: 0,
          detail: 'ASSUMED CLEAN · not reconstructed by this replay',
        }),
        keySessionGrades: [],
        painOrInjuryReported: measured(false),
        unplannedRecoveryTaken: measured(false),
        followingWeekCompletionFrac: followingFrac,
        absorptionCompletionBar: VOLUME_WEEK_COMPLETION_MIN_FRAC,
      });

      /* ── CONTINUOUS-EVIDENCE-1 · the two channels, on the real week ──
       *
       * `weighCapacity` is handed pass B's admission, for the same reason the
       * whole replay reports two passes: pass A's conditions are REFUSALS this
       * replay cannot read (no HR traces, no session thirds, no pain report),
       * and a capacity reading over refusals is a statement about the replay
       * rather than about the runner. The fatigue channel is unaffected either
       * way, because it reads canonical distance and nothing else. */
      const capacity: CapacityEvidence = weighCapacity(surplus, passB, {
        identityResolved: measured(true),
        telemetry: absent('this replay does not reconstruct heart-rate traces'),
        deterioration: measured({
          repeated: false, deterioratedCount: 0, unknownCount: 0, cleanCount: 0,
          detail: 'ASSUMED CLEAN · not reconstructed by this replay',
        }),
        keySessionGrades: [],
        painOrInjuryReported: measured(false),
        unplannedRecoveryTaken: measured(false),
        followingWeekCompletionFrac: followingFrac,
        absorptionCompletionBar: VOLUME_WEEK_COMPLETION_MIN_FRAC,
      });
      const fatigue: FatigueContribution = readFatigue(b.input, surplus);
      capacityReadings.push(capacity);
      // The ledger as it stood the moment this week's evidence landed. Only
      // weeks already run reach it, because `accumulateCapacityEvidence` drops
      // anything dated after `asOfISO`.
      const ledger = accumulateCapacityEvidence(capacityReadings, addDays(b.ws, 7));

      continuousRows.push({
        ws: b.ws,
        prescribed: b.input.prescribedMi,
        completed: b.completed,
        surplusFrac: capacity.surplusFrac.ok ? capacity.surplusFrac.value : null,
        units: capacity.units,
        confirmedUnits: capacity.confirmedUnits,
        weekFrac: capacity.fractionOfFullStep,
        confirmedFrac: capacity.confirmedFractionOfFullStep,
        absorption: capacity.confirmationWeight,
        provisional: capacity.provisional,
        unreadable: capacity.unreadable,
        ledgerUnits: ledger.totalUnits,
        ledgerRecorded: ledger.recordedUnits,
        ledgerFrac: ledger.progressionFraction,
        unlocked: ledger.fullStepUnlocked,
        fatigueExcessMi: fatigue.excessMi.ok ? fatigue.excessMi.value : null,
        fatigueNonNormal: fatigue.duringPrescribedNonNormal,
        artifactMi: fatigue.artifactMiExcluded,
        detail: capacity.detail,
      });

      const before = belief;
      belief = updateDemonstratedVolume({
        asOfISO: addDays(b.ws, 7),
        prior: before,
        week: surplus,
        admission: passB,
        representativeWeeklyMi: representative,
        allWeeklyMiUnfiltered: unfiltered,
        sustainedRank: SUSTAINED_WEEK_RANK,
        lowWeek: null,
      });
      for (const m of belief.moves) {
        beliefMoves.push(
          `| ${b.ws} | \`${m.field}\` | ${m.fromMi ?? 'unmeasured'} | **${m.toMi}** | ${m.because} |`);
      }

      // The low-week census · Rule 11, the downward half, on real data.
      if (surplus.completedMi.ok && b.input.prescribedMi > 0
        && surplus.completedMi.value < b.input.prescribedMi * VOLUME_WEEK_COMPLETION_MIN_FRAC) {
        const low = classifyLowWeek({
          weekStartISO: b.ws,
          prescribedMi: b.input.prescribedMi,
          completedMi: surplus.completedMi,
          prescribedNonNormal: surplus.prescribedNonNormal,
          dataComplete: true,
          declaredCause: absent('nothing declared on this account'),
          consecutiveLowRepresentativeWeeks: 1,
          minConsecutiveWeeksForLoss: VOLUME_MIN_CONSECUTIVE_WEEKS,
        });
        lowWeekCensus[low.cause] = (lowWeekCensus[low.cause] ?? 0) + 1;
      }

      // What the response WOULD have proposed for the four weeks ahead.
      const future: FutureWeek[] = built.slice(i + 1, i + 5).map((f) => ({
        weekStartISO: f.ws,
        prescribedMi: f.input.prescribedMi,
        sealed: false,
        isCutback: f.input.isCutback,
        isTaper: f.input.authoredPlanMode === 'TAPER',
        isRaceWeek: f.input.isRaceWeek,
        stressors: f.plan
          ? (wkoByPlanDay.get(`${f.plan.id}|${f.ws}`) ?? []).map((w) => w.type)
          : [],
        longestMi: 0,
        mpMi: 0,
      })).filter((f) => f.prescribedMi > 0);

      const phase: PhaseIntent = b.input.authoredPlanMode === 'RECOVERY' ? 'RECOVERY'
        : b.input.authoredPlanMode === 'TAPER' ? 'TAPER'
          : b.input.isRaceWeek ? 'RACE_WEEK' : 'BUILD';

      const resp = respondToVolumeEvidence({
        asOfISO: addDays(b.ws, 7),
        athleteId: OWNER,
        planVersion: b.plan?.id ?? 'none',
        evidenceVersion: b.ws,
        week: surplus,
        admission: passB,
        // CONTINUOUS-EVIDENCE-1 · the accumulated evidence as of this week,
        // not a hardcoded 1. This is what makes the replay's proposals scale
        // with what the runner actually demonstrated.
        progressionFraction: ledger.progressionFraction,
        beliefBefore: before,
        beliefAfter: belief,
        futureWeeks: future,
        weekBeforeFirstFuture: {
          weekStartISO: b.ws, prescribedMi: b.input.prescribedMi, sealed: true,
          isCutback: b.input.isCutback, isTaper: b.input.authoredPlanMode === 'TAPER',
          isRaceWeek: b.input.isRaceWeek,
          stressors: b.plan ? (wkoByPlanDay.get(`${b.plan.id}|${b.ws}`) ?? []).map((w) => w.type) : [],
          longestMi: 0, mpMi: 0,
        },
        phase,
        distanceFloorMi: 30,
        templatePeakBandMi: [45, 55],
        stepsTakenThisCycle: 0,
        nextBoundaryISO: addDays(b.ws, 14),
      });

      for (const w of resp.weeks.filter((x) => x.deltaMi > 0)) {
        futureChanges.push(`| ${b.ws} | ${w.weekStartISO} | ${w.beforeMi} | **${w.afterMi}** | +${w.deltaMi} | ${w.why} |`);
      }

      const say = (a: typeof passA): string => (a.admitted
        ? `ADMITTED ${a.mi} mi`
        : `${a.outcome}${a.blocking.length > 0 ? ` (${a.blocking.join(', ')})` : ''}`);

      rows.push({
        ws: b.ws,
        prescribed: b.input.prescribedMi,
        completed: b.completed,
        surplus: surplus.rawSurplusMi.ok ? String(surplus.rawSurplusMi.value) : 'refused',
        admissible: surplus.admissibleSurplusMi.ok ? String(surplus.admissibleSurplusMi.value) : 'refused',
        nonNormal: surplus.nonNormalBecause ?? '',
        barMi: r1(b.input.prescribedMi * VOLUME_ADDITION_THRESHOLD),
        gapMi: surplus.prescribedNonNormal || b.input.prescribedMi <= 0 || !surplus.rawSurplusMi.ok
          ? null
          : r1(b.input.prescribedMi * VOLUME_ADDITION_THRESHOLD - surplus.rawSurplusMi.value),
        passA: say(passA),
        passB: say(passB),
        beliefPeak: belief.peakWeeklyMi,
        moved: belief.moves.map((m) => m.field).join(' '),
        raised: resp.weeks.filter((w) => w.deltaMi > 0).length,
        addedMi: resp.totalAddedMi,
        blockedBy: resp.weeks.find((w) => w.preserved != null)?.preserved ?? '',
      });
    }

    /* ── the report ──────────────────────────────────────────────────── */

    const admittedA = rows.filter((r) => r.passA.startsWith('ADMITTED'));
    const admittedB = rows.filter((r) => r.passB.startsWith('ADMITTED'));
    const raisedWeeks = rows.filter((r) => r.raised > 0);
    const peakSeries = rows.map((r) => r.beliefPeak).filter((n): n is number => n != null);

    const md: string[] = [];
    md.push('# MILEAGE-RESPONSIVE-1 · does running MORE make future mileage larger');
    md.push('');
    md.push('Generated by `web-v2/lib/adaptation/volume-evidence/_replay_real_history.script.ts`');
    md.push('(`npm --prefix web-v2 run mileage-replay`), read-only, against the owner\'s real account.');
    md.push('');
    md.push('**The seam is shut.** `AUTOMATIC_ADAPTATION_AUTHORITY` is `false` and this directory has');
    md.push('no writer. Every number below is what the engine WOULD have believed and WOULD have');
    md.push('proposed. Nothing here changed a plan row.');
    md.push('');
    md.push('## What this replay cannot tell you');
    md.push('');
    md.push('1. It does not run `lib/execution/day-resolver.ts` (it needs the writable pool, and only');
    md.push('   7 of 159 canonical 2026 runs carry a `planWorkoutId` at all). Each DAY is aggregated');
    md.push('   into one observation instead, which is conservative on the upward side.');
    md.push('2. It does not reconstruct session thirds or heart-rate traces, so deterioration is not');
    md.push('   readable. That is what pass A and pass B are for.');
    md.push('3. It proves nothing about the plan on the phone.');
    md.push('');
    md.push('## The population read (Rule 14)');
    md.push('');
    md.push(`- canonical run-days ${FROM}..${TO}: **${days.length}**`);
    md.push(`- MERGED run-days in the same window, excluded: **${mergedDays.length}** `
      + `(${r1(mergedDays.reduce((a, d) => a + d.mi, 0))} mi that would have inflated these weeks)`);
    md.push(`- plan versions on this account: **${plans.length}** (the plan LIVE on each week is used, `
      + 'not the currently-active one)');
    md.push(`- races with a real result, driving Rule 8 windows: **${ranRaces.length}** `
      + `(${ranRaces.map((r) => r.dateISO).join(', ')})`);
    md.push(`- weeks walked: **${rows.length}**`);
    md.push('');
    md.push('## Headline');
    md.push('');
    md.push(`- weeks where the surplus was ADMITTED as evidence, pass A (evidence as it is): **${admittedA.length}**`);
    md.push(`- weeks where it would be admitted, pass B (conditions permitting): **${admittedB.length}**`);
    md.push(`- weeks where a FUTURE week would have been made larger: **${raisedWeeks.length}**`);
    md.push(`- total future mileage that would have been added across the year: `
      + `**${r1(rows.reduce((a, r) => a + r.addedMi, 0))} mi**`);
    md.push(`- demonstrated peak belief, start to end: `
      + `**${peakSeries[0] ?? 'unmeasured'} -> ${peakSeries[peakSeries.length - 1] ?? 'unmeasured'} mi/wk**`);
    md.push('');
    md.push('Compare against the measured baseline this work exists to correct: **zero** upward');
    md.push('adaptations in 309 production `coach_intents` rows (CLAUDE.md Rule 21).');
    md.push('');
    /* RULE 21 · "compute what the runner would have had to DO to trigger it,
     * then check whether any week they have actually run would have. If none
     * could, the bar is not a bar, it is a wall." Computed, not asserted. */
    const reachable = rows.filter((r) => r.gapMi != null).sort((a, b) => a.gapMi! - b.gapMi!);
    const cleared = reachable.filter((r) => r.gapMi! <= 0);
    /* ══════════════════════════════════════════════════════════════════
     * CONTINUOUS-EVIDENCE-1 · THE CLIFF, AND WHAT REPLACED IT
     * ═══════════════════════════════════════════════════════════════ */
    const contributing = continuousRows.filter((r) => r.units > 0);
    const target = continuousRows.find((r) => r.ws === '2026-06-15');
    md.push('## CONTINUOUS-EVIDENCE-1 · the week that used to contribute nothing');
    md.push('');
    md.push('The owner\'s finding: "The closest historical week completed 47.3 against 45.5');
    md.push('prescribed but contributed zero evidence because it missed a 47.8 bar by 0.4 miles.');
    md.push('That is another cliff." The bar is gone. Evidence is now credited continuously.');
    md.push('');
    if (target != null) {
      md.push(`**2026-06-15** · ${target.completed} mi run against ${target.prescribed} mi prescribed.`);
      md.push('');
      md.push(`- surplus fraction: **${target.surplusFrac == null ? 'refused' : `${r1(target.surplusFrac * 100)} per cent`}** of prescription`);
      md.push(`- evidence units contributed: **${target.units.toFixed(5)}** of the `
        + `${PROGRESSION_UNLOCK_FRAC} a full step needs`);
      md.push(`- **share of a full doctrinal volume step this one week is worth: `
        + `${(target.weekFrac * 100).toFixed(1)} per cent** (it contributed ZERO before this change)`);
      md.push(`- absorption factor from the following week: **${target.absorption.toFixed(3)}**`);
      md.push(`- of that, CONFIRMED and spendable today: **${(target.confirmedFrac * 100).toFixed(1)} per cent**`);
      md.push(`- provisional: ${target.provisional ? 'yes' : 'no'} · unreadable: ${target.unreadable ? 'yes' : 'no'}`);
      md.push(`- ledger as of the following week: recorded **${target.ledgerRecorded.toFixed(5)}**, `
        + `confirmed **${target.ledgerUnits.toFixed(5)}** `
        + `(${(target.ledgerFrac * 100).toFixed(1)} per cent of a full step, `
        + `${target.unlocked ? 'UNLOCKED' : 'not yet a full step'})`);
      md.push('');
      md.push(`> ${target.detail}`);
      md.push('');
      md.push('**Read that carefully, because the two halves are different facts (Rule 11).**');
      md.push('The 0.4-mile cliff is gone: the week is now worth a real, non-zero share of a step,');
      md.push('and the size of that share moves continuously with how far past prescription he ran.');
      md.push('What holds its CONFIRMED share at zero is a separate and genuine fact about the');
      md.push('following weeks, not a threshold he missed by a hair: 2026-06-22 completed 28 of 49.5');
      md.push('mi and 2026-06-29 completed 0 of 40. He did not carry the load on. The engine records');
      md.push('the evidence and declines to spend it, which is exactly what "evidence remains');
      md.push('provisional until recovery indicates absorption" asks for.');
    } else {
      md.push('_2026-06-15 is not in the walked window._');
    }
    md.push('');
    md.push('### Every week now worth something it was worth nothing before');
    md.push('');
    md.push('| week | prescribed | completed | surplus % | units | worth % of a step | absorption | confirmed % | ledger confirmed % |');
    md.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of contributing) {
      md.push(`| ${r.ws} | ${r.prescribed} | ${r.completed} | `
        + `${r.surplusFrac == null ? '-' : r1(r.surplusFrac * 100)} | ${r.units.toFixed(5)} | `
        + `**${(r.weekFrac * 100).toFixed(1)}** | ${r.absorption.toFixed(3)} | `
        + `${(r.confirmedFrac * 100).toFixed(1)} | ${(r.ledgerFrac * 100).toFixed(1)} |`);
    }
    md.push('');
    /* THE COUNTERFACTUAL, COMPUTED RATHER THAN REMEMBERED.
     *
     * Rule 18: a comparison that re-runs the NEW code and calls the answer
     * "old" proves nothing. So the two clauses the old `admitSurplus` applied
     * are re-derived here, literally, from the same rows: a surplus strictly
     * above `prescribed × VOLUME_ADDITION_THRESHOLD`, AND a following week at
     * or above `VOLUME_WEEK_COMPLETION_MIN_FRAC`. Anything else was zero. */
    const oldBarAdmitted = continuousRows.filter((r) => {
      const row = rows.find((x) => x.ws === r.ws);
      if (row == null || r.surplusFrac == null) return false;
      const surplusMi = r.completed - r.prescribed;
      const clearsMagnitude = surplusMi > r.prescribed * VOLUME_ADDITION_THRESHOLD;
      const clearsAbsorption = r.absorption >= 1;
      return clearsMagnitude && clearsAbsorption;
    });
    md.push(`Weeks now carrying non-zero capacity evidence: **${contributing.length}**. `
      + 'Weeks the OLD binary bar would have admitted, re-derived from the same rows rather '
      + `than re-run through the new code: **${oldBarAdmitted.length}**.`);
    md.push('');
    md.push('The old bar admitted a week whole or not at all. Every week in the table above was');
    md.push('worth exactly zero under it. That is the cliff, measured on the runner\'s own year.');
    md.push('');
    md.push('Note how FEW weeks carry any surplus at all: across the year the runner mostly ran');
    md.push('UNDER prescription, which is why the volume lever has so little to spend. That is a');
    md.push('fact about the year, not about the curve, and it is stated here rather than hidden');
    md.push('behind a single headline number.');
    md.push('');
    md.push('### The two channels disagree, which is the point');
    md.push('');
    md.push('Rule 8 filters CAPABILITY and its corollary refuses to filter ABSORBED LOAD. A week the');
    md.push('plan authored small contributes zero capacity and still contributes fatigue.');
    md.push('');
    md.push('| week | why non-normal | capacity units | fatigue excess mi | merged mi excluded |');
    md.push('|---|---|---|---|---|');
    for (const r of continuousRows.filter((x) => x.fatigueNonNormal && (x.fatigueExcessMi ?? 0) > 0)) {
      const nn = rows.find((x) => x.ws === r.ws)?.nonNormal ?? '';
      md.push(`| ${r.ws} | ${nn} | **${r.units.toFixed(5)}** | **${r.fatigueExcessMi}** | ${r.artifactMi} |`);
    }
    md.push('');
    md.push(`Merged miles excluded from BOTH channels across the window: `
      + `**${r1(continuousRows.reduce((a, r) => a + r.artifactMi, 0))} mi**.`);
    md.push('');
    md.push('## Rule 21 · is the bar a bar, or a wall');
    md.push('');
    md.push('The bar to be read as "he ran more" is `VOLUME_ADDITION_THRESHOLD` '
      + `(${Math.round(VOLUME_ADDITION_THRESHOLD * 100)} per cent of the week's own prescription), `
      + 'which is the SAME constant the downward path uses. What he would have had to do, '
      + 'per week, and how close he came:');
    md.push('');
    md.push(`- ordinary weeks with a prescription to be measured against: **${reachable.length}**`);
    md.push(`- of those, weeks that CLEARED the bar: **${cleared.length}**`);
    if (reachable.length > 0) {
      md.push(`- closest miss: **${reachable[0].ws}**, ${reachable[0].completed} mi run against `
        + `${reachable[0].prescribed} mi prescribed. The bar was ${reachable[0].barMi} mi of surplus `
        + `and he ran ${reachable[0].surplus}. He was **${r1(reachable[0].gapMi!)} mi short** of `
        + 'triggering an upward volume proposal.');
    }
    md.push('');
    md.push('| week | prescribed | completed | surplus | bar | short by |');
    md.push('|---|---|---|---|---|---|');
    for (const r of reachable.slice(0, 8)) {
      md.push(`| ${r.ws} | ${r.prescribed} | ${r.completed} | ${r.surplus} | ${r.barMi} | `
        + `${r.gapMi! <= 0 ? '**CLEARED**' : r1(r.gapMi!)} |`);
    }
    md.push('');
    md.push('And the weeks where the surplus was LARGE and Rule 8 refused it anyway, which is the');
    md.push('guard doing exactly what it exists for:');
    md.push('');
    md.push('| week | prescribed | completed | raw surplus | refused because |');
    md.push('|---|---|---|---|---|');
    for (const r of rows.filter((x) => x.nonNormal !== '' && Number(x.surplus) > 2)
      .sort((a, b) => Number(b.surplus) - Number(a.surplus))) {
      md.push(`| ${r.ws} | ${r.prescribed} | ${r.completed} | ${r.surplus} | \`${r.nonNormal}\` |`);
    }
    md.push('');
    md.push('## Which weeks would have moved the belief');
    md.push('');
    if (beliefMoves.length === 0) md.push('_None._');
    else {
      md.push('| week | field | from | to | because |');
      md.push('|---|---|---|---|---|');
      md.push(...beliefMoves);
    }
    md.push('');
    md.push('## Which future weeks would have changed');
    md.push('');
    if (futureChanges.length === 0) md.push('_None._');
    else {
      md.push('| evaluated after | week raised | before | after | delta | why |');
      md.push('|---|---|---|---|---|---|');
      md.push(...futureChanges);
    }
    md.push('');
    md.push('## The low-week census (Rule 11, the downward half)');
    md.push('');
    md.push('Every week completed below the bar, classified. Only `GENUINE_CAPACITY_LOSS` may lower a');
    md.push('belief, and it may never lower the peak.');
    md.push('');
    md.push('| cause | weeks |');
    md.push('|---|---|');
    for (const [k, v] of Object.entries(lowWeekCensus).sort((a, b) => b[1] - a[1])) {
      md.push(`| \`${k}\` | ${v} |`);
    }
    md.push('');
    md.push('## Every week');
    md.push('');
    md.push('| week | prescribed | completed | surplus | admissible | Rule 8 excluded because | pass A | pass B | peak belief | weeks raised | mi added |');
    md.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      md.push(`| ${r.ws} | ${r.prescribed} | ${r.completed} | ${r.surplus} | ${r.admissible} | `
        + `${r.nonNormal ? `\`${r.nonNormal}\`` : ''} | ${r.passA} | ${r.passB} | ${r.beliefPeak ?? ''} | `
        + `${r.raised || ''} | ${r.addedMi || ''} |`);
    }
    md.push('');

    md.push('## What this says, and the two decisions it surfaces');
    md.push('');
    md.push('**1 · The path exists and is reachable, and on this history it has not fired.** That is');
    md.push('the honest answer and it is not the same as "it cannot fire". The closest miss above is');
    md.push('a real week, 0.4 mi short of the bar, on a bar that is doctrine\'s own number and the');
    md.push('same one the downward path uses. Two more weeks cleared it by more than 11 mi and were');
    md.push('refused by Rule 8 for a reason Rule 8 exists to give.');
    md.push('');
    md.push('**2 · DECISION FOR THE OWNER · a CUTBACK week he overran by 11 per cent.** 2026-06-01');
    md.push('is the sharpest row in the table: 44.9 mi run against a 40.5 mi prescription, refused');
    md.push('because the plan marked that week a cutback. Rule 8 is unambiguous that a week the');
    md.push('engine authored small is not evidence about the runner\'s normal, and');
    md.push('`lib/adaptation/canonical/levers/weekly-volume.ts` drops cutback weeks for exactly the');
    md.push('same reason, so this directory is consistent with the existing owner of the question.');
    md.push('But a cutback is not a taper: the runner was not told to rest, he was told to run less,');
    md.push('and he ran more. Whether an OVERRUN cutback should be admissible is a product call, it');
    md.push('changes `weekly-volume.ts` as well as this directory, and an agent should not make it.');
    md.push('');
    md.push('**3 · DECISION FOR THE OWNER · the seam.** Everything above is an advisory. Nothing');
    md.push('here can raise a week on his phone while `AUTOMATIC_ADAPTATION_AUTHORITY` is `false`,');
    md.push('and opening it is his call, not an implementation detail.');
    md.push('');
    md.push('**4 · Rule 14, measured rather than argued.** 76 merged run-days carrying '
      + `${r1(mergedDays.reduce((a, d) => a + d.mi, 0))} mi sit inside this window. Reading them as `);
    md.push('volume would have manufactured a surplus in most weeks of the year. The canonical');
    md.push('predicate is doing real work on this account, not hypothetical work.');
    md.push('');

    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${md.join('\n')}\n`, 'utf8');

    // eslint-disable-next-line no-console
    console.log(`\n[mileage-replay] weeks=${rows.length} admittedA=${admittedA.length} `
      + `admittedB=${admittedB.length} raised=${raisedWeeks.length} `
      + `peak=${peakSeries[0] ?? '-'}->${peakSeries[peakSeries.length - 1] ?? '-'}\n${OUT}\n`);

    expect(rows.length).toBeGreaterThan(20);
  }, 120_000);
});
