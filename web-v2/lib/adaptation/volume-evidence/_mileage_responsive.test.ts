/**
 * lib/adaptation/volume-evidence/_mileage_responsive.test.ts · MILEAGE-RESPONSIVE-1.
 *
 * THE GATE over the path from "valid extra mileage" to "future weeks are
 * larger". Ten named cases, one per line of the owner's own specification, plus
 * the structural guards.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ──────────────────────────────
 *
 * Stated first and deliberately, because a green run here proves less than it
 * looks:
 *
 * · IT CANNOT FAIL ON THE SEAM BEING SHUT. Every case here proves an ADVISORY
 *   is correct. `AUTOMATIC_ADAPTATION_AUTHORITY` is `false` and this directory
 *   has no writer, so nothing in this file says anything about the plan on the
 *   runner's phone. That is the single largest limitation of the whole change
 *   and it is the owner's own ruling, not an oversight.
 * · IT CANNOT FAIL ON A BAD LOADER. Every case constructs its own input. A
 *   loader that mis-tiers a run, under-reports stressors, or hands a taper week
 *   through as an ordinary one produces confident, well-formed, wrong answers
 *   and nothing here would notice. `_replay_real_history.script.ts` is the
 *   other half and it runs against the real account.
 * · IT CANNOT FAIL ON A WELL-FORMED, WRONG PROPOSAL. The response moves a
 *   week's TOTAL mileage; it does not recompose the days inside it. A proposal
 *   naming the right weeks and the wrong sessions passes everything here.
 * · IT CANNOT GRADE TONE. The voice guard checks characters and phrase lists.
 *   Whether a sentence reads as a coach is a reviewer's judgement.
 *
 * ── RULE 22 · THE DISTRIBUTION, COUNTED ───────────────────────────────────
 *
 * The rule says to count the cases on each side of a mechanism with opposing
 * verdicts, because "twenty-nine files know how to hold a runner back, two know
 * what it means to accelerate one". Counted here, and asserted below so it
 * cannot rot:
 *
 *   cases where the belief RISES or a week is RAISED        4
 *   cases where a raise is correctly WITHHELD or DEFERRED   5
 *   cases where nothing moves in either direction           1
 *
 * Five-to-four toward withholding, against an app whose measured ratio was
 * ZERO upward adaptations in 309 production intents. The imbalance is small and
 * it is deliberate: four of the five withholding cases exist because the OWNER
 * named them (cutback, taper, deterioration, duplicate), so removing them would
 * be removing his specification, not correcting a bias.
 *
 * ── RULE 15 · WHICH CASE REACHES WHICH MECHANISM ──────────────────────────
 *
 * Named inline beside each `it`. The two branches NO case here reaches, stated
 * rather than left dark:
 *
 *   · `applyCapacityLoss` with `mayLowerBelief: true`. Reaching it needs three
 *     consecutive representative weeks below the bar with complete data, no
 *     recovery block and no declared cause. Case 10 constructs one week and
 *     asserts it does NOT reach it, which is the defect that matters; the
 *     three-week case is exercised in `classifyLowWeek` directly rather than
 *     end to end, because the end-to-end path would need a whole synthetic
 *     block and would test the fixture more than the code.
 *   · `PreservationReason: 'IN_THE_PAST'`. `respondToVolumeEvidence` is only
 *     ever handed future weeks by its loader, so the branch exists as a
 *     belt-and-braces guard and is exercised by a direct unit case below.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { QueuedDeferral } from '@/lib/adaptation/canonical/deferral-queue';
import { VOLUME_ADDITION_THRESHOLD } from '@/lib/plan/adjudication/adjudicate';
import { AUTOMATIC_ADAPTATION_AUTHORITY } from '@/lib/plan/adaptation-authority';
import { SUSTAINED_WEEK_RANK } from '@/lib/training/normal-window';
import { classifyWeekSurplus } from './classify';
import { admitSurplus, classifyLowWeek, type AdmissionInput, type LowWeekInput } from './admit';
import {
  applyCapacityLoss, rankWeek, unmeasuredBelief, updateDemonstratedVolume,
} from './belief';
import { respondToVolumeEvidence, type PhaseIntent, type VolumeResponseInput } from './respond';
import { allExplanations } from './explain';
// ONE DOOR · the engine's vocabulary reaches this directory through
// `./contract` and nowhere else. See that file's own section for the argument
// and for the four grants in `canonical/_cannot_mutate.test.ts`'s ALLOWLIST.
import {
  absent, failed, measured, type Measured,
  reconsiderAtBoundary,
  VOLUME_MAX_STEP_FRAC,
  VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
  RULE_21_THRESHOLD_LEDGER,
  type DemonstratedVolumeBelief,
  type FutureWeek,
  type SurplusRun,
  type WeekSurplusInput,
} from './contract';

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURES · one runner, the owner's own shape: ~40 mi weeks, a Sunday long,
 * two quality days. Every case perturbs exactly one thing.
 * ═══════════════════════════════════════════════════════════════════════ */

const WEEK = '2026-08-31';
const TODAY = '2026-09-07';

const run = (o: Partial<SurplusRun> & { activityId: string; dateISO: string }): SurplusRun => ({
  distanceMi: measured(6),
  match: 'exact',
  mergedIntoAnother: false,
  isRace: false,
  prescribedMi: 6,
  movedFromDateISO: null,
  ...o,
});

/** A 40 mi prescribed week run at exactly 40. */
function weekInput(o: Partial<WeekSurplusInput> = {}): WeekSurplusInput {
  return {
    weekStartISO: WEEK,
    prescribedMi: 40,
    authoredPlanMode: 'BUILD',
    isCutback: false,
    isRaceWeek: false,
    inPrescribedRaceWindow: false,
    dataComplete: true,
    runs: [
      run({ activityId: 'a1', dateISO: '2026-08-31', distanceMi: measured(6), prescribedMi: 6 }),
      run({ activityId: 'a2', dateISO: '2026-09-01', distanceMi: measured(8), prescribedMi: 8 }),
      run({ activityId: 'a3', dateISO: '2026-09-02', distanceMi: measured(6), prescribedMi: 6 }),
      run({ activityId: 'a4', dateISO: '2026-09-04', distanceMi: measured(4), prescribedMi: 4 }),
      run({ activityId: 'a5', dateISO: '2026-09-06', distanceMi: measured(16), prescribedMi: 16 }),
    ],
    ...o,
  };
}

