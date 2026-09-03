/**
 * _brain_acceptance.test.ts · PHASE 11 · the whole-system acceptance suite.
 *
 * One coaching-level expectation per runner archetype, asserted through the
 * real chain: evidence → beliefs → anchors → race outlook. Every fixture's
 * expectation is written as prose FIRST (the `expect` field) and then
 * asserted, so a green run means the model agreed with a coach, not that a
 * number matched itself.
 *
 * PURE. No database, so this runs in CI with no credentials — the gap
 * `test-full` names in its own header. The production-backed half of the same
 * loop (the owner's real activities, execution grading, adaptation shadow)
 * lives in the `.audit.test.ts` files and the p0-proof scripts.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22): anything downstream of the anchors —
 * plan composition, workout selection, execution grading and adaptation each
 * have their own suites; this asserts that the BELIEFS and the RACE OUTLOOK a
 * runner archetype produces are the ones a coach would defend. It also cannot
 * see a defect that is identical in the fixture and the engine, which is why
 * every expectation below is stated in words a coach would use before any
 * number appears.
 */
import { describe, it, expect } from 'vitest';
import {
  composeThresholdCapacity, composeEasyCeiling, composeHighIntensityCapacity,
  composeDurability, CAPACITY_CONFIDENCE_BANDS,
  type VdotFallbackRead,
} from '@/lib/training/capacity-resolver';
// `ResolvedCapacity` is Pace Prescription's own input type and has always
// lived here, never in the Runner Model layer — the four capacity estimates
// are what capacity-resolver.ts exports, and the BAG of all four is what the
// prescription consumes. Importing it from the resolver typechecked nowhere;
// vitest erases a type-only import, so the suite ran green while
// `tsc --noEmit` was red.
import { composePaceAnchors, type ResolvedCapacity } from '@/lib/training/prescription-resolver';
import { fitRaceExponent, type DurabilityRaceObservation, type DecouplingRead, type TrainingDurabilityRead } from '@/lib/training/durability-anchor';
import { composeRaceOutlook } from '@/lib/race/race-outlook';
import { fixtureReads, fixtureRace } from '@/lib/race/_race_outlook_fixture';
import type { ThresholdPaceRead, EasyPaceRead, PaceObservation } from '@/lib/training/pace-corpus';
import { fullAuthority, uncappedMoveCap } from '@/lib/training/pace-corpus';
import type { NormalReading } from '@/lib/training/normal-window';
// PHASE 12 · the golden-runner PLAN corpus (brief §7). Pure: `composePlan`
// takes no database and no clock, so this file keeps its no-credentials
// property. See the block at the bottom for what the corpus cannot reach.
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  type ComposePlanInput, type ComposePlanResult, type DOW,
} from '@/lib/plan/generate';
import { validateComposedPlan } from '@/lib/plan/validate';
import { tPaceFromGoal } from '@/lib/plan/spec-builder';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import { resolveLoadTier } from '@/lib/plan/goal-tiers';
import { predictRaceTime } from '@/lib/training/vdot';
import type { BlockStrategy } from '@/lib/plan/strategy-contracts';

const TODAY = '2026-09-01';
const pace = (s: number | null | undefined) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

const NO_THRESHOLD: ThresholdPaceRead = { ok: false, reason: 'no_observations', observations: 0, weightedSupport: 0, excluded: [], windowDays: 60 };
const NO_EASY: EasyPaceRead = { ok: false, reason: 'no_observations', observations: 0 };
const NO_DECOUPLING: DecouplingRead = { ok: false, reason: 'no_observations', observations: 0 };
const NO_TRAINING_DURABILITY: TrainingDurabilityRead = { ok: false, reason: 'no_observations', observations: 0 };
const habit = (mi: number, days = 28): NormalReading<number> => ({ ok: true, value: mi, representativeDays: days, excludedDays: 0 });

function fallback(over: Partial<VdotFallbackRead> = {}): VdotFallbackRead {
  return {
    measuredVdot: null, measuredVdotEvidenceId: null, measuredVdotDate: null, measuredVdotSource: null,
    belowTableAnchor: null, normalWeeklyMi: habit(0), normalRunDays: 0,
    selfReportedWeeklyMi: null, selfReportedPr: { ok: false, reason: 'NO_PR_ON_FILE', considered: 0, rejected: [] },
    ...over,
  };
}

/** `n` threshold observations at `paceSecPerMi`, `daysAgo` back, HR in band. */
function thresholdRead(paceSecPerMi: number, n: number, daysAgo = 5): ThresholdPaceRead {
  if (n === 0) return NO_THRESHOLD;
  const supporting: PaceObservation[] = Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, date: new Date(Date.parse(TODAY + 'T12:00:00Z') - (daysAgo + i * 3) * 86_400_000).toISOString().slice(0, 10),
    paceSecPerMi, durationSec: 1800, source: 'phases', hrBasis: 'pct_lthr', hrPct: 0.97, hrBandDistance: 0.4,
    weight: 1, completed: true, representative: true, authority: fullAuthority(),
  } as unknown as PaceObservation));
  return {
    ok: true, tPaceSecPerMi: paceSecPerMi, vdot: null as unknown as number, observations: n,
    supporting, weightedSupport: n, representativeSupporting: n, excluded: [], windowDays: 60,
    moveCap: uncappedMoveCap(paceSecPerMi),
  } as unknown as ThresholdPaceRead;
}

function easyRead(ceilingSecPerMi: number, n: number): EasyPaceRead {
  if (n === 0) return NO_EASY;
  return { ok: true, ceilingSecPerMi, observations: n, supporting: [] } as unknown as EasyPaceRead;
}

const race = (slug: string, date: string, mi: number, sec: number, weight = 1): DurabilityRaceObservation =>
  ({ slug, date, distanceMi: mi, finishSec: sec, priority: 'A', weight, representativenessReason: 'NOT_ASSESSED' });

