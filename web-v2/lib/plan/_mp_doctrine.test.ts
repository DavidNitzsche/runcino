/**
 * DOCTRINE-MPLONG-1 + DOCTRINE-TAPERMP-1 · the marathon's marathon-pace work.
 *
 * Two deferred defects, both about the same session appearing in the wrong
 * rhythm:
 *
 *   1. `longFinishSegment` put a 50%-of-the-long marathon-pace finish on EVERY
 *      race-specific week. `Research/04` §4.4 gives that session a frequency of
 *      "Every 2–3 weeks during marathon specific phase", and §16 names the
 *      pairing the engine then created — "MP long run + hard tempo within 5
 *      days" — as a combination to avoid. The 80/20 pass shipped earlier the
 *      same day handed the surplus hard miles back AFTER the fact, which left
 *      every race-specific week sitting on the floor at exactly 75% easy. The
 *      cadence removes the cause.
 *
 *   2. `qualityTypesFor` collapsed the whole TAPER to `['race_week_tuneup']`,
 *      so the marathon taper lost the MP-specific sessions `Research/08` §9.2
 *      prescribes at three and two weeks out. §9.1 states the principle being
 *      violated outright: "The largest cut is to easy mileage; intensity is
 *      preserved through the taper."
 *
 * The doctrine gate (`lib/doctrine/registry.ts` · MPLONG.race-specific-cadence,
 * TAPERMP.marathon-taper-mp-dose) holds the CONSTANTS against the research
 * tables. This file holds the composed PLANS against them.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_mp_doctrine.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { racePaceLongThisWeek, MP_LONG_CADENCE_WEEKS, TAPER_MP_DOSE } from './generate';
import { buildWorkoutSpec } from './spec-builder';
import { weekIntensity, EASY_SHARE_FLOOR } from './intensity-distribution';
import { subLabelFromSpec } from '@/lib/training/expand-spec';

const base = {
  startDateISO: '2026-08-17', raceDateISO: null, lastRaceFinishedDaysAgo: 0,
  lastRaceDistance: null, raceHistory: [], longRunDay: 'sun', restDay: 'sat', availableDays: [],
} as unknown as Record<string, unknown>;

/** David's own CIM block: advanced marathoner, ~50 mi/wk, 16-week runway. */
function cimBlock() {
  return buildSimPlan({
    ...base, goalMode: 'goal', distance: 'marathon', experienceLevel: 'advanced',
    weeklyMileageBucket: 45, weeklyFrequency: 6, planWeeks: 16, goalTimeSec: 11400,
    longestRunBucket: '10+', bestRecentVdotOverride: 47.9,
  } as never);
}

const finishMiOf = (subLabel: string | null | undefined): number => {
  const m = String(subLabel ?? '').match(/(\d+(?:\.\d+)?)mi @ (?:MP|M|HM)\b/);
  return m ? Number(m[1]) : 0;
};

