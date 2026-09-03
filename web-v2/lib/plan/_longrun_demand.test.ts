/**
 * _longrun_demand.test.ts · LONG-RUN DEMAND AND MARATHON SPECIFICITY.
 *
 * ── THE TWO DEFECTS THIS EXISTS FOR ─────────────────────────────────────────
 *
 * Both measured on 2026-09-02 by recomposing the reference marathoner's live
 * CIM block — a 15-week build to 2026-12-06 carrying two tune-up races, the
 * second a half marathon on his long-run Sunday — and comparing it against the
 * plan he is actually running.
 *
 * 1 · THE PEAK LONG RUN REGRESSED BELOW WHAT HE HAS ALREADY RUN. The live plan
 *     peaks at 21.5 mi, his best training long run; the rebuild peaked at 20.5,
 *     in a block whose own `thesis_at_authoring` reads
 *     `{"primaryLimiter":"DURABILITY","priority":"increase_long_run_demand"}`.
 *
 *     Cause: `smoothLongWoW` capped the peak at `floor(16.0 × 1.30 × 2)/2` off
 *     the CUTBACK week beside it, while the load week before that deload had
 *     already carried 19.5. `validateComposedPlan` §4 has bridged over a
 *     planned deload since CUTBACK-LONG-1 (2026-08-28) — "the rebound to a
 *     level the block already held is not a ramp" — and the AUTHORING pass
 *     never got the same exemption. Two answers to one doctrinal question, and
 *     the stricter one was the one that actually cut the plan. No gate could
 *     see it, because a validator reports what is ILLEGAL and a long run
 *     trimmed BELOW the limit is legal.
 *
 * 2 · THE RACE-SPECIFIC PHASE AUTHORED ZERO MARATHON-PACE LONG RUNS. Embedded
 *     marathon-pace miles inside long runs fell from 20.5 (live) to 5.0, the
 *     whole loss being the eleven-mile marathon-pace long run — the most
 *     race-specific session in the block.
 *
 *     Cause: `racePaceLongThisWeek` knew about deloads and not about races.
 *     `embedMidBlockRaces` sets `slot.isLong = wasLong`, so a tune-up race on
 *     the long-run day REPLACES the long; the cadence anchored on the phase's
 *     last week (a deload), stepped once to the week before it (the raced
 *     half), and stopped. The engine then WROTE ITS OWN DEFECT DOWN — that
 *     phase's recorded purpose reads "Race-pace durability … 0 long runs in
 *     this phase carry race pace" — and nothing read it.
 *
 * ── WHAT THIS GATE ASSERTS ──────────────────────────────────────────────────
 *
 * Shapes, not the absence of a string (Rule 13.3), on two fixtures:
 *
 *   A · PLAIN BLOCK, no mid-block races, so the deload cadence is the clean
 *       one. The long run after a PLANNED deload is not pinned to
 *       `deloadLong × 1.30` when the pre-deload long allows more, and the
 *       composed sequence stays legal under the validator that owns the rule.
 *   B · TUNE-UP BLOCK, a half marathon on the long-run day. The cadence steps
 *       over a week that has no long run to carry the session, and the
 *       marathon-pace long it authors doses inside `Research/04` §4.4's own
 *       band, read out of the doc at run time.
 *   C · a week the runner RACED is never bridged over as if it were a planned
 *       deload, at either call site.
 *
 * ── HOW IT WAS FALSIFIED (Rule 18) ──────────────────────────────────────────
 *
 * Run against the generator at `0fb97214` with this file unchanged — verbatim
 * output, two of fourteen red:
 *
 *   A → "week 4: long pinned at the deload's own 14 × 1.30 while the
 *        pre-deload long of 19 licenses 24.5: expected 18 to be greater
 *        than 18"
 *   B → "the session was handed to a week whose long run is a race:
 *        expected [ 10 ] to not include 10"
 *
 * `C` cannot be falsified behaviourally: `longRunWoWCeilingMi` and
 * `isPlannedDeloadWeek` did not exist, so the old tree does not compile against
 * this file at all. Stated rather than claimed as a pass.
 *
 * The peak-long assertion is NOT among the two, and that is worth saying: this
 * fixture hands the composer a `spikeAnchorLongMi` of 18, so the old ladder
 * cleared 21.5 here even though the reference runner's real anchor of 13.5 left
 * it at 20.5. It is a REGRESSION NET, not a reproduction.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · THE END-TO-END FORM OF DEFECT 2. Reproducing it in a composed block
 *     needs a three-week deload cadence (`cutbackCadence` returns 3 only under
 *     TSB < -10), which no `ComposePlanInput` can force — with the four-week
 *     cadence fixture B's own phase has a second candidate week and authors an
 *     MP long either way. So the FALSIFIER for defect 2 is the pure picker
 *     test, and fixture B's MP-long assertions are a regression net rather
 *     than a reproduction. Said plainly here because an unmarked gap is worse
 *     than a stated one.
 *   · A RUNNER WITH NO MID-BLOCK RACE ON THE LONG-RUN DAY. Defect 2's whole
 *     mechanism is `noLongRunWeeks`, empty for every plan without one —
 *     including all 8,781 `sim-matrix` archetypes, whose `Arc` type carries no
 *     races at all. Per Rule 15: `_sweep_allusers` CANNOT reach this mechanism
 *     and adding archetypes would not help; the corpus would need mid-block
 *     races as an input. This file and `_midrace_invariants.test.ts` are the
 *     only cases in the repo that reach the embed at all, and that one asserts
 *     the post-race recovery window rather than the cadence.
 *   · WHETHER THE DOSE IS RIGHT FOR THIS RUNNER. It checks the session exists
 *     and lands inside §4.4's stated band. Whether 11 mi at MP is the right
 *     ask for a given athlete belongs to `_dosing_sweep_gate` and to the
 *     adaptation engine.
 *   · THE DOWNWARD PATH. Every assertion here is "the plan is allowed to get
 *     harder"; a generator that trimmed nothing at all would pass this file
 *     and fail `_sweep_allusers`, `_restore_continuity` and the spike gate.
 *     The asymmetry is deliberate and stated, because Rule 22 says a gate
 *     inherits its author's bias — this one is written entirely on the upward
 *     side, against a suite that is 29 files to 2 on the other.
 *   · A REGRESSION IN THE LIVE ACCOUNT. It composes from fixtures, never from
 *     the database, so it says nothing about what any real plan holds.
 *   · WHETHER THE ANSWERS ARE TRUE. The `WEEKANSWERS-1` block below checks that
 *     every week carries all six, that each names a number off its own week,
 *     and that the wire carries them. It cannot check that a sentence is the
 *     right coaching thing to say — that is a reading, and it belongs to the
 *     owner.
 *   · THE ONE THRESHOLD THIS CHANGE ADDS. The deload bridge is skipped below a
 *     5 mi pre-deload long (`SPIKE_MIN_COHERENT_ANCHOR_MI`, the same floor the
 *     spike rule already applies for the same reason). It is a discontinuity of
 *     at most half a mile on the authoring grid, on a population whose long run
 *     is not the block's primary stressor, and it is REPORTED rather than
 *     hidden. Nothing here walks it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions, racePaceLongThisWeek,
  type ComposePlanInput, type ComposedWeek, type DOW, type DayPlan,
} from './generate';
import {
  longRunWoWCeilingMi, isPlannedDeloadWeek, validateComposedPlan, PlanValidationError,
} from './validate';
import { tPaceFromGoal } from './spec-builder';
import { deriveBlockStrategy, type WeekAnswers, type BlockAnswers } from './strategy-contracts';
import { buildWeeks, buildBlockAnswers } from './v5-block';

const RESEARCH_ROOT = path.resolve(__dirname, '../../../Research');
const doc = (f: string) => readFileSync(path.join(RESEARCH_ROOT, f), 'utf8');

const START_MONDAY = '2026-08-24';
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * The reference marathoner's frame: Sunday long, Saturday rest, Tue/Thu
 * quality, a 15-week block to 2026-12-06, opening mid-block on a 44 mi/wk
 * base. `midBlockRaces` is what separates the two fixtures.
 */
