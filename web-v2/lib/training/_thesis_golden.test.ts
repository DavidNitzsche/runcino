/**
 * lib/training/_thesis_golden.test.ts · THE SIX GOLDEN RUNNERS for the
 * Coaching Thesis (`docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`
 * §20-21: golden-runner fixtures gate any change to this architecture).
 *
 * EVERY FIXTURE STATES ITS COACHING-LEVEL EXPECTED OUTCOME BEFORE IT RUNS —
 * the `expect:` sentence on each case was written before the first run of
 * this file, and the assertions beneath it are that sentence made checkable.
 * Where the engine is WEAKER than a coach's read (the durable / speed-limited
 * runner, whose real limiter this engine cannot name), the expectation says
 * so rather than asserting a flattering answer.
 *
 * Five fixtures are PURE and drive `composeCoachingThesis` with hand-built
 * capacity estimates (the same shapes `_coaching_thesis.test.ts` uses); the
 * sixth is the OWNER's real account over the read-only role and is skipped
 * without `DATABASE_URL_RO`. The pure five are what CI runs.
 *
 * ── RULE 9 WALK ─────────────────────────────────────────────────────────────
 * Fixture 2's race set is held fixed while `todayISO` walks 90 days, through
 * the REAL `fitRaceExponent` → `composeDurability` → `composeCoachingThesis`
 * chain. The limiter must not move: the raw fit is a function of the race set
 * only, and the clock reaches confidence alone.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *   · It cannot say whether the curve-shape band is the right coaching
 *     classification for a given runner; that is `Research/02` §7.1's claim,
 *     bound by `LIMITER.curve-shape-neutral-band`, not this file's.
 *   · The pure five never touch a loader, so a wiring defect (the raw fit not
 *     carried by `resolveDurability`, a week loaded off an archived plan) is
 *     invisible here — the owner case and `_thesis_week_contract.audit.test.ts`
 *     are the Rule 13 renders that cover it.
 *   · Fixture 6 (no HR) asserts that the SHAPE path needs no HR; it cannot
 *     assert what the threshold reader does without HR, because the threshold
 *     estimate is hand-built here.
 */
import { describe, it, expect } from 'vitest';
import {
  composeCoachingThesis,
  assessWeekAgainstThesis,
  thesisPlanDirective,
  curveShapeFrom,
  type CoachingThesis,
  type ThesisWeekRow,
} from './coaching-thesis';
import {
  composeDurability,
  CAPACITY_CONFIDENCE_BANDS,
  type DurabilityCapacityEstimate,
  type HighIntensityCapacityEstimate,
  type SourceMode,
  type ThresholdCapacityEstimate,
} from './capacity-resolver';
import {
  fitRaceExponent,
  POPULATION_ENDURANCE_PRIOR,
  type DurabilityRaceObservation,
  type DecouplingRead,
} from './durability-anchor';
import { CURVE_NEUTRAL_EXPONENT_BAND } from '@/lib/coach/limiter';

const AT = '2026-09-02T00:00:00.000Z';
const TODAY = '2026-09-02';

