/**
 * DOCTRINE-DOSING-2 · the COMPOSER half, and the write boundary.
 *
 * `_dosing_doctrine.test.ts` proves the composed corpus carries no enforced
 * dosing breach. That is the outcome. This file holds the three mechanisms that
 * produce it, so a regression names itself instead of surfacing as a number
 * moving in the census:
 *
 *   1. NO WEEK RUNS TWO SESSIONS OF ONE PACE FAMILY. The rule that makes the
 *      weekly caps satisfiable at full doctrinal session size, asserted over
 *      every authored week rather than by reading the mix table by eye.
 *   2. BASE IS NOT SKIPPED FOR A RUNNER WHOSE VOLUME IS NOT REBUILT. The
 *      periodization gate that stopped the engine opening a marathon build in
 *      QUALITY off a post-race reverse taper.
 *   3. THE ADAPT PATH CANNOT BREACH WHAT AUTHORING CANNOT. `dose-guard`
 *      measures the training week a raw-SQL row edit would produce.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_dosing_composer.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { composePlan, BASE_REBUILT_SHARE } from './generate';
import { duplicatePaceFamily, slotDosePace, weeklyDoseBudgetMi, slotDoseBudgetMi } from './dosing';
import { dosingBreachIfWritten } from './dose-guard';
import type { SimDistance } from './sim-constants';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '2027-03-01', lastRaceFinishedDaysAgo: 0,
  lastRaceDistance: null, raceHistory: [], longRunDay: 'sun', restDay: 'sat', availableDays: [],
} as any;

const GOAL_SEC: Record<SimDistance, number> = {
  '5k': 1350, '10k': 2700, half: 6300, marathon: 13500, '50k': 18000, '100k': 43200,
};
const WEEKS: Record<SimDistance, number> = {
  '5k': 12, '10k': 12, half: 14, marathon: 18, '50k': 22, '100k': 24,
};

describe('DOCTRINE-DOSING-2 · one session per pace family, per week', () => {
  it('holds across the archetype matrix, in the AUTHORED plan', () => {
    // The claim is about what the runner is actually given, so it is asserted on
    // the composed days rather than on `qualityTypesFor`'s return value. A week
    // whose types were legal but whose scheduler filled two days from a
    // one-entry list would pass the table and fail here — which is exactly the
    // defect `scheduleQuality`'s GAP-mode downgrade used to produce.
    const offenders: string[] = [];
    let weeksChecked = 0;
    let beginnerFartlekWeeks = 0;

    for (const distance of ['5k', '10k', 'half', 'marathon', '50k'] as SimDistance[]) {
      for (const experienceLevel of ['beginner', 'intermediate', 'advanced'] as const) {
        for (const weeklyMileageBucket of [15, 25, 35, 45]) {
          for (const weeklyFrequency of [4, 5, 6]) {
            const r = buildSimPlan({
              ...base, goalMode: 'goal', distance, experienceLevel, weeklyMileageBucket,
              weeklyFrequency, planWeeks: WEEKS[distance], goalTimeSec: GOAL_SEC[distance],
              longestRunBucket: weeklyMileageBucket >= 35 ? '10+' : '6-10',
            } as any);
            if (!r.ok) continue;

            for (const w of r.composed.weeks as Array<{
              startISO: string; phase: string; isRaceWeek?: boolean;
              days: Array<{ type: string; isQuality?: boolean; subLabel?: string | null }>;
            }>) {
              // A taper's marathon-pace block and a race week's tune-up are
              // doses Research/08 §9.2 states by name; the percentage caps do
              // not govern those weeks (see `capEnforced`) and the frequency
              // rule they serve does not either.
              if (w.isRaceWeek || w.phase === 'TAPER') continue;
              weeksChecked++;
              const quality = w.days.filter((d) => d.isQuality && d.type !== 'race');
              const dup = duplicatePaceFamily(quality.map((d) => d.type));
              if (!dup) continue;
              // KNOWN-OPEN, and named rather than hidden: the BASE-BUILDING mix
              // is a single LIGHT FARTLEK type placed on two quality days, so
              // the week runs two of them. (Base-building is a low-volume tier
              // decision, not a declared experience level — a 15 mi/wk
              // "intermediate" ultra runner lands there too — so the exemption
              // is keyed on the prescription only that path authors.) §5.2 would rather
              // see one — but collapsing the second into an easy day moves
              // enough mileage on a beginner ramp to breach the validator's own
              // 50% week-over-week volume limit, and trading a frequency nuance
              // for a structural ramp violation is a worse plan. The DOSE is not
              // the issue: a 5×1 min surge set is ~0.6 mi at T, so two sit far
              // inside Daniels' 10% on any week a beginner runs, which is why
              // the census still reads zero. Re-sizing the beginner ramp is a
              // separate piece of work. See `effectiveQDows` in generate.ts.
              const allFartlek = quality.every((d) =>
                /min surges @ T effort/i.test(String(d.subLabel ?? '')));
              if (allFartlek) {
                beginnerFartlekWeeks++;
                continue;
              }
              offenders.push(
                `${distance}/${experienceLevel}/${weeklyMileageBucket}/${weeklyFrequency} ` +
                `${w.startISO} (${w.phase}): two ${dup} sessions — ` +
                `${quality.map((d) => `${d.type} "${d.subLabel}"`).join(' + ')}`,
              );
            }
          }
        }
      }
    }

    expect(weeksChecked).toBeGreaterThan(500);
    expect(offenders.slice(0, 10).join('\n')).toBe('');
    // The exemption is real, so it is asserted rather than left implicit — if a
    // future change fixes the beginner ramp, this drops to zero and the comment
    // above has to be deleted with it.
    expect(beginnerFartlekWeeks).toBeGreaterThan(0);
  }, 120_000);

  it('divides a shared budget rather than spending it twice', () => {
    // The arithmetic underneath the rule. If a future mix ever does double up,
    // the budget is what stops it becoming a breach.
    const week = 60;
    expect(weeklyDoseBudgetMi(week, 'T')).toBeCloseTo(6, 5);
    expect(slotDoseBudgetMi({ weeklyMi: week, pace: 'T', slots: 1 })).toBeCloseTo(6, 5);
    expect(slotDoseBudgetMi({ weeklyMi: week, pace: 'T', slots: 2 })).toBeCloseTo(3, 5);
    // What the long run's race-pace finish has already committed comes off the
    // top — the reason a week can be PLANNED rather than only checked.
    expect(slotDoseBudgetMi({ weeklyMi: week, pace: 'T', reservedMi: 2 })).toBeCloseTo(4, 5);
    expect(slotDoseBudgetMi({ weeklyMi: week, pace: 'T', reservedMi: 99 })).toBe(0);
    // I is bounded by its absolute ceiling once the percentage stops binding:
    // 8% of a 100 mi week is 8 miles, doctrine's "max 10K cumulative" is 6.21.
    expect(weeklyDoseBudgetMi(100, 'I')).toBeCloseTo(6.21, 2);
    // M carries no weekly cap at all — doctrine writes "n/a" — only the
    // 18 mi single-workout ceiling.
    expect(weeklyDoseBudgetMi(60, 'M')).toBe(Infinity);
  });

  it('agrees with the day-level attribution about what a slot doses', () => {
    // Two functions answer "what pace is this", one from a slot type and one
    // from a composed day. They are used on either side of the same budget, so
    // a disagreement would let a session be sized against one bucket and
    // charged to another.
    expect(slotDosePace('threshold')).toBe('T');
    expect(slotDosePace('tempo')).toBe('T');
    expect(slotDosePace('tempo', true)).toBe('M');
    expect(slotDosePace('intervals')).toBe('I');
    expect(slotDosePace('vo2max')).toBe('I');
    expect(slotDosePace('strides')).toBe('R');
    expect(slotDosePace('easy')).toBeNull();
    expect(slotDosePace('long')).toBeNull();
  });
});

describe('DOCTRINE-BASE-1 · BASE is skipped only for a rebuilt base', () => {
  /** The CIM shape: a marathon build authored straight out of a half's recovery. */
  const cim = (rampBaseEvidence: unknown) => composePlan({
    raceDistanceMi: 26.2, goalSec: 10800, goalPaceSec: 412,
    raceDateISO: '2026-12-06', startMondayISO: '2026-08-31', level: 'advanced',
    recentWeeklyMi: 31, easyDayMedianMi: 6, recentLongMi: 13,
    recentQualityDistanceMi: 8, recentQualityPerWeek: 2, bestRecentVdot: 48,
    isMidBlock: true,
    longRunDow: 0, restDow: 6, qualityDows: [2, 4],
    trainingDaysPerWeek: 6, crossModes: [],
    rxQuality: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
    rxRaceSpecific: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
    tPaceSec: 400, lthr: 162, maxHr: 188,
    rampBaseEvidence,
  } as never);

  const baseWeeks = (r: { weeks: Array<{ phase: string }> }) =>
    r.weeks.filter((w) => w.phase === 'BASE').length;

  it('inserts BASE when the runner is below their own sustained volume for no stated reason', () => {
    // 31 mi/wk against a 45 mi sustained level is 69% — under doctrine's
    // deepest sanctioned down week (Research/00a "reduce by 20-30%"), so the
    // shortfall is a deficit rather than a deload. Research/00b's reverse taper
    // is explicit about the order: "progressively rebuild volume first, then
    // add intensity."
    //
    // DOCTRINE-BASE-3 (2026-08-19) · `lifted: false` is now load-bearing in
    // this fixture and used to read `true`. `lifted` means the low stretch sits
    // inside an interruption the engine itself mandated, and `resolveRampBase`
    // already discounts those weeks when it sets the ramp base — so counting
    // the same weeks as detraining here made one authoring answer the question
    // both ways. Unexplained is what this case is about, and unexplained is
    // what it now says.
    const r = cim({ meanMi: 31, sustainedMi: 45, baseMi: 31, interruptionWeeks: 5, allowedInterruptionWeeks: 2, lifted: false });
    expect(31 / 45).toBeLessThan(BASE_REBUILT_SHARE);
    expect(baseWeeks(r)).toBeGreaterThan(0);
  });

  it('does NOT insert BASE when the dip is the recovery the engine itself prescribed', () => {
    // DOCTRINE-BASE-3 · the owner's CIM authoring, with his real numbers off
    // prod at 2026-08-31. The block starts fifteen days after an A-priority
    // half, so the 28-day mean is mostly the taper before that race plus
    // Research/00b's own 10-14 day half-marathon recovery window — volumes this
    // engine wrote. `rampBaseForBuild` extends the allowance to cover
    // exactly that ("A race the runner actually ran explains its own taper AND
    // its own recovery window"), and `lifted` is the flag that says it did.
    //
    // The VOLUME ramp still applies: `baseMi` is 70% of sustained, not 100%,
    // so the block opens well below the runner's own level. What does not
    // happen is three weeks with the intensity taken out on the strength of
    // weeks doctrine mandated.
    const r = cim({ meanMi: 16.8, sustainedMi: 43.5, baseMi: 30.5, interruptionWeeks: 3, allowedInterruptionWeeks: 4, lifted: true });
    expect(16.8 / 43.5).toBeLessThan(BASE_REBUILT_SHARE);
    expect(baseWeeks(r)).toBe(0);
  });

  it('does NOT insert BASE for a runner steadily mid-build', () => {
    // The regression the original mid-block rule exists to prevent, and the
    // reason this gate reads the runner's own history rather than the block's
    // target: 45 mi/wk against a 45 mi sustained level is 100%, whatever peak
    // the plan is building toward.
    const r = cim({ meanMi: 45, sustainedMi: 45, baseMi: 45, interruptionWeeks: 0, allowedInterruptionWeeks: 2, lifted: false });
    expect(baseWeeks(r)).toBe(0);
  });

  it('does NOT insert BASE on a planned down week', () => {
    // A cutback is 20-30% below sustained by design. 34 of 45 is 76%, inside
    // the band, and must read as mid-block rather than as a deficit.
    const r = cim({ meanMi: 34, sustainedMi: 45, baseMi: 34, interruptionWeeks: 1, allowedInterruptionWeeks: 2, lifted: false });
    expect(34 / 45).toBeGreaterThan(BASE_REBUILT_SHARE);
    expect(baseWeeks(r)).toBe(0);
  });

  it('does not fire without evidence', () => {
    // A harness, a synthetic persona and the simulator all call `composePlan`
    // with no volume history. Absence of history is not evidence of a deficit,
    // and inventing one would author a phase the runner's data never supported.
    expect(baseWeeks(cim(undefined))).toBe(0);
  });
});