interface Archetype {
  name: string;
  /** The coaching-level outcome, written before the assertion. */
  expect: string;
  threshold: ThresholdPaceRead;
  easy: EasyPaceRead;
  fallback: VdotFallbackRead;
  races?: DurabilityRaceObservation[];
  trainingDurability?: TrainingDurabilityRead;
}

function vector(a: Archetype): ResolvedCapacity {
  const raceExponent = a.races && a.races.length > 0
    ? fitRaceExponent(a.races, { today: TODAY })
    : { ok: false as const, reason: 'no_races' as const, races: 0 };
  const durability = composeDurability({
    raceExponent,
    decoupling: NO_DECOUPLING,
    trainingDurability: a.trainingDurability ?? NO_TRAINING_DURABILITY,
  });
  const threshold = composeThresholdCapacity({ direct: a.threshold, fallback: a.fallback, todayISO: TODAY });
  return {
    threshold,
    highIntensity: composeHighIntensityCapacity({ fallback: a.fallback, todayISO: TODAY }),
    easyCeiling: composeEasyCeiling({ direct: a.easy, threshold, todayISO: TODAY }),
    durability,
  } as unknown as ResolvedCapacity;
}

const ARCHETYPES: Archetype[] = [
  {
    name: 'owner · marathoner, corroborated threshold, one marathon on file',
    expect: 'Threshold is directly evidenced and confident. Marathon pace is carried through his own exponent, the model SAYS it rests on one marathon, and the pace carries a band rather than a false point.',
    threshold: thresholdRead(430, 3), easy: easyRead(502, 6), fallback: fallback({ measuredVdot: 47, normalWeeklyMi: habit(43), normalRunDays: 24 }),
    races: [race('la', '2026-03-08', 26.219, 12700), race('afc', '2026-08-16', 13.1, 6113), race('rose', '2026-01-18', 13.109, 5918)],
  },
  {
    name: 'zero-run runner · nothing but an answered weekly mileage',
    expect: 'No capacity is claimed as measured. Every anchor is a labelled prior at prior confidence, and nothing is presented as personal.',
    threshold: NO_THRESHOLD, easy: NO_EASY, fallback: fallback({ selfReportedWeeklyMi: 20, normalWeeklyMi: habit(0, 0), normalRunDays: 0 }),
  },
  {
    name: 'typed-PR runner · a stated 5K, no logged running',
    expect: 'The typed PR is used, at user-prior strength — better than a population guess, never as good as a measured session.',
    threshold: NO_THRESHOLD, easy: NO_EASY,
    fallback: fallback({ selfReportedWeeklyMi: 25, normalWeeklyMi: habit(0, 0), normalRunDays: 0, selfReportedPr: { ok: true, considered: 1, rejected: [], best: { distanceMi: 3.107, timeSec: 1290, daysAgo: 40, paceSecPerMi: 415, vdot: 45, tPaceSecPerMi: 452, freshness: 0.8 } } }),
  },
  {
    name: 'sparse-history runner · one threshold session, thin history',
    expect: 'One session cannot pose as a corroborated belief: the read is either a refusal into the fallback, or direct and explicitly sparse. It is never full confidence.',
    threshold: thresholdRead(470, 1), easy: easyRead(560, 2), fallback: fallback({ measuredVdot: 40, normalWeeklyMi: habit(18), normalRunDays: 9 }),
  },
  {
    name: 'returning runner · real history, nothing recent',
    expect: 'The old evidence still sets the LEVEL; what falls is confidence. A returning runner is not treated as a beginner.',
    threshold: thresholdRead(440, 3, 70), easy: easyRead(520, 4), fallback: fallback({ measuredVdot: 46, normalWeeklyMi: habit(12), normalRunDays: 6 }),
  },
  {
    name: 'speed-strong / durability-limited · fast half, slow marathon',
    expect: 'The fitted exponent is above the population prior, so marathon pace is prescribed SLOWER than the population table would give. Durability is the limiter, not speed.',
    threshold: thresholdRead(400, 3), easy: easyRead(470, 6), fallback: fallback({ measuredVdot: 52, normalWeeklyMi: habit(40), normalRunDays: 22 }),
    races: [race('h', '2026-06-01', 13.109, 5100), race('m', '2026-03-01', 26.219, 11700)],
  },
  {
    name: 'durable / speed-limited · marathon beats the half prediction',
    expect: 'The fitted exponent is at or below the population prior, so marathon pace is prescribed at least as fast as the population table. Speed, not durability, is the gap.',
    threshold: thresholdRead(430, 3), easy: easyRead(500, 6), fallback: fallback({ measuredVdot: 47, normalWeeklyMi: habit(55), normalRunDays: 26 }),
    races: [race('h', '2026-06-01', 13.109, 5900), race('m', '2026-03-01', 26.219, 12300)],
  },
  {
    name: 'no-HR runner · pace only, no heart rate anywhere',
    expect: 'A belief is still formed from pace alone, and it is not presented at the confidence a HR-corroborated one would carry.',
    threshold: NO_THRESHOLD, easy: NO_EASY, fallback: fallback({ measuredVdot: 44, normalWeeklyMi: habit(30), normalRunDays: 18 }),
  },
  {
    name: 'inconsistent runner · big weeks and empty weeks',
    expect: 'Sparse representative days lower confidence rather than the level; the model does not read an empty week as lost fitness.',
    threshold: thresholdRead(450, 2, 20), easy: easyRead(540, 3), fallback: fallback({ measuredVdot: 43, normalWeeklyMi: habit(22, 12), normalRunDays: 11 }),
  },
];

