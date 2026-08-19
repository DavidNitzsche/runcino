/**
 * DOCTRINE-VOCAB-1 + DOCTRINE-STRIDES-1 · what a plan actually CONTAINS.
 *
 * Two findings from the 2026-08-17 doctrine-conformance audit, both about the
 * gap between the workout vocabulary `Research/04-workout-vocabulary.md`
 * describes and the one the engine could produce:
 *
 *   · `resolvePrescriptions` asked the workout_library for `vo2max` and
 *     `threshold` and nothing else, so twelve of twenty-one seeded families
 *     were never requested and an eighteen-week marathon build contained
 *     exactly three workout shapes — reps, tempo, long.
 *
 *   · `expand-spec` had no strides shape, so a plan row reading "2 mi + 4×20s
 *     strides" reached the watch as a flat two-mile jog. Research/04 §7.2 puts
 *     strides in every phase of every plan; Research/08's race-week templates
 *     put them the day before every race.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_vocab_doctrine.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { qualityFamilyFor } from './generate';
import { buildWorkoutSpec, STRIDE_DAYS_PER_WEEK } from './spec-builder';
import { expandSpecToPhases, subLabelFromSpec, strideSuffix } from '../training/expand-spec';
import { parseStrides, parseTimeReps, parsePrescription } from './prescription-parser';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '2027-03-01', lastRaceFinishedDaysAgo: 0,
  lastRaceDistance: null, raceHistory: [], longRunDay: 'sun', restDay: 'sat', availableDays: [],
} as any;

const MARATHON = {
  ...base, goalMode: 'goal', distance: 'marathon', experienceLevel: 'advanced',
  weeklyMileageBucket: 55, weeklyFrequency: 6, planWeeks: 18, goalTimeSec: 11400,
  longestRunBucket: '10+', bestRecentVdotOverride: 48,
};
const FIVE_K = {
  ...base, goalMode: 'goal', distance: '5k', experienceLevel: 'intermediate',
  weeklyMileageBucket: 25, weeklyFrequency: 5, planWeeks: 12, goalTimeSec: 1350,
  longestRunBucket: '3-6',
};

function qualityShapes(cfg: Record<string, unknown>): Set<string> {
  const r = buildSimPlan(cfg as never);
  if (!r.ok) throw new Error('sim build failed');
  const out = new Set<string>();
  for (const w of r.composed.weeks) {
    for (const d of w.days) if (d.isQuality && d.subLabel) out.add(d.subLabel);
  }
  return out;
}

describe('DOCTRINE-VOCAB-1 · the plan carries the phase\'s vocabulary', () => {
  it('a marathon build carries marathon-pace work, not three shapes on repeat', () => {
    const shapes = qualityShapes(MARATHON);
    // Research/04 §11.2 Canova 2K repeats — "Specific phase; first block 8-10
    // weeks out". Before this the marathon's race-specific block was a generic
    // tempo and a generic cruise-interval session, week after week.
    //
    // VOCAB-CATALOGUE-1 · the zone walk is now rendered from the catalogue
    // entry's own `zones` (MP → T) rather than from the hand-written string
    // "5×2K · descend MP → T · 2 min jog". The word "descend" was the engine's;
    // the arrow is §11.2's ("descend across reps to slightly faster than T").
    expect([...shapes].some((s) => /MP → T/.test(s)), `marathon has no MP session: ${[...shapes]}`).toBe(true);
    // §10.3 wave tempo — "Specific phase HM/marathon".
    expect([...shapes].some((s) => /wave tempo/.test(s))).toBe(true);
    // §8 — the hill/strength block before the sharpening end.
    //
    // VOCAB-CATALOGUE-1 · this used to assert one hill string and one fartlek
    // string, because the engine alternated exactly two of them on
    // `Math.floor(weekIdx / 2) % 2`. §8 writes five hill sessions and the plan
    // now draws several, so the claim is breadth rather than presence.
    //
    // The fartlek assertion is GONE, and its removal is doctrine rather than a
    // relaxation: §9.5's time-based fartlek — the "6×3 min @ 10K effort" the
    // engine used to place here — states "When in cycle | Base phase or
    // trail-running prep", so QUALITY was never its phase. §9.2's Mona fartlek
    // IS placed through the specific phase, and the catalogue carries it, but
    // its 2×90s / 4×60s / 4×30s / 4×15s shape is an unequal-step sequence that
    // `prescription-parser.ts` has no form for; `catalogue-rx.ts` declines it
    // rather than shipping a label the spec builder would not build.
    const hillShapes = [...shapes].filter((s) => /hill/i.test(s));
    expect(hillShapes.length, `marathon draws too few hill sessions: ${hillShapes}`).toBeGreaterThanOrEqual(2);
    // The audit's headline number was three. Anything near it is the defect.
    expect(shapes.size).toBeGreaterThanOrEqual(7);
  });

  it('a 5K build sees speed and hills, and races at 5K pace in the race-specific block', () => {
    const shapes = qualityShapes(FIVE_K);
    expect([...shapes].some((s) => /hills/.test(s))).toBe(true);
    // §14.1's race-pace rep sessions. VOCAB-CATALOGUE-1 · WHICH of them this
    // runner gets is now an affordability question, and at 25 mi/wk the answer
    // is §14.1's "2 × (4 × 400) | 5K to 3K", not its "12 × 400 at 5K": twelve
    // four-hundreds is 2.98 mi at 5K pace and Daniels' 8% leaves about two on a
    // week this size. The catalogue states 12 as a fixed count, not a band, so
    // it declines rather than shipping an eight-rep session under a twelve-rep
    // name. Bigger weeks get the classic simulator.
    expect([...shapes].some((s) => /@ 5K[-\s]/.test(s)), `5K has no race-pace session: ${[...shapes]}`).toBe(true);
    // §12.2 cutdowns — "Specific phase, 5K/10K/HM". VOCAB-CATALOGUE-1 · the
    // cutdown is no longer PINNED to the late-QUALITY threshold slot; it now
    // competes there with §5.3's cruise intervals, which §15 places in the same
    // row, and the selector rotates between them least-recently-used. §12.2's
    // own Frequency row says "Every 2 weeks specific phase", so a weekly pin was
    // never what doctrine asked for. A build with more than one such slot draws
    // both — asserted on the half, which has a race-specific threshold slot as
    // well as a QUALITY one.
    const withCutdown = qualityShapes({
      ...base, goalMode: 'goal', distance: 'half', experienceLevel: 'intermediate',
      weeklyMileageBucket: 45, weeklyFrequency: 5, planWeeks: 16, goalTimeSec: 6300,
      longestRunBucket: '10+',
    });
    expect(
      [...withCutdown].some((s) => /MP → HM → T → 10K → 5K/.test(s)),
      `no §12.2 cutdown anywhere: ${[...withCutdown]}`,
    ).toBe(true);
    expect(shapes.size).toBeGreaterThanOrEqual(6);
  });

  it('never places the same family twice in one week', () => {
    // Both of a week's slots can land on the same type, and a family keyed only
    // on type would fill both with one workout — trading three shapes for two.
    const r = buildSimPlan(MARATHON as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const w of r.composed.weeks) {
      const q = w.days.filter((d) => d.isQuality && d.type !== 'race').map((d) => d.subLabel);
      expect(new Set(q).size, `${w.phase} repeats a session: ${q.join(' | ')}`).toBe(q.length);
    }
  });

  it('leaves BASE to easy volume, as Research/04 §15\'s base row does', () => {
    for (const slot of ['intervals', 'threshold', 'tempo'] as const) {
      expect(qualityFamilyFor('m', 'BASE', 0, 5, slot)).toBeNull();
    }
    // Ultra stays threshold-dominant: Research/00a:311-312 calls I-pace reps
    // "rarely" appropriate, and race-pace rep sessions are not its shape.
    expect(qualityFamilyFor('ultra', 'RACE-SPECIFIC', 0, 1, 'threshold')).toBeNull();
  });

  it('a hill session goes out by effort, never at a flat-ground pace', () => {
    // Research/04 §8.1's pace column is "5K–10K effort", never a number,
    // because a flat pace is unreachable on a 4-6% grade — prescribing one puts
    // the runner in breach of their own workout for climbing it correctly.
    const { spec, paceTargetSPerMi } = buildWorkoutSpec(
      'intervals', 7, 400, 160, '6×90s hills @ 5K-10K effort · 2:30 jog down',
    );
    const s = spec as Record<string, unknown>;
    expect(s.rep_count).toBe(6);
    expect(s.rep_duration_s).toBe(90);
    expect(s.rep_rest_s).toBe(150);
    expect(s.rep_pace_s_per_mi).toBeNull();
    expect(paceTargetSPerMi).toBeNull();

    const phases = expandSpecToPhases({ spec, totalMi: 7, easyPaceSec: 540 })!;
    const work = phases.filter((p) => p.type === 'work');
    expect(work).toHaveLength(6);
    // Time-based: no distance, so build-workout marks it repUnit:'time'.
    expect(work[0].distanceMi).toBeNull();
    expect(work[0].durationSec).toBe(90);
    expect(work[0].targetPaceSPerMi).toBeNull();
    // The authored identity survives into the persisted label.
    expect(subLabelFromSpec(spec)).toBe('6×90s hills @ 5K-10K effort · 2:30 jog down');
  });

  it('a fartlek keeps its pace target — only hills are effort-only', () => {
    const { spec } = buildWorkoutSpec('intervals', 7, 400, 160, '6×3 min @ 10K effort · 2 min easy jog');
    const s = spec as Record<string, unknown>;
    expect(s.rep_duration_s).toBe(180);
    expect(s.rep_pace_s_per_mi).toBeTypeOf('number');
  });

  it('time-rep parsing never steals a distance-rep prescription', () => {
    expect(parseTimeReps('5×800m @ I pace · 90s jog')).toBeNull();
    expect(parseTimeReps('4×1 mi @ I · 3 min jog')).toBeNull();
    expect(parsePrescription('6×90s hills · 2:30 jog down')).toBeNull();
    // The rest specifier comes from AFTER the rep pattern, or "90s" would be
    // read as its own recovery.
    expect(parseTimeReps('6×90s hills · 2:30 jog down')).toEqual({ reps: 6, durationS: 90, restS: 150 });
  });
});

describe('DOCTRINE-STRIDES-1 · the watch can run a stride', () => {
  it('parses every shape the generator and the library produce', () => {
    expect(parseStrides('4×20s strides')).toEqual({ reps: 4, durationS: 20, distanceM: null });
    expect(parseStrides('45 min easy + 6×80m strides')).toEqual({ reps: 6, durationS: null, distanceM: 80 });
    expect(parseStrides('2 mi E + 6×ST')).toEqual({ reps: 6, durationS: null, distanceM: null });
    // Never mistakes a rep set for strides.
    expect(parseStrides('5×800m @ I pace · 90s jog')).toBeNull();
  });

  it('expands into stride phases the watch counts down', () => {
    const { spec } = buildWorkoutSpec('easy', 6, 400, 160, 'EASY · 6×20s strides');
    const s = spec as Record<string, unknown>;
    expect(s.strides_reps).toBe(6);
    expect(s.strides_duration_s).toBe(20);

    const phases = expandSpecToPhases({ spec, totalMi: 6, easyPaceSec: 540 })!;
    const strides = phases.filter((p) => p.isStrideSegment);
    expect(strides).toHaveLength(6);
    expect(strides[0].durationSec).toBe(20);
    expect(strides[0].distanceMi).toBeNull();
    // Research/04 §7.2 · "Accelerate to mile-to-5K race pace" — faster than the
    // easy run they sit inside.
    expect(strides[0].targetPaceSPerMi!).toBeLessThan(540);
    // Each stride is followed by its walk-back; the easy run itself is first.
    expect(phases[0].type).toBe('work');
    expect(phases.filter((p) => p.label === 'Walk back')).toHaveLength(6);
    expect(strideSuffix(spec)).toBe(' + 6×20s strides');
  });

  it('an easy run without strides is unchanged', () => {
    const { spec } = buildWorkoutSpec('easy', 6, 400, 160, 'EASY');
    expect((spec as Record<string, unknown>).strides_reps).toBeUndefined();
    const phases = expandSpecToPhases({ spec, totalMi: 6, easyPaceSec: 540 })!;
    expect(phases).toHaveLength(1);
    expect(phases.some((p) => p.isStrideSegment)).toBe(false);
  });

  it('the day before a race carries the strides its label has always promised', () => {
    const r = buildSimPlan(MARATHON as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const shakeouts = r.composed.weeks.flatMap((w) => w.days.filter((d) => d.type === 'shakeout'));
    expect(shakeouts.length).toBeGreaterThan(0);
    for (const d of shakeouts) {
      expect(d.subLabel, 'shakeout promises strides in prose only').toMatch(/strides/i);
      const { spec } = buildWorkoutSpec(d.type, d.distanceMi, 400, 160, d.subLabel);
      expect((spec as Record<string, unknown>).strides_reps).toBeGreaterThan(0);
    }
  });

  it('puts strides on the doctrine number of easy days, in every phase', () => {
    // Research/04 §7.2 · "| When in cycle | All phases — never stop doing
    // strides |". §15's table lists them in the base row AND the
    // sharpening/taper row. BASE and TAPER are therefore included, not just the
    // quality blocks.
    //
    // The RACE WEEK is the one exception, and it is deliberate: that week is
    // built by its own layout, and its stride carrier is the shakeout the day
    // before the race — which is where Research/08's race-week templates and
    // §17.3's pre-race warmup table put strides. Asserted separately above.
    const r = buildSimPlan(MARATHON as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let phasesSeen = new Set<string>();
    for (const w of r.composed.weeks) {
      if (w.isRaceWeek) continue;
      const easyDays = w.days.filter((d) => d.type === 'easy' && d.distanceMi > 0);
      if (easyDays.length === 0) continue;
      const withStrides = easyDays.filter((d) => /strides/i.test(d.subLabel ?? ''));
      expect(
        withStrides.length,
        `${w.phase} has ${easyDays.length} easy days and ${withStrides.length} with strides`,
      ).toBe(Math.min(STRIDE_DAYS_PER_WEEK, easyDays.length));
      phasesSeen.add(String(w.phase));
    }
    expect([...phasesSeen].sort()).toEqual(['BASE', 'QUALITY', 'RACE-SPECIFIC', 'TAPER']);
  });
});
