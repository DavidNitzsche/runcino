/**
 * MID-BLOCK RACE INVARIANTS (2026-08-17).
 *
 * The tune-up embedding landed the same morning as the plan it was written for,
 * and a read-only verification of the owner's CIM block — a 14-week marathon
 * build carrying three of his own races — found two defects that no structural
 * gate could see, because the plan they produce is perfectly well-formed:
 *
 *   1. MINI-TAPER · the B-race easing indexed CALENDAR offsets −1 and −2 and
 *      required the day before the race to be a running day. His rest day is
 *      Saturday and his races are Sunday, so the shakeout conversion was
 *      skipped outright and the "no quality two days out" rule looked at a
 *      Friday easy run that was never quality. Both his B races — a 10K and a
 *      half — were authored off a full Thursday quality session with no taper
 *      of any kind. Every runner who rests the day before a race had the same
 *      no-op.
 *
 *   2. RAMP CEILING · `embedMidBlockRaces` rewrites weekly volumes AFTER
 *      `volumeCurve` has applied `GENERAL_RAMP_CEILING`, and it flags the
 *      tune-up week `isCutback`, which is exactly the flag the validator's
 *      week-over-week check exempts. So the week following a raced half came
 *      out at +37% and as the biggest week of the whole block, carrying its
 *      longest run with a ten-mile marathon-pace finish six days after 13.1
 *      raced miles — inside the two weeks of no quality
 *      `POST_RACE_RECOVERY_WEEKS.hm` mandates.
 *
 * Both are locked here on the layout that exposed them (Sunday long, Sunday
 * race, Saturday rest) rather than on the shape that happened to work.
 *
 * Cite: Research/00b-recovery-protocols.md §"Post-Race Recovery"
 * Cite: Research/08 §9.1 (taper depth · "the largest cut is to easy mileage")
 * Cite: Research/22-plan-templates.md §15 ("tune-up half at HMP-T, 4-6 wk out")
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
   type ComposePlanInput, type DOW, type DayPlan,
} from './generate';
import { tPaceFromGoal } from './spec-builder';
import { GENERAL_RAMP_CEILING } from './goal-tiers';
import { MP_LONG_TEMPO_MIN_GAP_DAYS } from './generate';
import { DRESS_REHEARSAL } from './long-run-rows';

const START_MONDAY = '2026-08-31';

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/** The owner's real CIM frame: Sunday long, Saturday rest, Tue/Thu quality. */
function cimInput(midBlockRaces: NonNullable<ComposePlanInput['midBlockRaces']>): ComposePlanInput {
  const raceDistanceMi = 26.22;
  const goalSec = 10800;
  return {
    raceDistanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / raceDistanceMi),
    raceDateISO: addDays(START_MONDAY, 14 * 7 - 1),
    startMondayISO: START_MONDAY,
    level: 'advanced',
    recentWeeklyMi: 30.5,
    easyDayMedianMi: 6,
    recentLongMi: 13,
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
    bestRecentVdot: 45.1,
    midBlockRaces,
  };
}

/** Compose + finalize exactly as generatePlan does. */
function build(midBlockRaces: NonNullable<ComposePlanInput['midBlockRaces']>) {
  const input = cimInput(midBlockRaces);
  const composed = composePlan(input);
  finalizeComposedPlan(composed, input.raceDistanceMi, input.level);
  composed.vols = composed.weeks.map((w) => w.weeklyMi);
  return composed;
}

/** Absolute day offset → the composed day, week-index included. */
function dayAt(composed: ReturnType<typeof build>, iso: string): { day: DayPlan; weekIdx: number } | null {
  const off = Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(START_MONDAY + 'T12:00:00Z')) / 86400000);
  const wi = Math.floor(off / 7);
  const week = composed.weeks[wi];
  if (!week) return null;
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay() as DOW;
  const day = week.days.find((d) => d.dow === dow);
  return day ? { day, weekIdx: wi } : null;
}