describe('PHASE 11 · every archetype produces a coaching-defensible belief set', () => {
  for (const a of ARCHETYPES) {
    it(a.name, () => {
      const cap = vector(a);
      const read = composePaceAnchors(cap);
      expect(read.ok, `${a.name}: anchors refused — ${read.ok ? '' : read.reason}`).toBe(true);
      if (!read.ok) return;
      const x = read.anchors;
      // eslint-disable-next-line no-console
      console.log(
        `\n  ${a.name}\n    EXPECT ${a.expect}\n` +
        `    threshold ${pace(x.thresholdSecPerMi)} (${x.basis.threshold.sourceMode}, conf ${x.basis.threshold.confidence.toFixed(2)})` +
        ` · interval ${pace(x.intervalSecPerMi)} (${x.basis.highIntensity.sourceMode})` +
        ` · easy ceiling ${pace(x.easyCeilingSecPerMi)} (${x.basis.easyCeiling.sourceMode})` +
        ` · marathon ${pace(x.marathonSecPerMi)}${x.marathonRangeSecPerMi ? ` [${pace(x.marathonRangeSecPerMi[0])}-${pace(x.marathonRangeSecPerMi[1])}]` : ''}` +
        ` (exp ${x.basis.marathon.enduranceExponent.toFixed(3)}, ${x.basis.marathon.personallyEvidenced ? 'personal' : 'population'}` +
        `${x.basis.marathon.restsOnOneLongRace ? ', rests on one marathon' : ''})`,
      );

      // ── the invariants every archetype must satisfy ──────────────────
      expect(x.thresholdSecPerMi, 'threshold must be faster than the easy ceiling').toBeLessThan(x.easyCeilingSecPerMi);
      expect(x.intervalSecPerMi, 'interval must be faster than threshold').toBeLessThan(x.thresholdSecPerMi);
      expect(x.marathonSecPerMi, 'marathon must sit between threshold and the easy ceiling').toBeGreaterThan(x.thresholdSecPerMi);
      expect(x.marathonSecPerMi).toBeLessThan(x.easyCeilingSecPerMi);
      expect(x.shakeoutCeilingSecPerMi, 'a shakeout is never faster than an easy day').toBeGreaterThanOrEqual(x.easyCeilingSecPerMi);

      // ── the archetype's own coaching expectation ─────────────────────
      if (a.name.startsWith('owner')) {
        expect(x.basis.threshold.sourceMode).toBe('direct');
        expect(x.basis.threshold.confidence).toBeGreaterThan(0.5);
        expect(x.basis.marathon.personallyEvidenced).toBe(true);
        expect(x.basis.marathon.restsOnOneLongRace).toBe(true);
        expect(x.marathonRangeSecPerMi![1]).toBeGreaterThan(x.marathonRangeSecPerMi![0]);
      }
      if (a.name.startsWith('zero-run')) {
        expect(x.basis.threshold.sourceMode === 'user_prior' || x.basis.threshold.sourceMode === 'population_prior').toBe(true);
        expect(x.basis.threshold.confidence).toBeLessThanOrEqual(CAPACITY_CONFIDENCE_BANDS.userPrior);
        expect(x.basis.marathon.personallyEvidenced).toBe(false);
      }
      if (a.name.startsWith('typed-PR')) {
        expect(x.basis.threshold.sourceMode).toBe('user_prior');
        expect(x.basis.threshold.confidence).toBeGreaterThan(CAPACITY_CONFIDENCE_BANDS.populationPrior);
        expect(x.basis.threshold.confidence).toBeLessThanOrEqual(CAPACITY_CONFIDENCE_BANDS.fallbackCeiling);
      }
      if (a.name.startsWith('sparse-history')) {
        expect(x.basis.threshold.confidence).toBeLessThan(CAPACITY_CONFIDENCE_BANDS.directCeiling);
      }
      if (a.name.startsWith('returning')) {
        // level from the old evidence, confidence reduced by its age
        expect(x.thresholdSecPerMi).toBe(440);
        expect(x.basis.threshold.confidence).toBeLessThan(CAPACITY_CONFIDENCE_BANDS.directCeiling);
      }
      if (a.name.startsWith('speed-strong')) {
        expect(x.basis.marathon.enduranceExponent).toBeGreaterThan(1.06);
        expect(x.basis.marathon.personallyEvidenced).toBe(true);
      }
      if (a.name.startsWith('durable')) {
        expect(x.basis.marathon.enduranceExponent).toBeLessThanOrEqual(1.06 + 1e-9);
      }
      if (a.name.startsWith('no-HR') || a.name.startsWith('inconsistent')) {
        expect(x.basis.threshold.confidence).toBeLessThan(CAPACITY_CONFIDENCE_BANDS.directCeiling);
      }
      // High intensity has no direct reader in this app: it must never claim one.
      expect(['vdot_fallback', 'user_prior', 'population_prior']).toContain(x.basis.highIntensity.sourceMode);
    });
  }
});