function cimInput(midBlockRaces?: ComposePlanInput['midBlockRaces']): ComposePlanInput {
  const raceDistanceMi = 26.22;
  const goalSec = 10800;
  return {
    raceDistanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / raceDistanceMi),
    raceDateISO: addDays(START_MONDAY, 15 * 7 - 1),
    startMondayISO: START_MONDAY,
    level: 'advanced',
    recentWeeklyMi: 44,
    easyDayMedianMi: 6.5,
    recentLongMi: 18,
    spikeAnchorLongMi: 18,
    isMidBlock: true,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    availableDows: null,
    trainingDaysPerWeek: 6,
    crossModes: [],
    rxQuality: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    rxRaceSpecific: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    tPaceSec: tPaceFromGoal(goalSec, raceDistanceMi),
    lthr: null,
    maxHr: null,
    bestRecentVdot: 47.8,
    ...(midBlockRaces ? { midBlockRaces } : {}),
  } as ComposePlanInput;
}

function build(midBlockRaces?: ComposePlanInput['midBlockRaces']) {
  const input = cimInput(midBlockRaces);
  const composed = composePlan(input);
  finalizeComposedPlan(composed, input.raceDistanceMi, input.level);
  composed.vols = composed.weeks.map((w) => w.weeklyMi);
  return { input, composed };
}