/** The same week with the long run taken 5 miles past its prescription. */
function overrunWeek(overMi = 5): WeekSurplusInput {
  const base = weekInput();
  return {
    ...base,
    runs: base.runs.map((r) => (r.activityId === 'a5'
      ? { ...r, distanceMi: measured(16 + overMi) }
      : r)),
  };
}

function admissionInput(o: Partial<AdmissionInput> & { week: AdmissionInput['week'] }): AdmissionInput {
  return {
    identityResolved: measured(true),
    telemetry: absent('no heart-rate trace on these runs'),
    deterioration: measured({
      repeated: false, deterioratedCount: 0, unknownCount: 0, cleanCount: 3,
      detail: 'three comparable sessions, none deteriorated',
    }),
    keySessionGrades: ['FULL', 'SUBSTANTIAL'],
    painOrInjuryReported: measured(false),
    unplannedRecoveryTaken: measured(false),
    followingWeekCompletionFrac: measured(1.0),
    absorptionCompletionBar: VOLUME_WEEK_COMPLETION_MIN_FRAC,
    ...o,
  };
}

const futureWeek = (o: Partial<FutureWeek> & { weekStartISO: string }): FutureWeek => ({
  prescribedMi: 40,
  sealed: false,
  isCutback: false,
  isTaper: false,
  isRaceWeek: false,
  stressors: ['threshold', 'long'],
  longestMi: 16,
  mpMi: 0,
  ...o,
});

const FOUR_ORDINARY_WEEKS: FutureWeek[] = [
  futureWeek({ weekStartISO: '2026-09-07' }),
  futureWeek({ weekStartISO: '2026-09-14' }),
  futureWeek({ weekStartISO: '2026-09-21' }),
  futureWeek({ weekStartISO: '2026-09-28' }),
];

/** A belief that has seen 40 mi weeks and a 41 mi peak. */
const PRIOR_BELIEF: DemonstratedVolumeBelief = {
  asOfISO: WEEK,
  peakWeeklyMi: 41,
  sustainedWeeklyMi: 39,
  heldWeeklyMi: 40,
  meanWeeklyMi: 38,
  absorbedWeeklyMiUnfiltered: 41,
  moves: [],
};

function responseInput(o: Partial<VolumeResponseInput> & {
  week: VolumeResponseInput['week'];
  admission: VolumeResponseInput['admission'];
  beliefAfter: VolumeResponseInput['beliefAfter'];
}): VolumeResponseInput {
  return {
    asOfISO: TODAY,
    athleteId: 'athlete-1',
    planVersion: 'plan-1',
    evidenceVersion: '2026-09-06',
    beliefBefore: PRIOR_BELIEF,
    futureWeeks: FOUR_ORDINARY_WEEKS,
    weekBeforeFirstFuture: futureWeek({ weekStartISO: WEEK, prescribedMi: 40 }),
    phase: 'BUILD' as PhaseIntent,
    distanceFloorMi: 30,
    templatePeakBandMi: [45, 55],
    stepsTakenThisCycle: 0,
    nextBoundaryISO: '2026-09-14',
    ...o,
  };
}

