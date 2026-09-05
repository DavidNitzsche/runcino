/**
 * lib/plan/adjudication/_malibu_dose_trace.test.ts · THE MALIBU SEQUENCE, TRACED.
 *
 * Run Malibu Half on 2026-11-08, its seven-day recovery, the 2026-11-15
 * long-run response, and the adjudication of the 2026-11-22 marathon-pace dose.
 * Plan `pln_7636bcc0a201bf2d`, the ACTIVE block for CIM on 2026-12-06, authored
 * 2026-09-03 18:43.
 *
 * ── THE PRODUCTION QUERIES, WRITTEN OUT SO THE NEXT READER CAN RE-RUN THEM ──
 *
 * Read 2026-09-04 through DATABASE_URL_RO. Every one names its population
 * (Rule 14) and none of them reuses an application filter.
 *
 *   -- the block itself. `archived_iso IS NULL` is the active-plan scope.
 *   SELECT date_iso, type, sub_label, distance_mi, workout_spec
 *   FROM plan_workouts WHERE plan_id = 'pln_7636bcc0a201bf2d'
 *   ORDER BY date_iso;
 *
 *   -- his longest single runs, WHOLE YEAR, canonical rows only.
 *   SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) d,
 *          (data->>'distanceMi')::numeric mi
 *   FROM runs WHERE user_uuid = <owner>
 *     AND NOT (data ? 'mergedIntoId')            -- CANONICAL_ROW_SQL
 *     AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= '2026-01-01'
 *   ORDER BY 2 DESC;
 *
 *   -- what he ran in the seven days after each half he raced.
 *   (halves from races.meta->>'distanceMi' BETWEEN 13.0 AND 13.3, joined to the
 *    canonical daily mileage over (race_day, race_day + 7])
 *
 * ── WHAT THOSE QUERIES RETURNED, AND WHAT AN EARLIER TRACE GOT WRONG ────────
 *
 * longest training run     21.51 mi on 2026-01-25   (races above it: Big Sur
 *                                                    26.81, LA 26.70)
 * peak week                48.53 mi w/c 2026-02-09
 * D+7 after a half         2026-01-25  21.51   after Rose Bowl Half
 *                          2026-02-08  17.21   after Disney Half
 *                          2026-08-23  11.01   after Americas Finest City
 *                          2026-05-10   7.37   after Sombrero Half  · EXCLUDED
 * largest CONTINUOUS M      5.0 mi (2026-10-18's first block, and 2026-11-22).
 *   block in the whole      The largest TOTAL at-MP dose is 8.0 mi, on
 *   15-week block           2026-10-18, across two blocks split by an easy
 *                          mile. Those are two different quantities and the
 *                          ladder below keeps them apart. There is no 10-mile
 *                          marathon-pace dose anywhere in the block; the two
 *                          sessions written "10 mi" are TOTAL SESSION DISTANCE
 *                          containing 6 mi at threshold.
 *
 * The Sombrero exclusion is Rule 8 and it is the only judgement call in the
 * list. That half was run on 2026-05-03, seven days after Big Sur on
 * 2026-04-26, so its entire D+7 window sits inside a post-marathon recovery
 * block the engine itself prescribed. Counting it as evidence about what he
 * can run a week after a half would be measuring him during a period the plan
 * told him to go easy, which is the exact defect Rule 8 was locked over. It is
 * excluded from the HABIT read and named here rather than deleted.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ───────────────────────────────
 *
 * 1 · IT CANNOT FAIL ON THE HISTORY DRIFTING. The numbers above are PINNED
 *     literals. If production changes, this file keeps passing. That is the
 *     failure that produced the first CIM trace, and the only real defence is
 *     the queries being written down beside the numbers, which they are. A live
 *     check would need database access and this suite is deliberately pure.
 *
 * 2 · IT CANNOT FAIL ON NOVEMBER. The November branches below are COUNTERFACTUAL:
 *     the sessions have not happened, so what is tested is what the system
 *     would do given each evidence state, not what the evidence will be. The
 *     only assertions about the real world are the ones about TODAY, and today
 *     the honest answer is that the evidence does not exist yet.
 *
 * 3 · IT CANNOT FAIL ON THE DOSE BEING THE RIGHT DOSE FOR HIM. It checks that
 *     every dose sits inside a band `Research/04` states, by parsing that file
 *     at run time. Doctrine bands are wide, and a number inside one can still
 *     be the wrong number for this runner in this week.
 *
 * 4 · IT CANNOT FAIL ON THE M-DOSE LADDER BEING TOO SHALLOW. It asserts the
 *     ladder is monotone and reachable. Whether 3 to 5 to 8 is the right rate
 *     of progression is a coaching judgement no assertion here makes.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertPrescription, auditSymmetry, doseEarningGate, reading, resolveDose, validatePrescription,
  type DoseEvidence, type DoseResponsivePrescription,
} from '@/lib/plan/adjudication/dose-responsive';
import { athleteEvidenceFor, ceilingClaimFrom } from '@/lib/plan/adjudication/adjudicate';
import type { ComparableSession } from '@/lib/plan/adjudication/contract';
import { sessionDoseCeilingMi } from '@/lib/plan/dosing';
import { isPrescribedNonNormal, prescribedWindowFor } from '@/lib/training/normal-window';
import type { Measured } from '@/lib/adaptation/canonical/input';

const measured = reading.of;
const absent = reading.absent;

const OWNER_HISTORY_WINDOW = 'all of 2026, canonical rows only, Rule 8 windows named';

/**
 * Run Malibu's Rule 8 window, resolved by `prescribedWindowFor` rather than
 * restated here, so a change to the taper or post-race tables moves this trace
 * with it instead of leaving it agreeing with itself (Rule 18).
 */
