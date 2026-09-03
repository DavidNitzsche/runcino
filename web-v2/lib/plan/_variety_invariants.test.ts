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
 *   5. Marathon/half intensity longs — one variant per (phase, distance),
 *      forever, and three consecutive warm-in finishes. Research/00a
 *      §"Long-Run Variations" ("Don't make every long run a progression —
 *      rotate") and §"Long-run rules of thumb" ("intensity inserts come 1 in
 *      every 2–3 long runs") say otherwise; the catalogue's five §4 long-run
 *      entries were declared on `SLOT_FAMILIES.long` and unreachable
 *      (VARIETY-LONG-1).
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
 *
 * ── RULING MOVES ────────────────────────────────────────────────────────────
 *
 * MPLADDER-1 / TAPERLONG-1 (2026-09-03). Two assertions in the marathon suite
 * moved, both because the behaviour they pinned was ruled on, not because the
 * variety principle changed — the "at least two distinct variants" assertion
 * above them is untouched and still passes, which is the check that matters.
 *
 *   1 · "TAPER longs stay plain" now allows the two-weeks-out long to carry a
 *       marathon-effort segment. `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q18:
 *       "The two-weeks-out run may carry a small controlled marathon-effort
 *       component if earlier development supports it, but must not function as
 *       another peak workout." The assertion is rewritten to check the LIMIT
 *       rather than deleted: the one-week-out long stays plain, and the
 *       two-weeks-out dose may not exceed the block's own largest.
 *
 *   2 · "a progression long re-splits the SAME intensity" no longer requires
 *       §4.3 to appear in a MARATHON block. §4.3 spends a third of its at-pace
 *       slice at threshold, and on a ladder week the marathon-effort miles are
 *       the ladder's dose — there is no way to carry that dose inside §4.3's
 *       shape without growing the session. §11.1's modified block took its
 *       place as the rotated marathon variant (bounded to the same dose), and
 *       §4.3 is unchanged and still asserted for the half and the 10K.
 *
 * Cite: Research/00b-recovery-protocols.md §"Marathon Recovery (4-week reverse taper)"
 * Cite: Research/08-pacing-and-race-week.md §9.1
 * Cite: docs/PROGRESSIVE_BASELINE_DOCTRINE.md §Q18
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  TENK_PROGRESSION_FINISH_MI, FAST_FINISH_MIN_MI,
  beginnerSurgeDose, beginnerHillReps,
  type ComposePlanInput, type DOW, type DayPlan,
} from './generate';
import { tPaceFromGoal, buildWorkoutSpec, strideRepsForPhase, STRIDE_REPS_BY_PHASE, STRIDE_DEFAULT_REPS, STRIDE_DAYS_PER_WEEK, extractLongSegments } from './spec-builder';
import { DRESS_REHEARSAL, dressRehearsalDose } from './long-run-rows';
import { dayDoses, weeklyDoseBudgetMi } from './dosing';
import { splitDay } from './intensity-distribution';
import { expandSpecToPhases, subLabelFromSpec } from '@/lib/training/expand-spec';

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

  /* DOCTRINE-STRIDES-3 (2026-08-30) · WHERE the strides land, not just how many.
   *
   * The MLR pass promotes one of the week's stride-carrying easy days into a
   * 9-12 mile medium-long run, and used to carry the strides across with it.
   * `Research/04` §7.2 Placement gives three homes — "End of an easy run,
   * mid-warmup before a workout, or standalone day" — and a medium-long is
   * none of them: `Research/00a` §3 gives it its own category, for "aerobic
   * strength under fatigue", which is the state §7.2's "Not a workout — back
   * off if form degrades" contraindication rules out.
   *
   * Found on the owner's live block `pln_9a57561debb776e5`: three medium-long
   * runs of 9-12 mi carrying 6-8×20s strides, one of them alongside an
   * embedded threshold segment.
   */
  it('a MEDIUM-LONG run never carries strides · §7.2 Placement', () => {
    const offenders: string[] = [];
    for (const w of composed.weeks) {
      for (const d of w.days) {
        const label = d.subLabel ?? '';
        if (label.startsWith('MEDIUM-LONG') && /strides/.test(label)) {
          offenders.push(`${w.phase} ${label} (${d.distanceMi}mi)`);
        }
        // The notes must not promise what the label no longer carries — that
        // is the "row promises strides over a spec that has none" failure
        // DOCTRINE-STRIDES-1's own comment warns about, in reverse.
        if (label.startsWith('MEDIUM-LONG') && /strides/.test(d.notes ?? '')) {
          offenders.push(`${w.phase} MEDIUM-LONG notes still promise strides`);
        }
      }
    }
    expect(offenders, 'strides on a medium-long run').toEqual([]);
  });

  it('and the week keeps its two stride days · §7.2 Frequency 2-4×/week', () => {
    // Re-homing, not deletion. A week that has an MLR and other easy days must
    // still carry two stride sessions — otherwise the fix above would have
    // bought placement at the cost of frequency.
    const shortfalls: string[] = [];
    for (const w of composed.weeks) {
      const hasMlr = w.days.some((d) => (d.subLabel ?? '').startsWith('MEDIUM-LONG'));
      if (!hasMlr) continue;
      const easyDays = w.days.filter(
        (d) => d.type === 'easy' && (d.distanceMi ?? 0) > 0
          && !(d.subLabel ?? '').startsWith('MEDIUM-LONG'));
      const withStrides = easyDays.filter((d) => /strides/.test(d.subLabel ?? '')).length;
      // Only demand two where two easy days actually exist to put them on.
      const expected = Math.min(STRIDE_DAYS_PER_WEEK, easyDays.length);
      if (withStrides < expected) {
        shortfalls.push(`${w.phase} wk: ${withStrides} stride days on ${easyDays.length} easy days`);
      }
    }
    expect(shortfalls, 'MLR promotion cost the week its stride days').toEqual([]);
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
        /*
         * LABELTRUTH-1 (2026-08-29) · the AUTHORED dose is 4-6, and that is
         * what `beginnerSurgeDose` is asserted against directly below. What
         * the label carries is the dose after `timeRepSpec`'s clamp, which is
         * arithmetic on the day's mileage — a prescription is a request, and a
         * six-rep set does not fit a two-mile day once warm-up, floats and
         * cool-down are paid for.
         *
         * This assertion used to read the label and require 4-6, which passed
         * only because the label was NOT the clamped number: the composer
         * wrote "6×1 min" and the spec ran three. Making the label truthful is
         * what exposed the gap, and the honest floor here is the SESSION's,
         * not the authoring band's — a reduction to fit the day is doctrine
         * working, a reduction to a single rep is a day that cannot hold the
         * session at all.
         *
         * The authoring band itself is asserted directly on
         * `beginnerSurgeDose` in "the progression helpers agree with
         * doctrine's endpoints" below, which is where that contract belongs.
         *
         * VARIETY-BEGIN-1-FIX (2026-08-30) · THE NAMED 45-DAY GAP IS CLOSED TO
         * ZERO. Re-verified against the 2026-08-29 archetype sweep first: a
         * cutback week (`isCutback`) deliberately excludes `layoutWeek`'s
         * RP-FREQ-FLOOR 2mi quality-day floor (by design — cutback weeks are
         * meant to shrink quality volume), and on a true beginner's low-volume
         * week `qualityMiEach` could round to exactly 1mi — smaller than the
         * doctrine floor dose's own warm-up + cool-down floors (1.0mi) before
         * a single rep is even run. Every one of the 45 was this: a 1-1.5mi
         * cutback-week day.
         *
         * Fixed at authoring time: `layoutWeek` now refuses to author the
         * beginner surge day at all below `MIN_BEGINNER_SURGE_DAY_MI`
         * (computed from `timeRepSpec`'s own warm-up/cool-down formula at the
         * doctrine floor dose — 4×1 min @ T — so it cannot drift out of sync
         * with the clamp it guards against). Below that floor the day falls
         * to the easy fill instead, the same answer DOCTRINE-BASE-2 already
         * gives a base week that cannot seat its own session.
         *
         * A SECOND, UNRELATED MECHANISM WAS FOUND AND IS DELIBERATELY LEFT
         * ALONE. `applyDosingCaps`'s generic Daniels'-T-share trim
         * (`trimSessionDose`) walks ANY rep-set label down one rep at a time
         * against the week's own 10% T-pace cap (`validate.ts`'s hard,
         * enforced ceiling — not spec-builder.ts's day-mileage clamp this test
         * and the handed-off finding were about), with no floor of its own,
         * and can walk a beginner's surge label to 1×1 min on a week whose
         * T-pace budget genuinely cannot afford more — even on a physically
         * generous day (5-12mi in the cases found). Two fixes for THIS
         * mechanism were tried and both regressed the corpus gates: rewriting
         * the label back to the protected 4×1 floor reopened
         * `_sweep_allusers.test.ts`'s validator (656 new "Week doses N mi at
         * T … (>10%)" firm failures — the 10% cap is real doctrine, not a
         * false positive); demoting the day to easy instead left 480
         * archetypes with a week carrying NO quality session where one
         * existed before, tripping that same gate's "no quality sessions
         * prescribed" check. Both attempts were reverted. This mechanism is
         * NOT what the handed-off finding named (it lives in generate.ts's
         * dosing-cap pass, not spec-builder.ts's day-size clamp) and a correct
         * fix needs `trimSessionDose` to give back Daniels' overage from
         * elsewhere in the week FIRST, before it reaches a beginner surge day
         * — out of scope here. Flagged as a follow-up rather than fixed.
         *
         * The floor below stays 1 for this reason: this specific test's
         * single archetype (10K, 10 weeks, recentWeeklyMi 12) never triggers
         * the T-share mechanism above, so it never observes a 1-rep day
         * post-fix — but the floor is NOT raised to imply the corpus-wide
         * case is closed, because it is not. See `beginnerSurgeDose`'s
         * "the progression helpers agree with doctrine's endpoints" below for
         * the authoring band the AUTHORED (pre-clamp) dose still keeps.
         */
        expect(reps, `${d.subLabel} on a ${d.distanceMi}mi day`).toBeGreaterThanOrEqual(1);
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
//
// VARIETY-LONG-1 (2026-08-28) · this section's first assertion used to read
// "no marathon long carries the 10K progression kind" — written the same day
// as VARIETY-10K-1, to catch the 10K's FIXED two-mile tail leaking into the
// marathon through the shared `longFinishSegment`. The marathon now carries a
// progression long of its OWN: §4.3's fraction-sized two-segment shape
// ("LONG · 5mi @ M + 2mi @ T"), rotated in by the catalogue's long slot. The
// original assertion's INTENT stands and is restated below in the terms that
// actually distinguish the two rows: the 10K's tail is a single fixed
// TENK_PROGRESSION_FINISH_MI segment; the marathon's progression is always
// two segments, fraction-sized off its own long.

describe('MARATHON REGRESSION · the marathon\'s long-run rows are untouched', () => {
  const composed = build({
    raceDistanceMi: 26.22, goalSec: 10800, weeks: 14,
    level: 'advanced', recentWeeklyMi: 40, recentLongMi: 14, easyDayMedianMi: 6, bestRecentVdot: 50,
  });
  const longs = longsOf(composed);

  it('the 10K\'s fixed 2-mile tail never leaks into the marathon', () => {
    for (const r of longs) {
      // The 10K row is a single fixed 2-mile segment. A marathon long that
      // reads exactly like it is the leak the original assertion caught.
      expect(r.long.subLabel, `${r.week.startISO}`).not.toBe(`LONG · ${TENK_PROGRESSION_FINISH_MI}mi @ M`);
      if (r.long.longRunKind === 'progression') {
        // A marathon progression is §4.3's two-pace walk, never a single tag.
        expect(r.long.subLabel, `${r.week.startISO} · a single-segment marathon "progression" is the 10K row wearing §4.3's name`)
          .toMatch(/^LONG · [\d.]+mi @ M \+ [\d.]+mi @ T$/);
      }
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
    // VARIETY-LONG-1 · §4.4 does not rotate: EVERY marathon race-specific
    // cadence long is the MP long. It is the phase's named stimulus, and the
    // rotation is deliberately scoped away from it.
    for (const r of longs.filter((x) => x.phase === 'RACE-SPECIFIC')) {
      if (r.long.longRunKind == null || r.long.longRunKind === 'dress_rehearsal') continue;
      expect(r.long.longRunKind, `${r.week.startISO} · the marathon RS cadence long rotated away from §4.4`).toBe('mp_long');
    }
  });

  it('marathon long-run kinds stay inside the known row set', () => {
    for (const r of longs) {
      if (r.long.longRunKind == null) continue;
      // SEGLONG-2 / DOWNHILL-2 (2026-08-29) · two rows added, both authored
      // deliberately and both marathon-only: §11.1's modified block (two MP
      // segments with easy running between them) and Research/11's downhill
      // simulation (an MP long promoted to carry a terrain instruction). The
      // list is what the marathon may author, so a new row belongs in it — the
      // assertion is still that nothing UNEXPECTED appears, which is what
      // caught the 10K's fixed tail leaking in.
      expect([
        'mp_long', 'fast_finish', 'dress_rehearsal', 'progression',
        'modified_block', 'downhill_simulation',
      ]).toContain(r.long.longRunKind);
    }
  });
});