// Both of his B races fall on a Sunday, with Saturday rest.
const SANTA_MONICA = { slug: 'sm10k', name: 'Santa Monica 10k', date: '2026-09-13', distanceMi: 6.2, goalPaceSec: null, priority: 'B' as const };
const MALIBU = { slug: 'malibu', name: 'Run Malibu', date: '2026-11-08', distanceMi: 13.1, goalPaceSec: 412, priority: 'B' as const };

describe('MINI-TAPER · a rest day the day before a B race does not skip the taper', () => {
  const composed = build([SANTA_MONICA, MALIBU]);

  for (const race of [SANTA_MONICA, MALIBU]) {
    it(`${race.name} · the last RUNNING day before the race is a shakeout`, () => {
      const before = dayAt(composed, addDays(race.date, -1))!;
      expect(before.day.type, 'the day before is the rest day this case is about').toBe('rest');
      const twoBefore = dayAt(composed, addDays(race.date, -2))!;
      expect(twoBefore.day.type).toBe('shakeout');
      expect(twoBefore.day.distanceMi).toBeLessThanOrEqual(2);
      expect(twoBefore.day.subLabel).toMatch(/SHAKEOUT/);
    });

    it(`${race.name} · no quality inside the 2 running days before it`, () => {
      // Saturday rest, Friday shakeout, Thursday = the second running day back.
      for (const back of [2, 3]) {
        const d = dayAt(composed, addDays(race.date, -back))!;
        expect(d.day.isQuality, `${addDays(race.date, -back)} is quality inside the mini-taper`).toBe(false);
      }
    });
  }
});