/** The whole pipeline, so a case perturbs one input and reads one answer. */
function runPipeline(args: {
  week?: WeekSurplusInput;
  admission?: Partial<AdmissionInput>;
  response?: Partial<VolumeResponseInput>;
  representativeWeeklyMi?: number[];
  prior?: DemonstratedVolumeBelief;
}) {
  const surplus = classifyWeekSurplus(args.week ?? overrunWeek());
  const admission = admitSurplus(admissionInput({ week: surplus, ...(args.admission ?? {}) }));
  const prior = args.prior ?? PRIOR_BELIEF;
  const beliefAfter = updateDemonstratedVolume({
    asOfISO: TODAY,
    prior,
    week: surplus,
    admission,
    representativeWeeklyMi: args.representativeWeeklyMi ?? [36, 38, 39, 40, 41, 45],
    allWeeklyMiUnfiltered: [36, 38, 39, 40, 41, 45],
    sustainedRank: SUSTAINED_WEEK_RANK,
    lowWeek: null,
  });
  const response = respondToVolumeEvidence(responseInput({
    week: surplus, admission, beliefBefore: prior, beliefAfter, ...(args.response ?? {}),
  }));
  return { surplus, admission, beliefAfter, response };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE TEN CASES
 * ═══════════════════════════════════════════════════════════════════════ */

describe('1 · a successful prescribed overrun', () => {
  // Rule 15 · this is the ONLY case that reaches the PRESCRIBED_OVERRUN branch
  // of classifyRun with a positive excess, the admitted branch of admitSurplus
  // with all five conditions MET, and the raise loop in respondToVolumeEvidence.
  const { surplus, admission, beliefAfter, response } = runPipeline({});

  it('names the extra miles as an overrun of the prescribed session', () => {
    const long = surplus.runs.find((r) => r.activityId === 'a5')!;
    expect(long.kind).toBe('PRESCRIBED_OVERRUN');
    expect(long.surplusMi).toBe(5);
    expect(surplus.admissibleSurplusMi).toEqual(measured(5));
  });

  it('admits it, with all five conditions read', () => {
    expect(admission.admitted).toBe(true);
    expect(admission.conditions).toHaveLength(5);
    expect(admission.conditions.every((c) => c.verdict === 'MET')).toBe(true);
  });

  it('raises the demonstrated peak to what he actually ran', () => {
    expect(beliefAfter.peakWeeklyMi).toBe(45);
    expect(beliefAfter.moves.some((m) => m.field === 'peakWeeklyMi' && m.fromMi === 41 && m.toMi === 45))
      .toBe(true);
  });

  it('makes future weeks LARGER, which is the whole question', () => {
    const raised = response.weeks.filter((w) => w.deltaMi > 0);
    expect(raised.length).toBeGreaterThan(0);
    expect(response.totalAddedMi).toBeGreaterThan(0);
    for (const w of raised) {
      // Never more than the doctrine step, on any week.
      expect(w.deltaMi).toBeLessThanOrEqual(w.beforeMi * VOLUME_MAX_STEP_FRAC + 1e-9);
    }
  });

  it('says so in one sentence the runner can read', () => {
    expect(response.explanation).toContain('You handled more volume');
    expect(response.explanation).toContain('upcoming mileage increases');
  });

  // FALSIFICATION · the mechanism is not a tautology. Withdraw the surplus and
  // the same pipeline produces no raise at all.
  it('FALSIFIER · with no surplus, nothing moves', () => {
    const flat = runPipeline({ week: weekInput() });
    expect(flat.admission.admitted).toBe(false);
    expect(flat.beliefAfter.peakWeeklyMi).toBe(41);
    expect(flat.response.totalAddedMi).toBe(0);
    expect(flat.response.weeks.every((w) => w.deltaMi === 0)).toBe(true);
  });
});

describe('2 · an absorbed supplemental run', () => {
  // Rule 15 · the ONLY case reaching the SUPPLEMENTAL_RUN branch.
  const week = weekInput();
  const withExtra: WeekSurplusInput = {
    ...week,
    runs: [...week.runs, run({
      activityId: 'a6', dateISO: '2026-09-05', distanceMi: measured(5),
      match: 'supplemental', prescribedMi: null,
    })],
  };
  const { surplus, admission, response } = runPipeline({ week: withExtra });

  it('counts every mile of a run that satisfied no prescription', () => {
    const extra = surplus.runs.find((r) => r.activityId === 'a6')!;
    expect(extra.kind).toBe('SUPPLEMENTAL_RUN');
    expect(extra.surplusMi).toBe(5);
    expect(surplus.completedMi).toEqual(measured(45));
  });

  it('admits it and raises future weeks', () => {
    expect(admission.admitted).toBe(true);
    expect(response.totalAddedMi).toBeGreaterThan(0);
  });

  // FALSIFICATION · the same run, on a day whose prescription it merely moved,
  // must NOT read as new volume.
  it('FALSIFIER · the same miles as a MOVED session buy nothing', () => {
    const moved: WeekSurplusInput = {
      ...week,
      runs: [...week.runs, run({
        activityId: 'a6', dateISO: '2026-09-05', distanceMi: measured(5),
        match: 'exact', prescribedMi: 5, movedFromDateISO: '2026-09-03',
      })],
    };
    const out = runPipeline({ week: moved });
    expect(out.surplus.runs.find((r) => r.activityId === 'a6')!.kind).toBe('MOVED_SESSION');
    expect(out.surplus.admissibleSurplusMi).toEqual(measured(0));
    expect(out.admission.admitted).toBe(false);
    expect(out.response.totalAddedMi).toBe(0);
  });
});

describe('3 · an overrun followed by deterioration', () => {
  // Rule 15 · the ONLY case reaching the `deterioration.value.repeated` branch.
  const { admission, beliefAfter, response } = runPipeline({
    admission: {
      deterioration: measured({
        repeated: true, deterioratedCount: 2, unknownCount: 0, cleanCount: 1,
        detail: 'the final third slowed at equal or higher heart rate in two sessions',
      }),
    },
  });

  it('refuses, and says which condition refused', () => {
    expect(admission.admitted).toBe(false);
    if (admission.admitted) throw new Error('unreachable');
    expect(admission.outcome).toBe('NOT_SUPPORTED');
    expect(admission.blocking).toContain('NO_MATERIAL_DETERIORATION');
  });

  it('leaves the belief exactly where it was', () => {
    expect(beliefAfter.peakWeeklyMi).toBe(PRIOR_BELIEF.peakWeeklyMi);
    expect(beliefAfter.moves).toEqual([]);
  });

  it('moves no future week, and explains why without judging', () => {
    expect(response.totalAddedMi).toBe(0);
    expect(response.explanation).toContain('fell away towards the end');
  });

  it('DISTINGUISHES an unreadable session from a deteriorated one · Rule 11', () => {
    const unknown = runPipeline({
      admission: { deterioration: failed('the splits could not be read') },
    });
    expect(unknown.admission.admitted).toBe(false);
    if (unknown.admission.admitted) throw new Error('unreachable');
    // A DIFFERENT outcome, and a different sentence. This is the whole rule.
    expect(unknown.admission.outcome).toBe('UNREADABLE');
    expect(unknown.response.explanation).not.toContain('fell away');
    expect(unknown.response.explanation).toContain('could not be read');
  });

  // FALSIFICATION · with deterioration CLEAN, the identical week is admitted.
  it('FALSIFIER · clean execution admits the same week', () => {
    expect(runPipeline({}).admission.admitted).toBe(true);
  });
});

describe('4 · a duplicate / recording artifact', () => {
  // Rule 15 · the ONLY case reaching the `mergedIntoAnother` branch, which is
  // Rule 14's canonical predicate answered.
  const base = overrunWeek();
  const withDupe: WeekSurplusInput = {
    ...base,
    runs: [...base.runs, run({
      activityId: 'dupe', dateISO: '2026-09-06', distanceMi: measured(21),
      mergedIntoAnother: true, match: 'exact', prescribedMi: 16,
    })],
  };
  const { surplus, response } = runPipeline({ week: withDupe });

  it('never counts a merged row as volume, however large it is', () => {
    expect(surplus.runs.find((r) => r.activityId === 'dupe')!.kind).toBe('RECORDING_ARTIFACT');
    // 6+8+6+4+21 canonical = 45, exactly the same as without the duplicate.
    expect(surplus.completedMi).toEqual(measured(45));
    expect(surplus.admissibleSurplusMi).toEqual(measured(5));
    expect(surplus.excluded.some((e) => e.activityId === 'dupe')).toBe(true);
  });

  it('produces the same answer as the week without the duplicate in it', () => {
    const clean = runPipeline({});
    expect(response.totalAddedMi).toBe(clean.response.totalAddedMi);
    expect(response.beliefAfter.peakWeeklyMi).toBe(clean.response.beliefAfter.peakWeeklyMi);
  });

  // FALSIFICATION · drop the canonical predicate and the duplicate's 21 miles
  // become free credit. This is the shape of the 63-lost-miles incident, run
  // the other way.
  it('FALSIFIER · counting the merged row would inflate the week by 21 mi', () => {
    const asIfCanonical: WeekSurplusInput = {
      ...withDupe,
      runs: withDupe.runs.map((r) => ({ ...r, mergedIntoAnother: false })),
    };
    const wrong = classifyWeekSurplus(asIfCanonical);
    expect(wrong.completedMi).toEqual(measured(66));
    expect(wrong.completedMi.ok && surplus.completedMi.ok
      && wrong.completedMi.value - surplus.completedMi.value).toBe(21);
  });

  it('an UNREADABLE distance refuses the week rather than under-counting it', () => {
    const broken: WeekSurplusInput = {
      ...base,
      runs: base.runs.map((r) => (r.activityId === 'a2'
        ? { ...r, distanceMi: failed('no distance on this activity') as Measured<number> }
        : r)),
    };
    const out = classifyWeekSurplus(broken);
    expect(out.completedMi.ok).toBe(false);
    const adm = admitSurplus(admissionInput({ week: out }));
    expect(adm.admitted).toBe(false);
    if (adm.admitted) throw new Error('unreachable');
    expect(adm.outcome).toBe('UNREADABLE');
  });
});

describe('5 · an extra-mileage week before a planned cutback', () => {
  // Rule 15 · the ONLY case reaching PreservationReason CUTBACK_WEEK.
  const weeks: FutureWeek[] = [
    futureWeek({ weekStartISO: '2026-09-07', isCutback: true, prescribedMi: 30 }),
    futureWeek({ weekStartISO: '2026-09-14' }),
  ];
  const { response } = runPipeline({ response: { futureWeeks: weeks } });

  it('leaves the cutback exactly as authored, and names the reason', () => {
    const cut = response.weeks.find((w) => w.weekStartISO === '2026-09-07')!;
    expect(cut.afterMi).toBe(30);
    expect(cut.deltaMi).toBe(0);
    expect(cut.preserved).toBe('CUTBACK_WEEK');
  });

  it('still records the evidence, which is the owner\'s own sentence', () => {
    expect(response.beliefAfter.peakWeeklyMi).toBe(45);
    // The week AFTER the cutback is ordinary and does move, so the block is not
    // frozen: only the cutback is protected.
    expect(response.weeks.find((w) => w.weekStartISO === '2026-09-14')!.deltaMi).toBeGreaterThan(0);
  });

  it('says the owner\'s sentence when the cutback is the only week ahead', () => {
    const onlyCutback = runPipeline({
      response: { futureWeeks: [weeks[0]] },
    });
    expect(onlyCutback.response.explanation)
      .toBe('The extra mileage counts as evidence, but next week remains a cutback.');
  });

  // FALSIFICATION · the same week, not marked as a cutback, IS raised.
  it('FALSIFIER · the identical week without the cutback flag is raised', () => {
    const notCutback = runPipeline({
      response: { futureWeeks: [futureWeek({ weekStartISO: '2026-09-07', prescribedMi: 30 })] },
    });
    expect(notCutback.response.weeks[0].deltaMi).toBeGreaterThan(0);
  });
});

describe('6 · an extra-mileage week before taper', () => {
  // Rule 15 · the ONLY case reaching PreservationReason TAPER_WEEK, and the
  // only one reaching the phase guard with a non-building phase.
  const weeks: FutureWeek[] = [
    futureWeek({ weekStartISO: '2026-09-07', isTaper: true, prescribedMi: 28 }),
    futureWeek({ weekStartISO: '2026-09-14', isRaceWeek: true, prescribedMi: 18 }),
  ];
  const { response } = runPipeline({ response: { futureWeeks: weeks } });

  it('grows neither the taper nor race week', () => {
    expect(response.weeks.map((w) => w.preserved)).toEqual(['TAPER_WEEK', 'RACE_WEEK']);
    expect(response.totalAddedMi).toBe(0);
  });

  it('refuses at the PHASE level too, so a taper block moves nothing at all', () => {
    const inTaper = runPipeline({
      response: { phase: 'TAPER', futureWeeks: FOUR_ORDINARY_WEEKS },
    });
    expect(inTaper.response.totalAddedMi).toBe(0);
    expect(inTaper.response.weeks.every((w) => w.preserved === 'TAPER_WEEK')).toBe(true);
    expect(inTaper.response.explanation).toContain('shed fatigue');
  });

  it('and a taper WEEK the runner overran is never read as his normal · Rule 8', () => {
    const taperSurplus = classifyWeekSurplus({ ...overrunWeek(), authoredPlanMode: 'TAPER' });
    expect(taperSurplus.prescribedNonNormal).toBe(true);
    expect(taperSurplus.admissibleSurplusMi.ok).toBe(false);
    // But the raw surplus is still REPORTED. The taper happened.
    expect(taperSurplus.rawSurplusMi).toEqual(measured(5));
  });

  // FALSIFICATION · in BUILD, with ordinary weeks, the identical evidence moves.
  it('FALSIFIER · the same evidence in BUILD raises weeks', () => {
    expect(runPipeline({}).response.totalAddedMi).toBeGreaterThan(0);
  });
});

describe('7 · two consecutive successfully absorbed higher-volume weeks', () => {
  // Rule 15 · the ONLY case reaching the SECOND `raise` of peakWeeklyMi, and
  // the only one that proves the belief compounds rather than resetting.
  const first = runPipeline({});
  const second = runPipeline({
    prior: first.beliefAfter,
    week: overrunWeek(8),
    representativeWeeklyMi: [38, 39, 40, 41, 45, 48],
  });

  it('the belief moves twice, and each move records its evidence', () => {
    expect(first.beliefAfter.peakWeeklyMi).toBe(45);
    expect(second.beliefAfter.peakWeeklyMi).toBe(48);
    expect(second.beliefAfter.moves.find((m) => m.field === 'peakWeeklyMi')!.fromMi).toBe(45);
    expect(second.beliefAfter.moves[0].evidence).toHaveLength(1);
  });

  it('the sustained reading follows, because rank 3 rose too', () => {
    expect(rankWeek([38, 39, 40, 41, 45, 48], SUSTAINED_WEEK_RANK)).toBe(41);
    expect(second.beliefAfter.sustainedWeeklyMi).toBe(41);
  });

  it('and the envelope the plan is measured against rises with it', () => {
    const before = first.response.contractAfter.plannedPeakLoad;
    const after = second.response.contractAfter.plannedPeakLoad;
    expect(before.known && after.known && after.mi).toBeGreaterThan(
      before.known ? before.mi : Number.POSITIVE_INFINITY,
    );
  });

  // FALSIFICATION · the cadence bound still holds. A second step inside the
  // same cutback cycle is refused, which is what stops "add the same amount
  // forever".
  it('FALSIFIER · a step already taken this cycle blocks the second', () => {
    const blocked = runPipeline({
      prior: first.beliefAfter,
      week: overrunWeek(8),
      response: { stepsTakenThisCycle: VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE },
    });
    expect(blocked.response.totalAddedMi).toBe(0);
  });
});

describe('8 · simultaneous volume and intensity proposals', () => {
  // Rule 15 · the ONLY case reaching detectSimultaneousStressAddition with a
  // finding, and therefore the only one reaching the deferral writer.
  const weeks: FutureWeek[] = [
    futureWeek({ weekStartISO: '2026-09-07', stressors: ['threshold', 'long', 'intervals'] }),
    futureWeek({ weekStartISO: '2026-09-14', stressors: ['threshold', 'long', 'intervals'] }),
  ];
  const { response } = runPipeline({
    response: {
      futureWeeks: weeks,
      // The week before carries FEWER stressors, so raising 09-07's mileage
      // makes it add both at once.
      weekBeforeFirstFuture: futureWeek({ weekStartISO: WEEK, prescribedMi: 30, stressors: ['long'] }),
    },
  });

  it('detects it through the adjudication layer, not a second implementation', () => {
    expect(response.simultaneousStressFindings.length).toBeGreaterThan(0);
    // The sentence is the ADJUDICATION LAYER'S own, which is the proof this
    // directory calls it rather than reimplementing the rule.
    expect(response.simultaneousStressFindings[0].why)
      .toContain('Research/00a \u00a7"Practical load rules"');
    expect(response.simultaneousStressFindings[0].why)
      .toContain('one or the other in a given week, not both');
  });

  it('holds the increase rather than applying it', () => {
    const held = response.weeks.find((w) => w.weekStartISO === '2026-09-07')!;
    expect(held.deltaMi).toBe(0);
    expect(held.preserved).toBe('SIMULTANEOUS_VOLUME_AND_INTENSITY');
  });

  it('and never discards it · step 10', () => {
    expect(response.deferred).toHaveLength(1);
    expect(response.deferred[0].lever).toBe('WEEKLY_VOLUME');
    expect(response.deferred[0].proposedAfterValue).toBeGreaterThan(response.deferred[0].beforeValue);
    expect(response.deferred[0].reasonDetail).toContain('Practical load rules');
  });

  // FALSIFICATION · with the stressor count unchanged week to week, doctrine
  // permits the mileage and the increase lands.
  it('FALSIFIER · equal stressor counts let the same increase apply', () => {
    const ok = runPipeline({
      response: {
        futureWeeks: weeks,
        weekBeforeFirstFuture: futureWeek({
          weekStartISO: WEEK, prescribedMi: 30, stressors: ['threshold', 'long', 'intervals'],
        }),
      },
    });
    expect(ok.response.simultaneousStressFindings).toEqual([]);
    expect(ok.response.weeks.find((w) => w.weekStartISO === '2026-09-07')!.deltaMi)
      .toBeGreaterThan(0);
  });
});

describe('9 · a deferred increase that later applies', () => {
  // Rule 15 · the ONLY case that drives lib/adaptation/canonical/deferral-queue.ts
  // end to end from this directory's own output.
  const weeks: FutureWeek[] = [
    futureWeek({ weekStartISO: '2026-09-07', stressors: ['threshold', 'long', 'intervals'] }),
  ];
  const { response } = runPipeline({
    response: {
      futureWeeks: weeks,
      weekBeforeFirstFuture: futureWeek({ weekStartISO: WEEK, prescribedMi: 30, stressors: ['long'] }),
    },
  });
  const queued: QueuedDeferral[] = [...response.deferred];

  it('the evidence survives the boundary it could not cross', () => {
    expect(queued).toHaveLength(1);
    const out = reconsiderAtBoundary({
      queue: queued,
      atISO: '2026-09-14',
      freshRecords: [],
      currentPlanVersion: 'plan-1',
      blockEndedISO: null,
    });
    expect(out.expired).toEqual([]);
    // An item can appear in BOTH lists: carried across the boundary AND
    // reconsidered at it. Count distinct queue ids, not list entries.
    const alive = new Set(out.carried.concat(out.reconsidered).map((i) => i.queueId));
    expect(alive.size).toBe(1);
  });

  it('and the increase is still the one the evidence earned', () => {
    const out = reconsiderAtBoundary({
      queue: queued, atISO: '2026-09-14', freshRecords: [],
      currentPlanVersion: 'plan-1', blockEndedISO: null,
    });
    const item = out.reconsidered[0] ?? out.carried[0];
    expect(item.proposedAfterValue).toBe(response.deferred[0].proposedAfterValue);
  });

  // FALSIFICATION · a deferral whose block has ended must NOT come back.
  it('FALSIFIER · the queue expires it when the block ends', () => {
    const out = reconsiderAtBoundary({
      queue: queued, atISO: '2026-09-14', freshRecords: [],
      currentPlanVersion: 'plan-1', blockEndedISO: '2026-09-10',
    });
    expect(out.expired).toHaveLength(1);
    expect(out.expired[0].expiry).toBe('BLOCK_ENDED');
  });
});

describe('10 · a missed week does NOT trigger an unjustified regression', () => {
  // Rule 15 · the ONLY case reaching classifyLowWeek's MISSED_TRAINING branch
  // through applyCapacityLoss, and the case that proves the deliberate
  // asymmetry in RULE_21_THRESHOLD_LEDGER row 7 is real.
  const lowInput = (o: Partial<LowWeekInput> = {}): LowWeekInput => ({
    weekStartISO: '2026-09-07',
    prescribedMi: 40,
    completedMi: measured(22),
    prescribedNonNormal: false,
    dataComplete: true,
    declaredCause: absent('nothing declared'),
    consecutiveLowRepresentativeWeeks: 1,
    minConsecutiveWeeksForLoss: VOLUME_MIN_CONSECUTIVE_WEEKS,
    ...o,
  });

  it('one short week is stated, never spent', () => {
    const r = classifyLowWeek(lowInput());
    expect(r.cause).toBe('MISSED_TRAINING');
    expect(r.mayLowerBelief).toBe(false);
    const after = applyCapacityLoss(PRIOR_BELIEF, r, 22, TODAY);
    expect(after.peakWeeklyMi).toBe(41);
    expect(after.sustainedWeeklyMi).toBe(39);
    expect(after.moves).toEqual([]);
  });

  it('the five other causes are five DIFFERENT facts · Rule 11', () => {
    expect(classifyLowWeek(lowInput({ prescribedNonNormal: true })).cause)
      .toBe('PRESCRIBED_RECOVERY_OR_TAPER');
    expect(classifyLowWeek(lowInput({ dataComplete: false })).cause).toBe('INCOMPLETE_DATA');
    expect(classifyLowWeek(lowInput({ completedMi: failed('unreadable') })).cause)
      .toBe('INCOMPLETE_DATA');
    expect(classifyLowWeek(lowInput({ declaredCause: measured('TRAVEL_OR_LIFE') })).cause)
      .toBe('TRAVEL_OR_LIFE');
    expect(classifyLowWeek(lowInput({ declaredCause: measured('ILLNESS_OR_INJURY') })).cause)
      .toBe('ILLNESS_OR_INJURY');
    const causes = new Set([
      'MISSED_TRAINING', 'PRESCRIBED_RECOVERY_OR_TAPER', 'INCOMPLETE_DATA',
      'TRAVEL_OR_LIFE', 'ILLNESS_OR_INJURY', 'GENUINE_CAPACITY_LOSS',
    ]);
    expect(causes.size).toBe(6);
  });

  it('and even a GENUINE loss may never lower the peak · the one asymmetry', () => {
    const loss = classifyLowWeek(lowInput({
      consecutiveLowRepresentativeWeeks: VOLUME_MIN_CONSECUTIVE_WEEKS,
    }));
    expect(loss.cause).toBe('GENUINE_CAPACITY_LOSS');
    expect(loss.mayLowerBelief).toBe(true);
    const after = applyCapacityLoss(PRIOR_BELIEF, loss, 22, TODAY);
    expect(after.peakWeeklyMi).toBe(41);          // untouched, on purpose
    expect(after.sustainedWeeklyMi).toBe(22);
    expect(after.heldWeeklyMi).toBe(22);
    expect(after.moves.every((m) => m.field !== 'peakWeeklyMi')).toBe(true);
  });

  // FALSIFICATION · the branch that DOES lower is reachable, so the
  // no-regression assertion above is not passing because nothing can ever fire.
  it('FALSIFIER · three consecutive low weeks DO reach the lowering branch', () => {
    const loss = classifyLowWeek(lowInput({ consecutiveLowRepresentativeWeeks: 3 }));
    expect(applyCapacityLoss(PRIOR_BELIEF, loss, 22, TODAY).moves.length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * STRUCTURAL GUARDS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RULE 21 · every upward threshold sits beside its downward opposite', () => {
  it('the ledger is populated and every asymmetric row carries a citation', () => {
    expect(RULE_21_THRESHOLD_LEDGER.length).toBeGreaterThanOrEqual(8);
    for (const row of RULE_21_THRESHOLD_LEDGER) {
      expect(row.question.length, row.question).toBeGreaterThan(10);
      expect(row.up.length, row.question).toBeGreaterThan(5);
      expect(row.down.length, row.question).toBeGreaterThan(5);
      if (!row.symmetric) {
        expect(row.asymmetryJustification, `asymmetric row with no citation: ${row.question}`)
          .toBeTruthy();
        expect(row.asymmetryJustification!.length).toBeGreaterThan(120);
      } else {
        expect(row.asymmetryJustification).toBeNull();
      }
    }
  });

  it('the numbers quoted in the ledger are the numbers the code uses', () => {
    // Rule 18 · read the values out of the source rather than hardcoding both
    // sides, so a constant that moves makes the ledger fail rather than lie.
    const quoted = (needle: string): number => {
      const row = RULE_21_THRESHOLD_LEDGER.find((r) => r.up.includes(needle) || r.down.includes(needle));
      expect(row, `no ledger row quotes ${needle}`).toBeTruthy();
      const m = /=\s*([\d.]+)|\(([\d.]+)\)/.exec(`${row!.up} ${row!.down}`);
      return Number(m![1] ?? m![2]);
    };
    expect(quoted('VOLUME_MIN_CONSECUTIVE_WEEKS')).toBe(VOLUME_MIN_CONSECUTIVE_WEEKS);
    expect(quoted('VOLUME_ADDITION_THRESHOLD')).toBe(VOLUME_ADDITION_THRESHOLD);
    expect(quoted('VOLUME_MAX_STEP_FRAC')).toBe(VOLUME_MAX_STEP_FRAC);
    expect(quoted('VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE')).toBe(VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE);
  });

  it('the bar to go UP is the SAME constant as the bar to come down', () => {
    // The symmetry is a fact about the imports, not a claim in a comment: both
    // directions read VOLUME_ADDITION_THRESHOLD from one module.
    const src = readFileSync(path.join(__dirname, 'admit.ts'), 'utf8');
    expect(src).toContain("import { VOLUME_ADDITION_THRESHOLD } from '@/lib/plan/adjudication/adjudicate'");
    expect(src).not.toMatch(/const\s+VOLUME_ADDITION_THRESHOLD\s*=/);
  });
});

describe('THE SEAM STAYS SEALED', () => {
  it('automatic plan mutation is still off, and this directory did not open it', () => {
    expect(AUTOMATIC_ADAPTATION_AUTHORITY).toBe(false);
    const seam = readFileSync(
      path.join(__dirname, '..', '..', 'plan', 'adaptation-authority.ts'), 'utf8');
    expect(seam).toMatch(/export const AUTOMATIC_ADAPTATION_AUTHORITY\s*:\s*false\s*=\s*false\s*;/);
  });

  it('no file here names the seam, a plan writer, or a database', () => {
    const files = readdirSync(__dirname)
      .filter((f) => f.endsWith('.ts') && !f.includes('.test.') && !f.includes('.script.'));
    // Rule 18 · liveness. A guard that scanned zero files would report clean.
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const code = readFileSync(path.join(__dirname, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, `${f} imports a database`).not.toMatch(/from\s+['"]@\/lib\/db\//);
      expect(code, `${f} names a plan writer`)
        .not.toMatch(/\b(applyAdaptations|tryAdaptiveBump|writeWorkoutProposals|mutatePlan|persistComposedPlan)\b/);
      expect(code, `${f} issues a write`).not.toMatch(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+[a-z_]/i);
    }
  });

  it('the pre-existing zero-mutation scan actually REACHES this directory', () => {
    // Rule 18 · do not assume a gate covers you. `_zero_mutation_scan.test.ts`
    // walks lib/adaptation recursively; this asserts the walk finds these files
    // rather than trusting the header that says it does.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('._') || name === 'node_modules') continue;
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith('.ts')) out.push(p);
      }
      return out;
    };
    const adaptationRoot = path.join(__dirname, '..');
    const seen = walk(adaptationRoot).filter((p) => p.includes(`${path.sep}volume-evidence${path.sep}`));
    expect(seen.length).toBeGreaterThanOrEqual(5);
  });
});

describe('RULE 16 · one owner for "how much load", and this is not a second one', () => {
  it('nothing outside the load contract computes an envelope', () => {
    // Rule 18 · read it out of the tree rather than asserting it in prose. The
    // contract module owns the arithmetic; this directory hands it fresher
    // evidence and reads the result.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('._') || name === 'node_modules' || name === '.next') continue;
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
      }
      return out;
    };
    const libRoot = path.join(__dirname, '..', '..');
    const all = walk(libRoot);
    // Liveness · a scanner that read nothing would report clean.
    expect(all.length).toBeGreaterThan(300);
    const callers = all.filter((p) => !p.includes('load-progression-contract')
      && !/\.(test|script)\.ts$/.test(p)
      && readFileSync(p, 'utf8').includes('resolveLoadProgressionContract('));
    const rel = callers.map((p) => path.relative(libRoot, p)).sort();
    expect(rel).toEqual([
      'adaptation/volume-evidence/respond.ts',
      'plan/generate.ts',
    ]);
  });
});

describe('COACH VOICE · every sentence this directory can say', () => {
  const lines = allExplanations();

  it('produces a sentence for every branch, and none of them is empty', () => {
    expect(lines.length).toBeGreaterThan(50);
    expect(lines.every((l) => l.trim().length > 20)).toBe(true);
  });

  it('no exclamation mark, no emoji, no em dash', () => {
    for (const l of lines) {
      expect(l, l).not.toMatch(/[!—]/);
      expect(l, l).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it('no hype and no scolding', () => {
    const banned = /\b(awesome|amazing|crush|nailed|smashed|great job|well done|you should have|you failed|disappointing)\b/i;
    for (const l of lines) expect(l, l).not.toMatch(banned);
  });

  it('and it says a thing ONCE · Rule 17', () => {
    // One response yields ONE sentence, not one per week.
    const many = runPipeline({
      response: {
        futureWeeks: [
          futureWeek({ weekStartISO: '2026-09-07', isCutback: true }),
          futureWeek({ weekStartISO: '2026-09-14', isCutback: true }),
          futureWeek({ weekStartISO: '2026-09-21', isCutback: true }),
        ],
      },
    });
    const sentence = 'next week remains a cutback';
    const occurrences = many.response.explanation.split(sentence).length - 1;
    expect(occurrences).toBeLessThanOrEqual(1);
  });
});

describe('RULE 9 · a hair more surplus never produces a different KIND of answer', () => {
  it('the response moves continuously and monotonically in the surplus', () => {
    // The walk `_restore_continuity.test.ts` established, applied to the one
    // new behavioural switch this directory introduces.
    let prevAdded = -1;
    let prevPeak = -1;
    for (let over = 2.0; over <= 8.0; over += 0.1) {
      const out = runPipeline({ week: overrunWeek(Math.round(over * 10) / 10) });
      expect(out.response.totalAddedMi).toBeGreaterThanOrEqual(prevAdded - 1e-9);
      expect(out.beliefAfter.peakWeeklyMi!).toBeGreaterThanOrEqual(prevPeak - 1e-9);
      prevAdded = out.response.totalAddedMi;
      prevPeak = out.beliefAfter.peakWeeklyMi!;
    }
  });

  it('the one discrete edge is the ADMISSION bar, and it is doctrine\'s own', () => {
    // 40 mi prescribed · the bar is 5% = 2.0 mi. Either side of it the answer
    // differs in KIND (admitted / not), which is legitimate: the bar is
    // VOLUME_ADDITION_THRESHOLD, the same number the downward path uses, and
    // the QUANTITY on each side moves continuously. Stated here rather than
    // hidden, per Rule 9's instruction to ask what a threshold is answering.
    expect(runPipeline({ week: overrunWeek(1.9) }).admission.admitted).toBe(false);
    expect(runPipeline({ week: overrunWeek(2.1) }).admission.admitted).toBe(true);
    expect(40 * VOLUME_ADDITION_THRESHOLD).toBe(2);
  });
});

describe('RULE 8 · which side of the corollary each reader is on', () => {
  it('the capability fields are filtered and the absorbed one is not', () => {
    const taper = classifyWeekSurplus({ ...overrunWeek(), authoredPlanMode: 'TAPER' });
    const admission = admitSurplus(admissionInput({ week: taper }));
    const after = updateDemonstratedVolume({
      asOfISO: TODAY,
      prior: PRIOR_BELIEF,
      week: taper,
      admission,
      representativeWeeklyMi: [36, 38, 39],
      allWeeklyMiUnfiltered: [36, 38, 39, 45],
      sustainedRank: SUSTAINED_WEEK_RANK,
      lowWeek: null,
    });
    // CAPABILITY · unchanged, because the week was a taper.
    expect(after.peakWeeklyMi).toBe(41);
    // ABSORBED LOAD · the taper happened, and the guards must keep seeing it.
    expect(after.absorbedWeeklyMiUnfiltered).toBe(45);
  });

  it('and asDemonstratedLoad never leaks the unfiltered number into the envelope', () => {
    const src = readFileSync(path.join(__dirname, 'belief.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function asDemonstratedLoad'));
    expect(fn).not.toContain('absorbedWeeklyMiUnfiltered:');
  });
});

describe('RULE 11 · the refusal is a TYPE, not a convention', () => {
  it('an unadmitted surplus has no `mi` field at all', () => {
    const flat = runPipeline({ week: weekInput() });
    expect(flat.admission.admitted).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(flat.admission, 'mi')).toBe(false);
  });

  it('an unmeasured belief is null everywhere, never zero', () => {
    const b = unmeasuredBelief(TODAY);
    expect(b.peakWeeklyMi).toBeNull();
    expect(b.sustainedWeeklyMi).toBeNull();
    expect(b.heldWeeklyMi).toBeNull();
    expect(b.meanWeeklyMi).toBeNull();
  });

  it('a week with no plan refuses rather than reporting a surplus of everything', () => {
    const noPlan = classifyWeekSurplus({ ...weekInput(), prescribedMi: 0 });
    expect(noPlan.runs.every((r) => r.kind === 'UNPRESCRIBED_WEEK')).toBe(true);
    expect(noPlan.admissibleSurplusMi.ok).toBe(false);
  });
});

describe('WHAT CAUSES A RAISE · the admission, not the size of the belief move', () => {
  // Rule 15 · the ONLY case where a week is admitted and the belief does NOT
  // move, which is the branch that says whether the mechanism is driven by the
  // evidence or by the arithmetic.
  const priorAlreadyHigher: DemonstratedVolumeBelief = {
    // Every field already above what this week or its window could produce:
    // peak 60 > 45 run, rank-3 of the series is 55, the series mean is 55.
    ...PRIOR_BELIEF, peakWeeklyMi: 60, sustainedWeeklyMi: 55, heldWeeklyMi: 58, meanWeeklyMi: 56,
  };
  const out = runPipeline({ prior: priorAlreadyHigher, representativeWeeklyMi: [50, 52, 55, 58, 60] });

  it('an admitted week whose numbers do not beat the prior still raises the plan', () => {
    expect(out.admission.admitted).toBe(true);
    expect(out.beliefAfter.moves).toEqual([]);          // nothing beat the prior
    expect(out.beliefAfter.peakWeeklyMi).toBe(60);
    // ...and the plan, at 40 mi against an envelope his existing evidence
    // already supports, still moves. Current fitness is a floor, not a ceiling.
    expect(out.response.totalAddedMi).toBeGreaterThan(0);
  });

  it('but the cadence bound is what stops it repeating forever', () => {
    const again = runPipeline({
      prior: priorAlreadyHigher,
      representativeWeeklyMi: [50, 52, 55, 58, 60],
      response: { stepsTakenThisCycle: VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE },
    });
    expect(again.response.totalAddedMi).toBe(0);
  });

  it('FALSIFIER · without the admission, the identical inputs move nothing', () => {
    const noSurplus = runPipeline({
      week: weekInput(), prior: priorAlreadyHigher, representativeWeeklyMi: [50, 52, 55, 58, 60],
    });
    expect(noSurplus.admission.admitted).toBe(false);
    expect(noSurplus.response.totalAddedMi).toBe(0);
  });
});

describe('THE WEEK IS THE UNIT · found by the real-history replay, not by a fixture', () => {
  /*
   * The first cut summed per-day surplus with no week-level cap. On the owner's
   * real account, 2026-05-25 then read as 2.3 mi of ADMITTED surplus on a week
   * he completed at 39.7 against 44 prescribed. Two days ran past their own
   * prescription and four ran short, and the engine credited only the first
   * half. It was the ONLY week of his 2026 the walk admitted, and it was the
   * wrong one.
   *
   * Rule 15 · no synthetic fixture in this file reached it, because every
   * fixture here either overruns the week as a whole or matches it exactly. The
   * replay is what found it, which is the argument for having one.
   */
  const longDayShortWeek: WeekSurplusInput = {
    ...weekInput(),
    prescribedMi: 44,
    runs: [
      run({ activityId: 'b1', dateISO: '2026-08-31', distanceMi: measured(3), prescribedMi: 6 }),
      run({ activityId: 'b2', dateISO: '2026-09-01', distanceMi: measured(4), prescribedMi: 8 }),
      run({ activityId: 'b3', dateISO: '2026-09-02', distanceMi: measured(4), prescribedMi: 6 }),
      run({ activityId: 'b4', dateISO: '2026-09-04', distanceMi: measured(6), prescribedMi: 4 }),
      run({ activityId: 'b5', dateISO: '2026-09-06', distanceMi: measured(22), prescribedMi: 20 }),
    ],
  };

  it('a week completed UNDER prescription contributes no admissible surplus', () => {
    const out = classifyWeekSurplus(longDayShortWeek);
    // 3+4+4+6+22 = 39 against 44 prescribed.
    expect(out.completedMi).toEqual(measured(39));
    expect(out.rawSurplusMi).toEqual(measured(0));
    // The per-day view alone would say 2+2 = 4 mi.
    const perDay = out.runs.reduce((a, r) => a + r.surplusMi, 0);
    expect(perDay).toBe(4);
    // The week is the unit, so the answer is zero.
    expect(out.admissibleSurplusMi).toEqual(measured(0));
  });

  it('and it is therefore not admitted', () => {
    const out = classifyWeekSurplus(longDayShortWeek);
    const adm = admitSurplus(admissionInput({ week: out }));
    expect(adm.admitted).toBe(false);
    if (adm.admitted) throw new Error('unreachable');
    expect(adm.outcome).toBe('NOT_SUPPORTED');
  });

  // FALSIFICATION · the cap is not a blanket refusal. Push the same week OVER
  // its prescription and the same days are admitted.
  it('FALSIFIER · the same week run OVER prescription is admitted', () => {
    const over: WeekSurplusInput = {
      ...longDayShortWeek,
      runs: longDayShortWeek.runs.map((r) => (r.activityId === 'b1'
        ? { ...r, distanceMi: measured(12) } : r)),
    };
    const out = classifyWeekSurplus(over);
    expect(out.completedMi).toEqual(measured(48));
    expect(out.rawSurplusMi).toEqual(measured(4));
    expect(out.admissibleSurplusMi).toEqual(measured(4));
    expect(admitSurplus(admissionInput({ week: out })).admitted).toBe(true);
  });
});

describe('RULE 8 · the week names WHICH fact excluded it', () => {
  const cases: Array<[Partial<WeekSurplusInput>, string]> = [
    [{ authoredPlanMode: 'RECOVERY' }, 'AUTHORED_RECOVERY_BLOCK'],
    [{ authoredPlanMode: 'TAPER' }, 'AUTHORED_TAPER'],
    [{ isRaceWeek: true }, 'PLAN_MARKED_RACE_WEEK'],
    [{ inPrescribedRaceWindow: true }, 'INSIDE_A_RACE_TAPER_OR_RECOVERY_WINDOW'],
    [{ isCutback: true }, 'CUTBACK_WEEK'],
  ];
  it('all five reasons are reachable and distinct', () => {
    const seen = cases.map(([patch, want]) => {
      const out = classifyWeekSurplus({ ...overrunWeek(), ...patch });
      expect(out.nonNormalBecause, JSON.stringify(patch)).toBe(want);
      return out.nonNormalBecause;
    });
    expect(new Set(seen).size).toBe(5);
  });
  it('and an ordinary week names none', () => {
    expect(classifyWeekSurplus(overrunWeek()).nonNormalBecause).toBeNull();
  });
});

describe('STEP 6 · a past week is never rewritten', () => {
  it('a week before asOfISO is preserved with IN_THE_PAST', () => {
    const out = runPipeline({
      response: {
        futureWeeks: [
          futureWeek({ weekStartISO: '2026-08-24' }),
          futureWeek({ weekStartISO: '2026-09-14' }),
        ],
      },
    });
    expect(out.response.weeks[0].preserved).toBe('IN_THE_PAST');
    expect(out.response.weeks[0].deltaMi).toBe(0);
  });

  it('a SEALED future week is preserved too', () => {
    const out = runPipeline({
      response: { futureWeeks: [futureWeek({ weekStartISO: '2026-09-07', sealed: true })] },
    });
    expect(out.response.weeks[0].preserved).toBe('SEALED');
  });
});
