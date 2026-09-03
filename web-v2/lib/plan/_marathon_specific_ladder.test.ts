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
      '3:introduction:long_run:4',
      '7:development:long_run:8',
      '10:peak_stimulus:tune_up_race:0',
      '11:consolidation:easy_run_touch:3',
      '12:sharpening:long_run:4',
    ]);
    // "Approximately four meaningful marathon-specific sessions before race
    // week" — four that carry marathon-effort miles, plus the race.
    expect(l.rungs.filter((r) => r.mpMi > 0).length).toBe(4);
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
      // Q16's post-race touch is an easy run, deliberately exempt from the
      // deload rule — it is not a quality session.
      if (r.vehicle === 'easy_run_touch') continue;
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

  it('skipped weeks carry a reason · Rule 11', () => {
    const l = resolveMarathonSpecificLadder(cimCalendar());
    expect(l.skipped.length).toBeGreaterThan(0);
    for (const s of l.skipped) expect(s.reason.length).toBeGreaterThan(10);
  });
});

describe('MPLADDER-1 · dose', () => {
  it('no rung exceeds what the block has already authored by more than one dose band', () => {
    const l = resolveMarathonSpecificLadder(cimCalendar());
    let largest = 0;
    for (const r of l.rungs) {
      if (r.vehicle === 'tune_up_race') { largest = Math.max(largest, MP_ROLE_DOSE_MI.peak_stimulus[1]); continue; }
      expect(r.mpMi, `${r.role} jumped past the earned ceiling`).toBeLessThanOrEqual(largest + MP_EARNED_STEP_MI);
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
    const taper = l.rungs.filter((r) => r.role === 'consolidation' || r.role === 'sharpening');
    const supported = Math.max(...l.rungs.filter((r) => r.role === 'introduction' || r.role === 'development').map((r) => r.ladderT));
    for (const r of taper) expect(r.ladderT).toBe(supported);
  });

  it('the later band is only reached after preceding development', () => {
    // A block whose only marathon-specific session IS the peak stimulus may not
    // jump to the fast edge of the runner's band.
    const c = cimCalendar();
    const short: MarathonSpecificLadderInput = {
      ...c,
      totalWeeks: 8,
      longRunISOByWeek: c.longRunISOByWeek.slice(7),
      isDeloadWeek: (i) => i > 0 && (i + 1) % 3 === 0,
      isTuneUpRaceWeek: () => false,
      isDesignedWeekendLong: () => false,
      peakStimulusRaceWeekIdx: null,
    };
    const l = resolveMarathonSpecificLadder(short);
    const peak = l.rungs.find((r) => r.role === 'peak_stimulus');
    if (peak && !l.rungs.some((r) => r.role === 'development')) {
      expect(peak.ladderT).toBe(MARATHON_EFFORT_LADDER_T.middle);
    }
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