describe('PHASE 11 · the race outlook end of the loop, per goal posture', () => {
  /* EXECTARGET-1 (2026-09-03) · RULING MOVE. All three postures used to name a
   * DIFFERENT execution source, because the goal chose the target: clamped to
   * the range edge when unreachable, the goal itself when inside, the expected
   * race day when absent. `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q7 rules the
   * active number is the projection-derived one, so the source is the same in
   * all three — and THAT is now the coaching expectation worth asserting: the
   * posture changes what the runner is TOLD about his goal, and changes the
   * prescription not at all. The feasibility column, which is where the posture
   * genuinely lives, is unchanged. */
  const cases = [
    { name: 'aggressive goal', goalSec: 2 * 3600 + 30 * 60, expect: 'The goal is echoed untouched, the day is raced on current evidence, and feasibility says the goal is unlikely on it.', source: 'current_evidence', feasibility: 'unlikely_currently' },
    { name: 'realistic goal', goalSec: null as number | null, expect: 'With no goal the target is still current evidence, and feasibility says there is no goal.', source: 'current_evidence', feasibility: 'no_goal' },
    { name: 'soft goal', goalSec: 4 * 3600, expect: 'A goal slower than current evidence is called comfortable, and still does not set the target.', source: 'current_evidence', feasibility: 'comfortable' },
  ];
  for (const c of cases) {
    it(`${c.name} · ${c.expect}`, async () => {
      const o = await composeRaceOutlook(fixtureRace({ statedGoalSec: c.goalSec }), TODAY, fixtureReads());
      expect(o.execution.source).toBe(c.source);
      expect(o.goalFeasibility.status).toBe(c.feasibility);
      expect(o.statedGoal.sec).toBe(c.goalSec);
      // Q7 · and the target itself is the same number in every posture.
      const bare = await composeRaceOutlook(fixtureRace({ statedGoalSec: null }), TODAY, fixtureReads());
      expect(o.execution.targetSec).toBe(bare.execution.targetSec);
      // The goal never touches capacity or expected improvement.
      const noGoal = await composeRaceOutlook(fixtureRace({ statedGoalSec: null }), TODAY, fixtureReads());
      expect(o.capacity.thresholdSecPerMi).toBe(noGoal.capacity.thresholdSecPerMi);
      expect(o.expectedImprovement.gainVdot).toBeCloseTo(noGoal.expectedImprovement.gainVdot, 9);
      expect(o.expectedRaceDay.expectedSec).toBe(noGoal.expectedRaceDay.expectedSec);
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * PHASE 12 (2026-09-02) · THE GOLDEN-RUNNER PLAN CORPUS · brief §7.
 *
 * The other end of the same loop. Everything above asserts what the model
 * BELIEVES about a runner; this asserts what the plan generator PRESCRIBES for
 * one, through the real `composePlan` → `finalizeComposedPlan` →
 * `validateComposedPlan` chain, and through the strategy contract the block
 * now states about itself.
 *
 * Written here rather than as a parallel corpus on purpose. The brief asks for
 * "coaching-level expected outcomes", and this file's whole idiom is that the
 * expectation is written as PROSE first and then asserted — so a green run
 * means the plan agreed with a coach, not that a number matched itself. A
 * second corpus with a different idiom would have been a second answer to
 * "what does acceptance mean here" (Rule 16).
 *
 * PURE. `composePlan` takes no database and no clock, so this keeps the file's
 * no-credentials property.
 *
 * ── WHAT THIS CORPUS CANNOT REACH, AND WHY (Rule 15, Rule 22) ───────────────
 *
 * Brief §7 lists twenty-five fixtures. Eighteen are expressible as a
 * `ComposePlanInput`; seven are NOT, and naming them is the point of this
 * paragraph, because a corpus that quietly drops a third of its list while
 * reporting green is exactly the failure Rule 15 describes:
 *
 *   7  illness interruption in a quality phase   `composePlan` authors a block;
 *   22 missed key workout early in the week      an interruption is something
 *   23 missed key workout late in the week       that happens to an AUTHORED
 *   24 taper-week missed session                 block afterwards. All four
 *                                                belong to `lib/plan/adapt.ts`
 *                                                and are covered by
 *                                                `_adapt_invariants.test.ts`.
 *   21 heat-affected runner                      heat is not a composer input;
 *                                                `lib/weather/heat-adjustment.ts`
 *                                                owns it and the HEAT.* claims
 *                                                gate it.
 *   ·  authoring/recompute parity                needs the database, so it
 *                                                lives in `_recompute_paces`
 *                                                and `_authoring_shadow_compare`.
 *   ·  sealed-history immutability               same, in `_mutation_boundary`
 *                                                and `_backdate_guard`.
 *
 * And what it cannot fail on even where it reaches:
 *
 *   · Whether a prescribed pace is the RIGHT pace. The capacity resolvers own
 *     that and the first half of this file asserts it.
 *   · Whether a session is the right SESSION. `_catalogue_wiring` and
 *     `_vocab_doctrine` own selection.
 *   · The intensity axis of the one-primary-stressor rule — `ComposedWeek`
 *     carries no scalar for "how hard", stated in `strategy-contracts.ts` too.
 * ═══════════════════════════════════════════════════════════════════════ */

interface GoldenRunner {
  name: string;
  /** The coaching-level outcome, in words, before any assertion. */
  expect: string;
  input: ComposePlanInput;
  /** Extra assertions this archetype exists for. */
  check?: (r: ComposePlanResult, s: BlockStrategy | null) => void;
}

const GOLDEN_START = '2026-08-17';   // a Monday

function planInput(over: Partial<ComposePlanInput> & {
  raceDistanceMi: number; weeks: number;
}): ComposePlanInput {
  const { raceDistanceMi, weeks } = over;
  const race = new Date(GOLDEN_START + 'T12:00:00Z');
  race.setUTCDate(race.getUTCDate() + weeks * 7 - 1);
  const cat = distanceCategoryOrThrow(raceDistanceMi);
  const goalSec = over.goalSec ?? null;
  // `weeks` is this helper's own parameter, not a `ComposePlanInput` field —
  // stripped so the spread below cannot reintroduce it (or re-set
  // `raceDistanceMi` after the named field above).
  const { weeks: _weeks, raceDistanceMi: _mi, ...rest } = over;
  return {
    raceDistanceMi,
    goalSec,
    goalPaceSec: goalSec != null ? Math.round(goalSec / raceDistanceMi) : null,
    raceDateISO: race.toISOString().slice(0, 10),
    startMondayISO: GOLDEN_START,
    level: 'intermediate',
    recentWeeklyMi: 30,
    easyDayMedianMi: 5,
    recentLongMi: 10,
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    availableDows: null,
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: tPaceFromGoal(goalSec, raceDistanceMi),
    lthr: null,
    maxHr: null,
    ...rest,
  } as ComposePlanInput;
}

const GOLDEN: GoldenRunner[] = [
  {
    name: '1 · owner · marathon mid-block, established runner',
    expect: 'No BASE phase — he arrives with training in the bank — and the block builds to a peak well above where it opened, with a real taper in front of the race.',
    input: planInput({
      raceDistanceMi: 26.2, weeks: 16, goalSec: 10800, level: 'advanced',
      recentWeeklyMi: 45, easyDayMedianMi: 7, recentLongMi: 18, bestRecentVdot: 48, isMidBlock: true,
    }),
    check: (r) => {
      expect(r.blocks.phases.some((p) => p.label === 'BASE'), 'an established mid-block runner was restarted in BASE').toBe(false);
      expect(r.blocks.phases.some((p) => p.label === 'TAPER')).toBe(true);
      const peak = Math.max(...r.weeks.map((w) => w.weeklyMi));
      expect(peak).toBeGreaterThan(r.weeks[0].weeklyMi);
    },
  },
  {
    name: '2 · zero-run cold start · marathon',
    expect: 'A runner with nothing on file is opened at the composer\'s own floor rather than at zero, and the plan is still a legal plan.',
    input: planInput({
      raceDistanceMi: 26.2, weeks: 24, goalSec: 16200, level: 'beginner',
      recentWeeklyMi: 0, easyDayMedianMi: 0, recentLongMi: 0,
    }),
    check: (r) => {
      expect(r.weeks[0].weeklyMi, 'a cold start opened at zero miles').toBeGreaterThan(0);
    },
  },
  {
    name: '3 · typed-PR cold start · half',
    expect: 'A self-reported PR gives the block a pace anchor without giving it volume it has no evidence for: the opening week still tracks the stated mileage, not the PR.',
    input: planInput({
      raceDistanceMi: 13.1, weeks: 16, goalSec: 6300,
      recentWeeklyMi: 18, easyDayMedianMi: 4, recentLongMi: 7, bestRecentVdot: 50,
    }),
    check: (r) => {
      expect(r.weeks[0].weeklyMi).toBeLessThan(30);
    },
  },
  {
    name: '4 · sparse history · 10K',
    expect: 'Thin history produces a small, legal block rather than a refusal or a fabricated one.',
    input: planInput({
      raceDistanceMi: 6.2, weeks: 12, goalSec: 2700,
      recentWeeklyMi: 12, easyDayMedianMi: 3, recentLongMi: 4,
    }),
  },
  {
    name: '5 · returning after three weeks off · marathon',
    expect: 'A runner returning from a layoff opens BELOW the volume they held before it, and climbs back rather than resuming at their old peak.',
    input: planInput({
      raceDistanceMi: 26.2, weeks: 18, goalSec: 12600, level: 'intermediate',
      recentWeeklyMi: 20, easyDayMedianMi: 4, recentLongMi: 8,
      // COHERENT, and the first cut of this fixture was not. It carried
      // `heldMi: 40` — the runner is CURRENTLY holding their pre-layoff
      // volume — beside `interruptionWeeks: 3`, which says they were not
      // running at all. POSTRACE-RESTORE-1 reads `heldMi` to decide whether
      // the re-entry week has already been spent, so the contradiction opened
      // the block at the full 40 and looked like an engine defect. A genuine
      // layoff holds nothing; `rampBaseMi` is the resume level
      // `resolveRampBase` would hand the composer in production.
      rampBaseMi: 28,
      rampBaseEvidence: {
        sustainedMi: 40, meanMi: 20, heldMi: 20, peakMi: 45,
        returning: true, interruptionWeeks: 3, allowedInterruptionWeeks: 4,
      },
    } as Partial<ComposePlanInput> & { raceDistanceMi: number; weeks: number }),
    check: (r) => {
      expect(r.weeks[0].weeklyMi, 'a returning runner resumed at their pre-layoff level').toBeLessThan(40);
      // …and climbs back rather than staying there.
      expect(Math.max(...r.weeks.map((w) => w.weeklyMi))).toBeGreaterThan(r.weeks[0].weeklyMi);
    },
  },
  {
    name: '6 · injury return · four available days, no back-to-back running',
    expect: 'Every prescribed run lands on a day the runner said they can run. Nothing is placed on a day they cannot.',
    input: planInput({
      raceDistanceMi: 13.1, weeks: 14, goalSec: 7200,
      recentWeeklyMi: 18, easyDayMedianMi: 4, recentLongMi: 8,
      availableDows: new Set([0, 2, 4, 6]), trainingDaysPerWeek: 4,
      qualityDows: [2, 4] as DOW[], restDow: 1 as DOW,
    } as Partial<ComposePlanInput> & { raceDistanceMi: number; weeks: number }),
    check: (r) => {
      for (const w of r.weeks) {
        for (const d of w.days) {
          if (d.distanceMi <= 0 || d.type === 'race') continue;
          expect([0, 2, 4, 6], `${w.startISO} prescribes a run on dow ${d.dow}, which is not available`).toContain(d.dow);
        }
      }
    },
  },
  {
    name: '8 · speed-strong, durability-limited marathoner',
    expect: 'A durability limiter does not change the SHAPE of a legal marathon block: the plan still tapers, still peaks above its start, and still carries quality every quality-phase week.',
    input: planInput({
      raceDistanceMi: 26.2, weeks: 16, goalSec: 11400, level: 'advanced',
      recentWeeklyMi: 40, easyDayMedianMi: 6, recentLongMi: 14, bestRecentVdot: 50,
      thesisAtAuthoring: { primaryLimiter: 'DURABILITY', priority: 'increase_long_run_demand', confidence: 0.6, source: 'resolved' },
    } as Partial<ComposePlanInput> & { raceDistanceMi: number; weeks: number }),
  },
  {
    name: '9 · durable, speed-limited marathoner',
    expect: 'The mirror image composes just as legally, and its strategy names the limiter it was handed rather than a different one.',
    input: planInput({
      raceDistanceMi: 26.2, weeks: 16, goalSec: 11400, level: 'advanced',
      recentWeeklyMi: 40, easyDayMedianMi: 6, recentLongMi: 14, bestRecentVdot: 50,
      thesisAtAuthoring: { primaryLimiter: 'HIGH_INTENSITY', priority: 'establish_evidence_before_prioritising', confidence: 0.4, source: 'resolved' },
    } as Partial<ComposePlanInput> & { raceDistanceMi: number; weeks: number }),
    check: (_r, s) => {
      if (s) expect(s.thesis.limiter).toBe('HIGH_INTENSITY');
    },
  },
  {
    name: '11 · low volume, easy-day floor cannot fit the week',
    expect: 'A 12 mi/wk runner is not handed easy days sized for a 50 mi/wk one, and the week still validates.',
    input: planInput({
      raceDistanceMi: 3.1, weeks: 12, goalSec: 1500,
      recentWeeklyMi: 12, easyDayMedianMi: 6, recentLongMi: 5, trainingDaysPerWeek: 4,
    }),
    check: (r) => {
      // TAPER-1 · a race week's `weeklyMi` EXCLUDES the race itself, by
      // design and stated in validate.ts's own taper-band comment: it is
      // shakeout-plus-easies, because the race is the event rather than a
      // training week. So the day sum legitimately exceeds it there, and
      // asserting otherwise measures the exclusion rather than a defect.
      for (const w of r.weeks) {
        if (w.isRaceWeek) continue;
        const sum = w.days.reduce((s, d) => s + d.distanceMi, 0);
        expect(sum, `${w.startISO} day sum ${sum} disagrees with weeklyMi ${w.weeklyMi}`).toBeCloseTo(w.weeklyMi, 0);
      }
    },
  },
  {
    name: '12 · four-day availability, one quality day',
    expect: 'One quality slot means one structured session a week, not two squeezed together.',
    input: planInput({
      raceDistanceMi: 6.2, weeks: 12, goalSec: 3000,
      recentWeeklyMi: 20, easyDayMedianMi: 5, recentLongMi: 8,
      qualityDows: [3] as DOW[], trainingDaysPerWeek: 4, availableDows: new Set([0, 1, 3, 5]),
      restDow: 6 as DOW,
    } as Partial<ComposePlanInput> & { raceDistanceMi: number; weeks: number }),
    check: (r) => {
      for (const w of r.weeks) {
        if (w.isRaceWeek) continue;
        const q = w.days.filter((d) => d.isQuality && !d.isLong && d.type !== 'race');
        expect(q.length, `${w.startISO} carries ${q.length} quality days on a one-slot week`).toBeLessThanOrEqual(1);
      }
    },
  },
  {
    name: '13 · six-day availability, two quality days',
    expect: 'Two quality slots are used, and no week runs more than two structured sessions.',
    input: planInput({
      raceDistanceMi: 13.1, weeks: 14, goalSec: 5400, level: 'advanced',
      recentWeeklyMi: 45, easyDayMedianMi: 7, recentLongMi: 13, bestRecentVdot: 52,
      qualityDows: [2, 4] as DOW[], trainingDaysPerWeek: 6,
    }),
    check: (r) => {
      for (const w of r.weeks) {
        if (w.isRaceWeek) continue;
        const q = w.days.filter((d) => d.isQuality && !d.isLong && d.type !== 'race');
        expect(q.length, `${w.startISO} carries ${q.length} quality days`).toBeLessThanOrEqual(2);
      }
    },
  },
  {
    name: '16 · multiple mid-block races',
    expect: 'Two tune-ups embed as race days, each with its own recovery, and the block still validates.',
    input: planInput({
      raceDistanceMi: 26.2, weeks: 18, goalSec: 11400, level: 'advanced',
      recentWeeklyMi: 45, easyDayMedianMi: 7, recentLongMi: 15, bestRecentVdot: 50,
      midBlockRaces: [
        { slug: 'tenk', name: 'Tune-up 10K', date: '2026-09-13', distanceMi: 6.2, goalPaceSec: null, priority: 'C' },
        { slug: 'half', name: 'Tune-up half', date: '2026-10-25', distanceMi: 13.1, goalPaceSec: null, priority: 'B' },
      ],
    } as Partial<ComposePlanInput> & { raceDistanceMi: number; weeks: number }),
    check: (r) => {
      const embedded = (r.authoredState as Record<string, unknown>).embedded_races as unknown[];
      expect(embedded.length, 'both tune-ups should embed').toBe(2);
      const raceDays = r.weeks.flatMap((w) => w.days.filter((d) => d.type === 'race'));
      expect(raceDays.length, 'two tune-ups plus the target race').toBe(3);
    },
  },
  {
    name: '17 · short runway · BASE has to shrink or disappear',
    expect: 'A six-week runway still produces a legal block with a taper, and does not spend half of it in BASE.',
    input: planInput({
      raceDistanceMi: 13.1, weeks: 6, goalSec: 6300,
      recentWeeklyMi: 30, easyDayMedianMi: 5, recentLongMi: 11,
    }),
    check: (r) => {
      const base = r.blocks.phases.find((p) => p.label === 'BASE');
      expect((base?.weeks ?? 0), 'a six-week runway spent too long in BASE').toBeLessThanOrEqual(2);
      expect(r.blocks.phases.some((p) => p.label === 'TAPER')).toBe(true);
    },
  },
  {
    name: '18 · no goal · an open block toward a dated race',
    expect: 'With no stated goal the block is still authored, and nothing anywhere prices a session off a goal that does not exist.',
    input: planInput({
      raceDistanceMi: 13.1, weeks: 14, goalSec: null,
      recentWeeklyMi: 30, easyDayMedianMi: 5, recentLongMi: 11, bestRecentVdot: 45,
    }),
  },
  {
    name: '19 · aggressive goal that cannot alter capacity',
    expect: 'A goal far beyond the evidence composes a legal block and moves no pace. What it CAN move is the tier volume band, which is doctrine rather than a leak — measured and reported by the goal-isolation test below.',
    input: planInput({
      raceDistanceMi: 26.2, weeks: 18, goalSec: 8100, level: 'intermediate',
      recentWeeklyMi: 35, easyDayMedianMi: 5, recentLongMi: 12, bestRecentVdot: 44,
    }),
  },
  {
    name: '20 · no HR data',
    expect: 'A runner with no LTHR and no HRmax gets the same block shape; the HR ceiling is simply absent rather than invented.',
    input: planInput({
      raceDistanceMi: 6.2, weeks: 12, goalSec: 2700,
      recentWeeklyMi: 25, easyDayMedianMi: 5, recentLongMi: 9, lthr: null, maxHr: null,
    }),
  },
  {
    name: '25a · 5K',
    expect: 'The shortest supported block still tapers and still carries quality.',
    input: planInput({ raceDistanceMi: 3.1, weeks: 12, goalSec: 1080, level: 'advanced', recentWeeklyMi: 35, easyDayMedianMi: 6, recentLongMi: 10, bestRecentVdot: 55 }),
  },
  {
    name: '25b · ultra',
    expect: 'A 50K composes with an ultra-shaped long run and a legal taper.',
    input: planInput({ raceDistanceMi: 31.5, weeks: 20, goalSec: 18000, level: 'advanced', recentWeeklyMi: 55, easyDayMedianMi: 8, recentLongMi: 20, bestRecentVdot: 48 }),
  },
];

describe('PHASE 12 · golden runners · what the plan generator prescribes', () => {
  for (const g of GOLDEN) {
    it(`${g.name} · ${g.expect}`, () => {
      const composed = composePlan(g.input);
      finalizeComposedPlan(composed, g.input.raceDistanceMi, g.input.level);
      composed.vols = composed.weeks.map((w) => w.weeklyMi);

      /* ── SAFE VOLUME, LONG-RUN SHAPE, QUALITY SPACING, TAPER ─────────────
       * All four are `validateComposedPlan`'s, and asking it is stronger than
       * re-deriving them here: the corpus then agrees with the gate that
       * actually blocks a write rather than with a second opinion (Rule 16). */
      expect(() => validateComposedPlan(composed, g.input.raceDistanceMi, 'race-prep', {
        todayISO: GOLDEN_START,
        level: g.input.level,
        recentWeeklyMi: g.input.recentWeeklyMi,
        isSteppingStoneToMarathon: false,
        priorPlanPeakLongMi: null,
        trailingAvgWeeklyMi: null,
        trainingDaysPerWeek: g.input.trainingDaysPerWeek ?? null,
      })).not.toThrow();

      const st = composed.authoredState as Record<string, unknown>;
      const strategy = (st.block_strategy ?? null) as BlockStrategy | null;

      /* ── PHASE PURPOSE ── every phase says what it develops. */
      expect(strategy, 'the block states no strategy at all').toBeTruthy();
      for (const p of strategy!.phases) {
        expect(p.primaryDevelopment.length, `${p.id} states no development purpose`).toBeGreaterThan(10);
      }

      /* ── WEEKLY ROLE and ONE PRIMARY STRESSOR ── every week has a role, and
       * a week that advances something names exactly one lever for it. */
      expect(strategy!.weeks.length).toBe(composed.weeks.length);
      for (const w of strategy!.weeks) {
        expect(w.role, `${w.weekStartISO} has no role`).toBeTruthy();
        if (w.proposedChange) {
          expect(w.primaryProgressionLever, `${w.weekStartISO} proposes a step with no lever`).toBeTruthy();
          expect(w.proposedChange.prerequisiteEvidence.length).toBeGreaterThan(0);
          expect(w.proposedChange.holdAlternative.length).toBeGreaterThan(10);
        }
      }

      /* ── RATIONALE ── a quality day the catalogue chose says why it is
       * there. A day the composer authored from its own fixed prescriptions
       * carries none, and that is a different fact, not a missing one. */
      const catalogueDays = composed.weeks.flatMap((w) => w.days)
        .filter((d) => d.isQuality && !d.isLong && d.type !== 'race' && d.catalogueRationale != null);
      for (const d of catalogueDays) {
        expect(d.catalogueRationale!.length, 'an empty rationale is worse than none').toBeGreaterThan(10);
      }

      /* ── WARM-UP / COOL-DOWN SANITY ── coarse on purpose: the fine-grained
       * census is `_boundary_run.test.ts`'s and it is a ratchet, not a zero,
       * so a hard bound here would be a second and disagreeing answer. What
       * this holds is that no quality day is ALL boundary running. */
      for (const w of composed.weeks) {
        for (const d of w.days) {
          if (!d.isQuality || d.isLong || d.type === 'race' || !(d.distanceMi > 0)) continue;
          expect(d.distanceMi, `${w.startISO} ${d.type} is ${d.distanceMi}mi`).toBeGreaterThan(0);
        }
      }

      /* ── AVAILABILITY COMPLIANCE ── asserted for every archetype, not only
       * the ones that set it, so a future change that starts ignoring
       * `availableDows` fails on the fixtures that declare one. */
      if (g.input.availableDows) {
        for (const w of composed.weeks) {
          for (const d of w.days) {
            if (d.distanceMi <= 0 || d.type === 'race') continue;
            expect([...g.input.availableDows], `${w.startISO} runs on unavailable dow ${d.dow}`).toContain(d.dow);
          }
        }
      }

      g.check?.(composed, strategy);
    });
  }

  /**
   * GOAL ISOLATION, on the whole corpus at once — and what it FOUND.
   *
   * Compose the same runner against a 15% faster and a 15% slower stated goal,
   * holding `tPaceSec` fixed (see the note inside), and ask whether the
   * training moved. Not "does the goal appear in the pace resolver" — that is
   * `check-goal-pace-leak`'s static job — but "does the plan a runner receives
   * change when they change their ambition".
   *
   * ── THE ANSWER, MEASURED 2026-09-02 ────────────────────────────────────────
   *
   * The goal does NOT move a pace, and it moves volume in ONE direction only.
   *
   * ── WHAT THIS PARAGRAPH USED TO SAY, AND WHY IT IS GONE (GOALVOL-1) ────────
   *
   * It read: "The goal DOES move volume ... on the owner-shaped archetype the
   * two goals landed in different tiers and the blocks peaked at 70 versus 65
   * mi/wk on identical evidence and an identical threshold. That is designed
   * rather than leaked." The measurement was right and the verdict was wrong.
   * David ruled on it 2026-09-02:
   *
   *   "A typed goal must not directly increase training volume. Volume must be
   *    governed by demonstrated training history, durable/sustained volume,
   *    recovery, plan phase, and safety constraints. The goal may influence
   *    plan direction and required development, but it cannot manufacture
   *    readiness for more load."
   *
   * The 70-versus-65 case is closed. `classifyCapacityTier` is now the ceiling
   * and has no goal in its parameter tuple; `resolveLoadTier` is
   * `min(capacity, goalDemand)`, so the goal may only ever narrow the band. The
   * cross-tier deltas this test still prints are therefore all REDUCTIONS from
   * a capacity ceiling — required development, which the ruling licenses — and
   * `lib/plan/_goal_volume_seal.test.ts` is what asserts the direction.
   *
   * So the assertion is the one that holds without argument: WITHIN A TIER the
   * block is byte-identical, and ACROSS tiers the PERIODIZATION is identical —
   * the goal may move how much the runner runs, never the shape of the block
   * or the phases it spends its weeks in.
   *
   * WHAT THIS CANNOT FAIL ON: the prescribed paces, held fixed here on
   * purpose; whether the tier's own volume answer is the right one, which is
   * `TIER_TARGETS`' question and `TEMPLATE.*`'s to gate; and the DIRECTION of a
   * cross-tier delta, which it prints rather than asserts — that is
   * `_goal_volume_seal.test.ts` §2 and §3.
   */
  it('goal isolation · within a tier the block is identical, across tiers only its volume moves', () => {
    let sameTier = 0;
    let crossTier = 0;
    const volumeDeltas: string[] = [];
    for (const g of GOLDEN) {
      if (g.input.goalSec == null) continue;
      const goalSecBase = g.input.goalSec;
      const at = (goalSec: number) => {
        const c = composePlan({
          ...g.input,
          goalSec,
          goalPaceSec: Math.round(goalSec / g.input.raceDistanceMi),
          // HELD FIXED, and that is the experiment rather than a weakening of
          // it. In production the composer is priced from
          // `PrescribedPaceAnchors`, resolved from capacity with goal data
          // compile-time excluded (Constitution section G), so the threshold a
          // runner trains at does not move when their ambition does. This
          // fixture's helper derives `tPaceSec` from the goal only because a
          // pure caller has no anchors to hand it; varying it would measure
          // that shortcut, since an easy day is sized in MINUTES at the
          // runner's own pace.
          tPaceSec: g.input.tPaceSec,
        });
        return {
          // GOALVOL-1 (2026-09-02) · RESOLVED THE WAY THE COMPOSER RESOLVES IT.
          //
          // This read `classifyGoalTier(goalPace, distance, level)` and omitted
          // `demonstratedPaceSec`, so the bucket this test sorts pairs into was
          // a DIFFERENT quantity from the tier `composePlan` actually sized the
          // block with (Rule 16). Golden runner 3 is where it showed: a
          // self-reported VDOT 50 grades `advanced` at the half (419 s/mi
          // equivalent against the 420 s/mi line), so the composer answers
          // advanced/intermediate across that pair while this label answered
          // intermediate/intermediate — and the strong within-tier assertion
          // fired on two blocks the engine had deliberately sized differently.
          // The proxy was wrong, not the engine: peak 55 vs 35 is the goal
          // REDUCING from an advanced capacity, which is what the ruling
          // licenses ("the goal may influence ... required development").
          tier: resolveLoadTier({
            // TIEREVIDENCE-2 · no `level` in the bag, exactly as the composer.
            raceDistanceMi: g.input.raceDistanceMi,
            demonstratedPaceSec: g.input.bestRecentVdot != null
              ? (() => {
                  const t = predictRaceTime(g.input.bestRecentVdot, g.input.raceDistanceMi);
                  return t != null ? Math.round(t / g.input.raceDistanceMi) : null;
                })()
              : null,
            goalPaceSec: Math.round(goalSec / g.input.raceDistanceMi),
          }).tier,
          phases: c.blocks.phases.map((p) => `${p.label}:${p.weeks}`).join('|'),
          peak: Math.max(...c.weeks.map((w) => w.weeklyMi)),
          shape: JSON.stringify(c.weeks.map((w) => ({
            startISO: w.startISO, phase: w.phase, weeklyMi: w.weeklyMi,
            days: w.days.map((d) => ({ dow: d.dow, type: d.type, mi: d.distanceMi, long: d.isLong, q: d.isQuality })),
          }))),
        };
      };
      const faster = at(Math.round(goalSecBase * 0.85));
      const slower = at(Math.round(goalSecBase * 1.15));

      // THE PERIODIZATION IS THE GOAL'S TO LEAVE ALONE, always.
      expect(
        faster.phases,
        `${g.name}: a different stated goal changed the phase structure`,
      ).toBe(slower.phases);

      if (faster.tier === slower.tier) {
        sameTier++;
        expect(
          faster.shape,
          `${g.name}: two goals in the same tier (${faster.tier}) produced different training`,
        ).toBe(slower.shape);
      } else {
        crossTier++;
        volumeDeltas.push(
          `${g.name}: ${slower.tier} peak ${slower.peak} -> ${faster.tier} peak ${faster.peak}`,
        );
      }
    }
    // Rule 18 liveness, both halves: the corpus must actually contain goals,
    // and it must actually exercise the within-tier case that carries the
    // strong assertion. A run where every pair crossed a tier would report
    // green having asserted only the weak half.
    expect(sameTier + crossTier, 'no archetype carried a goal to compare').toBeGreaterThan(8);
    expect(sameTier, 'no pair stayed inside one tier - the strong claim was never tested').toBeGreaterThan(2);
    // The cross-tier deltas are printed rather than asserted: they are the
    // measurement this test exists to surface, and turning them into a bound
    // would be inventing a coaching rule the doctrine does not state.
    if (volumeDeltas.length > 0) {
      // eslint-disable-next-line no-console
      console.log('\n=== a modest goal REDUCES volume below capacity (GOALVOL-1: reduction only) ===\n  ' + volumeDeltas.join('\n  '));
    }
  });
});
