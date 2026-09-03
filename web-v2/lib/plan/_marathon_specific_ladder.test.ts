/**
 * MPLADDER-1 · the marathon-specific ladder, as a pure function.
 *
 * The unit-level statement of `docs/PROGRESSIVE_BASELINE_DOCTRINE.md`'s
 * marathon-effort rulings. `_mp_doctrine.test.ts` holds composed PLANS against
 * them; this holds the placement arithmetic, so a failure points at the
 * function rather than at fifteen weeks of output.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * It sees the LADDER, never the plan. A rung this file places correctly and the
 * composer then shaves away (dosing caps, the 80/20 intensity floor, a
 * post-race quality strip) passes here and is wrong on the phone — that is
 * `_mp_doctrine.test.ts`'s job and the reason the composed-plan assertions
 * exist at all. It says nothing about pace: `ladderT` is checked as a position,
 * not as seconds, because `marathon-pace-contract.ts` owns the conversion. It
 * cannot see a rung that should exist in a calendar shape this file never
 * builds — the reference block and the two synthetic shapes below are the whole
 * corpus, and it is small on purpose because the rulings are about one runner's
 * block. And it cannot tell a deliberate ruling change from a regression: if
 * the owner moves a dose band, this file goes red and someone has to decide
 * which side is right.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveMarathonSpecificLadder,
  MP_ROLE_DOSE_MI,
  MP_EARNED_STEP_MI,
  MP_LADDER_MIN_GAP_WEEKS,
  MP_LADDER_MAX_GAP_WEEKS,
  MP_LONG_COUNTS_AS_QUALITY_MI,
  type MarathonSpecificLadderInput,
} from './marathon-specific-ladder';
import { MARATHON_EFFORT_LADDER_T } from '@/lib/training/marathon-pace-contract';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * THE REFERENCE BLOCK · the owner's CIM block exactly as the composer lays it
 * out at the 2026-08-30 authoring instant. Fifteen weeks starting Monday
 * 2026-08-24, long run on Sunday, race Sunday 2026-12-06, deloads every third
 * week, Santa Monica on the week-2 Sunday, Dodgers paired with the week-4 long
 * run, Run Malibu on the week-10 Sunday.
 *
 * Rule 15: this fixture EXISTS because the ladder is unreachable without a real
 * calendar. A synthetic block with no races and no deloads exercises none of
 * the four placement rules.
 */
function cimCalendar(): MarathonSpecificLadderInput {
  const start = new Date('2026-08-24T12:00:00Z');
  const longRunISOByWeek = Array.from({ length: 15 }, (_, i) => iso(new Date(start.getTime() + (i * 7 + 6) * DAY)));
  return {
    totalWeeks: 15,
    longRunISOByWeek,
    raceDateISO: '2026-12-06',
    isDeloadWeek: (i) => i > 0 && (i + 1) % 3 === 0,
    isTuneUpRaceWeek: (i) => i === 2 || i === 10,        // Santa Monica · Run Malibu
    isDesignedWeekendLong: (i) => i === 4,               // Dodgers + Sunday long
    isInsidePostRaceWindow: () => false,                 // deloads already cover them here
    peakStimulusRaceWeekIdx: 10,
  };
}

