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
import { composePaceAnchors, type ResolvedCapacity } from '@/lib/training/prescription-resolver';
import { fitRaceExponent, type DurabilityRaceObservation, type DecouplingRead, type TrainingDurabilityRead } from '@/lib/training/durability-anchor';
import { composeRaceOutlook } from '@/lib/race/race-outlook';
import { fixtureReads, fixtureRace } from '@/lib/race/_race_outlook_fixture';
import type { ThresholdPaceRead, EasyPaceRead, PaceObservation } from '@/lib/training/pace-corpus';
import { fullAuthority, uncappedMoveCap } from '@/lib/training/pace-corpus';
import type { NormalReading } from '@/lib/training/normal-window';

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
  const cases = [
    { name: 'aggressive goal', goalSec: 2 * 3600 + 30 * 60, expect: 'The goal is echoed untouched, the day is raced at the likely range fast edge, and feasibility says it is unlikely on current evidence.', source: 'stated_goal_clamped_to_range_edge', feasibility: 'unlikely_currently' },
    { name: 'realistic goal', goalSec: null as number | null, expect: 'With no goal the target IS the expected race day and a coach set is offered.', source: 'expected_race_day', feasibility: 'no_goal' },
    { name: 'soft goal', goalSec: 4 * 3600, expect: 'A goal slower than the expected result is raced as stated, and called comfortable.', source: 'stated_goal_within_range', feasibility: 'comfortable' },
  ];
  for (const c of cases) {
    it(`${c.name} · ${c.expect}`, async () => {
      const o = await composeRaceOutlook(fixtureRace({ statedGoalSec: c.goalSec }), TODAY, fixtureReads());
      expect(o.execution.source).toBe(c.source);
      expect(o.goalFeasibility.status).toBe(c.feasibility);
      expect(o.statedGoal.sec).toBe(c.goalSec);
      // The goal never touches capacity or expected improvement.
      const noGoal = await composeRaceOutlook(fixtureRace({ statedGoalSec: null }), TODAY, fixtureReads());
      expect(o.capacity.thresholdSecPerMi).toBe(noGoal.capacity.thresholdSecPerMi);
      expect(o.expectedImprovement.gainVdot).toBeCloseTo(noGoal.expectedImprovement.gainVdot, 9);
      expect(o.expectedRaceDay.expectedSec).toBe(noGoal.expectedRaceDay.expectedSec);
    });
  }
});