// ══ 6 · VARIETY-LONG-1 · long runs rotate and stay on cadence ═══════════════
//
// Research/00a §"Long-Run Variations": "Long runs are not monolithic" and, on
// the progression row, "Don't make every long run a progression — rotate."
// §"Long-run rules of thumb": "Most long runs are easy; intensity inserts come
// 1 in every 2–3 long runs in marathon/half cycles." Research/04 §4.3 gives the
// progression long its shape ("middle at strong E or M, final 1/4 to 1/3 at M
// to T") and the same every-2-3-weeks cadence §4.4/§4.5 carry. The catalogue's
// `long` slot picks WHICH §4 row a cadence week's long is; the composer keeps
// every number.

describe('VARIETY-LONG-1 · the marathon block rotates its intensity longs on cadence', () => {
  const archetype = {
    raceDistanceMi: 26.22, goalSec: 10800, weeks: 14,
    level: 'advanced' as const, recentWeeklyMi: 40, recentLongMi: 14, easyDayMedianMi: 6, bestRecentVdot: 50,
  };
  const composed = build(archetype);
  const longs = longsOf(composed);
  const intensity = longs.filter((r) => r.long.longRunKind != null && r.long.longRunKind !== 'dress_rehearsal');

  it('at least two distinct intensity variants appear across the block', () => {
    const kinds = new Set(intensity.map((r) => r.long.longRunKind));
    expect(kinds.size, `only ${[...kinds].join(', ') || 'none'} — the one-variant-forever defect`).toBeGreaterThanOrEqual(2);
    expect(intensity.length).toBeGreaterThan(1);
  });

  it('intensity longs land on the cadence: never three in a row, ≥2 weeks apart within a phase', () => {
    // Research/00a: "intensity inserts come 1 in every 2–3 long runs". The two
    // phases anchor the same picker on their own last weeks, so a single
    // one-week gap can exist at the QUALITY → RACE-SPECIFIC seam; three
    // consecutive intensity longs cannot.
    const weekIdxOf = (r: (typeof longs)[number]) => composed.weeks.indexOf(r.week);
    const hot = intensity.map(weekIdxOf).sort((a, b) => a - b);
    for (let i = 2; i < hot.length; i++) {
      expect(
        hot[i] - hot[i - 2],
        `three consecutive intensity longs at weeks ${hot[i - 2]}..${hot[i]}`,
      ).toBeGreaterThan(2);
    }
    for (const phase of ['QUALITY', 'RACE-SPECIFIC']) {
      const inPhase = intensity.filter((r) => r.phase === phase).map(weekIdxOf).sort((a, b) => a - b);
      for (let i = 1; i < inPhase.length; i++) {
        expect(inPhase[i] - inPhase[i - 1], `${phase} intensity longs one week apart`).toBeGreaterThanOrEqual(2);
      }
    }
    // And plain longs still exist between them — most long runs are easy.
    expect(longs.filter((r) => r.long.longRunKind == null).length).toBeGreaterThan(0);
  });

  it('TAPER longs shed fatigue · at most one carries marathon effort, and never a peak dose', () => {
    // TAPERLONG-1 · Q18. The two-weeks-out long may carry "a small controlled
    // marathon-effort component"; everything later than it stays plain, and
    // nothing in the taper may be another peak workout.
    const taperLongs = longs.filter((x) => x.phase === 'TAPER' && x.long.longRunKind !== 'dress_rehearsal');
    const withEffort = taperLongs.filter((r) => (r.long.longRunKind ?? null) != null);
    expect(withEffort.length, 'more than one taper long carries marathon effort').toBeLessThanOrEqual(1);
    const biggest = Math.max(0, ...longs
      .filter((r) => r.phase !== 'TAPER')
      .map((r) => extractLongSegments(r.long.subLabel).reduce((n, g) => n + (g.tag === 'M' ? g.mi : 0), 0)));
    for (const r of withEffort) {
      const mp = extractLongSegments(r.long.subLabel).reduce((n, g) => n + (g.tag === 'M' ? g.mi : 0), 0);
      expect(mp, `${r.week.startISO} · a taper long out-dosing the block itself is another peak workout`)
        .toBeLessThan(Math.max(biggest, 0.01));
    }
    // The LAST long before race week is always plain: "after that the purpose
    // is shedding fatigue while preserving rhythm".
    const last = taperLongs[taperLongs.length - 1];
    if (last) expect(last.long.longRunKind ?? null, `${last.week.startISO}`).toBeNull();
  });

  it('a progression long re-splits the SAME intensity the default finish was sized to', () => {
    // MPLADDER-1 · §4.3 is no longer offered on a marathon's ladder weeks (see
    // RULING MOVES at the top of this file), so the marathon block rotates to
    // §11.1 instead. The SHAPE assertions below still run wherever §4.3 does
    // appear, and the half/10K suites above are where its presence is required.
    const prog = longs.filter((r) => r.long.longRunKind === 'progression');
    const rotated = new Set(longs.map((r) => r.long.longRunKind).filter((k) => k != null && k !== 'mp_long' && k !== 'dress_rehearsal'));
    expect(rotated.size, 'the marathon block rotated to nothing — check the long-slot wiring').toBeGreaterThan(0);
    for (const r of prog) {
      const segs = extractLongSegments(r.long.subLabel);
      expect(segs.length).toBe(2);
      const [mid, tail] = segs;
      expect(mid.tag).toBe('M');
      expect(tail.tag).toBe('T');
      // Each segment is a real session (§4.5's two-mile floor applies to each).
      expect(mid.mi).toBeGreaterThanOrEqual(FAST_FINISH_MIN_MI);
      expect(tail.mi).toBeGreaterThanOrEqual(FAST_FINISH_MIN_MI);
      // The tail sits inside Daniels' weekly T budget for the realized week.
      expect(tail.mi).toBeLessThanOrEqual(weeklyDoseBudgetMi(r.week.weeklyMi, 'T', 'training') + 0.55);
      // Total intensity is the fraction sizing's, so rotating the shape never
      // added a hard mile: same ceiling the single-tag finish obeys.
      expect(mid.mi + tail.mi).toBeLessThanOrEqual(r.long.distanceMi * 0.5 + 0.01);
      // And the week dropped its structured T-family slot (§4.3 "don't pair
      // with other quality work"; the tail IS the week's threshold work).
      const q = r.week.days.filter((d) => d.isQuality && d.type !== 'race');
      expect(q.map((d) => d.type)).not.toContain('threshold');
      expect(q.map((d) => d.type)).not.toContain('tempo');
    }
  });

  it('the accounting sees both segments: splitDay sums them, the doses split by pace', () => {
    const day = { type: 'long', distanceMi: 20, subLabel: 'LONG · 5mi @ M + 2mi @ T', isLong: true };
    expect(splitDay(day as never).qualityMi).toBe(7);
  });

  it('the watch renders the progression: segments in the spec, three phases out', () => {
    const label = 'LONG · 5mi @ M + 2mi @ T';
    const { spec } = buildWorkoutSpec('long', 20, 420, null, label);
    const s = spec as Record<string, unknown>;
    const segs = s.finish_segments as Array<{ mi: number; pace_s_per_mi: number; label: string }>;
    expect(Array.isArray(segs)).toBe(true);
    expect(segs.length).toBe(2);
    expect(segs[0].label).toBe('M');
    expect(segs[1].label).toBe('T');
    // The tail is FASTER than the middle — the walk §4.3 describes.
    expect(segs[1].pace_s_per_mi).toBeLessThan(segs[0].pace_s_per_mi);
    // The derived label round-trips, so persist-time reconciliation cannot
    // collapse the shape to its first segment.
    expect(subLabelFromSpec(spec)).toBe(label);
    const phases = expandSpecToPhases({ spec, totalMi: 20, easyPaceSec: 540 });
    expect(phases).not.toBeNull();
    expect(phases!.length).toBe(3);
    expect(phases![0].type).toBe('work');
    expect(phases![1].isFinishSegment).toBe(true);
    expect(phases![2].isFinishSegment).toBe(true);
    expect(phases![2].targetPaceSPerMi!).toBeLessThan(phases![1].targetPaceSPerMi!);
    expect(Math.round((phases![0].distanceMi ?? 0) + (phases![1].distanceMi ?? 0) + (phases![2].distanceMi ?? 0))).toBe(20);
  });

  it('the rotation is deterministic: the same inputs compose the same block', () => {
    const again = build(archetype);
    const labels = (c: typeof composed) => longsOf(c).map((r) => `${r.week.startISO}:${r.long.subLabel}`);
    expect(labels(again)).toEqual(labels(composed));
  });
});