describe('MPLADDER-1 · placement', () => {
  it('the reference block gets the sequence the owner asked for', () => {
    const l = resolveMarathonSpecificLadder(cimCalendar());
    expect(l.rungs.map((r) => `${r.weekIdx}:${r.role}:${r.vehicle}:${r.mpMi}`)).toEqual([
      '3:introduction:long_run:5',
      '7:development:long_run:8',
      '10:peak_stimulus:tune_up_race:0',
      '12:sharpening:long_run:5',
    ]);
    // "Approximately four meaningful marathon-specific sessions before race
    // week": three that carry marathon-effort miles, plus the tune-up race.
    // The fourth the ruling names — Q16's ~3 mi touch the week after the race —
    // is refused and recorded, because Research/00b's post-race no-quality
    // window covers the day it asks for. The refusal is asserted below rather
    // than being an absence nobody can see.
    expect(l.rungs.filter((r) => r.mpMi > 0).length).toBe(3);
    expect(l.skipped.some((x) => x.weekIdx === 11 && /post-race no-quality window/.test(x.reason)),
      'the Q16 conflict is not recorded').toBe(true);
  });

  it('the first marathon-effort running is not seven weeks out', () => {
    // The defect this file exists for: the composed block's FIRST marathon-effort
    // session was 49 days out and was four miles. Falsified against the unfixed
    // engine, which put nothing before 49 days.
    const l = resolveMarathonSpecificLadder(cimCalendar());
    const first = l.rungs.find((r) => r.mpMi > 0)!;
    expect(first.daysToRace).toBeGreaterThan(56);
  });

  it('marathon-effort work is not displaced into the taper', () => {
    // 18 of 33 miles (55%) fell in the last three weeks. The last three weeks
    // here are the rungs at or inside 21 days.
    const l = resolveMarathonSpecificLadder(cimCalendar());
    const total = l.rungs.reduce((s, r) => s + r.mpMi, 0);
    const late = l.rungs.filter((r) => r.daysToRace <= 21).reduce((s, r) => s + r.mpMi, 0);
    expect(total).toBeGreaterThan(0);
    expect(late / total).toBeLessThan(0.45);
    // And Research/04 §4.4's own 6-10-weeks-out window is no longer served by
    // one four-mile session.
    const inWindow = l.rungs.filter((r) => r.daysToRace >= 42 && r.daysToRace <= 70)
      .reduce((s, r) => s + r.mpMi, 0);
    expect(inWindow).toBeGreaterThanOrEqual(MP_ROLE_DOSE_MI.development[0]);
  });

  it('no rung lands on a deload, a tune-up race long, or the designed weekend', () => {
    const c = cimCalendar();
    const l = resolveMarathonSpecificLadder(c);
    for (const r of l.rungs) {
      if (r.vehicle === 'tune_up_race') continue;
      expect(c.isDeloadWeek(r.weekIdx), `rung on deload week ${r.weekIdx}`).toBe(false);
      expect(c.isTuneUpRaceWeek(r.weekIdx)).toBe(false);
      expect(c.isDesignedWeekendLong(r.weekIdx)).toBe(false);
    }
  });

  it('the build rungs respect Research/04 §4.4’s 2-3 week cadence, stretching only past unusable weeks', () => {
    const c = cimCalendar();
    const l = resolveMarathonSpecificLadder(c);
    const build = l.rungs.filter((r) => r.role === 'introduction' || r.role === 'development' || r.role === 'peak_stimulus');
    expect(build.length).toBeGreaterThan(1);
    for (let i = 1; i < build.length; i++) {
      const gap = build[i].weekIdx - build[i - 1].weekIdx;
      expect(gap, 'two marathon-specific demands closer than the cadence allows').toBeGreaterThanOrEqual(MP_LADDER_MIN_GAP_WEEKS);
      if (gap > MP_LADDER_MAX_GAP_WEEKS) {
        // A stretched gap is legal only when no week inside it could have
        // carried the rung: each is either unusable, or too close to the later
        // rung for the cadence to allow it.
        for (let wi = build[i - 1].weekIdx + 1; wi < build[i].weekIdx; wi++) {
          const usable = !c.isDeloadWeek(wi) && !c.isTuneUpRaceWeek(wi) && !c.isDesignedWeekendLong(wi);
          const farEnough = build[i].weekIdx - wi >= MP_LADDER_MIN_GAP_WEEKS;
          expect(usable && farEnough, `week ${wi} could have carried a rung but the ladder skipped it`).toBe(false);
        }
      }
    }
  });

  it('WHY rung 1\u2019s 8-9-week window is empty · the calendar, proved rather than asserted', () => {
    /* DOSE-BAND-2 (2026-09-03) · the coordinator asked for the calendar that
     * proves this, not a sentence claiming it. Here it is, computed.
     *
     * The owner's rung 1 sits 8-9 weeks out and rung 2 sits 6-7 weeks out. On
     * the reference calendar each window contains exactly ONE week that can
     * carry a marathon-effort long, the other being a planned cutback — and the
     * two usable weeks are SEVEN DAYS APART. `Research/04` §4.4's "Every 2-3
     * weeks" and `Research/00a` §"Long-run rules of thumb" ("intensity inserts
     * come 1 in every 2-3 long runs") both forbid filling both, so exactly one
     * of the two windows can be served.
     *
     * The ladder serves rung 2's, because 49 days is the centre of §4.4's own
     * 6-10-week window and because it leaves a three-week gap to the tune-up
     * race rather than four. Rung 1's dose is then delivered at the next
     * available week back rather than not at all.
     */
    const c = cimCalendar();
    const raceMs = Date.parse(`${c.raceDateISO}T12:00:00Z`);
    const daysOut = (wi: number) => Math.round((raceMs - Date.parse(`${c.longRunISOByWeek[wi]}T12:00:00Z`)) / DAY);
    const usable = (wi: number) =>
      !c.isDeloadWeek(wi) && !c.isTuneUpRaceWeek(wi) && !c.isDesignedWeekendLong(wi) && wi < c.totalWeeks - 1;
    const inWindow = (lo: number, hi: number) =>
      [...Array(c.totalWeeks).keys()].filter((wi) => daysOut(wi) >= lo && daysOut(wi) <= hi);

    const rung1 = inWindow(56, 63);      // 8-9 weeks out
    const rung2 = inWindow(42, 49);      // 6-7 weeks out
    const rung1Usable = rung1.filter(usable);
    const rung2Usable = rung2.filter(usable);
    const show = (ws: number[]) => ws.map((wi) => `wk${wi}@${daysOut(wi)}d${usable(wi) ? '' : ' (unusable)'}`).join(', ');

    expect(rung1Usable.length, `rung 1's window holds no usable week at all: ${show(rung1)}`).toBe(1);
    expect(rung2Usable.length, `rung 2's window holds no usable week at all: ${show(rung2)}`).toBe(1);
    // THE FINDING: they are adjacent, so the cadence can serve only one.
    expect(
      rung2Usable[0] - rung1Usable[0],
      `rung 1 (${show(rung1)}) and rung 2 (${show(rung2)}) are not adjacent — `
      + 'the constraint this case records has gone and both windows can now be filled',
    ).toBeLessThan(MP_LADDER_MIN_GAP_WEEKS);

    // And the ladder serves rung 2's window, not rung 1's.
    const l = resolveMarathonSpecificLadder(c);
    const dev = l.rungs.find((r) => r.role === 'development')!;
    expect(dev.weekIdx).toBe(rung2Usable[0]);
    expect(l.rungs.some((r) => r.weekIdx === rung1Usable[0]), 'the adjacent week was used after all').toBe(false);
  });

  it('skipped weeks carry a reason · Rule 11', () => {
    const l = resolveMarathonSpecificLadder(cimCalendar());
    expect(l.skipped.length).toBeGreaterThan(0);
    for (const s of l.skipped) expect(s.reason.length).toBeGreaterThan(10);
  });
});