describe('RAMP CEILING · the week after a tune-up', () => {
  const composed = build([SANTA_MONICA, MALIBU]);
  const peak = Math.max(...composed.weeks.map((w) => w.weeklyMi));

  it('the week after a raced HALF is not the block\'s peak week', () => {
    const raceWk = dayAt(composed, MALIBU.date)!.weekIdx;
    const after = composed.weeks[raceWk + 1];
    expect(after).toBeDefined();
    const priorPeak = Math.max(...composed.weeks.slice(0, raceWk + 1).map((w) => w.weeklyMi));
    expect(after.weeklyMi).toBeLessThanOrEqual(priorPeak + 0.05);
    expect(after.weeklyMi).toBeLessThan(peak + 0.05);
  });

  it('the week after a raced half carries no MARATHON-PACE LONG on its long run', () => {
    const raceWk = dayAt(composed, MALIBU.date)!.weekIdx;
    const long = composed.weeks[raceWk + 1].days.find((d) => d.isLong && d.type === 'long');
    expect(long).toBeDefined();
    // Research/00b §"Post-Race Recovery" · §4.4's marathon-pace long run is
    // 8-16 mi at MP and is not run on legs inside the window.
    expect(long!.longRunKind).not.toBe('mp_long');
    expect(long!.longRunKind).not.toBe('fast_finish');
  });

  it('the post-race window is RECORDED, not silent', () => {
    // LONGRUN-TRACE-1 · this is the defect the trace exists for. On the owner's
    // own block the strip took an eleven-mile marathon-pace finish off the
    // twenty-one-mile run three weeks out — the biggest session of the build —
    // and left nothing but its absence behind.
    //
    // MPLADDER-1 (2026-09-03) · RULING MOVE, and the mechanism got BETTER
    // rather than the assertion getting weaker. `marathon-specific-ladder.ts`
    // asks `isInsidePostRaceWindow` BEFORE it places a rung, so the session is
    // no longer authored and then removed — there is nothing to strip. The
    // record moved with it: `authored_state.marathon_specific_ladder.skipped`
    // names the week and the reason at the moment the decision is made, which
    // is the same fact one step earlier. Rule 11 is what both records serve:
    // a week with no marathon-pace long because doctrine said so and a week
    // with none because a pass ate it are different facts.
    const st = composed.authoredState as Record<string, unknown>;
    const ladder = st.marathon_specific_ladder as
      { skipped?: Array<{ weekIdx: number; reason: string }> } | null | undefined;
    const changes = st.long_run_race_pace_changes as Array<Record<string, unknown>> | undefined;

    const skippedForWindow = (ladder?.skipped ?? [])
      .filter((x) => /post-race no-quality window/i.test(x.reason));
    const strippedForWindow = (changes ?? [])
      .filter((c) => String(c.reason).includes('post-race no-quality window'));

    // One of the two ledgers carries it, and whichever does names the reason.
    expect(
      skippedForWindow.length + strippedForWindow.length,
      'neither the ladder\'s skip list nor the race-pace change ledger records the post-race window',
    ).toBeGreaterThan(0);

    // The ladder's record names a REAL week of this block, so it cannot be a
    // reason string with nothing behind it (Rule 18 liveness).
    for (const sk of skippedForWindow) {
      expect(sk.weekIdx).toBeGreaterThanOrEqual(0);
      expect(sk.weekIdx).toBeLessThan(composed.weeks.length);
    }
    // And where the older ledger still fires, its shape is unchanged.
    for (const strip of strippedForWindow) {
      expect(Number(strip.from_mi)).toBeGreaterThan(0);
      expect(Number(strip.to_mi)).toBe(0);
    }
  });

  /* -- MPSPACING-1 (2026-09-01) - TWO CITED ROWS COLLIDE HERE, AND 16 WINS --
   *
   * LONGRUN-ROWS-1 asserted that 4.6's rehearsal SURVIVES the post-race
   * no-quality window at the slow edge of its own MP band, while 4.4's
   * 8-16 mi session is stripped. That reasoning is about `Research/00b`'s
   * POST-RACE window and it still stands - the assertion below that carries
   * it is unchanged.
   *
   * A SECOND window also lands on this exact day, and it is a different rule
   * with a different citation. `Research/04` 16: "MP long run + hard tempo
   * within 5 days | Same energy system, same impact pattern, no recovery
   * between." On the owner's own frame - which is what this fixture is - the
   * rehearsal falls on the last day of the last race-specific week and 9.2's
   * week-minus-3 taper session (11 mi at MP) falls two days later.
   *
   * WHICH ROW GOVERNS. 16 does, and the decision is recorded here rather
   * than left implicit:
   *
   *   - 16 is a named PROHIBITION with a stated mechanism and no exception
   *     clause. 4.6 is a session description whose own Contraindications row
   *     explicitly sanctions dropping the race-pace half of it ("Not a fitness
   *     builder - keep effort controlled. If injury threat, skip MP segments").
   *   - The runner loses no marathon-pace rehearsal by it. 9.2's session two
   *     days later is 11 mi at MP against this one's 4 - the bigger rehearsal
   *     is the one that survives.
   *   - 4.6's stated PURPOSE, "Final equipment, fueling, and timing
   *     rehearsal", needs kit, race breakfast and fuelling intervals, none of
   *     which needs MP miles. The session still happens, on the day doctrine
   *     dates it, doing the job its own row names.
   *
   * REVERSIBLE, and worth a second opinion: a defensible reading says 16's
   * "MP long run" means 4.4's 8-16 mi session specifically and not 4.6's
   * controlled 4-mile rehearsal, in which case the two never collide and the
   * pre-MPSPACING-1 behaviour was right. That reading is recorded in the agent
   * report as an open decision. What is NOT defensible is the state this
   * replaced: fifteen marathon-pace miles across three days entering a taper,
   * with no check able to see it because one sat in each week.
   */
  it("4.6's dress rehearsal survives that window, and 16 governs its race pace", () => {
    const raceWk = dayAt(composed, MALIBU.date)!.weekIdx;
    const long = composed.weeks[raceWk + 1].days.find((d) => d.isLong && d.type === 'long')!;
    // UNCHANGED - the post-race window removes 4.4's session and not 4.6's.
    // This is what LONGRUN-ROWS-1 exists to hold and it still holds.
    expect(long.longRunKind).toBe('dress_rehearsal');

    // Is 9.2's taper MP session inside 16's window of this rehearsal? Asked
    // of the composed block rather than assumed, so this invariant follows the
    // engine if the taper's shape ever moves.
    const isoOf = (wi: number, dow: number): string => {
      const start = composed.weeks[wi].startISO;
      const startDow = new Date(start + 'T12:00:00Z').getUTCDay();
      return new Date(
        Date.parse(start + 'T12:00:00Z') + (((dow - startDow) % 7 + 7) % 7) * 86400000,
      ).toISOString().slice(0, 10);
    };
    const rehearsalISO = isoOf(raceWk + 1, long.dow);
    const mpQualityWithinWindow = composed.weeks.some((w, wi) => w.days.some((d) => {
      if (!d.isQuality || d.isLong || d.type === 'race') return false;
      if (!/@\s*MP?\b/i.test(String(d.subLabel ?? ''))) return false;
      const gap = Math.abs(
        (Date.parse(isoOf(wi, d.dow) + 'T12:00:00Z') - Date.parse(rehearsalISO + 'T12:00:00Z')) / 86400000,
      );
      return gap > 0 && gap < MP_LONG_TEMPO_MIN_GAP_DAYS;
    }));

    const mi = Number((long.subLabel ?? '').match(/([\d.]+)mi\s*@/)?.[1] ?? 0);
    if (mpQualityWithinWindow) {
      // 16 governs - the rehearsal keeps its job and loses its race pace.
      expect(mi, "16: no MP segments within five days of the taper's MP session").toBe(0);
      expect(long.subLabel).not.toMatch(/@\s*MP?\b/i);
      expect(long.notes).toMatch(/race kit/i);
      expect(long.notes).toMatch(/easy effort/i);
    } else {
      // No collision - LONGRUN-ROWS-1's original assertion, verbatim.
      expect(mi, 'inside a post-race window the rehearsal is at the band floor').toBe(DRESS_REHEARSAL.mpMiBand[0]);
      expect(long.notes).toMatch(/not a fitness test/i);
    }
  });

  it('every post-tune-up week respects the general ramp ceiling off the last undistorted week', () => {
    const ceiling = GENERAL_RAMP_CEILING.advanced;
    for (const race of [SANTA_MONICA, MALIBU]) {
      const raceWk = dayAt(composed, race.date)!.weekIdx;
      const after = composed.weeks[raceWk + 1];
      if (!after || after.isRaceWeek) continue;
      let ref = 0;
      for (let k = raceWk - 1; k >= 0; k--) {
        if (composed.weeks[k].isCutback || composed.weeks[k].isRaceWeek) continue;
        ref = composed.weeks[k].weeklyMi;
        break;
      }
      if (!(ref > 0)) continue;
      expect(after.weeklyMi, `week after ${race.name}`).toBeLessThanOrEqual(ref * ceiling + 0.05);
    }
  });
});

describe('BYTE-SAFETY · a plan with no mid-block races is untouched', () => {
  it('composes identically with an empty race list and with the field absent', () => {
    const withEmpty = build([]);
    const input = cimInput([]);
    delete (input as { midBlockRaces?: unknown }).midBlockRaces;
    const withAbsent = composePlan(input);
    finalizeComposedPlan(withAbsent, input.raceDistanceMi, input.level);
    withAbsent.vols = withAbsent.weeks.map((w) => w.weeklyMi);
    expect(withEmpty.vols).toEqual(withAbsent.vols);
    expect(JSON.stringify(withEmpty.weeks)).toBe(JSON.stringify(withAbsent.weeks));
  });
});