function threshold(confidence: number, sourceMode: SourceMode = 'direct', ids = ['t1', 't2', 't3']): ThresholdCapacityEstimate {
  return { paceSecPerMi: 430, vdot: 47.9, confidence, sourceMode, evidenceIds: ids, resolvedAt: AT, reasons: [], modelVersion: '1.0.0' };
}
function highIntensity(confidence: number, sourceMode: SourceMode = 'vdot_fallback'): HighIntensityCapacityEstimate {
  return { intervalPaceSecPerMi: 407, repetitionPaceSecPerMi: 371, vdot: 46.8, confidence, sourceMode, evidenceIds: ['hi1'], resolvedAt: AT, reasons: [], modelVersion: '1.0.0' };
}
function durability(opts: {
  confidence: number; sourceMode: SourceMode;
  raw?: number | null; shrunk?: number | null; raceConf?: number; slugs?: string[];
  decoupling?: number | null;
}): DurabilityCapacityEstimate {
  const raw = opts.raw === undefined ? null : opts.raw;
  const shrunk = opts.shrunk === undefined ? raw : opts.shrunk;
  const dec = opts.decoupling === undefined ? null : opts.decoupling;
  return {
    enduranceExponent: shrunk ?? POPULATION_ENDURANCE_PRIOR,
    raceExponent: raw == null
      ? { present: false, reason: 'insufficient_races', observations: 1 }
      : { present: true, value: shrunk ?? raw, confidence: opts.raceConf ?? 0.6, sourceMode: 'race_derived', evidenceIds: opts.slugs ?? ['race-a', 'race-b'] },
    rawFittedExponent: raw,
    decoupling: dec == null
      ? { present: false, reason: 'no qualifying long runs', observations: 0 }
      : { present: true, value: dec, confidence: 0.85, sourceMode: 'direct', evidenceIds: ['d1'] },
    confidence: opts.confidence, sourceMode: opts.sourceMode,
    evidenceIds: [...(raw == null ? [] : (opts.slugs ?? ['race-a', 'race-b'])), ...(dec == null ? [] : ['d1'])],
    resolvedAt: AT, reasons: [], modelVersion: '1.0.0',
  };
}
function row(over: Partial<ThesisWeekRow> & { dateIso: string; type: string }): ThesisWeekRow {
  return {
    id: `wko_${over.dateIso}_${over.type}`, subLabel: null, isLong: over.type === 'long',
    distanceMi: null, workoutSpec: null, phaseLabel: 'QUALITY', isRaceWeek: false, isCutback: false,
    ...over,
  };
}
const WEEK_WITH_LONG_AND_TEMPO: ThesisWeekRow[] = [
  row({ dateIso: '2026-09-01', type: 'easy' }),
  row({ dateIso: '2026-09-02', type: 'tempo', subLabel: '2 mi @ T' }),
  row({ dateIso: '2026-09-04', type: 'easy' }),
  row({ dateIso: '2026-09-06', type: 'long', distanceMi: 14 }),
];
const WEEK_VO2_DOMINANT_NO_LONG: ThesisWeekRow[] = [
  row({ dateIso: '2026-09-01', type: 'intervals', subLabel: '6×800m @ I' }),
  row({ dateIso: '2026-09-03', type: 'easy' }),
  row({ dateIso: '2026-09-04', type: 'intervals', subLabel: '5×1000m @ I' }),
  row({ dateIso: '2026-09-06', type: 'easy' }),
];
const TAPER_WEEK: ThesisWeekRow[] = [
  row({ dateIso: '2026-11-30', type: 'easy', phaseLabel: 'TAPER' }),
  row({ dateIso: '2026-12-01', type: 'race_week_tuneup', phaseLabel: 'TAPER', isRaceWeek: true }),
  row({ dateIso: '2026-12-06', type: 'race', phaseLabel: 'TAPER', isRaceWeek: true }),
];

interface Golden {
  name: string;
  /** The coaching-level outcome, written BEFORE the first run. */
  expect: string;
  build: () => CoachingThesis;
  check: (t: CoachingThesis) => void;
}