describe('MPLADDER-1 · dose', () => {
  it('no rung exceeds what the block has already authored by more than one dose band', () => {
    const l = resolveMarathonSpecificLadder(cimCalendar());
    // DOSE-BAND-2 · the earned rule bounds a STEP between rungs. The first rung
    // has nothing to step from and is bounded by its own doctrine band instead,
    // so it is checked against the band and the rule starts at the second.
    let largest = 0;
    for (const [k, r] of l.rungs.entries()) {
      if (r.vehicle === 'tune_up_race') { largest = Math.max(largest, MP_ROLE_DOSE_MI.peak_stimulus[1]); continue; }
      if (k === 0) {
        expect(r.mpMi, 'the opening rung left its own band').toBeLessThanOrEqual(MP_ROLE_DOSE_MI[r.role][1]);
      } else {
        expect(r.mpMi, `${r.role} jumped past the earned ceiling`).toBeLessThanOrEqual(largest + MP_EARNED_STEP_MI);
      }
      largest = Math.max(largest, r.mpMi);
    }
  });

  it('every dose sits inside its role’s stated band', () => {
    const l = resolveMarathonSpecificLadder(cimCalendar());
    for (const r of l.rungs) {
      if (r.vehicle === 'tune_up_race') { expect(r.mpMi).toBe(0); continue; }
      const [lo, hi] = MP_ROLE_DOSE_MI[r.role];
      expect(r.mpMi).toBeGreaterThanOrEqual(lo);
      expect(r.mpMi).toBeLessThanOrEqual(hi);
    }
  });

  it('a long run carrying ≥ 6 marathon-effort miles is marked a quality day · Q14', () => {
    const l = resolveMarathonSpecificLadder(cimCalendar());
    for (const r of l.rungs) {
      expect(r.countsAsQuality).toBe(r.vehicle === 'long_run' && r.mpMi >= MP_LONG_COUNTS_AS_QUALITY_MI);
    }
    expect(l.rungs.some((r) => r.countsAsQuality), 'no rung reaches the quality-day threshold').toBe(true);
  });
});

