/**
 * WORKOUT-VARIETY INVARIANTS (2026-08-28).
 *
 * Four defects, one shape: doctrine prescribes variety and the engine froze a
 * single value for the whole block.
 *
 *   1. 10K long runs — sixteen identical plain easy runs. `racePaceTag` is
 *      null for the distance so `longFinishSegment` never fired, but
 *      `Research/22` §"10K — Intermediate" names the progression LR among its
 *      Key workout types and its sample peak week states the dose: "9-10 mi E
 *      w/ last 2 mi @ M" (VARIETY-10K-1).
 *   2. HM dress rehearsal — missing outright. `Research/04` §4.6's Distance
 *      row states both races ("18–22 mi (marathon); 12–14 mi (HM)") and
 *      `authorDressRehearsal` returned early for everything but the marathon
 *      (VARIETY-HMDR-1).
 *   3. Strides — frozen at 6×20s from week one of BASE to race week. §7.2's
 *      Reps row is a 4–8 BAND; the engine now walks it with the block
 *      (DOCTRINE-STRIDES-2).
 *   4. Beginner quality — two identical surge sessions, dose frozen forever.
 *      Research/00b's ladder ("light fartlek (4–6× 1 min)") and Research/22's
 *      beginner rows (5K opens "4×1 min @ T", 10K peaks "6×2 min fartlek")
 *      state a walk, and §15's base row supplies a DIFFERENT second day
 *      ("hill sprints, occasional fartlek/light hills") (VARIETY-BEGIN-1).
 *
 * Locked here on real composed blocks, `_midrace_invariants.test.ts` idiom —
 * no DB, byte-reproducible. The doctrine registry holds the numbers against
 * the docs (`STRIDES.rep-progression`, `LONGRUN.tenk-progression`,
 * `LONGRUN.dress-rehearsal`, `BEGINNER.surge-progression`,
 * `BEGINNER.hill-day`); this file holds the BEHAVIOUR on whole plans.
 *
 * Cite: Research/22-plan-templates.md §"10K — Intermediate", §"5K — Beginner",
 *       §"10K — Beginner"
 * Cite: Research/04-workout-vocabulary.md §4.3, §4.6, §7.2, §8.2, §15
 * Cite: Research/00b-recovery-protocols.md §"Marathon Recovery (4-week reverse taper)"
 * Cite: Research/08-pacing-and-race-week.md §9.1
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  TENK_PROGRESSION_FINISH_MI, FAST_FINISH_MIN_MI,
  beginnerSurgeDose, beginnerHillReps,
  type ComposePlanInput, type DOW, type DayPlan,
} from './generate';
import { tPaceFromGoal, buildWorkoutSpec, strideRepsForPhase, STRIDE_REPS_BY_PHASE, STRIDE_DEFAULT_REPS } from './spec-builder';
import { DRESS_REHEARSAL, dressRehearsalDose } from './long-run-rows';

const START_MONDAY = '2026-08-31';

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/** The owner's frame (Sunday long, Saturday rest, Tue/Thu quality), on any
 *  race distance and level — the same archetype grid the sweeps walk. */
function inputFor(opts: {
  raceDistanceMi: number;
  goalSec: number;
  weeks: number;
  level: ComposePlanInput['level'];
  recentWeeklyMi: number;
  recentLongMi: number;
  easyDayMedianMi?: number;
  bestRecentVdot?: number;
}): ComposePlanInput {
  const { raceDistanceMi, goalSec, weeks, level, recentWeeklyMi, recentLongMi } = opts;
  return {
    raceDistanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / raceDistanceMi),
    raceDateISO: addDays(START_MONDAY, weeks * 7 - 1),
    startMondayISO: START_MONDAY,
    level,
    recentWeeklyMi,
    easyDayMedianMi: opts.easyDayMedianMi ?? 4,
    recentLongMi,
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    availableDows: null,
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    rxRaceSpecific: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    tPaceSec: tPaceFromGoal(goalSec, raceDistanceMi),
    lthr: null,
    maxHr: null,
    ...(opts.bestRecentVdot != null ? { bestRecentVdot: opts.bestRecentVdot } : {}),
    midBlockRaces: [],
  };
}

function build(opts: Parameters<typeof inputFor>[0]) {
  const input = inputFor(opts);
  const composed = composePlan(input);
  finalizeComposedPlan(composed, input.raceDistanceMi, input.level);
  return composed;
}