/** The week's training long, race day excluded — the validator's own reading. */
const trainingLongMi = (w: ComposedWeek): number =>
  Math.max(0, ...w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi));

/** Marathon-pace miles a day's own prescription declares, from its sub_label. */
function mpMilesOf(d: DayPlan): number {
  let total = 0;
  const re = /([0-9]+(?:\.[0-9]+)?)\s*mi\s*@\s*(?:M|MP)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d.subLabel ?? ''))) total += Number(m[1]);
  return total;
}

function longRunViolations(composed: ReturnType<typeof build>['composed'], input: ComposePlanInput): string[] {
  try {
    validateComposedPlan(composed, input.raceDistanceMi, 'race-prep', {
      level: input.level, isSteppingStoneToMarathon: false, trailingAvgWeeklyMi: null,
    } as never);
    return [];
  } catch (e) {
    if (!(e instanceof PlanValidationError)) throw e;
    return e.violations.filter((v) => /long run/.test(v));
  }
}

describe('LONGRUN-DEMAND · a planned deload does not suppress the long-run progression', () => {
  const { input, composed } = build();

  it('the fixture reaches the mechanism · the block contains a planned deload', () => {
    const deloads = composed.weeks.filter((w, i) =>
      i >= 2 && isPlannedDeloadWeek(w) && trainingLongMi(w) > 0 && trainingLongMi(composed.weeks[i - 1]) > 0);
    expect(deloads.length, 'no planned deload with load weeks either side — the fixture is inert')
      .toBeGreaterThan(0);
  });

  it('the week after a planned deload is not pinned to the deload\'s own long', () => {
    let checked = 0;
    for (let i = 1; i < composed.weeks.length; i++) {
      const week = composed.weeks[i];
      // A TAPER long DESCENDS by design (Research/08 §9.1) and a deload long is
      // deliberately small, so neither is a week the bridge is about to be
      // asked for. Only a BUILD week rebounding off a deload is.
      if (week.phase === 'TAPER' || week.isRaceWeek || week.isCutback) continue;
      const prev = composed.weeks[i - 1];
      if (!isPlannedDeloadWeek(prev)) continue;
      const bridge = trainingLongMi(composed.weeks[i - 2] ?? ({ days: [] } as unknown as ComposedWeek));
      const deloadLong = trainingLongMi(prev);
      const curr = trainingLongMi(composed.weeks[i]);
      if (!(bridge > 0 && deloadLong > 0 && curr > 0)) continue;
      const flatCeil = Math.floor(longRunWoWCeilingMi('m', deloadLong) * 2) / 2;
      const bridgedCeil = Math.floor(longRunWoWCeilingMi('m', deloadLong, {
        bridgeLongMi: bridge, prevWasPlannedCutback: true,
      }) * 2) / 2;
      // Only assert where the bridge actually licenses more than the flat rule
      // AND the block was asking for it (`layoutWeek` sized the long above the
      // flat ceiling). Otherwise a different guard is the binding one and this
      // says nothing.
      if (!(bridgedCeil > flatCeil)) continue;
      checked++;
      expect(curr, `week ${i}: long pinned at the deload's own ${deloadLong} × 1.30 `
        + `while the pre-deload long of ${bridge} licenses ${bridgedCeil}`)
        .toBeGreaterThan(flatCeil);
    }
    expect(checked, 'no week in the fixture exercised the bridge').toBeGreaterThan(0);
  });

  it('the peak long run clears the runner\'s demonstrated best', () => {
    // 21.5 mi, 2026-01-25 — a training long run, verified not a race (his 26.8
    // and 26.7 are Big Sur and LA). A block whose declared priority is
    // `increase_long_run_demand` cannot peak below what he has already run.
    const DEMONSTRATED_LONG_MI = 21.5;
    expect(Math.max(0, ...composed.weeks.map(trainingLongMi)))
      .toBeGreaterThanOrEqual(DEMONSTRATED_LONG_MI);
  });

  it('the composed long-run sequence stays legal under the validator that owns the rule', () => {
    // The point of CUTBACK-LONG-2 is that these two agree. If the authoring
    // pass ever gets ahead of the validator, this is where it shows.
    expect(longRunViolations(composed, input)).toEqual([]);
  });
});

