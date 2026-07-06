/**
 * ADAPTER INVARIANTS (2026-07-06 · phone+watch audit wave 1).
 *
 * Locks the adaptation-engine defect cluster found live on David's plan
 * (audit P1-5/P1-35..P1-40/P1-46/P1-54/P1-55/P2-64/P2-67):
 *
 *   1. CRON_INDEX    — actions[i]↔triggers[i] pairing misrouted the
 *                      anti-stacking downgrade into a mislabeled
 *                      readiness proposal whenever pullback co-fired
 *                      (live Jul 1 + Jul 6). Now: per-action
 *                      sourceTrigger tag + partitionActionsForCron.
 *   2. COLLISION     — reschedule landed on occupied days (15.5-24mi
 *                      doubles), rest days, the long-run day, race week.
 *                      Now: chooseRescheduleDate guard battery; no slot
 *                      → drop (data, not debt).
 *   3. STALENESS     — a missed workout rode +2d forward forever.
 *                      Now: >3 days past ORIGINAL date → dropped.
 *   4. GAP_RAMP      — no layoff concept; after 8 days off the adapter
 *                      crammed quality into a cutback week. Now:
 *                      classifyGapBand + buildGapActions per
 *                      Research/22-plan-templates.md §14 (628-651) and
 *                      Research/01-pace-zones-vdot.md:319-320.
 *   5. IDEMPOTENCY   — daily crons re-fired the same response. Now:
 *                      gapAlreadyHandled markers (once per gap+band) +
 *                      overshoot shave cooldown (7d).
 *   6. COMPLETION    — flat ≥4mi gate broke sub-4mi quality (5K plans)
 *                      and let easy jogs satisfy tempos. Now:
 *                      completionThresholdMi (≥60% of prescription).
 *
 * Pure-logic tests over the exported decision core — same posture as
 * adapter-bench.test.ts (the SQL shell feeds these functions; the math
 * they encode is what the SQL must respect). SQL-shape contracts that
 * cannot run without a DB are locked as source-text assertions at the
 * bottom.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_adapt_invariants.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EXPERIENCE_CAPS_MI,
  GAP_SHAVE_FRACTIONS,
  buildGapActions,
  chooseRescheduleDate,
  classifyGapBand,
  completionThresholdMi,
  dateNearRace,
  daysBetweenISO,
  dowOfISO,
  gapAlreadyHandled,
  isStaleMissed,
  overshootFires,
  partitionActionsForCron,
  plusDaysISO,
  type AdaptationAction,
  type GapPlanRow,
  type RescheduleDayContext,
} from './adapt';
import { TIER_TARGETS } from './goal-tiers';

const TODAY = '2026-07-06'; // Monday · the audit's real seed date

const emptyDay = (): RescheduleDayContext => ({
  runCount: 0, qualityOrLong: false, hasRestRow: false, weekRunCount: null,
});
const dayMap = (overrides: Record<string, Partial<RescheduleDayContext>>): Record<string, RescheduleDayContext> => {
  const m: Record<string, RescheduleDayContext> = {};
  for (let i = 0; i <= 5; i++) m[plusDaysISO(TODAY, i)] = emptyDay();
  for (const [k, v] of Object.entries(overrides)) m[k] = { ...emptyDay(), ...v };
  return m;
};
const baseOpts = () => ({
  todayISO: TODAY,
  byDate: dayMap({}),
  longRunDow: null as number | null,
  restDow: null as number | null,
  weeklyFrequency: null as number | null,
  raceDates: [] as string[],
});

describe('P1-37 · cron partition is per-action tag, never index alignment', () => {
  it('reproduces the live Jul 1 sequence: pullback trigger with 0 actions no longer strips the anti-stacking downgrade', () => {
    // Live failure: triggers [missed_key_workout, readiness_pullback];
    // pullback emitted 0 actions, missed emitted 2 → the old
    // actions.filter((_, i) => triggers[i].kind !== 'readiness_pullback')
    // dropped actions[1] (the downgrade) from apply and proposed it as
    // "Readiness pullback · HRV below 5 days running".
    const actions: AdaptationAction[] = [
      { kind: 'reschedule', workoutIds: ['wko_a'], newDate: '2026-07-03', sourceTrigger: 'missed_key_workout', why: 'x' },
      { kind: 'downgrade', workoutIds: ['wko_b'], newType: 'easy', sourceTrigger: 'missed_key_workout', why: 'Avoid stacking two quality days; downgrade upcoming key to easy.' },
    ];
    const { applyNow, proposeFirst } = partitionActionsForCron(actions);
    expect(applyNow).toHaveLength(2);
    expect(proposeFirst).toHaveLength(0);
  });

  it('routes pullback-tagged actions to propose-first and untagged actions to apply (back-compat default)', () => {
    const actions: AdaptationAction[] = [
      { kind: 'downgrade', workoutIds: ['wko_a'], newType: 'easy', sourceTrigger: 'readiness_pullback', why: 'x' },
      { kind: 'downgrade', workoutIds: ['wko_b'], newType: 'easy', sourceTrigger: 'niggle_reported', why: 'x' },
      { kind: 'shave', workoutIds: ['wko_c'], shaveFraction: 0.17, why: 'x' }, // untagged (legacy shape)
    ];
    const { applyNow, proposeFirst } = partitionActionsForCron(actions);
    expect(proposeFirst.map((a) => a.workoutIds?.[0])).toEqual(['wko_a']);
    expect(applyNow.map((a) => a.workoutIds?.[0])).toEqual(['wko_b', 'wko_c']);
  });
});

describe('P1-35/P1-46 · chooseRescheduleDate guard battery', () => {
  it('COLLISION-NEVER: skips occupied days, lands on the first truly clear day', () => {
    // today+1 occupied (easy), today+2 occupied (easy) → today+3 clear.
    const opts = {
      ...baseOpts(),
      byDate: dayMap({
        [plusDaysISO(TODAY, 1)]: { runCount: 1 },
        [plusDaysISO(TODAY, 2)]: { runCount: 1 },
      }),
    };
    expect(chooseRescheduleDate(opts)).toBe(plusDaysISO(TODAY, 3));
  });

  it('never lands on a plan rest day', () => {
    const opts = {
      ...baseOpts(),
      byDate: dayMap({ [plusDaysISO(TODAY, 1)]: { hasRestRow: true } }),
    };
    expect(chooseRescheduleDate(opts)).toBe(plusDaysISO(TODAY, 2));
  });

  it('never lands on the long-run day (dow), even when that day is empty', () => {
    // TODAY is Monday → today+1..+4 are Tue..Fri. Block Wednesday (dow 3).
    const opts = { ...baseOpts(), longRunDow: 3 };
    const picked = chooseRescheduleDate(opts);
    expect(picked).toBe(plusDaysISO(TODAY, 1)); // Tuesday clear
    const blockedWed = {
      ...baseOpts(),
      longRunDow: dowOfISO(plusDaysISO(TODAY, 1)),
    };
    expect(chooseRescheduleDate(blockedWed)).toBe(plusDaysISO(TODAY, 2));
  });

  it('never lands adjacent to a quality/long day (hard/easy spacing)', () => {
    // Quality on today+2 → today+1 and today+3 blocked → today+4.
    const opts = {
      ...baseOpts(),
      byDate: dayMap({ [plusDaysISO(TODAY, 2)]: { runCount: 1, qualityOrLong: true } }),
    };
    expect(chooseRescheduleDate(opts)).toBe(plusDaysISO(TODAY, 4));
  });

  it('respects weekly_frequency: a full week rejects the added run day', () => {
    const full = {
      ...baseOpts(),
      weeklyFrequency: 4,
      byDate: dayMap({
        [plusDaysISO(TODAY, 1)]: { weekRunCount: 4 },
        [plusDaysISO(TODAY, 2)]: { weekRunCount: 4 },
        [plusDaysISO(TODAY, 3)]: { weekRunCount: 4 },
        [plusDaysISO(TODAY, 4)]: { weekRunCount: 4 },
      }),
    };
    expect(chooseRescheduleDate(full)).toBeNull();
    const room = {
      ...full,
      byDate: dayMap({
        [plusDaysISO(TODAY, 1)]: { weekRunCount: 4 },
        [plusDaysISO(TODAY, 2)]: { weekRunCount: 3 },
      }),
    };
    expect(chooseRescheduleDate(room)).toBe(plusDaysISO(TODAY, 2));
  });

  it('never reschedules into race week or within 3 days of a race', () => {
    // Race at today+5 → every candidate (+1..+4) is inside [race-6, race].
    expect(chooseRescheduleDate({ ...baseOpts(), raceDates: [plusDaysISO(TODAY, 5)] })).toBeNull();
    // Race yesterday → +1..+2 are within 3 days post-race; +3 clears.
    expect(chooseRescheduleDate({ ...baseOpts(), raceDates: [plusDaysISO(TODAY, -1)] }))
      .toBe(plusDaysISO(TODAY, 3));
  });

  it('DROP over stacking: all four candidate days blocked → null (workout becomes data, not debt)', () => {
    const opts = {
      ...baseOpts(),
      byDate: dayMap({
        [plusDaysISO(TODAY, 1)]: { runCount: 1 },
        [plusDaysISO(TODAY, 2)]: { hasRestRow: true },
        [plusDaysISO(TODAY, 3)]: { runCount: 2 },
        [plusDaysISO(TODAY, 4)]: { runCount: 1 },
      }),
    };
    expect(chooseRescheduleDate(opts)).toBeNull();
  });

  it('race-week edges: dateNearRace covers [race-6, race] and ±3d, nothing beyond', () => {
    const race = '2026-08-16';
    expect(dateNearRace('2026-08-10', [race])).toBe(true);   // race-6 · race week
    expect(dateNearRace('2026-08-16', [race])).toBe(true);   // race day
    expect(dateNearRace('2026-08-19', [race])).toBe(true);   // +3 post-race
    expect(dateNearRace('2026-08-09', [race])).toBe(false);  // race-7 · clear
    expect(dateNearRace('2026-08-20', [race])).toBe(false);  // +4 post-race · clear
  });
});

describe('P1-38 · staleness expiry', () => {
  it('a workout ≤3 days past its original date is still reschedulable; >3 days is dropped', () => {
    expect(isStaleMissed('2026-07-05', TODAY)).toBe(false); // 1 day past
    expect(isStaleMissed('2026-07-03', TODAY)).toBe(false); // 3 days past · boundary
    expect(isStaleMissed('2026-07-02', TODAY)).toBe(true);  // 4 days past
    expect(isStaleMissed('2026-06-30', TODAY)).toBe(true);  // 6 days past
  });
});

describe('P1-40/P1-54 · workout-relative completion gate (Research/22 §14)', () => {
  it('threshold is 60% of the prescription, floored at 1mi, capped at the prescription', () => {
    expect(completionThresholdMi(8)).toBeCloseTo(4.8);
    expect(completionThresholdMi(3)).toBeCloseTo(1.8);   // 5K-plan quality now completable
    expect(completionThresholdMi(1)).toBe(1);
    expect(completionThresholdMi(0.5)).toBe(0.5);        // never demands more than prescribed
    expect(completionThresholdMi(null)).toBe(4);         // legacy fallback · no prescription
    expect(completionThresholdMi(0)).toBe(4);
  });

  it('a 4mi easy jog no longer satisfies an 8mi tempo; a 3mi executed 5K session is no longer "missed"', () => {
    expect(4 >= completionThresholdMi(8)).toBe(false);
    expect(3 >= completionThresholdMi(3)).toBe(true);
  });
});

describe('P1-36 · gap bands (Research/22-plan-templates.md §14:628-651)', () => {
  it('band edges: ≤3 none · 4-7 easy_swap · 8-14 shave_70_85 · ≥15 rebuild_propose', () => {
    expect(classifyGapBand(0)).toBe('none');
    expect(classifyGapBand(3)).toBe('none');   // normal plan spacing, not a layoff
    expect(classifyGapBand(4)).toBe('easy_swap');
    expect(classifyGapBand(7)).toBe('easy_swap');
    expect(classifyGapBand(8)).toBe('shave_70_85');
    expect(classifyGapBand(14)).toBe('shave_70_85');
    expect(classifyGapBand(15)).toBe('rebuild_propose');
    expect(classifyGapBand(45)).toBe('rebuild_propose');
  });

  it('re-entry fractions are 70% then 85% (shave 0.30 / 0.15)', () => {
    expect(GAP_SHAVE_FRACTIONS[0]).toBeCloseTo(0.30);
    expect(GAP_SHAVE_FRACTIONS[1]).toBeCloseTo(0.15);
  });
});

// ── The seed real-world case (David · Jun 28-Jul 5 gap) ────────────────
// Runner misses 8 days. Plan had quality Jun 30 + Jul 2, easy Jul 3 +
// Jul 8, long Jul 5, cutback week starting Jul 6. Correct output: a 70%
// week-1 shave (85% week 2), intensity dropped, and ZERO reschedules —
// NOT three consecutive tempos and double-booked days.
describe('SEED REGRESSION · 8-day gap into a cutback week', () => {
  const row = (id: string, dateISO: string, type: string, distanceMi: number, inRaceWeek = false): GapPlanRow =>
    ({ id, dateISO, type, distanceMi, inRaceWeek });
  // The upcoming 14 days as authored (mirrors the live plan probe).
  const upcoming: GapPlanRow[] = [
    row('w_mon_easy', '2026-07-06', 'easy', 6),
    row('w_tue_tempo', '2026-07-07', 'tempo', 8),
    row('w_wed_easy', '2026-07-08', 'easy', 6),
    row('w_thu_tempo', '2026-07-09', 'tempo', 6.5),
    row('w_fri_easy', '2026-07-10', 'easy', 6),
    row('w_sat_rest', '2026-07-11', 'rest', 0),
    row('w_sun_long', '2026-07-12', 'long', 13),
    row('w2_mon_easy', '2026-07-13', 'easy', 9),
    row('w2_tue_tempo', '2026-07-14', 'tempo', 8),
    row('w2_wed_easy', '2026-07-15', 'easy', 9),
    row('w2_thu_int', '2026-07-16', 'intervals', 7.5),
    row('w2_fri_easy', '2026-07-17', 'easy', 9),
    row('w2_sat_rest', '2026-07-18', 'rest', 0),
    row('w2_sun_long', '2026-07-19', 'long', 17),
  ];
  const actions = buildGapActions({
    todayISO: TODAY,
    daysOff: 8,                    // Jun 28..Jul 5 with no canonical run
    lastRunISO: '2026-06-27',
    upcoming,
    raceDates: ['2026-08-16'],     // A-race 6 weeks out · outside all windows
  });

  it('emits ZERO reschedules', () => {
    expect(actions.filter((a) => a.kind === 'reschedule')).toHaveLength(0);
  });

  it('shaves week 1 to 70% and week 2 to 85% (existing shave machinery, 0.5mi snapping downstream)', () => {
    const shaves = actions.filter((a) => a.kind === 'shave');
    expect(shaves).toHaveLength(2);
    expect(shaves[0].shaveFraction).toBeCloseTo(0.30);
    expect(shaves[1].shaveFraction).toBeCloseTo(0.15);
    // Week-1 shave covers every running row of the cutback week, rest excluded.
    expect(shaves[0].workoutIds).toEqual(
      expect.arrayContaining(['w_mon_easy', 'w_tue_tempo', 'w_wed_easy', 'w_thu_tempo', 'w_fri_easy', 'w_sun_long']),
    );
    expect(shaves[0].workoutIds).not.toContain('w_sat_rest');
    expect(shaves[1].workoutIds).toEqual(
      expect.arrayContaining(['w2_mon_easy', 'w2_tue_tempo', 'w2_sun_long']),
    );
  });

  it('drops intensity for the first week back (both cutback-week tempos → easy), leaves week-2 quality alone', () => {
    const downgrades = actions.filter((a) => a.kind === 'downgrade');
    expect(downgrades).toHaveLength(1);
    expect(downgrades[0].newType).toBe('easy');
    expect([...(downgrades[0].workoutIds ?? [])].sort()).toEqual(['w_thu_tempo', 'w_tue_tempo']);
  });

  it('records the gap marker for idempotency (keyed on lastRunISO, band recorded)', () => {
    const marker = actions.find((a) => a.kind === 'note' && a.noteReason === 'plan_adapt_gap');
    expect(marker).toBeDefined();
    expect(marker?.noteField).toBe('2026-06-27');
    expect(marker?.noteValue).toMatchObject({ lastRunISO: '2026-06-27', daysOff: 8, band: 'shave_70_85' });
  });
});

describe('P1-36 · other gap bands', () => {
  const upcoming: GapPlanRow[] = [
    { id: 'q1', dateISO: plusDaysISO(TODAY, 1), type: 'tempo', distanceMi: 8, inRaceWeek: false },
    { id: 'e1', dateISO: plusDaysISO(TODAY, 2), type: 'easy', distanceMi: 6, inRaceWeek: false },
    { id: 'q2', dateISO: plusDaysISO(TODAY, 3), type: 'intervals', distanceMi: 7, inRaceWeek: false },
  ];

  it('easy_swap (4-7d): substitutes ONLY the first upcoming quality with easy, nothing else', () => {
    const actions = buildGapActions({
      todayISO: TODAY, daysOff: 5, lastRunISO: plusDaysISO(TODAY, -6), upcoming, raceDates: [],
    });
    const downgrades = actions.filter((a) => a.kind === 'downgrade');
    expect(downgrades).toHaveLength(1);
    expect(downgrades[0].workoutIds).toEqual(['q1']);
    expect(downgrades[0].newType).toBe('easy');
    expect(actions.filter((a) => a.kind === 'shave')).toHaveLength(0);
    expect(actions.filter((a) => a.kind === 'reschedule')).toHaveLength(0);
  });

  it('easy_swap skips race-protected quality (race week / near-race) and takes the next one', () => {
    const raceWeek: GapPlanRow[] = [
      { id: 'qr', dateISO: plusDaysISO(TODAY, 1), type: 'tempo', distanceMi: 6, inRaceWeek: true },
      { id: 'q2', dateISO: plusDaysISO(TODAY, 9), type: 'tempo', distanceMi: 8, inRaceWeek: false },
    ];
    const actions = buildGapActions({
      todayISO: TODAY, daysOff: 5, lastRunISO: plusDaysISO(TODAY, -6), upcoming: raceWeek, raceDates: [],
    });
    const downgrades = actions.filter((a) => a.kind === 'downgrade');
    expect(downgrades).toHaveLength(1);
    expect(downgrades[0].workoutIds).toEqual(['q2']);
  });

  it('rebuild_propose (>14d): notes only, NO plan mutation, VDOT haircut per Research/01:319-320', () => {
    const actions = buildGapActions({
      todayISO: TODAY, daysOff: 20, lastRunISO: plusDaysISO(TODAY, -21), upcoming, raceDates: [],
    });
    expect(actions.every((a) => a.kind === 'note')).toBe(true);
    const rebuild = actions.find((a) => a.noteReason === 'plan_adapt_gap_rebuild');
    expect(rebuild?.noteValue).toMatchObject({ recommendation: 'rebuild', vdotHaircut: '3-5' });
    const long = buildGapActions({
      todayISO: TODAY, daysOff: 45, lastRunISO: plusDaysISO(TODAY, -46), upcoming, raceDates: [],
    });
    expect(long.find((a) => a.noteReason === 'plan_adapt_gap_rebuild')?.noteValue)
      .toMatchObject({ vdotHaircut: '5-8' });
  });

  it('never shaves race-protected rows in the 8-14d band', () => {
    const withRace: GapPlanRow[] = [
      ...upcoming,
      { id: 'race_row', dateISO: plusDaysISO(TODAY, 4), type: 'race', distanceMi: 13.1, inRaceWeek: true },
      { id: 'tuneup', dateISO: plusDaysISO(TODAY, 5), type: 'race_week_tuneup', distanceMi: 3, inRaceWeek: false },
    ];
    const actions = buildGapActions({
      todayISO: TODAY, daysOff: 9, lastRunISO: plusDaysISO(TODAY, -10),
      upcoming: withRace, raceDates: [plusDaysISO(TODAY, 4)],
    });
    for (const a of actions) {
      expect(a.workoutIds ?? []).not.toContain('race_row');
      expect(a.workoutIds ?? []).not.toContain('tuneup');
    }
  });
});

describe('P1-36 · gap idempotency across daily crons', () => {
  it('fires at most once per (gap, band): same gap + same band → handled', () => {
    const handled = [{ lastRunISO: '2026-06-27', band: 'shave_70_85' }];
    expect(gapAlreadyHandled(handled, '2026-06-27', 'shave_70_85')).toBe(true);
  });
  it('band escalation on the same gap fires once more', () => {
    const handled = [{ lastRunISO: '2026-06-27', band: 'shave_70_85' }];
    expect(gapAlreadyHandled(handled, '2026-06-27', 'rebuild_propose')).toBe(false);
    // ...and a higher handled band covers a lower re-classification.
    const escalated = [{ lastRunISO: '2026-06-27', band: 'rebuild_propose' }];
    expect(gapAlreadyHandled(escalated, '2026-06-27', 'shave_70_85')).toBe(true);
  });
  it('a NEW gap (different lastRunISO) is not blocked by an old marker; malformed markers are ignored', () => {
    const handled = [
      { lastRunISO: '2026-05-01', band: 'shave_70_85' },
      { lastRunISO: '2026-06-27' },              // no band → ignored
      { band: 'shave_70_85' },                   // no gap key → ignored
      null as unknown as { lastRunISO?: unknown; band?: unknown },
    ];
    expect(gapAlreadyHandled(handled, '2026-06-27', 'shave_70_85')).toBe(false);
  });
});

describe('P1-55 · volume overshoot vs the plan it came from', () => {
  it('baselines on the ACTIVE PLAN schedule: a compliant runner never fires, regardless of tier', () => {
    // Beginner marathon (clamped to intermediate tier) legitimately
    // scheduled 42mi and ran it: old static cap 25 fired at 31.25.
    expect(overshootFires(42, 42, EXPERIENCE_CAPS_MI.beginner)).toBe(false);
    // Ran meaningfully more than prescribed → fires.
    expect(overshootFires(55, 42, EXPERIENCE_CAPS_MI.beginner)).toBe(true);
    // 25% over exactly → does not fire (strict >).
    expect(overshootFires(52.5, 42, EXPERIENCE_CAPS_MI.beginner)).toBe(false);
  });

  it('falls back to the tier-aligned experience cap when the plan scheduled nothing meaningful', () => {
    expect(overshootFires(50, 0, EXPERIENCE_CAPS_MI.beginner)).toBe(false);   // 50 ≤ 45×1.25
    expect(overshootFires(60, 0, EXPERIENCE_CAPS_MI.beginner)).toBe(true);    // 60 > 56.25
    expect(overshootFires(60, null, EXPERIENCE_CAPS_MI.beginner)).toBe(true);
  });

  it('fallback caps clear every tier band the generator can prescribe for the level (P1-55 contradiction closed)', () => {
    // Same level→tier mapping as adapter-bench.test.ts. HARD assert now —
    // the caps were re-derived from TIER_TARGETS so a doctrine-compliant
    // plan can never trip the fallback.
    const levelToTier = {
      beginner: 'developing', intermediate: 'intermediate',
      advanced: 'advanced', advanced_plus: 'elite',
    } as const;
    for (const cat of Object.keys(TIER_TARGETS) as Array<keyof typeof TIER_TARGETS>) {
      for (const lvl of Object.keys(EXPERIENCE_CAPS_MI) as Array<keyof typeof EXPERIENCE_CAPS_MI>) {
        const tierUpper = TIER_TARGETS[cat][levelToTier[lvl]].peakWeeklyMileageBand[1];
        expect(EXPERIENCE_CAPS_MI[lvl] * 1.25).toBeGreaterThanOrEqual(tierUpper);
      }
    }
  });
});

describe('date helpers', () => {
  it('daysBetweenISO is signed and DST-safe; plusDaysISO round-trips', () => {
    expect(daysBetweenISO('2026-06-27', TODAY)).toBe(9);
    expect(daysBetweenISO(TODAY, '2026-06-27')).toBe(-9);
    expect(plusDaysISO('2026-06-27', 9)).toBe(TODAY);
    // DST boundary (US spring-forward 2026-03-08).
    expect(daysBetweenISO('2026-03-07', '2026-03-09')).toBe(2);
    expect(dowOfISO('2026-07-06')).toBe(1); // Monday
  });
});

// ── SQL-shape contracts (no DB in vitest — lock the load-bearing SQL
// fragments as source text so a revert to the old queries fails CI) ──
describe('SQL contracts · adapt.ts source', () => {
  const src = readFileSync(fileURLToPath(new URL('./adapt.ts', import.meta.url)), 'utf8');

  it('NO-CHAIN-DRAG: the missed detector excludes rows the adapter already rescheduled/dropped/noted', () => {
    expect(src).toMatch(/ci\.reason IN \('plan_adapt_reschedule',\s*'plan_adapt_drop_missed',\s*'plan_adapt_missed_noted'\)/);
  });

  it('P1-39: missed detection covers long runs', () => {
    expect(src).toMatch(/pw\.type IN \('threshold','tempo','intervals','vo2max','long'\)/);
  });

  it('NO-SELF-CANNIBALIZATION: the anti-stacking downgrade target excludes previously-rescheduled rows and the moved row itself', () => {
    expect(src).toMatch(/AND pw\.id <> \$3[\s\S]{0,400}ci\.reason = 'plan_adapt_reschedule'/);
  });

  it('P2-64: a reschedule re-resolves week_id, dow, and stamps original_date_iso (no bare date_iso poke)', () => {
    expect(src).toMatch(/original_date_iso = COALESCE\(pw\.original_date_iso, pw\.date_iso\)/);
    expect(src).not.toMatch(/UPDATE plan_workouts SET date_iso = \$1 WHERE id = \$2/);
  });

  it('OVERSHOOT-COOLDOWN: one shave per rolling 7 days', () => {
    expect(src).toMatch(/reason = 'plan_adapt_shave'[\s\S]{0,80}INTERVAL '7 days'/);
  });

  it('GAP SUPPRESSION: missed-workout detection is gated while a gap is active or recently handled', () => {
    expect(src).toMatch(/if \(!inGapReentry\) \{/);
  });

  it('COMPLETION: the flat >=4mi SQL gate is gone from the detector', () => {
    expect(src).not.toMatch(/\(data->>'distanceMi'\)::numeric >= 4/);
  });
});