function longsOf(composed: ReturnType<typeof build>) {
  return composed.weeks
    .filter((w) => !w.isRaceWeek)
    .map((w) => ({
      phase: w.phase,
      week: w,
      long: w.days.find((d) => d.isLong && d.type === 'long' && d.distanceMi > 0) ?? null,
    }))
    .filter((r): r is { phase: string; week: (typeof composed.weeks)[number]; long: DayPlan } => r.long != null);
}

// ══ 1 · VARIETY-10K-1 · the 10K's long runs are not all identical ══════════

describe('VARIETY-10K-1 · 10K long runs carry the progression tail on cadence', () => {
  const composed = build({
    raceDistanceMi: 6.22, goalSec: 2700, weeks: 12,
    level: 'intermediate', recentWeeklyMi: 28, recentLongMi: 9, easyDayMedianMi: 5, bestRecentVdot: 45,
  });
  const longs = longsOf(composed);

  it('at least one race-specific long carries the fixed M tail, as a progression LR', () => {
    const tails = longs.filter((r) => r.long.longRunKind === 'progression');
    expect(tails.length, 'no 10K long carries the §4.3 progression tail at all — the sixteen-identical-longs defect').toBeGreaterThan(0);
    for (const r of tails) {
      expect(r.phase, 'the tail is a race-specific-phase session (§4.3 "in specific phase")').toBe('RACE-SPECIFIC');
      expect(r.long.subLabel).toBe(`LONG · ${TENK_PROGRESSION_FINISH_MI}mi @ M`);
      expect(r.long.notes).toMatch(/then 2mi at marathon/i);
    }
  });

  it('the tail is the sample week\'s two miles, never the marathon fractions', () => {
    for (const r of longs.filter((x) => x.long.longRunKind === 'progression')) {
      const mi = Number((r.long.subLabel ?? '').match(/([\d.]+)mi\s*@/)?.[1] ?? 0);
      expect(mi, 'Research/22 §"10K — Intermediate": "last 2 mi @ M"').toBe(TENK_PROGRESSION_FINISH_MI);
      expect(mi).toBeGreaterThanOrEqual(FAST_FINISH_MIN_MI);
      expect(mi, 'a 50% marathon-sized finish on a 10K long is the wrong row').toBeLessThan(r.long.distanceMi * 0.5);
    }
  });

  it('the long runs are NOT all identical: plain longs remain off-cadence', () => {
    const plain = longs.filter((r) => r.long.longRunKind == null && (r.long.subLabel ?? 'LONG') === 'LONG');
    const tails = longs.filter((r) => r.long.longRunKind === 'progression');
    expect(plain.length, 'every long carries the tail — §4.3 is every 2-3 weeks, not weekly').toBeGreaterThan(0);
    expect(tails.length).toBeGreaterThan(0);
  });

  it('TAPER long runs stay plain', () => {
    for (const r of longs.filter((x) => x.phase === 'TAPER')) {
      expect(r.long.longRunKind ?? null, `taper week ${r.week.startISO} long carries race pace`).toBeNull();
      expect(r.long.subLabel ?? 'LONG').toBe('LONG');
    }
  });

  it('the watch spec renders the tail: finish_mi + finish_label from the sub_label', () => {
    const tail = longs.find((r) => r.long.longRunKind === 'progression')!;
    const { spec } = buildWorkoutSpec('long', tail.long.distanceMi, 420, null, tail.long.subLabel);
    expect(spec).not.toBeNull();
    expect((spec as Record<string, unknown>).finish_mi).toBe(TENK_PROGRESSION_FINISH_MI);
    expect((spec as Record<string, unknown>).finish_label).toBe('M');
    expect((spec as Record<string, unknown>).finish_pace_s_per_mi).toBeGreaterThan(0);
  });
});

describe('VARIETY-10K-1 · the 5K stays plain (its Research/22 rows are all-E longs)', () => {
  const composed = build({
    raceDistanceMi: 3.11, goalSec: 1320, weeks: 10,
    level: 'intermediate', recentWeeklyMi: 22, recentLongMi: 6, bestRecentVdot: 42,
  });

  it('no 5K long run carries a race-pace segment of any kind', () => {
    for (const r of longsOf(composed)) {
      expect(r.long.longRunKind ?? null, `${r.week.startISO} · ${r.long.subLabel}`).toBeNull();
    }
  });
});