describe('LONGRUN-DEMAND · the race-specific phase carries §4.4 marathon-pace long runs', () => {
  const TUNE_UPS: NonNullable<ComposePlanInput['midBlockRaces']> = [
    { slug: 'sm10k', name: 'Santa Monica 10k', date: '2026-09-13', distanceMi: 6.2, goalPaceSec: null, priority: 'B' },
    // Sunday · his long-run day. The slot this race consumes IS the defect.
    { slug: 'malibu', name: 'Run Malibu', date: '2026-11-08', distanceMi: 13.1, goalPaceSec: 412, priority: 'B' },
  ];
  const { input, composed } = build(TUNE_UPS);

  it('the fixture reaches the mechanism · a tune-up race takes a long-run slot', () => {
    const consumed = composed.weeks.filter((w) =>
      !w.isRaceWeek && w.days.some((d) => d.type === 'race' && d.isLong));
    expect(consumed.length, 'no tune-up race consumed a long-run slot — the fixture is inert')
      .toBeGreaterThan(0);
  });

  it('the cadence steps over a week that has no long run to carry the session', () => {
    // Pure, at the picker, on the reference block's own numbers: RACE-SPECIFIC
    // is weeks 8..11 of a 15-week block on a three-week deload cadence, and
    // week 10's long-run day is the raced half. The anchor (11) is a deload and
    // the week it steps to (10) has no long run, so the session must land on 9
    // rather than vanish.
    const cutbackEveryN = 3;
    const noLong = (i: number) => i === 10;
    const hits = [8, 9, 10, 11].filter((wk) => racePaceLongThisWeek(wk, 11 - wk, cutbackEveryN, noLong));
    expect(hits, 'the cadence left the race-specific phase with no session at all').not.toEqual([]);
    expect(hits, 'the session was handed to a week whose long run is a race').not.toContain(10);
    // With no raced week the picker is unchanged — the old behaviour, kept.
    expect([8, 9, 10, 11].filter((wk) => racePaceLongThisWeek(wk, 11 - wk, cutbackEveryN)))
      .toEqual([10]);
  });

  it('authors at least one marathon-pace long run in the RACE-SPECIFIC phase', () => {
    const phase = composed.weeks.filter((w) => w.phase === 'RACE-SPECIFIC');
    expect(phase.length, 'no RACE-SPECIFIC phase in the fixture').toBeGreaterThan(0);
    const mpLongs = phase.flatMap((w) =>
      w.days.filter((d) => d.isLong && d.type === 'long' && mpMilesOf(d) > 0));
    expect(mpLongs.length, 'the race-specific phase authors no marathon-pace long run')
      .toBeGreaterThan(0);
  });

  it('the marathon-pace long run doses inside §4.4\'s own band', () => {
    // Read the numbers out of the doc at run time. A check that hardcodes both
    // sides only proves the test agrees with itself (Rule 18).
    const src = doc('04-workout-vocabulary.md');
    const anchor = '### 4.4 Marathon-pace long run';
    expect(src, '§4.4 citation no longer resolves').toContain(anchor);
    const section = src.slice(src.indexOf(anchor), src.indexOf(anchor) + 1400);
    const structure = /\+\s*(\d+)[–-](\d+)\s*mi at MP/.exec(section);
    expect(structure, "§4.4's Structure row no longer states an at-MP range").not.toBeNull();
    const [loMi, hiMi] = [Number(structure![1]), Number(structure![2])];

    const mpLongs = composed.weeks
      .filter((w) => w.phase === 'RACE-SPECIFIC')
      .flatMap((w) => w.days.filter((d) => d.isLong && d.type === 'long' && mpMilesOf(d) > 0));
    for (const d of mpLongs) {
      const mp = mpMilesOf(d);
      expect(mp, `§4.4 asks for ${loMi}-${hiMi} mi at MP; this long carries ${mp}`)
        .toBeGreaterThanOrEqual(loMi);
      expect(mp).toBeLessThanOrEqual(hiMi);
      expect(mp, 'the marathon-pace block cannot exceed the run it sits inside')
        .toBeLessThanOrEqual(d.distanceMi);
    }
  });

  it('a block carrying tune-ups stays legal under the validator', () => {
    expect(longRunViolations(composed, input)).toEqual([]);
  });
});