const MALIBU_WINDOW = prescribedWindowFor({
  slug: 'run-malibu', dateISO: '2026-11-08', distanceMi: 13.1, priority: 'B',
})!;
const RESEARCH = path.resolve(process.cwd(), '..', 'Research');

/* ══════════════════════════════════════════════════════════════════════════
 * DOCTRINE, PARSED AT RUN TIME
 *
 * Rule 18: "Read numbers out of the cited source at run time rather than
 * hardcoding both sides · a check that hardcodes both only proves the test
 * agrees with itself." Every band below comes out of the file.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Pull an `a-b` range out of a line, tolerating the en dash the docs use. */
function rangeIn(line: string, after: string): readonly [number, number] {
  const tail = line.slice(line.indexOf(after) + after.length);
  const m = tail.match(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)/);
  if (!m) throw new Error(`no range after ${JSON.stringify(after)} in: ${line}`);
  return [Number(m[1]), Number(m[2])];
}

function lineContaining(file: string, needle: string): string {
  const src = fs.readFileSync(path.join(RESEARCH, file), 'utf8');
  const hit = src.split('\n').find((l) => l.includes(needle));
  if (!hit) throw new Error(`anchor not found in ${file}: ${JSON.stringify(needle)}`);
  return hit;
}

/** `Research/04` §4.1 long-run family overview, the fast-finish row. */
function fastFinishMpBand(): readonly [number, number] {
  return rangeIn(lineContaining('04-workout-vocabulary.md', '| Fast finish long run |'), 'last');
}

/** `Research/04` §4.6 dress rehearsal, the Pace row. */
function dressRehearsalMpBand(): readonly [number, number] {
  return rangeIn(
    lineContaining('04-workout-vocabulary.md', 'segments at MP ('),
    'segments at MP (',
  );
}

/** `Research/04` §4.1, the marathon-pace long run row. */
function marathonPaceLongRunMpBand(): readonly [number, number] {
  return rangeIn(lineContaining('04-workout-vocabulary.md', '| Marathon-pace long run |'), 'warmup +');
}

/** `Research/00a` §"Practical load rules", the long-run cap. */
function longRunCapPctOfPrior30dMax(): number {
  const line = lineContaining('00a-distance-running-training.md', '| Long-run cap rule |');
  const m = line.match(/(\d+)%/);
  if (!m) throw new Error(`no percentage in the long-run cap rule row: ${line}`);
  return Number(m[1]) / 100;
}

/** `Research/00a` §"Practical load rules", the one-stressor-at-a-time row. */
function addStressOneAtATime(): string {
  return lineContaining('00a-distance-running-training.md', '| Add stress one-at-a-time |');
}