// ══ 2 · VARIETY-HMDR-1 · the half's dress rehearsal exists ═════════════════

describe('VARIETY-HMDR-1 · the HM authors §4.6\'s rehearsal at the HM band', () => {
  const composed = build({
    raceDistanceMi: 13.11, goalSec: 5400, weeks: 12,
    level: 'advanced', recentWeeklyMi: 32, recentLongMi: 12, easyDayMedianMi: 6, bestRecentVdot: 48,
  });
  const longs = longsOf(composed);
  const raceISO = addDays(START_MONDAY, 12 * 7 - 1);

  it('the three-weeks-out slot is either the rehearsal or already §4.5\'s cadence long', () => {
    // §4.6: the rehearsal lands three weeks out UNLESS the fast-finish cadence
    // already put race pace on that long (the pass does not upgrade or double).
    const slot = longs.find((r) => {
      const iso = addDays(r.week.startISO, r.long.dow === 0 ? 6 : r.long.dow - 1);
      const daysOut = Math.round((Date.parse(raceISO) - Date.parse(iso)) / 86400000);
      return Math.abs(daysOut - DRESS_REHEARSAL.daysBeforeRace) <= 3;
    });
    expect(slot, 'no long run sits in the three-weeks-out window at all').toBeDefined();
    expect(
      slot!.long.longRunKind,
      `the 21-days-out HM long is ${slot!.long.longRunKind ?? 'plain'} — the half has no rehearsal again`,
    ).toMatch(/dress_rehearsal|fast_finish/);
  });

  it('when the rehearsal is authored, it is dosed inside §4.6\'s MP band and says what it is', () => {
    const dress = longs.filter((r) => r.long.longRunKind === 'dress_rehearsal');
    for (const r of dress) {
      const mi = Number((r.long.subLabel ?? '').match(/([\d.]+)mi\s*@\s*MP/)?.[1] ?? 0);
      expect(mi).toBeGreaterThanOrEqual(FAST_FINISH_MIN_MI);
      expect(mi, '§4.6: "4-8 mi total at MP" is the ceiling however long the run').toBeLessThanOrEqual(DRESS_REHEARSAL.mpMiBand[1]);
      expect(r.long.notes).toMatch(/not a fitness test/i);
      expect(r.long.notes).toMatch(/Research\/04 §4\.6/);
    }
  });

  it('the HM dose function scales on the HM band: mid-band long → mid-band MP dose', () => {
    const [lo, hi] = DRESS_REHEARSAL.hmTotalMiBand;
    const dose = dressRehearsalDose((lo + hi) / 2, 99, FAST_FINISH_MIN_MI, false, DRESS_REHEARSAL.hmTotalMiBand);
    expect(dose).not.toBeNull();
    expect(dose!.mpMi).toBeGreaterThanOrEqual(DRESS_REHEARSAL.mpMiBand[0]);
    expect(dose!.mpMi).toBeLessThanOrEqual(DRESS_REHEARSAL.mpMiBand[1]);
    // Without the HM band, a 13-mile long reads as a small marathon long and
    // under-doses — the reference band is what makes the sizing per-race.
    const marathonRead = dressRehearsalDose((lo + hi) / 2, 99, FAST_FINISH_MIN_MI);
    expect(dose!.mpMi).toBeGreaterThan(marathonRead?.mpMi ?? 0);
  });
});

// ══ 3 · DOCTRINE-STRIDES-2 · the stride count walks the §7.2 band ══════════