describe('DOCTRINE-MPLONG-1 · the marathon-pace long run is a cadence session', () => {
  it('the picker never violates the 2-3 week band and never lands on a deload', () => {
    // The doctrine gate reads the band out of Research/04 §4.4 and walks the
    // same geometries. This is the unit-level statement of the same rule, kept
    // here so a failure points at the function rather than at the registry.
    expect(MP_LONG_CADENCE_WEEKS).toBe(2);
    for (const cutbackEveryN of [3, 4]) {
      for (const phaseEndIdx of [4, 7, 10, 13, 16, 19]) {
        const hits: number[] = [];
        for (let wk = 0; wk <= phaseEndIdx; wk++) {
          if (racePaceLongThisWeek(wk, phaseEndIdx - wk, cutbackEveryN)) hits.push(wk);
        }
        expect(hits.length, `no MP long at all for phaseEnd=${phaseEndIdx}/n=${cutbackEveryN}`).toBeGreaterThan(0);
        for (const wk of hits) expect(wk > 0 && (wk + 1) % cutbackEveryN === 0).toBe(false);
        for (let i = 1; i < hits.length; i++) {
          expect(hits[i] - hits[i - 1]).toBeGreaterThanOrEqual(2);
          expect(hits[i] - hits[i - 1]).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('the last race-specific week always carries one · it is the closest to the race', () => {
    // Anchoring on the phase END rather than its start is what keeps the final
    // marathon-pace rehearsal a fixed distance from race day regardless of how
    // long the build is.
    for (const phaseEndIdx of [6, 9, 12, 14]) {
      const lastIsCutback = phaseEndIdx > 0 && (phaseEndIdx + 1) % 4 === 0;
      expect(racePaceLongThisWeek(phaseEndIdx, 0, 4)).toBe(!lastIsCutback);
    }
  });

  it("David's CIM block runs MP longs every 2-3 weeks, not every week", () => {
    const r = cimBlock();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rs = r.composed.weeks
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => w.phase === 'RACE-SPECIFIC' && !w.isRaceWeek);
    expect(rs.length).toBeGreaterThan(2);

    const withMp = rs.filter(({ w }) => finishMiOf(w.days.find((d) => d.isLong)?.subLabel) > 0);
    const withoutMp = rs.filter(({ w }) => finishMiOf(w.days.find((d) => d.isLong)?.subLabel) === 0);
    // Both kinds exist — that IS the cadence. Before this fix `withoutMp` was
    // empty, which is the defect.
    expect(withMp.length).toBeGreaterThan(0);
    expect(withoutMp.length).toBeGreaterThan(0);
    for (let i = 1; i < withMp.length; i++) {
      const gap = withMp[i].i - withMp[i - 1].i;
      expect(gap).toBeGreaterThanOrEqual(2);
      expect(gap).toBeLessThanOrEqual(3);
    }
    // The intervening long is a plain easy long, not a shrunken MP one.
    for (const { w } of withoutMp) {
      expect(w.days.find((d) => d.isLong)?.subLabel).toBe('LONG');
    }
  });

  it('an MP-long week drops the tempo · Research/04 §16', () => {
    const r = cimBlock();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let mpWeeks = 0;
    let plainWeeks = 0;
    for (const w of r.composed.weeks) {
      if (w.phase !== 'RACE-SPECIFIC' || w.isRaceWeek) continue;
      const q = w.days.filter((d) => d.isQuality && d.type !== 'race');
      if (finishMiOf(w.days.find((d) => d.isLong)?.subLabel) > 0) {
        mpWeeks++;
        // "MP long run + hard tempo within 5 days" — the tempo is what goes.
        expect(q.map((d) => d.type)).not.toContain('tempo');
        // But the week is not emptied out: the MP long IS the second quality
        // session, so exactly one structured session stands beside it.
        expect(q.length).toBe(1);
      } else {
        plainWeeks++;
        expect(q.length).toBe(2);
      }
    }
    expect(mpWeeks).toBeGreaterThan(0);
    expect(plainWeeks).toBeGreaterThan(0);
  });

  it('the runner keeps the same number of training days either way', () => {
    // The dropped quality slot becomes an easy day, never a rest day. A cadence
    // that silently cut a run out of every other week would be a different
    // change from the one doctrine asked for.
    const r = cimBlock();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rs = r.composed.weeks.filter((w) => w.phase === 'RACE-SPECIFIC' && !w.isRaceWeek);
    const runDays = new Set(rs.map((w) => w.days.filter((d) => d.distanceMi > 0).length));
    expect(runDays.size, `training-day count varies across race-specific weeks: ${[...runDays]}`).toBe(1);
  });

  it('the 80/20 floor now RARELY has to shave the marathon long run', () => {
    // The floor can only ever REDUCE a finish, and a shaved finish is visible:
    // the authored dose is 50% of the long, so anything landing well under that
    // is the correction cleaning up after the generator. Before the cadence,
    // EVERY race-specific week of EVERY marathon archetype came out shaved —
    // the floor was doing the generator's job for it, week in week out.
    //
    // It is not zero afterwards, and the residue is honest rather than a gap in
    // the fix. On four running days a marathoner's long run is close to half
    // the week by itself, so a 50%-of-the-long MP dose plus any structured
    // session cannot clear 75% easy at all — no cadence can fix arithmetic. The
    // floor is exactly the right thing to be firing there, and that is what a
    // safety net is for. Five and six days a week — every archetype a marathon
    // build is realistically written for — must now stand on their own.
    const shaved: string[] = [];
    const perFrequency: Record<number, { weeks: number; shaved: number }> = {};
    for (const experienceLevel of ['intermediate', 'advanced'] as const) {
      for (const weeklyMileageBucket of [25, 35, 45]) {
        for (const weeklyFrequency of [4, 5, 6]) {
          const r = buildSimPlan({
            ...base, goalMode: 'goal', distance: 'marathon', experienceLevel,
            weeklyMileageBucket, weeklyFrequency, planWeeks: 18, goalTimeSec: 13500,
            longestRunBucket: weeklyMileageBucket >= 35 ? '10+' : '6-10',
          } as never);
          if (!r.ok) continue;
          const bucket = (perFrequency[weeklyFrequency] ??= { weeks: 0, shaved: 0 });
          for (const [i, w] of r.composed.weeks.entries()) {
            if (w.phase !== 'RACE-SPECIFIC' || w.isRaceWeek) continue;
            const long = w.days.find((d) => d.isLong && d.type === 'long');
            if (!long) continue;
            bucket.weeks++;
            const ratio = finishMiOf(long.subLabel) / long.distanceMi;
            // 0 = off-cadence easy long. Otherwise it must still be the real
            // 50% dose (rounding and the long-run trimmers cost a few points).
            if (ratio > 0.01 && ratio < 0.42) {
              bucket.shaved++;
              if (weeklyFrequency >= 5) {
                shaved.push(`${experienceLevel}/${weeklyMileageBucket}mi/f${weeklyFrequency} wk${i} = ${(ratio * 100).toFixed(0)}%`);
              }
            }
          }
        }
      }
    }
    expect(shaved.slice(0, 10).join('\n')).toBe('');
    // Overall the floor is now a rare correction rather than the mechanism.
    const totals = Object.values(perFrequency).reduce(
      (a, b) => ({ weeks: a.weeks + b.weeks, shaved: a.shaved + b.shaved }),
      { weeks: 0, shaved: 0 },
    );
    expect(totals.weeks).toBeGreaterThan(20);
    expect(totals.shaved / totals.weeks).toBeLessThan(0.15);
  });

  it('the half marathon is untouched', () => {
    // Research/04 §4.5 arguably owes the half the same cadence; that is a
    // separate deliberate decision. This test exists so taking it is loud.
    const r = buildSimPlan({
      ...base, goalMode: 'goal', distance: 'half', experienceLevel: 'intermediate',
      weeklyMileageBucket: 35, weeklyFrequency: 5, planWeeks: 14, goalTimeSec: 6300,
      longestRunBucket: '6-10',
    } as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let checked = 0;
    for (const w of r.composed.weeks) {
      if (w.phase !== 'RACE-SPECIFIC' || w.isRaceWeek) continue;
      const long = w.days.find((d) => d.isLong && d.type === 'long');
      if (!long) continue;
      expect(finishMiOf(long.subLabel), `half lost its race-pace finish: "${long.subLabel}"`).toBeGreaterThan(0);
      expect(w.days.filter((d) => d.isQuality && d.type !== 'race').length).toBe(2);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('DOCTRINE-TAPERMP-1 · the marathon taper keeps its marathon-pace work', () => {
  it('both non-race taper weeks carry an MP session at the doctrine dose', () => {
    const r = cimBlock();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const taper = r.composed.weeks.filter((w) => w.phase === 'TAPER' && !w.isRaceWeek);
    expect(taper.length).toBe(2);

    const [minus3, minus2] = taper;
    const mpOf = (w: (typeof taper)[number]) => {
      const d = w.days.find((x) => x.isQuality && /@\s*MP\b/.test(x.subLabel ?? ''));
      expect(d, `taper week has no MP session: ${w.days.map((x) => x.subLabel).join(' | ')}`).toBeTruthy();
      const m = String(d!.subLabel).match(/^([\d.]+) mi WU · ([\d.]+) mi @ MP · ([\d.]+) mi CD$/);
      expect(m, `MP session label is malformed: "${d!.subLabel}"`).toBeTruthy();
      return { day: d!, wu: Number(m![1]), mp: Number(m![2]), cd: Number(m![3]) };
    };

    const a = mpOf(minus3);
    // Research/08 §9.2 row -3: "Final MP-specific (14-16 mi w/ 10-12 mi at MP)".
    expect(a.wu + a.mp + a.cd).toBeGreaterThanOrEqual(14);
    expect(a.wu + a.mp + a.cd).toBeLessThanOrEqual(16);
    expect(a.mp).toBeGreaterThanOrEqual(10);
    expect(a.mp).toBeLessThanOrEqual(12);

    const b = mpOf(minus2);
    // Row -2: "6-8 mi at MP".
    expect(b.mp).toBeGreaterThanOrEqual(6);
    expect(b.mp).toBeLessThanOrEqual(8);
    // The later session is the smaller one — the taper keeps descending.
    expect(b.mp).toBeLessThan(a.mp);

    // The label's own arithmetic matches the day it is printed on. Several
    // passes trim taper days after they are authored, and this session is the
    // only one in the plan whose sub_label spells out its segments.
    for (const s of [a, b]) {
      expect(s.wu + s.mp + s.cd).toBeCloseTo(s.day.distanceMi, 1);
    }
  });

  it('race week still runs the 5K-pace tune-up · §9.2 row -1', () => {
    const r = cimBlock();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const raceWeek = r.composed.weeks.find((w) => w.isRaceWeek)!;
    const q = raceWeek.days.filter((d) => d.isQuality && d.type !== 'race');
    expect(q.map((d) => d.type)).toContain('race_week_tuneup');
    expect(q.some((d) => /@\s*MP\b/.test(d.subLabel ?? ''))).toBe(false);
  });

  it("the taper's VOLUME cut is intact · §9.1 cuts easy miles, not intensity", () => {
    const r = cimBlock();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const peak = Math.max(
      ...r.composed.weeks.filter((w) => w.phase !== 'TAPER' && !w.isRaceWeek).map((w) => w.weeklyMi),
    );
    const taper = r.composed.weeks.filter((w) => w.phase === 'TAPER' && !w.isRaceWeek);
    let prior = peak;
    for (const w of taper) {
      expect(w.weeklyMi, 'the taper stopped descending').toBeLessThan(prior);
      prior = w.weeklyMi;
    }
    // §9.2's own volume bands for the two weeks it names.
    expect(taper[0].weeklyMi / peak).toBeGreaterThanOrEqual(0.78);
    expect(taper[0].weeklyMi / peak).toBeLessThanOrEqual(0.92);
    expect(taper[1].weeklyMi / peak).toBeLessThanOrEqual(0.72);
    // And the intensity did NOT go with it: the taper is now the least-easy
    // part of the block by share, which is precisely what §9.1 describes.
    for (const w of taper) {
      expect(weekIntensity(w).easyShare).toBeLessThan(0.95);
    }
  });

  it('a marathoner too small to carry the session keeps the tune-up', () => {
    // The dose is a target, not a floor. A 15 mi/wk marathoner's taper cannot
    // hold a 15-mile quality session, and shipping a scaled-to-nothing "MP
    // session" would be worse than the tune-up doctrine already gives them.
    const r = buildSimPlan({
      ...base, goalMode: 'goal', distance: 'marathon', experienceLevel: 'beginner',
      weeklyMileageBucket: 15, weeklyFrequency: 4, planWeeks: 18, goalTimeSec: 18000,
      longestRunBucket: '6-10',
    } as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const w of r.composed.weeks) {
      if (w.phase !== 'TAPER') continue;
      const long = Math.max(0, ...w.days.filter((d) => d.isLong).map((d) => d.distanceMi));
      for (const d of w.days) {
        if (!d.isQuality || d.isLong || d.type === 'race') continue;
        // Whatever it is, it never out-runs the long.
        expect(d.distanceMi, `${d.subLabel} (${d.distanceMi}) exceeds the long (${long})`).toBeLessThanOrEqual(long);
      }
    }
  });

  it('the half, 10K and 5K tapers are unchanged', () => {
    for (const distance of ['half', '10k', '5k'] as const) {
      const r = buildSimPlan({
        ...base, goalMode: 'goal', distance, experienceLevel: 'intermediate',
        weeklyMileageBucket: 35, weeklyFrequency: 5, planWeeks: 14,
        goalTimeSec: distance === 'half' ? 6300 : distance === '10k' ? 2700 : 1350,
        longestRunBucket: '6-10',
      } as never);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      for (const w of r.composed.weeks) {
        if (w.phase !== 'TAPER') continue;
        expect(w.days.some((d) => /@\s*MP\b/.test(d.subLabel ?? '')), `${distance} taper grew an MP session`).toBe(false);
      }
    }
  });
});

describe('DOCTRINE-TAPERMP-1 · the MP block reaches the watch at marathon pace', () => {
  const T = 400;               // threshold, s/mi
  const LABEL = '2 mi WU · 7 mi @ MP · 1 mi CD';

  it('paces the block at MP, not at threshold', () => {
    const { spec, paceTargetSPerMi } = buildWorkoutSpec('tempo', 10, T, 160, LABEL);
    const s = spec as Record<string, unknown>;
    expect(s.kind).toBe('tempo');
    expect(s.tempo_distance_mi).toBe(7);
    // The engine's marathon pace is T+18 when no goal pace is threaded. Pacing
    // it at T would be 18 s/mi too fast, turning a specificity rehearsal into a
    // threshold session in the window doctrine adds no novel stress.
    expect(s.tempo_pace_s_per_mi).toBe(T + 18);
    expect(paceTargetSPerMi).toBe(T + 18);
    // Research/03 anchors the marathon-pace run on pace, not heart rate.
    expect(s.hr_target_bpm).toBeNull();
  });

  it('prefers the runner\'s real goal pace when it sits in the marathon zone', () => {
    const goal = T + 25;
    const { spec } = buildWorkoutSpec('tempo', 10, T, 160, LABEL, null, goal);
    expect((spec as Record<string, unknown>).tempo_pace_s_per_mi).toBe(goal);
    // Same rule the long-run M-finish uses — they read one shared expression.
    const { spec: longSpec } = buildWorkoutSpec('long', 20, T, 160, 'LONG · 8mi @ MP', null, goal);
    expect((longSpec as Record<string, unknown>).finish_pace_s_per_mi).toBe(goal);
  });

  it('survives a spec rebuild without being relabelled as threshold work', () => {
    const { spec } = buildWorkoutSpec('tempo', 10, T, 160, LABEL);
    expect(subLabelFromSpec(spec as never)).toBe(LABEL);
  });

  it('an ordinary tempo is byte-identical', () => {
    const plain = '2 mi WU · 4 mi @ T · 2 mi CD';
    const { spec } = buildWorkoutSpec('tempo', 8, T, 160, plain);
    const s = spec as Record<string, unknown>;
    expect(s.tempo_pace_s_per_mi).toBe(T);
    expect(s.hr_target_bpm).toBe(Math.round(160 * 0.92));
    expect(s.label).toBeUndefined();
    expect(subLabelFromSpec(spec as never)).toBe('2 mi WU · 4 mi @ T · 2 mi CD');
  });
});

// Keep the imported floor referenced so a future edit that stops measuring
// intensity here fails to compile rather than silently passing.
expect(EASY_SHARE_FLOOR).toBeGreaterThan(0);
expect(TAPER_MP_DOSE.final.mpMi).toBeGreaterThan(TAPER_MP_DOSE.primer.mpMi);