describe('MPLADDER-1 · pace ladder position', () => {
  it('duration is the early lever · the pace steps once and then holds · Q8', () => {
    const l = resolveMarathonSpecificLadder(cimCalendar());
    const ts = l.rungs.filter((r) => r.mpMi > 0).map((r) => r.ladderT);
    // Monotone non-decreasing: no rung asks for a pace the block has not
    // already supported ("no large new pace jump", "preserve the most recently
    // supported effort").
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1]);
    expect(ts[0]).toBe(MARATHON_EFFORT_LADDER_T.early);
    // The taper rungs HOLD rather than stepping.
    const taper = l.rungs.filter((r) => r.role === 'sharpening');
    const supported = Math.max(...l.rungs.filter((r) => r.role === 'introduction' || r.role === 'development').map((r) => r.ladderT));
    for (const r of taper) expect(r.ladderT).toBe(supported);
  });

  it('the later band is only reached after preceding development', () => {
    // A block whose only marathon-specific session IS the peak stimulus may not
    // jump to the fast edge of the runner's band.
    /*
     * MPLADDER-2 (2026-09-03) · THE CALENDAR HAD TO BE REBUILT, BECAUSE THE OLD
     * ONE NEVER PRODUCED THE SHAPE THIS CASE IS ABOUT.
     *
     * It was an eight-week slice with an ordinary deload cadence, and it grew a
     * development rung every time — so `if (peak && !development)` was false on
     * every run and the body NEVER EXECUTED. The case reported green for years
     * of nothing (Rule 18: a gate that has never failed is a hypothesis).
     *
     * To have a peak stimulus and no development rung the calendar must offer
     * the peak week and nothing usable before it, so every other week is a
     * planned cutback. Week 2's long sits 35 days out, inside
     * `MP_PEAK_STIMULUS_WINDOW_DAYS`.
     */
    const c = cimCalendar();
    const PEAK_WK = 2;
    const short: MarathonSpecificLadderInput = {
      ...c,
      totalWeeks: 8,
      longRunISOByWeek: c.longRunISOByWeek.slice(7),
      isDeloadWeek: (i) => i !== PEAK_WK,
      isTuneUpRaceWeek: () => false,
      isDesignedWeekendLong: () => false,
      peakStimulusRaceWeekIdx: null,
    };
    const l = resolveMarathonSpecificLadder(short);
    const peak = l.rungs.find((r) => r.role === 'peak_stimulus');
    // Both facts the verdict rests on are asserted, so a calendar change that
    // stops producing this shape fails here instead of quietly emptying the
    // test again.
    expect(peak, 'the short calendar authored no peak-stimulus rung — this case read nothing').toBeDefined();
    expect(l.rungs.some((r) => r.role === 'development'),
      'the short calendar grew a development rung, so it no longer tests the no-development case').toBe(false);
    expect(peak!.ladderT).toBe(MARATHON_EFFORT_LADDER_T.middle);
  });

  /*
   * MPLADDER-2 (2026-09-03) · THE UPWARD PATH, ASSERTED (Rule 22).
   *
   * Every other assertion in this describe is a CEILING: monotone, holds in the
   * taper, does not jump to the fast edge without development. Measured across
   * 112 synthetic calendars, 32 of them reach `MARATHON_EFFORT_LADDER_T.later`
   * — so the rung is reachable — and NOT ONE committed case asserted that it is
   * ever reached. The gate could fail on "the ladder went too high" and could
   * not fail on "the ladder never went up at all", which is precisely the
   * disposition CLAUDE.md's Rule 21 and Rule 22 exist to catch, and the half
   * this engine can least afford.
   *
   * The owner's own block does NOT reach it: Run Malibu is his peak stimulus,
   * a race takes the rung, and `ladderT` holds. That is correct for his
   * calendar and is exactly why the positive case has to be written from a
   * calendar that has no tune-up race in the peak window — otherwise Q8's
   * "later peak-specific work" row is decoration.
   */
  it('a block whose peak stimulus is a LONG RUN reaches Q8\'s later rung', () => {
    const c = cimCalendar();
    const noRaceAtPeak: MarathonSpecificLadderInput = {
      ...c,
      isTuneUpRaceWeek: () => false,
      isDesignedWeekendLong: () => false,
      peakStimulusRaceWeekIdx: null,
    };
    const l = resolveMarathonSpecificLadder(noRaceAtPeak);
    const peak = l.rungs.find((r) => r.role === 'peak_stimulus');
    expect(peak, 'no peak-stimulus rung was authored — the positive case read nothing').toBeDefined();
    expect(l.rungs.some((r) => r.role === 'development'),
      'the later rung is conditioned on preceding development, and there is none').toBe(true);
    expect(peak!.vehicle).toBe('long_run');
    expect(peak!.ladderT, 'Q8: "later peak-specific work, only after preceding development"')
      .toBe(MARATHON_EFFORT_LADDER_T.later);
    // And the doses go UP into it, not just the pace.
    const dev = l.rungs.find((r) => r.role === 'development')!;
    expect(peak!.mpMi).toBeGreaterThanOrEqual(dev.mpMi);
  });
});