describe('DOCTRINE-STRIDES-2 · stride reps vary across the block within 4-8', () => {
  const composed = build({
    raceDistanceMi: 26.22, goalSec: 10800, weeks: 14,
    level: 'advanced', recentWeeklyMi: 40, recentLongMi: 14, easyDayMedianMi: 6, bestRecentVdot: 50,
  });

  /** phase → the distinct stride rep counts its easy days carry. */
  function strideRepsByPhase() {
    const seen = new Map<string, Set<number>>();
    for (const w of composed.weeks) {
      for (const d of w.days) {
        const m = (d.subLabel ?? '').match(/(?:EASY|MEDIUM-LONG).*?(\d+)×\d+s strides/);
        if (!m) continue;
        if (!seen.has(w.phase)) seen.set(w.phase, new Set());
        seen.get(w.phase)!.add(Number(m[1]));
      }
    }
    return seen;
  }

  it('every phase prescribes its own §7.2 count, inside the 4-8 band', () => {
    const seen = strideRepsByPhase();
    expect(seen.size, 'no strides found anywhere — DOCTRINE-STRIDES-1 has regressed').toBeGreaterThan(0);
    for (const [phase, counts] of seen) {
      for (const c of counts) {
        expect(c, `${phase} strides out of §7.2's band`).toBeGreaterThanOrEqual(4);
        expect(c, `${phase} strides out of §7.2's band`).toBeLessThanOrEqual(8);
        expect(c, `${phase} count disagrees with strideRepsForPhase`).toBe(strideRepsForPhase(phase));
      }
    }
  });

  it('the count is NOT one frozen number across the block', () => {
    const all = new Set([...strideRepsByPhase().values()].flatMap((s) => [...s]));
    expect(all.size, 'strides are frozen at a single rep count again').toBeGreaterThan(1);
  });

  it('the taper runs a familiar dose, not a novel one (Research/08 §9.1)', () => {
    const seen = strideRepsByPhase();
    const taper = seen.get('TAPER');
    if (taper) {
      for (const c of taper) expect(c).toBe(STRIDE_DEFAULT_REPS);
    }
    // And BASE opens at the floor while RACE-SPECIFIC reaches the top.
    expect(STRIDE_REPS_BY_PHASE['BASE']).toBeLessThan(STRIDE_REPS_BY_PHASE['RACE-SPECIFIC']);
  });
});

// ══ 4 · VARIETY-BEGIN-1 · the beginner's two days differ and the dose walks ═