describe('WEEKANSWERS-1 · the plan explains itself, and the explanation reaches a surface', () => {
  const { composed } = build();

  it('every week carries all six answers, and only a cutback carries the cutback one', () => {
    const strategy = deriveBlockStrategy({
      weeks: composed.weeks,
      phases: composed.blocks.phases.map((p) => ({ label: p.label, weeks: p.weeks, answers: p.answers })),
      targetEvent: { distanceMi: 26.22, category: 'm', dateISO: addDays(START_MONDAY, 15 * 7 - 1) },
      statedGoalSec: 10800,
      thesis: null,
    });
    expect(strategy, 'no strategy derived for a composed block').not.toBeNull();
    expect(strategy!.weeks.length).toBe(composed.weeks.length);
    for (const w of strategy!.weeks) {
      const a = w.answers;
      for (const k of ['whyMileage', 'whyLongRun', 'whyQuality', 'developsPrevious', 'preparesForRace'] as const) {
        expect(a[k], `${w.weekStartISO} · ${k} is empty`).toMatch(/\S/);
      }
      // Rule 11 · not applicable is not the same as unknown.
      if (w.role === 'CUTBACK' || w.role === 'RECOVERY') expect(a.whyCutback).toMatch(/\S/);
      else expect(a.whyCutback).toBeNull();
    }
    for (const k of ['longRunProgression', 'marathonSpecificStart', 'marathonPaceProgression',
      'longestRunReason', 'sustainRaceEffort'] as const) {
      expect(strategy!.answers[k], `block answer ${k} is empty`).toMatch(/\S/);
    }
  });

  it('the answers name real numbers from this block, not generalities', () => {
    const strategy = deriveBlockStrategy({
      weeks: composed.weeks,
      phases: composed.blocks.phases.map((p) => ({ label: p.label, weeks: p.weeks, answers: p.answers })),
      targetEvent: { distanceMi: 26.22, category: 'm', dateISO: addDays(START_MONDAY, 15 * 7 - 1) },
      statedGoalSec: 10800,
      thesis: null,
    });
    const peakLong = Math.max(...composed.weeks.map(trainingLongMi));
    // The sentence about the longest run states the block's actual longest run.
    expect(strategy!.answers.longestRunReason).toContain(String(peakLong).replace(/\.0$/, ''));
    // And every week's mileage answer states that week's own mileage.
    for (const w of strategy!.weeks) {
      const shown = String(Math.round(w.volumeMi * 10) / 10).replace(/\.0$/, '');
      expect(w.answers.whyMileage, `${w.weekStartISO} does not state its own mileage`).toContain(shown);
    }
  });

  it('the wire carries them · buildWeeks and buildBlockAnswers', () => {
    // THE SURFACE, checked rather than assumed. `block_strategy` was derived
    // and persisted for months and reached no route, no component and no Swift
    // file — which is the same as not existing, and is why this assertion is
    // here rather than a note saying the payload "should" carry them.
    const answers: WeekAnswers = {
      whyMileage: 'a', whyLongRun: 'b', whyQuality: 'c',
      whyCutback: null, developsPrevious: 'd', preparesForRace: 'e',
    };
    const blockAnswers: BlockAnswers = {
      longRunProgression: 'p', marathonSpecificStart: 'q', marathonPaceProgression: 'r',
      longestRunReason: 's', sustainRaceEffort: 't',
    };
    const state = {
      weeks: [{
        id: 'wk0', idx: 0, phase: 'QUALITY', startDate: '2026-08-24', plannedMi: 46,
        isRaceWeek: false, isCutback: false, isCurrent: true,
        days: [] as never[],
      }],
      // Matched by DATE. A week with no entry gets no answers key at all.
      weekAnswers: { '2026-08-24': answers },
      blockAnswers,
    } as unknown as Parameters<typeof buildWeeks>[0];

    const wire = buildWeeks(state) as Array<{ answers?: Array<{ label: string; text: string }> }>;
    // Five rows, not six: `whyCutback` is null on this week, so the row is
    // absent rather than blank.
    expect(wire[0].answers?.map((a) => a.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
    const cut = buildWeeks({
      ...state,
      weekAnswers: { '2026-08-24': { ...answers, whyCutback: 'x' } },
    } as typeof state) as typeof wire;
    expect(cut[0].answers?.map((a) => a.text)).toEqual(['a', 'b', 'c', 'x', 'd', 'e']);
    expect(buildBlockAnswers(state)?.map((a) => a.text)).toEqual(['p', 'q', 'r', 's', 't']);

    // No answers for this week's date → the key is ABSENT, not empty.
    const unmatched = buildWeeks({ ...state, weekAnswers: { '2020-01-01': answers } } as typeof state);
    expect((unmatched[0] as { answers?: unknown }).answers).toBeUndefined();
    expect(buildBlockAnswers({ ...state, blockAnswers: null } as typeof state)).toBeNull();
  });
});

describe('LONGRUN-DEMAND · one ceiling, and a raced week is not a deload', () => {
  it('the bridge spends the pre-deload long at the same multiple, never a looser one', () => {
    const flat = longRunWoWCeilingMi('m', 16);
    const bridged = longRunWoWCeilingMi('m', 16, { bridgeLongMi: 19.5, prevWasPlannedCutback: true });
    expect(bridged).toBeGreaterThan(flat);
    expect(bridged / 19.5, 'the bridged ceiling is the same multiple on a different anchor')
      .toBeCloseTo(flat / 16, 9);
    // Without the flag the bridge is inert, so a caller that does not know
    // about deloads cannot accidentally spend it.
    expect(longRunWoWCeilingMi('m', 16, { bridgeLongMi: 19.5 })).toBeCloseTo(flat, 9);
    // And it never LOWERS a ceiling: the anchor is a max, not a replacement.
    expect(longRunWoWCeilingMi('m', 16, { bridgeLongMi: 4, prevWasPlannedCutback: true }))
      .toBeCloseTo(flat, 9);
  });

  it('a raced week is never a planned deload', () => {
    const raced = { isCutback: true, isRaceWeek: false, days: [{ type: 'race' }, { type: 'easy' }] };
    const deload = { isCutback: true, isRaceWeek: false, days: [{ type: 'long' }, { type: 'easy' }] };
    expect(isPlannedDeloadWeek(raced), 'a week the runner raced is not a week the plan told him to ease')
      .toBe(false);
    expect(isPlannedDeloadWeek(deload)).toBe(true);
    expect(isPlannedDeloadWeek({ isCutback: true, isRaceWeek: true, days: [] })).toBe(false);
    expect(isPlannedDeloadWeek({ isCutback: false, isRaceWeek: false, days: [] })).toBe(false);
    expect(isPlannedDeloadWeek(null)).toBe(false);
    // Research/00b is the citation the bridge rests on; fail if it moves.
    expect(doc('00b-recovery-protocols.md')).toContain('### What Cutback Weeks Are Not');
  });
});