describe('VARIETY-LONG-1 · the half rotates too, and its cadence holds', () => {
  const composed = build({
    raceDistanceMi: 13.11, goalSec: 5400, weeks: 14,
    level: 'advanced', recentWeeklyMi: 32, recentLongMi: 12, easyDayMedianMi: 6, bestRecentVdot: 48,
  });
  const longs = longsOf(composed);

  it('the HM block carries at least two intensity variants', () => {
    const kinds = new Set(
      longs.map((r) => r.long.longRunKind).filter((k) => k != null && k !== 'dress_rehearsal'),
    );
    expect(kinds.size, `only ${[...kinds].join(', ') || 'none'}`).toBeGreaterThanOrEqual(2);
  });

  it('an HM progression week runs ONE structured session beside the long', () => {
    for (const r of longs.filter((x) => x.long.longRunKind === 'progression')) {
      const q = r.week.days.filter((d) => d.isQuality && d.type !== 'race');
      expect(q.length, `${r.week.startISO}`).toBe(1);
    }
  });
});

// ══ 6 · VARIETY-R3-1 · the 5K/10K third quality day (the R day) ═════════════
//
// Research/01 §"Dosing rules": polarized hard half is "10–15% M+T, 10–15% I+R";
// the two-slot 5K/10K week left R unspent. Research/22's advanced sample weeks
// state the missing day: §"5K — Advanced" runs I (Tue), T (Thu) AND
// "WU + 8×400 m @ R, 400 jog + CD" (Sat); §"10K — Advanced" the same shape with
// "10×400 m @ R". Both rows state "Days/week | 6-7". The registry claim
// VARIETY.r3-third-quality-day reads the counts and the day floor out of the
// doc; this block holds the BEHAVIOUR on whole composed plans.