const GOLDEN: Golden[] = [
  {
    name: '2 · speed-strong, durability-limited (races fade with distance)',
    expect: 'DURABILITY is the limiter on curve-shape evidence; the long run is the key session; '
      + 'threshold holds; interval work is the thing not to add; a VO2-dominant week with no long '
      + 'run is called a contradiction.',
    build: () => composeCoachingThesis({
      threshold: threshold(0.80),
      highIntensity: highIntensity(0.30),
      durability: durability({ confidence: 0.85, sourceMode: 'direct', raw: 1.12, shrunk: 1.10, raceConf: 0.7, decoupling: 7.5 }),
      week: WEEK_WITH_LONG_AND_TEMPO,
      todayISO: TODAY,
    }),
    check: (t) => {
      expect(t.primaryLimiter).toBe('DURABILITY');
      expect(t.basis).toBe('CURVE_SHAPE_EVIDENCE');
      expect(t.priority).toBe('increase_long_run_demand');
      expect(t.confidence).toBeCloseTo(0.7, 10);
      expect(t.addressedBy.map((a) => a.family)).toEqual(['long']);
      expect(t.weekVerdict.code).toBe('WEEK_ADDRESSES_LIMITER');
      expect(t.heldConstant.find((h) => h.capacity === 'THRESHOLD')?.code).toBe('BETTER_EVIDENCED_THAN_THE_LIMITER');
      expect(t.coachLine).toBe(
        'Your races fade with distance faster than your speed predicts, so durability is where the work goes. '
        + "Your threshold holds, and this week's long run is the session that builds it.",
      );
      const d = thesisPlanDirective(t);
      expect(d).toMatchObject({ emphasis: 'durability', keySessionFamily: 'long', doNotAdd: 'intervals' });
      expect(d.hold).toEqual(['THRESHOLD']);
      expect(assessWeekAgainstThesis('DURABILITY', WEEK_VO2_DOMINANT_NO_LONG).code).toBe('WEEK_CONTRADICTS_THESIS');
      expect(assessWeekAgainstThesis('DURABILITY', TAPER_WEEK).code).toBe('WEEK_IS_NON_NORMAL');
    },
  },
  {
    name: '3 · durable, speed-limited (holds pace across distance better than reference)',
    expect: 'The real limiter is speed, and this engine CANNOT name it (no direct high-intensity '
      + 'reader), so: HIGH_INTENSITY stays unrankable; DURABILITY is excluded as the evidenced '
      + 'strength and never called the limiter; the limiter falls to THRESHOLD on the confidence '
      + 'basis; the shape finding is stated in reasons and a review trigger names the missing reader.',
    build: () => composeCoachingThesis({
      threshold: threshold(0.75),
      highIntensity: highIntensity(0.45),
      durability: durability({ confidence: 0.60, sourceMode: 'direct', raw: 1.04, shrunk: 1.05, raceConf: 0.55, decoupling: 3.0 }),
      week: WEEK_WITH_LONG_AND_TEMPO,
      todayISO: TODAY,
    }),
    check: (t) => {
      expect(t.curveShape.read).toBe('endurance_biased');
      expect(t.primaryLimiter).not.toBe('HIGH_INTENSITY');
      expect(t.primaryLimiter).not.toBe('DURABILITY');
      expect(t.primaryLimiter).toBe('THRESHOLD');
      expect(t.basis).toBe('LOWEST_CONFIDENCE_AMONG_EVIDENCED');
      expect(t.heldConstant.find((h) => h.capacity === 'DURABILITY')?.code).toBe('EVIDENCED_STRENGTH_BY_CURVE_SHAPE');
      expect(t.heldConstant.find((h) => h.capacity === 'HIGH_INTENSITY')?.code).toBe('NOT_LOOKED_AT_NO_DIRECT_READER');
      expect(t.reasons).toContain('CURVE_SHAPE_ENDURANCE_BIASED_NO_HIGH_INTENSITY_READER');
      expect(t.reconsiderIf.some((r) => r.code === 'UNRANKABLE_GAINS_A_DIRECT_READER' && /HIGH_INTENSITY/.test(r.detail))).toBe(true);
      expect(t.coachLine).toBe(
        "Your durability is an evidenced strength, so it holds. Threshold is where the work goes, and this week's threshold session is the session that builds it.",
      );
    },
  },
  {
    name: '4 · sparse history (one logged run, no races, no long runs)',
    expect: 'UNKNOWN. No capacity has been looked at with this runner\'s own evidence, so no '
      + 'limiter is named, no confidence is spent, the priority is to establish evidence, and the '
      + 'week is not assessed.',
    build: () => composeCoachingThesis({
      threshold: threshold(0.32, 'vdot_fallback', ['run1']),
      highIntensity: highIntensity(0.32),
      durability: durability({ confidence: CAPACITY_CONFIDENCE_BANDS.populationPrior, sourceMode: 'population_prior' }),
      week: WEEK_WITH_LONG_AND_TEMPO,
      todayISO: TODAY,
    }),
    check: (t) => {
      expect(t.primaryLimiter).toBe('UNKNOWN');
      expect(t.basis).toBe('NO_EVIDENCED_CAPACITY');
      expect(t.priority).toBe('establish_evidence_before_prioritising');
      expect(t.confidence).toBeNull();
      expect(t.evidenceIds).toEqual([]);
      expect(t.curveShape.read).toBe('unavailable');
      expect(t.weekVerdict.code).toBe('NOT_ASSESSED');
      expect(t.addressedBy).toEqual([]);
      expect(t.coachLine).toMatch(/not enough direct evidence/);
      expect(thesisPlanDirective(t).emphasis).toBe('establish_evidence');
      for (const s of t.standings) expect(s.rankable).toBe(false);
    },
  },
  {
    name: '5 · returning runner (real evidence, all of it stale; neutral race curve)',
    expect: 'A real limiter is still named because the evidence is real: the values hold and only '
      + 'the confidences have decayed. With a neutral curve the basis is confidence, and the '
      + 'least-known evidenced capacity (durability, race-derived only, no recent long runs) is '
      + 'the one to rebuild first, with a lowered confidence stated.',
    build: () => composeCoachingThesis({
      threshold: threshold(0.55),
      highIntensity: highIntensity(0.22),
      durability: durability({ confidence: 0.35, sourceMode: 'race_derived', raw: 1.07, shrunk: 1.065, raceConf: 0.35 }),
      week: null,
      todayISO: TODAY,
    }),
    check: (t) => {
      expect(t.curveShape.read).toBe('neutral');
      expect(t.primaryLimiter).toBe('DURABILITY');
      expect(t.basis).toBe('LOWEST_CONFIDENCE_AMONG_EVIDENCED');
      expect(t.confidence).toBeCloseTo(0.35, 10);
      expect(t.reasons).toContain('CURVE_SHAPE_NEUTRAL');
      expect(t.reasons).toContain('LIMITER_EVIDENCE_IS_INDIRECT');
      expect(t.reasons).toContain('NO_ACTIVE_PLAN');
      expect(t.weekVerdict.code).toBe('NOT_ASSESSED');
      expect(t.reconsiderIf.some((r) => r.code === 'LIMITER_CONFIDENCE_OVERTAKEN')).toBe(true);
    },
  },
  {
    name: '6 · no-HR runner (races graded, nothing HR-derived corroborates)',
    expect: 'The curve-shape read needs no heart rate, so a speed-biased race curve still names '
      + 'DURABILITY as the limiter; threshold, which needs HR to be read directly, is a fallback '
      + 'and is held as not-looked-at rather than called a weakness.',
    build: () => composeCoachingThesis({
      threshold: threshold(0.31, 'vdot_fallback', ['race-a']),
      highIntensity: highIntensity(0.31),
      durability: durability({ confidence: 0.50, sourceMode: 'race_derived', raw: 1.095, shrunk: 1.08, raceConf: 0.5, slugs: ['race-a', 'race-b', 'race-c'] }),
      week: WEEK_WITH_LONG_AND_TEMPO,
      todayISO: TODAY,
    }),
    check: (t) => {
      expect(t.primaryLimiter).toBe('DURABILITY');
      expect(t.basis).toBe('CURVE_SHAPE_EVIDENCE');
      expect(t.evidenceIds).toEqual(['race-a', 'race-b', 'race-c']);
      expect(t.heldConstant.find((h) => h.capacity === 'THRESHOLD')?.code).toBe('NOT_LOOKED_AT_NO_DIRECT_READER');
      expect(t.coachLine).toBe(
        "Your races fade with distance faster than your speed predicts, so durability is where the work goes, and this week's long run is the session that builds it.",
      );
    },
  },
];