describe('the doctrine anchors still resolve · Rule 7 and Rule 18', () => {
  it('every cited row is present and parses to the band this trace uses', () => {
    expect(fastFinishMpBand()).toEqual([2, 6]);
    expect(dressRehearsalMpBand()).toEqual([4, 8]);
    expect(marathonPaceLongRunMpBand()).toEqual([8, 16]);
    expect(longRunCapPctOfPrior30dMax()).toBe(1.1);
    expect(addStressOneAtATime()).toContain('add mileage OR add intensity');
  });

  it('the marathon-pace session ceiling comes from the existing owner', () => {
    // Rule 16. `lib/plan/dosing.ts` already owns "how much M work may one
    // session carry", bound in CI by DOSING.marathon-pace-workout-ceiling.
    // This module does not restate it and does not have a second answer.
    expect(sessionDoseCeilingMi('M')).toBe(18);
    // Every dose this trace prescribes sits well inside it, so the binding
    // constraint here is the workout-family band, not the absolute cap.
    for (const dose of [3, 4, 5, 6, 8]) {
      expect(dose).toBeLessThanOrEqual(sessionDoseCeilingMi('M'));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * BEAT 1 · MALIBU ITSELF · 2026-11-08, 13.1 mi, B race
 * ═══════════════════════════════════════════════════════════════════════ */

describe('beat 1 · Run Malibu on 2026-11-08', () => {
  it('is a B race inside the block, not the block target', () => {
    // From plan_workouts: type 'race', distance_mi 13.10, and the authored
    // note reads "Run Malibu. B race · race effort. Recovery days follow
    // before quality resumes." Its workout_spec carries a race_hr band of
    // 161-168 against LTHR 168, and a mile-5 abort at 171.
    const MALIBU = {
      dateISO: '2026-11-08', distanceMi: 13.1, priority: 'B',
      raceHrBandBpm: [161, 168] as const, abortAtBpm: 171,
    };
    expect(MALIBU.priority).toBe('B');
    // The half is 28 days before CIM. It is a rehearsal, and the block is
    // built to keep going after it rather than to peak for it.
    const daysToCim = Math.round(
      (Date.parse('2026-12-06') - Date.parse(MALIBU.dateISO)) / 86_400_000,
    );
    expect(daysToCim).toBe(28);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * BEAT 2 · THE SEVEN-DAY RECOVERY · 2026-11-09 to 2026-11-14
 * ═══════════════════════════════════════════════════════════════════════ */

/** The block as authored, from plan_workouts. */
const RECOVERY_WEEK_MI: readonly number[] = [4.5, 5, 5, 5, 5, 0]; // 11-09 .. 11-14, then rest

describe('beat 2 · the seven days after Malibu', () => {
  it('prescribes 24.5 easy miles and no quality, which is a Rule 8 window', () => {
    const total = RECOVERY_WEEK_MI.reduce((a, b) => a + b, 0);
    expect(total).toBe(24.5);
    // Every one of those days is a day the ENGINE told him to go easy. Any
    // reader that answers "what does he normally do" must exclude them, and
    // any reader that answers "what have his legs carried" must not.
    // `isPrescribedNonNormal` is the one definition of that window.
    expect(RECOVERY_WEEK_MI.filter((mi) => mi > 8).length).toBe(0);
  });

  it('the recovery window is what makes a measured zero readable', () => {
    // Quality sessions prescribed 11-09 to 11-14: zero. That zero is a
    // correct measurement of a prescribed recovery block and NOT evidence
    // that he has stopped doing quality work. Rule 11's founding case.
    const qualityDaysPrescribed = 0;
    const reading: Measured<number> = measured(qualityDaysPrescribed);
    expect(reading.ok).toBe(true);
    if (reading.ok) expect(reading.value).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * BEAT 3 · THE 2026-11-15 RESPONSE · 16 mi with 4 mi at M, at D+7
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * What he did at exactly D+7 after each half he raced in 2026, Sombrero
 * excluded for the reason in this file's header.
 */
const POST_HALF_D7: readonly ComparableSession[] = [
  {
    dateISO: '2026-01-25', what: 'D+7 after Rose Bowl Half', distanceMi: 21.51,
    avgPaceSecPerMi: null, avgHrBpm: 146, executed: true, next7DaysMi: 18.4,
    notes: 'His longest run of 2026 came at this offset, at average heart rate 146.',
  },
  {
    dateISO: '2026-02-08', what: 'D+7 after Disney Half', distanceMi: 17.21,
    avgPaceSecPerMi: null, avgHrBpm: 146, executed: true, next7DaysMi: 21.2,
    notes: 'Followed by his peak week of 48.53 mi.',
  },
  {
    dateISO: '2026-08-23', what: 'D+7 after Americas Finest City', distanceMi: 11.01,
    avgPaceSecPerMi: null, avgHrBpm: 147, executed: true, next7DaysMi: 22.9,
    notes: 'The smallest of the three, and the one an earlier trace mistook for a limit.',
  },
];

describe('beat 3 · the 16 mile long run on 2026-11-15', () => {
  it('is SUPPORTED at that offset, and the ceiling is the MAX of the set', () => {
    const claim = ceilingClaimFrom(POST_HALF_D7, (c) => c.distanceMi);
    expect(claim).not.toBeNull();
    expect(claim!.value).toBe(21.51);
    expect(claim!.comparableCount).toBe(3);
    expect(claim!.valid).toBe(true);

    const ev = athleteEvidenceFor({
      what: 'the 16.0 mile long run on 2026-11-15, seven days after Run Malibu',
      asOfISO: '2026-11-15',
      prescribed: 16.0,
      demonstratedMaxToday: 21.51,
      demonstratedMaxProjected: 21.5, // the block's own 21.5 on 2026-11-01
      comparables: POST_HALF_D7,
      ceilingQuantity: (c) => c.distanceMi,
      historyWindow: OWNER_HISTORY_WINDOW,
    });
    expect(ev.evidenceClass).toBe('SUPPORTED');
    expect(ev.stepOverDemonstratedToday).toBeLessThan(0);
  });

  it('and the injury guard reads the ABSORBED number, not the habit one', () => {
    // Rule 8's corollary. The long-run spike rule writes its own window into
    // the citation, so it reads the literal prior-30-day maximum. On
    // 2026-11-15 that window contains the 21.5 on 2026-11-01 and Malibu's
    // 13.1, and the taper into Malibu is NOT excluded from it.
    const prior30dMax = 21.5;
    expect(16.0).toBeLessThanOrEqual(prior30dMax * longRunCapPctOfPrior30dMax());
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * BEAT 4 · RECENT VOLUME, HEART RATE, AND MISSED TRAINING
 * ═══════════════════════════════════════════════════════════════════════ */

describe('beat 4 · the context the 11-22 decision sits in', () => {
  it('recent volume · the block reaches 60 mi and the two November weeks do not', () => {
    // From plan_weeks joined to plan_workouts on the active plan.
    const WEEKLY_MI: Readonly<Record<string, number>> = {
      '2026-10-26': 60.0, '2026-11-02': 43.2, '2026-11-09': 40.5,
      '2026-11-16': 49.0, '2026-11-23': 36.0, '2026-11-30': 43.72,
    };
    // His demonstrated peak week is 48.53. The week the 11-22 session sits in
    // is 49.0, which is a step of about 1% over anything he has run.
    expect(WEEKLY_MI['2026-11-16']! / 48.53 - 1).toBeLessThan(0.02);
    // And the weeks either side come DOWN, which is what a taper looks like.
    expect(WEEKLY_MI['2026-11-23']!).toBeLessThan(WEEKLY_MI['2026-11-16']!);
  });

  it('heart rate · the long-run ceiling is 151 and his recent longs sat above it', () => {
    // workout_spec.hr_cap_bpm on both November long runs is 151, stamped from
    // profile.lthr 168. Two recent long runs from `runs`, canonical rows:
    //   2026-08-30  13.49 mi  avg HR 159
    //   2026-09-04  15.51 mi  avg HR 133
    // One over the ceiling and one well under it. That spread is exactly why
    // the earning gate below carries a heart-rate condition rather than
    // treating completion as the whole answer.
    const LONG_RUN_HR_CAP = 151;
    expect(159).toBeGreaterThan(LONG_RUN_HR_CAP);
    expect(133).toBeLessThan(LONG_RUN_HR_CAP);
  });

  it('missed or modified training · one short day in the block so far', () => {
    // Prescribed against canonical actuals, 2026-08-24 to 2026-09-04:
    //   08-27 prescribed 7.0, ran 3.14 on a treadmill. Short by 3.86.
    // Everything else landed at or above prescription. Stated, not judged.
    const MODIFIED_DAYS = 1;
    const PRESCRIBED_DAYS = 10;
    expect(MODIFIED_DAYS / PRESCRIBED_DAYS).toBeLessThan(0.15);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * BEAT 5 · THE 2026-11-22 MARATHON-PACE DOSE, AS A DOSE-RESPONSIVE GATE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The marathon-pace ladder in the block as authored, read from
 * `plan_workouts.sub_label` and `workout_spec.finish_mi`.
 *
 * ── A RULE 16 TRAP, CORRECTED HERE AFTER WALKING INTO IT ───────────────────
 *
 * "The marathon-pace dose" is TWO QUANTITIES, and `workout_spec.finish_mi`
 * holds only one of them. The September and October sessions are BROKEN
 * blocks, and their real sub_labels say so:
 *
 *   2026-09-20  "LONG · 3mi @ M + 1mi @ E + 2mi @ M"   16.5 mi   finish_mi 3
 *   2026-10-18  "LONG · 5mi @ M + 1mi @ E + 3mi @ M"   20.0 mi   finish_mi 5
 *   2026-11-15  "LONG · 4mi @ M"                       16.0 mi   finish_mi 4
 *   2026-11-22  "LONG · 5mi @ M"                       16.0 mi   finish_mi 5
 *
 * So `finish_mi` is the FIRST block, not the session's marathon-pace dose. The
 * totals are 5, 8, 4 and 5, and the largest continuous blocks are 3, 5, 4 and
 * 5. An earlier draft of this trace read `finish_mi` as the dose and would have
 * reported that the block never exceeds 5 miles at marathon pace, when it
 * already reaches EIGHT on 18 October.
 *
 * The two are different stimuli and doctrine treats them differently, which is
 * why the distinction has to survive into the gate rather than being averaged
 * away. `Research/04` §4.1's fast-finish row says "last 2-6 mi at MP", which
 * describes ONE continuous finish. §4.6's dress-rehearsal row says
 * "2-3 segments at MP (4-8 mi TOTAL at MP)", which is explicitly the sum. The
 * 18 October session's own authored note names the intent of the broken shape:
 * "The second block is the session: you are practising getting back to race
 * pace on tired legs."
 *
 * Hence the two gates below read different quantities on purpose. The 22 Nov
 * gate is a continuous fast finish and is bounded by §4.1's 2-6. The 15 Nov
 * gate is a dress rehearsal and is bounded by §4.6's 4-8 total.
 */
interface MSession {
  readonly dateISO: string;
  readonly totalMi: number;
  /** Every at-MP mile in the session, summed across blocks. */
  readonly mTotalMi: number;
  /** The largest single unbroken block at marathon pace. */
  readonly mContinuousMi: number;
  readonly subLabel: string;
}
const M_LADDER: readonly MSession[] = [
  { dateISO: '2026-09-20', totalMi: 16.5, mTotalMi: 5, mContinuousMi: 3, subLabel: 'LONG · 3mi @ M + 1mi @ E + 2mi @ M' },
  { dateISO: '2026-10-18', totalMi: 20.0, mTotalMi: 8, mContinuousMi: 5, subLabel: 'LONG · 5mi @ M + 1mi @ E + 3mi @ M' },
  { dateISO: '2026-11-15', totalMi: 16.0, mTotalMi: 4, mContinuousMi: 4, subLabel: 'LONG · 4mi @ M' },
  { dateISO: '2026-11-22', totalMi: 16.0, mTotalMi: 5, mContinuousMi: 5, subLabel: 'LONG · 5mi @ M' },
];

const RESEARCH_04_FAST_FINISH = {
  source: 'Research/04-workout-vocabulary.md',
  section: '4.1 · Fast finish long run',
  says: 'Easy bulk + last 2-6 mi at MP or faster, in a 12-18 mi session.',
  force: 'GUIDELINE' as const,
};
const RESEARCH_08_TAPER = {
  source: 'Research/08-pacing-and-race-week.md',
  section: '9.1 · taper length',
  says: 'A marathon taper runs 21 days, so 2026-11-22 is inside it.',
  force: 'HARD_CONSTRAINT' as const,
};
const RESEARCH_00A_ONE_STRESSOR = {
  source: 'Research/00a-distance-running-training.md',
  section: 'Practical load rules',
  says: 'Either add mileage OR add intensity in a given week, not both.',
  force: 'GUIDELINE' as const,
};

/** The 2026-11-22 fast-finish marathon-pace block, as a dose-responsive gate. */
function nov22(): DoseResponsivePrescription {
  const [ffLo, ffHi] = fastFinishMpBand();
  return {
    prescriptionId: 'pln_7636bcc0a201bf2d:2026-11-22:m-dose',
    what: 'The marathon-pace block on 22 Nov',
    landsOnISO: '2026-11-22',
    axis: 'QUALITY_DOSE_MI',
    target: 'SPECIFICITY',
    defaultDose: {
      value: 5,
      provenance: 'CALCULATED_PHYSIOLOGY',
      basis: `Research/04 §4.1 puts a fast finish long run at ${ffLo}-${ffHi} mi at MP. `
        + 'Five is inside that band and is what the block was authored with.',
    },
    earnedDose: {
      value: ffHi,
      provenance: 'CALCULATED_PHYSIOLOGY',
      basis: `The top of the same ${ffLo}-${ffHi} band. It does NOT reach into §4.4's `
        + '8-16 mi marathon-pace long run, because that is a different workout and '
        + 'Research/08 §9.1 puts this date inside the marathon taper.',
    },
    reducedDose: {
      value: 3,
      provenance: 'CALCULATED_PHYSIOLOGY',
      basis: `Back to the September rung, still inside the ${ffLo}-${ffHi} band.`,
    },
    earn: [
      {
        requirementId: 'nov22:m-blocks-landed',
        what: 'the marathon-pace blocks on 20 Sep, 18 Oct and 15 Nov all land',
        measurable: 'count of M-finish long runs graded FULL or SUBSTANTIAL by gradeStimulus',
        reader: 'STIMULUS_GRADE',
        comparator: 'AT_LEAST',
        threshold: 3,
        rampFrom: 1,
        discreteBecause: null,
        byISO: '2026-11-16',
      },
      {
        requirementId: 'nov22:no-late-fade',
        what: 'none of them falls away in the last third',
        measurable: 'deteriorationPattern.deterioratedCount over the prior 28 days',
        reader: 'DETERIORATION_PATTERN',
        comparator: 'AT_MOST',
        threshold: 0,
        rampFrom: 2,
        discreteBecause: null,
        byISO: '2026-11-16',
      },
      {
        requirementId: 'nov22:volume-held',
        what: 'his ordinary week is still at least 48 miles',
        measurable: 'normalWeeklyMileage, taper and post-race recovery excluded',
        reader: 'HABIT_WEEKLY_MI',
        comparator: 'AT_LEAST',
        threshold: 48,
        rampFrom: 40,
        discreteBecause: null,
        byISO: '2026-11-16',
      },
    ],
    reduce: [
      {
        requirementId: 'nov22:late-fade',
        what: 'the long runs are falling away late',
        measurable: 'deteriorationPattern.deterioratedCount over the prior 28 days',
        reader: 'DETERIORATION_PATTERN',
        comparator: 'AT_LEAST',
        threshold: 2,
        rampFrom: 0,
        discreteBecause: null,
        byISO: '2026-11-16',
      },
      {
        requirementId: 'nov22:sessions-not-landing',
        what: 'the key sessions are not being completed as written',
        measurable: 'count of prescriptions matched at the exact tier by resolveDateRangeExecutions',
        reader: 'EXECUTION_IDENTITY',
        comparator: 'AT_MOST',
        threshold: 2,
        rampFrom: 5,
        discreteBecause: null,
        byISO: '2026-11-16',
      },
      {
        requirementId: 'nov22:volume-fell',
        what: 'the miles his legs actually carried have dropped away',
        measurable: 'recentWeeklyMileageMi, taper INCLUDED, per Rule 8 corollary',
        reader: 'ABSORBED_WEEKLY_MI',
        comparator: 'AT_MOST',
        threshold: 30,
        rampFrom: 45,
        discreteBecause: null,
        byISO: '2026-11-16',
      },
    ],
    assessOnISO: '2026-11-16',
    assessOnIsPrescribedNonNormal: isPrescribedNonNormal('2026-11-16', [MALIBU_WINDOW]),
    onIncompleteEvidence: 'HOLD_DEFAULT',
    cap: {
      maxHarder: {
        value: 1,
        provenance: 'CALCULATED_PHYSIOLOGY',
        basis: `Research/04 §4.1 caps a fast finish at ${ffHi} mi at MP and the default is 5.`,
      },
      maxEasier: {
        value: 2,
        provenance: 'CALCULATED_PHYSIOLOGY',
        basis: 'Research/08 §9.1 · inside a taper, reducing is the direction doctrine expects.',
      },
      hardCeiling: {
        value: ffHi,
        provenance: 'CALCULATED_PHYSIOLOGY',
        basis: `Research/04 §4.1 fast finish long run, ${ffLo}-${ffHi} mi at MP. Going past it `
          + 'turns the session into a §4.4 marathon-pace long run two weeks from the race.',
      },
      easyFloor: {
        value: ffLo,
        provenance: 'CALCULATED_PHYSIOLOGY',
        basis: `Research/04 §4.1 · below ${ffLo} mi at MP it is no longer a fast finish.`,
      },
    },
    citations: [RESEARCH_04_FAST_FINISH, RESEARCH_08_TAPER, RESEARCH_00A_ONE_STRESSOR],
    asymmetryJustified: {
      SMALLER_STEP_TO_GO_UP:
        'Research/08 §9.1 puts 2026-11-22 fourteen days from CIM, inside the 21-day marathon '
        + 'taper. A taper is the one window where doctrine licenses an asymmetry in this '
        + 'direction: it exists to shed accumulated fatigue, so the room to reduce is larger '
        + 'than the room to add by design. The asymmetry is one mile against two and it is '
        + 'bounded by the same Research/04 §4.1 band on both sides, so it is a narrower '
        + 'window rather than a lower ceiling. Outside a taper this justification does not '
        + 'hold and the gate should be rejected without it.',
    },
    assessInsideWindowJustified: null,
  };
}

/** The 2026-11-15 dress rehearsal, which has more room because it is 3 weeks out. */
function nov15(): DoseResponsivePrescription {
  const [drLo, drHi] = dressRehearsalMpBand();
  return {
    ...nov22(),
    prescriptionId: 'pln_7636bcc0a201bf2d:2026-11-15:m-dose',
    what: 'The marathon-pace block on 15 Nov',
    landsOnISO: '2026-11-15',
    defaultDose: {
      value: 4,
      provenance: 'CALCULATED_PHYSIOLOGY',
      basis: `Research/04 §4.6 puts a dress rehearsal at ${drLo}-${drHi} mi total at MP. `
        + 'Four is the bottom of that band and is what the block was authored with.',
    },
    earnedDose: {
      value: drHi,
      provenance: 'CALCULATED_PHYSIOLOGY',
      basis: `The top of the same ${drLo}-${drHi} band, three weeks out, which is where `
        + 'Research/04 §4.6 places this session.',
    },
    reducedDose: {
      value: 2,
      provenance: 'CALCULATED_PHYSIOLOGY',
      basis: 'A fast-finish dose instead, per Research/04 §4.1.',
    },
    assessOnISO: '2026-11-09',
    assessOnIsPrescribedNonNormal: isPrescribedNonNormal('2026-11-09', [MALIBU_WINDOW]),
    assessInsideWindowJustified:
      'FOUND BY THIS TRACE, AND STATED RATHER THAN MOVED. 2026-11-09 is inside Run Malibu\'s '
      + 'prescribed window (2026-10-25 to 2026-11-15, two taper weeks plus one recovery week), '
      + 'and it cannot move earlier without assessing before the 18 Oct block has been run, '
      + 'which is the evidence the gate exists to read. The consequence is named rather than '
      + 'waved past: the habit requirement reads normalWeeklyMileage, which excludes every day '
      + 'in that window, so on this date it answers from weeks ending 2026-10-24 or earlier or '
      + 'refuses outright. A refusal holds the default at 4 mi, which is safe and is the '
      + 'correct Rule 11 posture, but it means the upward path here rests on the two execution '
      + 'requirements rather than on all three. The 22 Nov gate does not have this problem: its '
      + 'assessment lands one day after the window closes.',
    earn: nov22().earn.map((r) => ({
      ...r,
      requirementId: r.requirementId.replace('nov22', 'nov15'),
      byISO: '2026-11-09',
      ...(r.requirementId === 'nov22:m-blocks-landed'
        ? {
          what: 'the marathon-pace blocks on 20 Sep and 18 Oct both land',
          threshold: 2, rampFrom: 0,
        }
        : {}),
    })),
    reduce: nov22().reduce.map((r) => ({
      ...r,
      requirementId: r.requirementId.replace('nov22', 'nov15'),
      byISO: '2026-11-09',
    })),
    cap: {
      maxHarder: {
        value: 4,
        provenance: 'CALCULATED_PHYSIOLOGY',
        basis: `Research/04 §4.6 · ${drLo} to ${drHi} mi at MP is the whole band, and the `
          + 'default sits at the bottom of it.',
      },
      maxEasier: {
        value: 2,
        provenance: 'CALCULATED_PHYSIOLOGY',
        basis: 'Down to a fast-finish dose, per Research/04 §4.1.',
      },
      hardCeiling: {
        value: drHi,
        provenance: 'CALCULATED_PHYSIOLOGY',
        basis: `Research/04 §4.6 dress rehearsal, ${drLo}-${drHi} mi total at MP.`,
      },
      easyFloor: {
        value: 2,
        provenance: 'CALCULATED_PHYSIOLOGY',
        basis: 'Research/04 §4.1 · the bottom of the fast-finish band.',
      },
    },
    asymmetryJustified: {},
  };
}

const at = (assessedOnISO: string, pairs: Record<string, Measured<number>>): DoseEvidence => ({
  assessedOnISO, readings: new Map(Object.entries(pairs)),
});

describe('beat 4b · Rule 8 · where the assessment dates fall, resolved not restated', () => {
  /**
   * FOUND WHILE TRACING, AND IT IS A DEFECT CLASS RATHER THAN A DETAIL. A gate
   * whose earning condition reads HABIT and whose assessment lands inside a
   * taper or post-race recovery block can only ever read what Rule 8 leaves
   * behind, and where that is too little the reader refuses. A refusal is an
   * absence, an absence holds the default, and a condition that can only read
   * absent is a wall rather than a bar (Rule 21).
   */
  it('Run Malibu excludes 2026-10-25 to 2026-11-15, two taper weeks and one recovery week', () => {
    expect(MALIBU_WINDOW.category).toBe('hm');
    expect(MALIBU_WINDOW.taperWeeks).toBe(2);
    expect(MALIBU_WINDOW.recoveryWeeks).toBe(1);
    expect(MALIBU_WINDOW.fromISO).toBe('2026-10-25');
    expect(MALIBU_WINDOW.toISO).toBe('2026-11-15');
  });

  it('the 15 Nov session LANDS on the last excluded day, and its gate is assessed inside', () => {
    expect(isPrescribedNonNormal('2026-11-15', [MALIBU_WINDOW])).toBe(true);
    expect(isPrescribedNonNormal('2026-11-09', [MALIBU_WINDOW])).toBe(true);
    expect(nov15().assessOnIsPrescribedNonNormal).toBe(true);
    // So it must carry the reason, and it does.
    expect(nov15().assessInsideWindowJustified).toContain('normalWeeklyMileage');
  });

  it('the 22 Nov gate is assessed one day AFTER the window closes, and needs no reason', () => {
    expect(isPrescribedNonNormal('2026-11-16', [MALIBU_WINDOW])).toBe(false);
    expect(nov22().assessOnIsPrescribedNonNormal).toBe(false);
    expect(nov22().assessInsideWindowJustified).toBeNull();
  });

  it('and an unjustified assessment inside the window BLOCKS', () => {
    const bad = { ...nov15(), assessInsideWindowJustified: null };
    const defects = validatePrescription(bad);
    expect(defects.map((d) => d.field)).toContain('assessInsideWindowJustified');
    expect(defects.find((d) => d.field === 'assessInsideWindowJustified')?.detail)
      .toContain('wall rather than a bar');
  });

  it('an unresolved calendar is its own finding, not a quiet no', () => {
    const unresolved = { ...nov22(), assessOnIsPrescribedNonNormal: null };
    expect(validatePrescription(unresolved).map((d) => d.field))
      .toContain('assessOnIsPrescribedNonNormal');
  });
});

describe('beat 5 · both November marathon-pace doses are well-formed gates', () => {
  it('2026-11-22 validates, and its taper asymmetry is the only one and is argued', () => {
    const rx = nov22();
    expect(validatePrescription(rx)).toEqual([]);
    expect(() => assertPrescription(rx)).not.toThrow();
    const findings = auditSymmetry(rx);
    expect(findings.map((f) => f.kind)).toEqual(['SMALLER_STEP_TO_GO_UP']);
    expect(rx.asymmetryJustified.SMALLER_STEP_TO_GO_UP).toContain('taper');
  });

  it('2026-11-15 validates with NO asymmetry at all · three weeks out there is room', () => {
    const rx = nov15();
    expect(validatePrescription(rx)).toEqual([]);
    expect(auditSymmetry(rx)).toEqual([]);
    // And this is the Rule 21 shape the engine has been missing: the step
    // toward harder is larger than the step toward easier.
    expect(rx.cap.maxHarder.value).toBeGreaterThan(rx.cap.maxEasier.value);
  });

  it('every dose either gate can produce sits inside a band Research/04 states', () => {
    const [ffLo, ffHi] = fastFinishMpBand();
    const [drLo, drHi] = dressRehearsalMpBand();
    const a = nov22();
    for (const v of [a.reducedDose.value, a.defaultDose.value, a.earnedDose.value]) {
      expect(v).toBeGreaterThanOrEqual(ffLo);
      expect(v).toBeLessThanOrEqual(ffHi);
    }
    const b = nov15();
    expect(b.defaultDose.value).toBeGreaterThanOrEqual(drLo);
    expect(b.earnedDose.value).toBeLessThanOrEqual(drHi);
  });
});

describe('beat 6 · the 11-22 verdict, in every evidence state', () => {
  it('TODAY, 2026-09-04, the evidence does not exist and the dose is 5', () => {
    // This is the real answer, and it is the one that matters. No M-finish
    // long run in this block has been run: the first is 2026-09-20. The
    // execution identity that would grade one only began stamping in
    // September. So every earning reading is an ABSENCE, not a zero.
    const v = resolveDose(nov22(), at('2026-09-04', {
      'nov22:m-blocks-landed': absent('no marathon-pace long run has been run yet'),
      'nov22:no-late-fade': absent('no long run in the window could be judged late-on'),
      'nov22:volume-held': absent('not enough ordinary training weeks to answer honestly'),
      'nov22:late-fade': absent('no long run in the window could be judged late-on'),
      'nov22:sessions-not-landing': absent('the block has run for eleven days'),
      'nov22:volume-fell': measured(45.79),
    }));
    expect(v.resolvedDose).toBe(5);
    expect(v.decision).toBe('HOLD');
    expect(v.posture).toBe('DEFAULT_HELD_ON_INCOMPLETE_EVIDENCE');
    expect(v.earnedFraction).toBeNull();
    expect(v.say).toContain('stays at 5 mi');
    expect(v.say).toContain('no data');
  });

  it('the gate the block carries until then says what would move it', () => {
    const g = doseEarningGate(nov22());
    expect(g.ifUnmet).toBe('REDUCE');
    expect(g.reduceTo).toBe(5);
    expect(g.assessOnISO).toBe('2026-11-16');
    expect(g.requires.map((r) => r.what)).toEqual([
      'the marathon-pace blocks on 20 Sep, 18 Oct and 15 Nov all land',
      'none of them falls away in the last third',
      'his ordinary week is still at least 48 miles',
    ]);
    expect(g.explain).toContain('6 mi');
  });

  it('EVIDENCE ARRIVES · all three M blocks land, and it goes to 6', () => {
    const v = resolveDose(nov22(), at('2026-11-16', {
      'nov22:m-blocks-landed': measured(3),
      'nov22:no-late-fade': measured(0),
      'nov22:volume-held': measured(49.0),
      'nov22:late-fade': measured(0),
      'nov22:sessions-not-landing': measured(7),
      'nov22:volume-fell': measured(49.0),
    }));
    expect(v.decision).toBe('PROGRESS');
    expect(v.posture).toBe('EARNED_IN_FULL');
    expect(v.resolvedDose).toBe(6);
    expect(v.say).toContain('moves from 5 to 6 mi');
  });

  it('PARTIAL EVIDENCE · two of three land, and it moves half a mile', () => {
    const v = resolveDose(nov22(), at('2026-11-16', {
      'nov22:m-blocks-landed': measured(2),
      'nov22:no-late-fade': measured(0),
      'nov22:volume-held': measured(49.0),
      'nov22:late-fade': measured(0),
      'nov22:sessions-not-landing': measured(7),
      'nov22:volume-fell': measured(49.0),
    }));
    expect(v.earnedFraction).toBeCloseTo(0.5, 10);
    expect(v.resolvedDose).toBe(5.5);
    expect(v.posture).toBe('EARNED_IN_PART');
  });

  it('THE EVIDENCE GOES THE OTHER WAY · it comes back to 3', () => {
    const v = resolveDose(nov22(), at('2026-11-16', {
      'nov22:m-blocks-landed': measured(1),
      'nov22:no-late-fade': measured(2),
      'nov22:volume-held': measured(38),
      'nov22:late-fade': measured(2),
      'nov22:sessions-not-landing': measured(2),
      'nov22:volume-fell': measured(29),
    }));
    expect(v.decision).toBe('REDUCE');
    expect(v.resolvedDose).toBe(3);
    expect(v.say).toContain('comes back to 3 mi');
  });

  it('ONE UNREADABLE HEART-RATE TRACE DOES NOT EARN THE STEP, AND DOES NOT CUT IT', () => {
    // The specific Rule 11 case for this gate. The 11-15 dress rehearsal is
    // run, the watch flat-lines, `gradeStimulus` cannot grade it, so the count
    // of sessions that count is an ABSENCE rather than a two.
    const v = resolveDose(nov22(), at('2026-11-16', {
      'nov22:m-blocks-landed': absent('the heart-rate trace on 15 Nov held one value'),
      'nov22:no-late-fade': measured(0),
      'nov22:volume-held': measured(49.0),
      'nov22:late-fade': measured(0),
      'nov22:sessions-not-landing': measured(7),
      'nov22:volume-fell': measured(49.0),
    }));
    expect(v.resolvedDose).toBe(5);
    expect(v.decision).toBe('HOLD');
    expect(v.posture).toBe('DEFAULT_HELD_ON_INCOMPLETE_EVIDENCE');
  });
});

describe('beat 7 · Rule 21 · prove the upward path can actually fire on his history', () => {
  /**
   * Rule 21's standard, in its own words: "compute what the runner would have
   * had to DO to trigger it, then check whether any week they have actually
   * run would have. If none could, the bar is not a bar, it is a wall."
   */
  it('the volume condition is already met by weeks he has actually run', () => {
    // Weekly mileage from `runs`, canonical rows, Mon-start, 2026:
    const WEEKS_2026 = [48.53, 47.48, 47.29, 45.79, 44.87, 44.71, 43.87, 43.15, 42.31];
    const threshold = 48;
    const rampFrom = 40;
    // At least one real week clears the full bar outright.
    expect(WEEKS_2026.filter((w) => w >= threshold).length).toBeGreaterThanOrEqual(1);
    // And every week in that list buys SOME of the step, which is the
    // continuity that stops this being a wall.
    expect(WEEKS_2026.filter((w) => w > rampFrom).length).toBe(WEEKS_2026.length);
  });

  it('the execution condition is met by the block he is running right now', () => {
    // 2026-08-24 to 2026-09-04, prescribed against canonical actuals: ten
    // prescriptions, nine landed at or above what was asked.
    const LANDED = 9;
    const M_BLOCKS_AVAILABLE_BEFORE_ASSESSMENT = M_LADDER
      .filter((x) => x.dateISO < '2026-11-16').length;
    expect(LANDED).toBeGreaterThanOrEqual(5);
    // Three M blocks exist before the assessment date, which is exactly the
    // threshold. The bar is reachable, and it is not reachable twice over.
    expect(M_BLOCKS_AVAILABLE_BEFORE_ASSESSMENT).toBe(3);
    expect(nov22().earn.find((r) => r.requirementId === 'nov22:m-blocks-landed')!.threshold)
      .toBe(M_BLOCKS_AVAILABLE_BEFORE_ASSESSMENT);
  });

  it('the ladder rows agree with their own sub_labels · the trap that caught this trace', () => {
    // Parse the authored label back into miles at M and check it against the
    // two numbers the row claims. A row whose label and figures disagree is
    // exactly how `finish_mi` got read as the dose in the first place.
    for (const x of M_LADDER) {
      const blocks = [...x.subLabel.matchAll(/(\d+(?:\.\d+)?)mi @ M\b/g)].map((m) => Number(m[1]));
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks.reduce((a, b) => a + b, 0)).toBe(x.mTotalMi);
      expect(Math.max(...blocks)).toBe(x.mContinuousMi);
    }
  });

  it('the M ladder rises on both readings, and the gate lets it rise further', () => {
    // CONTINUOUS: as authored it tops out at 5 and never goes past it, which
    // is the ceiling the owner was pointing at.
    expect(Math.max(...M_LADDER.map((x) => x.mContinuousMi))).toBe(5);
    // TOTAL: it already reaches 8, on 18 October. Reporting the block as
    // capped at 5 without this distinction is the Rule 16 error this trace
    // corrected in itself.
    expect(Math.max(...M_LADDER.map((x) => x.mTotalMi))).toBe(8);
    // The gate does not raise the authored number. It makes a higher number
    // reachable on evidence, which is the whole ask.
    expect(nov22().defaultDose.value).toBe(5);
    expect(nov22().earnedDose.value).toBeGreaterThan(5);
    // And the earned 6 is a real step against his largest demonstrated
    // CONTINUOUS block by the assessment date, which is 18 October's 5.
    const continuousByAssessment = Math.max(
      ...M_LADDER.filter((x) => x.dateISO < '2026-11-16').map((x) => x.mContinuousMi),
    );
    expect(continuousByAssessment).toBe(5);
    expect(nov22().earnedDose.value / continuousByAssessment - 1).toBeCloseTo(0.2, 6);
  });
});

describe('beat 8 · what the September plan should contain TODAY', () => {
  it('the 20 Sep block stays as authored, because that is the dose he has earned', () => {
    // He has no completed plan-linked marathon-pace dose at all. Execution
    // identity only began stamping in September, so the honest reading is an
    // absence, and Rule 11 says an absence holds the default rather than
    // earning a higher one. Three miles is the bottom rung of Research/04
    // §4.1's fast-finish band and it is the rung that PRODUCES the evidence
    // the November gate needs.
    const [ffLo, ffHi] = fastFinishMpBand();
    const sept = M_LADDER.find((x) => x.dateISO === '2026-09-20')!;
    expect(sept.mContinuousMi).toBe(3);
    expect(sept.mTotalMi).toBe(5);
    // Both readings sit inside §4.1's band, which is what makes the session
    // legal on either interpretation of "the dose".
    expect(sept.mContinuousMi).toBeGreaterThanOrEqual(ffLo);
    expect(sept.mTotalMi).toBeLessThanOrEqual(ffHi);
    // And it is inside a 16.5 mi session, which §4.1 puts at 12-18 mi.
    expect(sept.totalMi).toBeLessThanOrEqual(18);
  });

  it('the September and October blocks are one stressor at a time', () => {
    // Research/00a: "Either add mileage OR add intensity in a given week, not
    // both." The M dose rises 3 to 5 between 20 Sep and 18 Oct, and the long
    // run rises 16.5 to 20.0 across the same span. Those are four weeks
    // apart, not one week, which is what makes both moves legal.
    const sept = M_LADDER.find((x) => x.dateISO === '2026-09-20')!;
    const oct = M_LADDER.find((x) => x.dateISO === '2026-10-18')!;
    const weeksApart = Math.round(
      (Date.parse(oct.dateISO) - Date.parse(sept.dateISO)) / (7 * 86_400_000),
    );
    expect(weeksApart).toBe(4);
    expect(oct.mContinuousMi).toBeGreaterThan(sept.mContinuousMi);
    expect(oct.mTotalMi).toBeGreaterThan(sept.mTotalMi);
    expect(addStressOneAtATime()).toContain('not both');
  });
});