describe('DOCTRINE-DOSING-2 · the adapt write boundary', () => {
  /** A fake pg client returning canned rows, so this needs no database. */
  const clientFor = (rows: Array<Record<string, unknown>>, meta: Record<string, unknown>) => ({
    query: async (sql: string) => {
      if (/FROM plan_workouts pw/.test(sql)) return { rows: [meta] } as never;
      return { rows } as never;
    },
  }) as never;

  const META = {
    date_iso: '2026-09-09', plan_id: 'p1', long_run_day: 'sun',
    phase: 'QUALITY', is_race_week: false,
  };

  const WEEK = [
    { id: 'w-long', type: 'long', distance_mi: '14', sub_label: 'LONG', is_long: true },
    { id: 'w-t', type: 'threshold', distance_mi: '8', sub_label: '4×1mi @ T pace · 60s jog', is_long: false },
    { id: 'w-e1', type: 'easy', distance_mi: '6', sub_label: 'EASY', is_long: false },
    { id: 'w-e2', type: 'easy', distance_mi: '6', sub_label: 'EASY', is_long: false },
  ];

  it('refuses a field test that would put the week past the T cap', async () => {
    // 34 mi of training, so Daniels allows 3.4 mi at T. The week already spends
    // 4 on its cruise session; converting an easy day into a 30-minute threshold
    // time trial adds ~4 more. `advanceShape`'s per-session cap sees nothing
    // wrong with either one on its own — that is the whole gap.
    const breach = await dosingBreachIfWritten(
      clientFor(WEEK, META), 'u1',
      { workoutId: 'w-e1', type: 'tempo', distanceMi: 6, subLabel: 'FIELD TEST', atPaceMi: 4 },
    );
    expect(breach.length).toBeGreaterThan(0);
    expect(breach[0].pace).toBe('T');
    expect(breach.every((f) => f.enforced)).toBe(true);
  });

  it('allows a write that stays inside the cap', async () => {
    // The same conversion on a week whose only other quality is a rep session:
    // different pace family, its own budget, nothing to refuse.
    const week = WEEK.map((d) => (d.id === 'w-t'
      ? { ...d, type: 'intervals', sub_label: '4×3 min @ I pace · 90s jog' }
      : d));
    const breach = await dosingBreachIfWritten(
      clientFor(week, META), 'u1',
      { workoutId: 'w-e1', type: 'tempo', distanceMi: 6, subLabel: 'FIELD TEST', atPaceMi: 3 },
    );
    expect(breach).toEqual([]);
  });

  it('does not refuse a write it merely failed to read', async () => {
    // A guard that blocks on a DB error would silently drop repairs the runner
    // needs. The plan it is guarding was validated at authoring time, so the
    // pre-existing state is known-good and a missed check is the cheaper error.
    const dead = { query: async () => { throw new Error('connection refused'); } } as never;
    expect(await dosingBreachIfWritten(dead, 'u1',
      { workoutId: 'w-e1', type: 'tempo', distanceMi: 6, subLabel: 'FIELD TEST', atPaceMi: 9 },
    )).toEqual([]);
  });

  it('does not enforce the percentage inside a race week', async () => {
    // Research/08 §9.2 states the race-week tune-up by name and dose, on a week
    // whose training volume is a shakeout. Enforcing a share of that denominator
    // would forbid the taper doctrine prescribes — see `capEnforced`.
    const raceWeek = [
      { id: 'r-race', type: 'race', distance_mi: '26.2', sub_label: 'RACE', is_long: true },
      { id: 'r-e1', type: 'easy', distance_mi: '4', sub_label: 'EASY', is_long: false },
      { id: 'r-e2', type: 'easy', distance_mi: '3', sub_label: 'EASY', is_long: false },
    ];
    const breach = await dosingBreachIfWritten(
      clientFor(raceWeek, { ...META, phase: 'TAPER', is_race_week: true }), 'u1',
      { workoutId: 'r-e1', type: 'race_week_tuneup', distanceMi: 4, subLabel: '5×400m @ 5K pace · 90s jog' },
    );
    expect(breach).toEqual([]);
  });
});