describe('VARIETY-R3-1 · 5K/10K advanced weeks carry the R day', () => {
  /** Research/22's own frame: Sun long, Mon rest, three quality-eligible days. */
  function r3input(opts: Parameters<typeof inputFor>[0] & {
    qualityDows?: DOW[]; restDow?: DOW; trainingDaysPerWeek?: number | null;
  }): ComposePlanInput {
    const input = inputFor(opts);
    return {
      ...input,
      restDow: (opts.restDow ?? 1) as DOW,
      qualityDows: opts.qualityDows ?? ([2, 4, 6] as DOW[]),
      trainingDaysPerWeek: opts.trainingDaysPerWeek === undefined ? 6 : opts.trainingDaysPerWeek,
    };
  }
  function r3build(opts: Parameters<typeof r3input>[0]) {
    const input = r3input(opts);
    const composed = composePlan(input);
    finalizeComposedPlan(composed, input.raceDistanceMi, input.level);
    return composed;
  }
  const chrono = (dow: number, startDow: number) => (dow - startDow + 7) % 7;

  /** Per-week structured-quality summary for the Q/RS phases. */
  function qWeeks(composed: ReturnType<typeof r3build>) {
    return composed.weeks
      .filter((w) => !w.isRaceWeek && (w.phase === 'QUALITY' || w.phase === 'RACE-SPECIFIC'))
      .map((w) => {
        const q = w.days.filter((d) => d.isQuality && !d.isLong);
        let iMi = 0; let rMi = 0; let weekMi = 0;
        for (const d of w.days) {
          weekMi += d.distanceMi;
          if (!d.isQuality && !d.isLong) continue;
          for (const dose of dayDoses(d)) {
            if (dose.pace === 'I') iMi += dose.mi;
            if (dose.pace === 'R') rMi += dose.mi;
          }
        }
        return { week: w, q, iMi, rMi, weekMi, isCutback: Boolean((w as { isCutback?: boolean }).isCutback) };
      });
  }

  const fiveK = r3build({
    raceDistanceMi: 3.11, goalSec: 1050, weeks: 12, level: 'advanced',
    recentWeeklyMi: 42, recentLongMi: 10, easyDayMedianMi: 6, bestRecentVdot: 58,
  });
  const tenK = r3build({
    raceDistanceMi: 6.22, goalSec: 2220, weeks: 14, level: 'advanced',
    recentWeeklyMi: 50, recentLongMi: 13, easyDayMedianMi: 7, bestRecentVdot: 58,
  });

  it('a 6-day advanced 5K/10K runner with three quality prefs gets three quality days, one of them an R session', () => {
    for (const [name, composed] of [['5k', fiveK], ['10k', tenK]] as const) {
      const weeks = qWeeks(composed).filter((w) => !w.isCutback);
      expect(weeks.length, `${name}: no non-cutback QUALITY/RACE-SPECIFIC weeks at all`).toBeGreaterThan(0);
      const threeDay = weeks.filter((w) => w.q.length === 3);
      expect(threeDay.length, `${name}: no week carries three quality days — the R day never landed`).toBeGreaterThan(0);
      const rWeeks = weeks.filter((w) => w.rMi > 0);
      expect(rWeeks.length, `${name}: no week spends any R miles — the third day is not the R day`).toBeGreaterThan(0);
      // The R session is a rep day the runner can read: an "@ R" label.
      const rLabeled = weeks.flatMap((w) => w.q).filter((d) => /@ R/.test(d.subLabel ?? ''));
      expect(rLabeled.length, `${name}: no structured day carries an "@ R" label`).toBeGreaterThan(0);
      for (const d of rLabeled) {
        expect(d.type, 'the R day rides the rep-shaped day type (DOCTRINE-BASE-2 convention)').toBe('intervals');
      }
    }
  });

  it('cutback weeks drop back to two quality days (Research/00b cut order)', () => {
    for (const [name, composed] of [['5k', fiveK], ['10k', tenK]] as const) {
      const cutbacks = qWeeks(composed).filter((w) => w.isCutback);
      expect(cutbacks.length, `${name}: archetype produced no cutback weeks — widen the plan`).toBeGreaterThan(0);
      for (const w of cutbacks) {
        expect(w.q.length, `${name} ${w.week.startISO}: a cutback week kept the third quality day`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('every week honours Daniels\' per-pace caps: the point is three correctly-sized days, not one inflated one', () => {
    for (const [name, composed] of [['5k', fiveK], ['10k', tenK]] as const) {
      for (const w of qWeeks(composed)) {
        // Half-mile rounding grace, same grain the composer sizes days at.
        const rCap = weeklyDoseBudgetMi(w.weekMi, 'R', 'training') + 0.5;
        const iCap = weeklyDoseBudgetMi(w.weekMi, 'I', 'training') + 0.5;
        expect(w.rMi, `${name} ${w.week.startISO}: R miles ${w.rMi.toFixed(2)} breach the 5% weekly cap`).toBeLessThanOrEqual(rCap);
        expect(w.iMi, `${name} ${w.week.startISO}: I miles ${w.iMi.toFixed(2)} breach the 8% weekly cap`).toBeLessThanOrEqual(iCap);
      }
    }
  });

  it('the I+R share lands meaningfully above the two-day baseline', () => {
    /* LADDER-TARGET-2 (2026-09-02) · THE FLOOR IS MEASURED NOW, NOT WRITTEN
     * DOWN.
     *
     * This assertion has been recalibrated twice against a hardcoded number,
     * both times because a fix removed PHANTOM I MILES rather than because R3
     * stopped working: DOSE-EFFORT-1 stopped billing effort-cued hills to the
     * I bucket, and LADDER-TARGET-2 stopped billing a whole §12.3 cutdown to
     * it (the session descends MP → HM → T → 10K → 5K; only its last rung is
     * anywhere near I, and pricing all five at I was the defect). The measured
     * 5K share fell 5.99% → 5.39% and the constant floor of 0.055 failed.
     *
     * A constant that has to be re-measured every time the engine gets more
     * honest is not a floor, it is a treadmill — and, worse, it hardcodes both
     * sides of a comparison (Rule 18). The claim this test actually makes is
     * COMPARATIVE: "the third quality day lifts the I+R share meaningfully
     * above what two quality days produce." So it now BUILDS the two-day
     * runner and measures both. The engine can get as honest as it likes and
     * the question stays the same one.
     *
     * WHAT THIS CANNOT FAIL ON: an engine that under-doses I on BOTH shapes
     * equally. It asks whether the R day is doing work, not whether the
     * absolute level is right — `weeklyDoseBudgetMi`'s per-pace caps, asserted
     * two tests above, own that. */
    const twoDay = {
      '5k': r3build({
        raceDistanceMi: 3.11, goalSec: 1050, weeks: 12, level: 'advanced',
        recentWeeklyMi: 42, recentLongMi: 10, easyDayMedianMi: 6, bestRecentVdot: 58,
        qualityDows: [2, 4] as DOW[],
      }),
      '10k': r3build({
        raceDistanceMi: 6.22, goalSec: 2220, weeks: 14, level: 'advanced',
        recentWeeklyMi: 50, recentLongMi: 13, easyDayMedianMi: 7, bestRecentVdot: 58,
        qualityDows: [2, 4] as DOW[],
      }),
    } as const;
    const shareOf = (composed: ReturnType<typeof r3build>) => {
      const weeks = qWeeks(composed);
      return weeks.reduce((s, w) => s + (w.weekMi > 0 ? (w.iMi + w.rMi) / w.weekMi : 0), 0) / weeks.length;
    };
    for (const [name, composed] of [['5k', fiveK], ['10k', tenK]] as const) {
      const baseline = shareOf(twoDay[name]);
      const mean = shareOf(composed);
      // The margin the original 0.068 floor was defending, in absolute points:
      // DOSE-EFFORT-1 re-measured it at +1.46pp (5K) and +1.79pp (10K). Held
      // at one point, which is comfortably inside both and is a real lift
      // rather than rounding.
      expect(
        mean - baseline,
        `${name}: three quality days give an I+R share of ${(mean * 100).toFixed(2)}% against ` +
        `${(baseline * 100).toFixed(2)}% for two — the R day is not lifting it`,
      ).toBeGreaterThan(0.01);
    }
  });

  it('the R day never sits the day before a threshold session (Research/04 §16)', () => {
    for (const [, composed] of [['5k', fiveK], ['10k', tenK]] as const) {
      for (const w of composed.weeks) {
        const startDow = new Date(w.startISO + 'T12:00:00Z').getUTCDay();
        const rDays = w.days.filter((d) => d.isQuality && /@ R/.test(d.subLabel ?? ''));
        const tDays = w.days.filter((d) => d.isQuality && (d.type === 'threshold' || d.type === 'tempo'));
        for (const r of rDays) {
          for (const t of tDays) {
            expect(
              chrono(t.dow, startDow) - chrono(r.dow, startDow),
              `${w.startISO}: R day (dow ${r.dow}) directly before threshold (dow ${t.dow})`,
            ).not.toBe(1);
          }
        }
      }
    }
  });

  it('a 4-day 10K runner stays at two quality days', () => {
    const f4 = r3build({
      raceDistanceMi: 6.22, goalSec: 2220, weeks: 12, level: 'advanced',
      recentWeeklyMi: 30, recentLongMi: 10, easyDayMedianMi: 5, bestRecentVdot: 55,
      qualityDows: [2, 4] as DOW[], trainingDaysPerWeek: 4,
    });
    for (const w of qWeeks(f4)) {
      expect(w.q.length, `${w.week.startISO}: a 4-day week carries more than two quality days`).toBeLessThanOrEqual(2);
    }
  });

  it('a calendar that cannot seat the R day (Saturday rest, Sunday long) folds back to two days, never fewer', () => {
    const satRest = r3build({
      raceDistanceMi: 6.22, goalSec: 2220, weeks: 12, level: 'advanced',
      recentWeeklyMi: 50, recentLongMi: 13, easyDayMedianMi: 7, bestRecentVdot: 58,
      qualityDows: [2, 4, 5] as DOW[], restDow: 6 as DOW,
    });
    for (const w of qWeeks(satRest)) {
      expect(w.q.length, `${w.week.startISO}: seat-less R day did not fold cleanly`).toBeLessThanOrEqual(3);
      if (!w.isCutback) {
        expect(w.q.length, `${w.week.startISO}: dropping the R day also lost a core session`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('hm and marathon weeks are untouched: never a third quality day, never an R-labelled session', () => {
    for (const [name, raceDistanceMi, goalSec, weeks, recentWeeklyMi, recentLongMi] of [
      ['hm', 13.11, 5340, 14, 45, 14],
      ['m', 26.22, 10500, 16, 55, 18],
    ] as const) {
      const composed = r3build({
        raceDistanceMi, goalSec, weeks, level: 'advanced',
        recentWeeklyMi, recentLongMi, easyDayMedianMi: 7, bestRecentVdot: 55,
      });
      for (const w of qWeeks(composed)) {
        expect(w.q.length, `${name} ${w.week.startISO}: a third quality day leaked to ${name}`).toBeLessThanOrEqual(2);
        for (const d of w.q) {
          expect(d.subLabel ?? '', `${name} ${w.week.startISO}: an R session leaked to ${name}`).not.toMatch(/@ R\b/);
        }
      }
    }
  });
});