describe('MPLADDER-1 · refusal', () => {
  it('a calendar with nowhere to put a session returns an empty ladder, not a guess', () => {
    const c = cimCalendar();
    const impossible: MarathonSpecificLadderInput = {
      ...c,
      isDeloadWeek: () => true,
      isTuneUpRaceWeek: () => false,
      isDesignedWeekendLong: () => false,
      peakStimulusRaceWeekIdx: null,
    };
    const l = resolveMarathonSpecificLadder(impossible);
    expect(l.rungs).toEqual([]);
    expect(l.largestDoseMi).toBe(0);
    expect(l.skipped.length).toBeGreaterThan(0);
  });

  it('is deterministic · the same calendar twice gives the same ladder', () => {
    const a = resolveMarathonSpecificLadder(cimCalendar());
    const b = resolveMarathonSpecificLadder(cimCalendar());
    expect(JSON.stringify(a.rungs)).toBe(JSON.stringify(b.rungs));
  });

  it('Rule 9 · every boundary this file creates is walked, and none of them steps', () => {
    /* THE FOUR BOUNDARIES, and what a day of calendar either side of each is
     * worth. A behaviour may be discrete — a rung sits in one week or the next
     * — but no DOSE may change in kind on a hair of input.
     *
     * Falsified: with §4.4's window applied as a hard trim rather than the
     * fade, the first walk below reports a 2.0 mi step at 42 days.
     */
    const base = cimCalendar();

    // 1 · MP_LARGE_SESSION_WINDOW_DAYS · the dose fades across the edge of the
    //     window doctrine licenses a large marathon-effort session in.
    //     Walk the whole block one day at a time and watch the development
    //     rung's dose as it crosses 28 and 70 days out.
    //     The RACE DATE moves, not the weeks: that changes every rung's
    //     days-to-race by one and leaves the roles and the weeks they sit in
    //     exactly where they were, so what is measured is the window edge and
    //     nothing else.
    const walk: { dose: number; rungs: number }[] = [];
    /*
     * The development rung sits 49 days out, so the walk has to reach past an
     * edge of [28, 70] to cross anything.
     *
     * MPLADDER-2 (2026-09-03) · THE RANGE MOVED WITH THE EDGE. It was -10..+20,
     * which crossed §4.4's old 42-day edge and, once the fade began measuring
     * against the union, crossed nothing at all — the liveness assertion below
     * caught it immediately, which is the whole reason it is there. +25 takes
     * the rung past 70 days; the negative side no longer reaches 28 without
     * dissolving the ladder, and the far edge exercises the same one fade.
     */
    for (let shift = -10; shift <= 25; shift++) {
      const l = resolveMarathonSpecificLadder({
        ...base,
        raceDateISO: iso(new Date(Date.parse(`${base.raceDateISO}T12:00:00Z`) + shift * DAY)),
      });
      const dev = l.rungs.find((r) => r.role === 'development');
      expect(dev, `the development rung vanished at shift ${shift} · this walk measures nothing`).toBeDefined();
      walk.push({ dose: dev!.mpMi, rungs: l.rungs.filter((r) => r.mpMi > 0).length });
    }
    for (let i = 1; i < walk.length; i++) {
      const step = Math.abs(walk[i].dose - walk[i - 1].dose);
      if (walk[i].rungs === walk[i - 1].rungs) {
        // Same sequence, one day of calendar: only the union window edge can
        // move the dose, and it fades rather than steps.
        expect(step, `the development dose moved ${step} mi for one day of calendar with the ladder unchanged`)
          .toBeLessThanOrEqual(0.5);
      } else {
        // The block gained or lost a marathon-effort session. The earned-step
        // cap may move the dose by up to one dose band, and losing a rung must
        // move it DOWN — a shorter block earning MORE is the signature Rule 9
        // names ("the fitter runner gets the worse plan", inverted).
        expect(step, `losing a rung moved the dose ${step} mi, past one dose band`)
          .toBeLessThanOrEqual(MP_EARNED_STEP_MI);
        if (walk[i].rungs < walk[i - 1].rungs) {
          expect(walk[i].dose, 'a block with FEWER marathon-effort sessions earned a BIGGER dose')
            .toBeLessThanOrEqual(walk[i - 1].dose);
        }
      }
    }
    // Liveness: the walk must actually cross the edge, or it proves nothing.
    expect(new Set(walk.map((w) => w.dose)).size, 'the walk never changed the dose · it did not cross the window')
      .toBeGreaterThan(1);

    // 2 · MP_PEAK_STIMULUS_WINDOW_DAYS · a tune-up race sliding across the
    //     window either IS the peak stimulus or is not. That is a discrete
    //     calendar fact, so what is walked is the CONSEQUENCE: the ladder still
    //     produces a coherent sequence on both sides, and no dose jumps.
    for (const raceWeek of [8, 9, 10, 11]) {
      const l = resolveMarathonSpecificLadder({ ...base, isTuneUpRaceWeek: (i) => i === 2 || i === raceWeek, peakStimulusRaceWeekIdx: raceWeek });
      expect(l.rungs.length, `no ladder at all with the race in week ${raceWeek}`).toBeGreaterThan(0);
      for (const r of l.rungs) {
        if (r.vehicle === 'tune_up_race') continue;
        const [lo, hi] = MP_ROLE_DOSE_MI[r.role];
        expect(r.mpMi, `${r.role} left its band with the race in week ${raceWeek}`).toBeLessThanOrEqual(hi);
        expect(r.mpMi).toBeGreaterThan(0);
        expect(lo).toBeGreaterThan(0);
      }
    }

    // 3 · MP_SHARPEN_WINDOW_DAYS and MP_LADDER_FIRST_DAYS · walked by the
    //     calendar shift in the case below, which moves every rung's
    //     days-to-race together and asserts the whole shape is preserved.
  });

  it('a one-week shift of the whole calendar moves the ladder by one week, not into a different shape · Rule 9', () => {
    const base = cimCalendar();
    const shifted: MarathonSpecificLadderInput = {
      ...base,
      longRunISOByWeek: base.longRunISOByWeek.map((d) => iso(new Date(Date.parse(`${d}T12:00:00Z`) + 7 * DAY))),
      raceDateISO: '2026-12-13',
    };
    const a = resolveMarathonSpecificLadder(base);
    const b = resolveMarathonSpecificLadder(shifted);
    expect(b.rungs.map((r) => `${r.role}:${r.mpMi}`)).toEqual(a.rungs.map((r) => `${r.role}:${r.mpMi}`));
    expect(b.rungs.map((r) => r.daysToRace)).toEqual(a.rungs.map((r) => r.daysToRace));
  });
});