describe('VARIETY-BEGIN-1 · beginner quality: two different days, a dose that moves', () => {
  const composed = build({
    raceDistanceMi: 6.22, goalSec: 3600, weeks: 10,
    level: 'beginner', recentWeeklyMi: 12, recentLongMi: 4, easyDayMedianMi: 3,
  });

  function structuredDays() {
    return composed.weeks
      .filter((w) => !w.isRaceWeek && (w.phase === 'QUALITY' || w.phase === 'RACE-SPECIFIC'))
      .map((w) => ({
        phase: w.phase,
        startISO: w.startISO,
        // The beginner's two structured days: the surge fartlek rides the
        // `tempo` type, the light-hills day rides `intervals`
        // (DOCTRINE-BASE-2's rep-shaped-day convention).
        days: w.days.filter((d) => d.isQuality && (d.type === 'tempo' || d.type === 'intervals')),
      }))
      .filter((w) => w.days.length > 0);
  }

  it('a week with two structured days runs two DIFFERENT sessions', () => {
    const twoDay = structuredDays().filter((w) => w.days.length === 2);
    expect(twoDay.length, 'no beginner week carries two structured days in this archetype').toBeGreaterThan(0);
    for (const w of twoDay) {
      const [a, b] = w.days.map((d) => d.subLabel ?? '');
      expect(a, `${w.startISO}: the two-identical-days defect`).not.toBe(b);
      const labels = `${a} · ${b}`;
      expect(labels).toMatch(/surges @ T effort/);
      expect(labels).toMatch(/hill/i);
    }
  });

  it('the surge dose is not constant across the block', () => {
    const doses = new Set<string>();
    for (const w of structuredDays()) {
      for (const d of w.days) {
        const m = (d.subLabel ?? '').match(/(\d+)×([\d.]+) min surges/);
        if (m) doses.add(`${m[1]}×${m[2]}`);
      }
    }
    expect(doses.size, `frozen dose: ${[...doses].join(', ') || 'none found'}`).toBeGreaterThan(1);
  });

  it('every surge dose sits inside doctrine\'s bands and never exceeds Daniels\' T share', () => {
    // The UNCAPPED schedule is monotone (the registry's BEGINNER.surge-
    // progression walks it); the authored dose may step back down on a week
    // whose mileage cannot buy the earned rung — Research/04:187's 10% T cap,
    // via `weeklyDoseBudgetMi`, always gets the last word.
    let found = 0;
    for (const w of structuredDays()) {
      for (const d of w.days) {
        const m = (d.subLabel ?? '').match(/(\d+)×([\d.]+) min surges/);
        if (!m) continue;
        found++;
        const reps = Number(m[1]);
        const minutes = Number(m[2]);
        expect(reps).toBeGreaterThanOrEqual(4);
        expect(reps).toBeLessThanOrEqual(6);
        expect(minutes).toBeGreaterThanOrEqual(1);
        expect(minutes).toBeLessThanOrEqual(2);
      }
    }
    expect(found, 'no surge session found at all').toBeGreaterThan(0);
  });

  it('the hills day carries §8.2\'s shape and rep geometry the spec can read', () => {
    const hills = structuredDays().flatMap((w) => w.days.map((d) => ({ phase: w.phase, d })))
      .filter((x) => /hill/i.test(x.d.subLabel ?? ''));
    expect(hills.length, 'no hills day authored — the second day is a clone again').toBeGreaterThan(0);
    for (const { phase, d } of hills) {
      const m = (d.subLabel ?? '').match(/(\d+)×(\d+)s .*hill/i);
      expect(m, `unparseable hills label: ${d.subLabel}`).not.toBeNull();
      expect(Number(m![1])).toBe(beginnerHillReps(phase));
      expect(Number(m![2])).toBeGreaterThanOrEqual(10);   // §8.2 "10–30 s"
      expect(Number(m![2])).toBeLessThanOrEqual(30);
      expect(d.type, 'the hills day rides the rep-shaped day type').toBe('intervals');
      // By effort: the word "hill" is what routes buildWorkoutSpec to the
      // no-pace-target rep spec (§8.1 prescribes hills by effort) — NOT to a
      // paced rep set or a continuous block, which was the original
      // fartlek-spec defect one type over.
      const { spec } = buildWorkoutSpec(d.type, d.distanceMi, 420, null, d.subLabel);
      const s = spec as Record<string, unknown>;
      expect(s.rep_count).toBe(beginnerHillReps(phase));
      expect(s.rep_duration_s).toBe(Number(m![2]));
      expect(s.by_effort, 'a hill set must carry no pace target (§8.1)').toBe(true);
      expect(s.rep_pace_s_per_mi).toBeNull();
    }
  });

  it('the progression helpers agree with doctrine\'s endpoints', () => {
    expect(beginnerSurgeDose('QUALITY', 99)).toEqual({ reps: 4, minutes: 1 });      // 5K-Beginner "4×1 min @ T"
    expect(beginnerSurgeDose('RACE-SPECIFIC', 0)).toEqual({ reps: 6, minutes: 2 }); // 10K-Beginner "6×2 min fartlek"
  });
});

// ══ 5 · MARATHON REGRESSION · shared code paths left the marathon alone ═════

describe('MARATHON REGRESSION · the marathon\'s long-run rows are untouched', () => {
  const composed = build({
    raceDistanceMi: 26.22, goalSec: 10800, weeks: 14,
    level: 'advanced', recentWeeklyMi: 40, recentLongMi: 14, easyDayMedianMi: 6, bestRecentVdot: 50,
  });
  const longs = longsOf(composed);

  it('no marathon long carries the 10K progression kind or its fixed 2-mile tail', () => {
    for (const r of longs) {
      expect(r.long.longRunKind ?? null, `${r.week.startISO}`).not.toBe('progression');
    }
  });

  it('the marathon race-specific cadence long is still §4.4\'s fraction-sized session', () => {
    const mp = longs.filter((r) => r.long.longRunKind === 'mp_long');
    expect(mp.length, 'the marathon lost its MP long — a regression outside this fix\'s scope').toBeGreaterThan(0);
    for (const r of mp) {
      const mi = Number((r.long.subLabel ?? '').match(/([\d.]+)mi\s*@/)?.[1] ?? 0);
      // Fraction-sized (≈50% bounded by the dose budget), never the 10K's fixed 2.
      expect(mi).toBeGreaterThan(TENK_PROGRESSION_FINISH_MI);
    }
  });

  it('marathon long-run kinds stay inside the pre-existing row set', () => {
    for (const r of longs) {
      if (r.long.longRunKind == null) continue;
      expect(['mp_long', 'fast_finish', 'dress_rehearsal']).toContain(r.long.longRunKind);
    }
  });
});