describe('COACHING THESIS · the golden runners (pure five)', () => {
  const resolved = GOLDEN.map((g) => ({ g, t: g.build() }));

  it('prints every fixture beside the outcome that was written for it', () => {
    /* eslint-disable no-console */
    for (const { g, t } of resolved) {
      console.log(`\n── ${g.name}`);
      console.log(`   EXPECTED · ${g.expect}`);
      console.log(`   ACTUAL   · limiter=${t.primaryLimiter} basis=${t.basis} priority=${t.priority} `
        + `confidence=${t.confidence == null ? 'null' : t.confidence.toFixed(2)} shape=${t.curveShape.read}`);
      console.log(`              week=${t.weekVerdict.code} · ${t.weekVerdict.detail}`);
      console.log(`              coachLine: ${t.coachLine}`);
    }
    /* eslint-enable no-console */
    expect(resolved.length).toBe(5);
  });

  for (const { g, t } of resolved) {
    it(g.name, () => g.check(t));
  }

  it('every coach line obeys the locked voice: no em dash, no exclamation mark, no interpunct, two sentences at most', () => {
    for (const { t } of resolved) {
      expect(t.coachLine, t.coachLine).not.toMatch(/[—!·]/);
      expect(t.coachLine.split('.').filter((s) => s.trim()).length, t.coachLine).toBeLessThanOrEqual(2);
    }
  });

  it('a fallback-only capacity is NEVER the limiter, in any fixture', () => {
    for (const { t } of resolved) {
      if (t.primaryLimiter === 'UNKNOWN') continue;
      const s = t.standings.find((x) => x.capacity === t.primaryLimiter)!;
      expect(s.rankable).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * RULE 9 · the clock walk through the REAL fit
 * ═════════════════════════════════════════════════════════════════════════ */

describe('COACHING THESIS · Rule 9 · the limiter does not move on the clock', () => {
  // A speed-biased race set: two halves and a marathon that came in slower
  // than Riegel 1.06 predicts from them. Fixed for the whole walk.
  const RACES: DurabilityRaceObservation[] = [
    { slug: 'half-a', date: '2026-02-01', distanceMi: 13.11, finishSec: 5694, priority: 'A', weight: 1 },
    { slug: 'half-b', date: '2026-05-03', distanceMi: 13.16, finishSec: 5760, priority: 'B', weight: 0.65 },
    { slug: 'marathon', date: '2026-03-08', distanceMi: 26.22, finishSec: 12700, priority: 'A', weight: 1 },
  ];
  const NO_DECOUPLING: DecouplingRead = { ok: false, reason: 'no_observations', observations: 0 };

  it('walks todayISO across 90 days with the races held fixed · one limiter, decaying confidence', () => {
    const seen = new Set<string>();
    const confidences: number[] = [];
    for (let d = 0; d <= 90; d += 3) {
      const today = new Date(Date.parse('2026-06-01T12:00:00Z') + d * 86_400_000).toISOString().slice(0, 10);
      const raceExponent = fitRaceExponent(RACES, { today });
      const dur = composeDurability({ raceExponent, decoupling: NO_DECOUPLING });
      expect(dur.rawFittedExponent).not.toBeNull();
      const t = composeCoachingThesis({
        threshold: threshold(0.7), highIntensity: highIntensity(0.3), durability: dur, week: null, todayISO: today,
      });
      seen.add(`${t.primaryLimiter}/${t.basis}`);
      confidences.push(t.confidence ?? -1);
    }
    expect([...seen]).toEqual(['DURABILITY/CURVE_SHAPE_EVIDENCE']);
    // The clock reached confidence and nothing else.
    for (let i = 1; i < confidences.length; i++) expect(confidences[i]).toBeLessThanOrEqual(confidences[i - 1] + 1e-12);
    expect(confidences[confidences.length - 1]).toBeLessThan(confidences[0]);
  });

  it('the raw fit the shape reads sits above the doctrine band for this race set, and the band is limiter.ts\'s own', () => {
    const raceExponent = fitRaceExponent(RACES, { today: '2026-09-02' });
    expect(raceExponent.ok).toBe(true);
    if (!raceExponent.ok) return;
    expect(raceExponent.rawFittedExponent).toBeGreaterThan(CURVE_NEUTRAL_EXPONENT_BAND[1]);
    const dur = composeDurability({ raceExponent, decoupling: NO_DECOUPLING });
    const shape = curveShapeFrom(dur);
    expect(shape.read).toBe('speed_biased');
    if (shape.read !== 'unavailable') expect(shape.band).toBe(CURVE_NEUTRAL_EXPONENT_BAND);
  });

  it('composeDurability carries the raw fit (the pass-through the shape read depends on)', () => {
    const raceExponent = fitRaceExponent(RACES, { today: '2026-09-02' });
    const dur = composeDurability({ raceExponent, decoupling: NO_DECOUPLING });
    if (raceExponent.ok) expect(dur.rawFittedExponent).toBe(raceExponent.rawFittedExponent);
    const refused = composeDurability({ raceExponent: { ok: false, reason: 'no_races', races: 0 }, decoupling: NO_DECOUPLING });
    expect(refused.rawFittedExponent).toBeNull();
    expect(curveShapeFrom(refused).read).toBe('unavailable');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE OWNER · real account, read-only role (Rule 13)
 * ═════════════════════════════════════════════════════════════════════════ */

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

describe.skipIf(!RO)('COACHING THESIS · 1 · the owner, rendered on the read-only role', () => {
  it('expected: DURABILITY on curve-shape evidence (raw fit above 1.08 over five graded races), threshold holds, this week\'s long run addresses it', async () => {
    process.env.DATABASE_URL = RO;
    const { resolveCoachingThesis } = await import('@/lib/training/coaching-thesis');
    const t = await resolveCoachingThesis(OWNER, '2026-09-02');
    /* eslint-disable no-console */
    console.log(`\n── 1 · OWNER · 2026-09-02`);
    console.log(`   limiter=${t.primaryLimiter} basis=${t.basis} priority=${t.priority} confidence=${t.confidence?.toFixed(3)}`);
    console.log(`   curveShape=${JSON.stringify(t.curveShape)}`);
    console.log(`   evidenceIds=${JSON.stringify(t.evidenceIds)}`);
    console.log(`   week=${t.weekVerdict.code} · ${t.weekVerdict.detail}`);
    console.log(`   addressedBy=${t.addressedBy.map((a) => `${a.dateIso} ${a.type} ${a.distanceMi ?? ''}mi`).join(' | ')}`);
    console.log(`   coachLine: ${t.coachLine}`);
    /* eslint-enable no-console */
    expect(t.primaryLimiter).toBe('DURABILITY');
    expect(t.basis).toBe('CURVE_SHAPE_EVIDENCE');
    expect(t.curveShape.read).toBe('speed_biased');
    if (t.curveShape.read !== 'unavailable') {
      expect(t.curveShape.rawExponent).toBeGreaterThan(CURVE_NEUTRAL_EXPONENT_BAND[1]);
      expect(t.curveShape.races).toBe(5);
    }
    expect(t.heldConstant.find((h) => h.capacity === 'THRESHOLD')?.code).toBe('BETTER_EVIDENCED_THAN_THE_LIMITER');
    expect(t.heldConstant.find((h) => h.capacity === 'HIGH_INTENSITY')?.code).toBe('NOT_LOOKED_AT_NO_DIRECT_READER');
    expect(t.weekVerdict.code).toBe('WEEK_ADDRESSES_LIMITER');
    expect(t.addressedBy.some((a) => a.family === 'long')).toBe(true);
  }, 60_000);
});
