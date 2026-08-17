/**
 * lib/faff/_surface_contracts.test.ts · the four cross-surface contracts
 * the 2026-08-17 Today/Train correctness pass established, pinned so a
 * future edit to either view has to break a test to break them again.
 *
 * Two kinds of assertion live here, deliberately:
 *
 *   1. BEHAVIOURAL · the shared resolvers, driven by one fixture through
 *      both surfaces' reductions, asserting they land on the same number.
 *      This is the real test.
 *   2. SOURCE GUARDS · greps over the two view files for the exact dead
 *      shapes (`goalSec + 420`, `toISOString().slice(0, 10)`, an
 *      unconditional `className="check"`). Vitest here runs in a `node`
 *      environment with no DOM, so a rendered-output assertion is not
 *      available; the shapes are distinctive enough that a grep is a real
 *      gate. Same precedent as lib/doctrine/_doctrine_lint.test.ts, which
 *      scans source for recurring defect shapes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { computeWeekMileage } from './week-mileage';
import { dayKeyFromLocalParts } from '../runtime/day-key';
import { resolveBGoal } from '../race/b-goal';

const VIEWS = path.join(__dirname, '..', '..', 'components', 'faff-app', 'views');
const readView = (f: string) => readFileSync(path.join(VIEWS, f), 'utf8');
const TODAY = readView('TodayView.tsx');
const TRAIN = readView('TrainView.tsx');

/** Strip // and block comments so a grep can't be satisfied — or tripped —
 *  by a comment describing the bug it is guarding against. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}
const TODAY_CODE = codeOnly(TODAY);
const TRAIN_CODE = codeOnly(TRAIN);

// ── 3 · "miles this week" has ONE definition ───────────────────────────

describe('miles this week · Today and Train agree', () => {
  /**
   * One real-shaped week. The runner over-ran two days and under-ran one,
   * which is the case that used to split the two surfaces: Today summed
   * the PLANNED distance of every day flagged done, Train summed doneMi.
   */
  const weekDays = [
    { date: '2026-08-10', dow: 'MON', type: 'easy', mi: 6.0, doneMi: 7.4, done: true },
    { date: '2026-08-11', dow: 'TUE', type: 'intervals', mi: 8.0, doneMi: 8.2, done: true },
    { date: '2026-08-12', dow: 'WED', type: 'rest', mi: 0, doneMi: 0, done: false },
    { date: '2026-08-13', dow: 'THU', type: 'tempo', mi: 9.0, doneMi: 8.1, done: true },
    { date: '2026-08-14', dow: 'FRI', type: 'easy', mi: 5.0, doneMi: 5.0, done: true },
    { date: '2026-08-15', dow: 'SAT', type: 'rest', mi: 0, doneMi: 0, done: false },
    { date: '2026-08-16', dow: 'SUN', type: 'long', mi: 16.0, doneMi: 16.6, done: true },
  ];

  /** What TodayView's RestDayCard now feeds the helper. */
  const todayInput = weekDays.map((w) => ({
    dateISO: w.date,
    plannedMi: w.mi,
    doneMi: w.doneMi,
    type: w.type,
  }));

  /** What TrainView's execWeeks row now feeds it. Same rows, same fields. */
  const trainInput = weekDays.map((d) => ({
    dateISO: d.date ?? null,
    plannedMi: d.mi,
    doneMi: d.doneMi ?? 0,
    type: d.type,
  }));

  it('THE BUG · the old Today reduction disagreed with Train', () => {
    // Today: planned distance of each day flagged done.
    const oldToday = Math.round(
      weekDays.reduce((s, w) => s + (w.done ? w.mi : 0), 0) * 10,
    ) / 10;
    // Train: miles actually run.
    const oldTrain = Math.round(
      weekDays.reduce((s, d) => s + (d.doneMi ?? 0), 0) * 10,
    ) / 10;

    expect(oldToday).toBe(44);
    expect(oldTrain).toBe(45.3);
    expect(oldToday).not.toBe(oldTrain);
  });

  it('both surfaces now land on the same number', () => {
    const today = computeWeekMileage(todayInput, { todayISO: '2026-08-16' });
    const train = computeWeekMileage(trainInput);
    expect(today.actualMi).toBe(train.actualMi);
  });

  it('that number is MILES ACTUALLY RUN, which is what Train had right', () => {
    const today = computeWeekMileage(todayInput, { todayISO: '2026-08-16' });
    expect(today.actualMi).toBe(45.3);
    expect(today.plannedMi).toBe(44);
    // The gap between the two is the coaching signal, and it only exists
    // because the helper refuses to collapse them into one "miles".
    expect(today.actualMi).not.toBe(today.plannedMi);
  });

  it('the supporting counts agree too', () => {
    const today = computeWeekMileage(todayInput, { todayISO: '2026-08-16' });
    expect(today.daysRun).toBe(5);
    expect(today.hardSessionsDone).toBe(3); // intervals + tempo + long
  });

  it('a mid-week read is not automatically behind', () => {
    // Wednesday. Comparing 4 days of running against the FULL week's plan
    // makes every runner look behind until Sunday night; plannedToDateMi
    // is the honest denominator.
    const midweek = computeWeekMileage(todayInput, { todayISO: '2026-08-12' });
    expect(midweek.actualToDateMi).toBe(15.6);
    expect(midweek.plannedToDateMi).toBe(14);
    expect(midweek.vsPlanToDateMi).toBeGreaterThan(0); // ahead, not behind
    // Against the whole week's plan the same runner reads 30 miles down.
    expect(midweek.actualToDateMi - midweek.plannedMi).toBeLessThan(0);
  });

  it('both views read the shared helper, not a local reduction', () => {
    expect(TODAY).toContain("from '@/lib/faff/week-mileage'");
    expect(TRAIN).toContain("from '@/lib/faff/week-mileage'");
    // The old Today shape: parseFloat over the planned `dist` string.
    expect(TODAY_CODE).not.toMatch(/weekMiles\s*\+=\s*parseFloat/);
  });
});

// ── 5 · the month calendar keys cells in the runner's own calendar ─────

describe('month calendar day key · east of UTC', () => {
  const withTz = <T,>(tz: string, fn: () => T): T => {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  };

  /** Exactly what TrainView's month grid builds per cell. */
  const cellDate = (y: number, m: number, dd: number) => new Date(y, m, dd);

  it('THE BUG · toISOString keys the whole grid a day early in Berlin', () => {
    withTz('Europe/Berlin', () => {
      const date = cellDate(2026, 7, 17); // 17 Aug 2026, local midnight
      expect(date.getDate()).toBe(17);
      expect(date.toISOString().slice(0, 10)).toBe('2026-08-16');
    });
  });

  it('dayKeyFromLocalParts keys it correctly in Berlin', () => {
    withTz('Europe/Berlin', () => {
      expect(dayKeyFromLocalParts(cellDate(2026, 7, 17))).toBe('2026-08-17');
    });
  });

  it('holds across the zones the runner could be in', () => {
    const cases: Array<[string, number, number, number, string]> = [
      ['America/Los_Angeles', 2026, 7, 17, '2026-08-17'], // UTC-7 · always worked
      ['UTC', 2026, 7, 17, '2026-08-17'],
      ['Europe/Berlin', 2026, 7, 17, '2026-08-17'], // UTC+2
      ['Asia/Tokyo', 2026, 7, 17, '2026-08-17'], // UTC+9
      ['Pacific/Auckland', 2026, 7, 17, '2026-08-17'], // UTC+12
      // Month and year boundaries · where an off-by-one moves the cell
      // into a different grid entirely.
      ['Pacific/Auckland', 2026, 0, 1, '2026-01-01'],
      ['Pacific/Auckland', 2026, 11, 31, '2026-12-31'],
      ['Europe/Berlin', 2026, 8, 1, '2026-09-01'],
    ];
    for (const [tz, y, m, dd, expected] of cases) {
      withTz(tz, () => {
        expect(dayKeyFromLocalParts(cellDate(y, m, dd))).toBe(expected);
      });
    }
  });

  it('every cell of a full month keys to its own date in Auckland', () => {
    withTz('Pacific/Auckland', () => {
      for (let dd = 1; dd <= 31; dd++) {
        expect(dayKeyFromLocalParts(cellDate(2026, 7, dd))).toBe(
          `2026-08-${String(dd).padStart(2, '0')}`,
        );
      }
    });
  });

  it('TrainView no longer builds a day key out of toISOString', () => {
    expect(TRAIN_CODE).not.toMatch(/toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/);
    expect(TRAIN).toContain("from '@/lib/runtime/day-key'");
    expect(TRAIN_CODE).toContain('dayKeyFromLocalParts(date)');
  });
});

// ── 4 · the race-day hero's B goal is the one every surface resolves ───

describe('race-day B · SAFE', () => {
  const FIVEK_18 = 18 * 60;
  const MARATHON_3H = 3 * 3600;

  it('THE BUG · a flat +7:00 is absurd at short distances', () => {
    const flat5k = FIVEK_18 + 420;
    expect(flat5k / FIVEK_18 - 1).toBeGreaterThan(0.38); // +39%
    const resolved = resolveBGoal({ effectiveTargetSec: FIVEK_18 }).sec!;
    expect(resolved).toBeLessThan(flat5k);
    expect(resolved / FIVEK_18 - 1).toBeCloseTo(0.033, 3);
  });

  it('is proportional, so it means the same thing at every distance', () => {
    for (const target of [FIVEK_18, 40 * 60, 90 * 60, MARATHON_3H]) {
      const b = resolveBGoal({ effectiveTargetSec: target }).sec!;
      expect(b / target - 1).toBeCloseTo(0.033, 3);
    }
  });

  it('reads back the runner-entered B goal instead of overriding it', () => {
    const stored = 3 * 3600 + 600;
    const r = resolveBGoal({ effectiveTargetSec: MARATHON_3H, storedBGoalSec: stored });
    expect(r.source).toBe('stored');
    expect(r.sec).toBe(stored);
  });

  it('renders nothing rather than a fabricated number', () => {
    expect(resolveBGoal({ effectiveTargetSec: null }).sec).toBeNull();
  });

  it('the race-day hero delegates to the shared resolver', () => {
    expect(TODAY).toContain("from '@/lib/race/b-goal'");
    expect(TODAY_CODE).toContain('resolveBGoal({');
    expect(TODAY_CODE).not.toMatch(/goalSec\s*\+\s*420/);
    // And derives from the EFFECTIVE target, not the raw stated goal, so a
    // demoted stretch goal cannot hand back a B faster than the A the
    // runner is actually paced to.
    expect(TODAY_CODE).toContain('effectiveTarget?.targetSec');
  });
});

// ── 1 · one hero, one verdict ──────────────────────────────────────────

describe('completed hero · the tick and the badge agree', () => {
  /** The tick and everything that could be guarding it. */
  const tickContext = (() => {
    const at = TODAY_CODE.indexOf('className="check"');
    expect(at).toBeGreaterThan(-1);
    // One tick in the file; if a second ever lands, this test should be
    // rewritten rather than silently guarding only the first.
    expect(TODAY_CODE.indexOf('className="check"', at + 1)).toBe(-1);
    // Window = the enclosing .titlerow element, so the guard has to be on
    // the tick itself and not merely somewhere earlier in the component.
    const rowAt = TODAY_CODE.lastIndexOf('<div className="titlerow">', at);
    expect(rowAt).toBeGreaterThan(-1);
    return TODAY_CODE.slice(rowAt, at);
  })();

  it('THE BUG · the tick used to render unconditionally', () => {
    // The hero's title row and its verdict badge sit on the same card. A
    // green check beside a coral OFF PLAN badge is the card contradicting
    // itself, and the tick had no condition on it at all. It is now
    // guarded by the badge's own variable, in the same scope.
    expect(tickContext).toContain("verdictBadge === 'on-plan' && (");
  });

  it('the tick fires for on-plan only · not hot-day, not off-plan', () => {
    expect(tickContext).not.toContain("'hot-day'");
    expect(tickContext).not.toContain("'off-plan'");
    // The three badges below still each have their own branch, unchanged.
    for (const state of ['on-plan', 'hot-day', 'off-plan']) {
      expect(TODAY_CODE).toContain(`verdictBadge === '${state}'`);
    }
  });
});

// ── 2 · the tempo panel receives the splits it needs ───────────────────

describe('tempo HR thirds · measured, not synthesized', () => {
  it('TempoPanel now receives splits, like its two sibling panels', () => {
    expect(TODAY_CODE).toMatch(/<TempoPanel[\s\S]{0,200}splits=\{splits\}/);
    expect(TODAY).toContain("from '@/lib/coach/hr-thirds'");
  });

  it('the avg±(max−avg) synthesis is gone from the view', () => {
    // The exact dead shape: climb from the phase summary, thirds from it.
    expect(TODAY_CODE).not.toMatch(/const\s+climb\s*=\s*Math\.max\(0,\s*peak\s*-\s*avg\)/);
    expect(TODAY_CODE).not.toMatch(/const\s+driftHi\s*=/);
  });

  it('the heading is no longer a hard-coded claim of measurement', () => {
    // It reads hrThirdsHeading(source), so the estimated path relabels.
    expect(TODAY_CODE).toContain('hrThirdsHeading(hrThirds.source)');
    expect(TODAY_CODE).not.toContain('>HR ACROSS THE BLOCK<');
  });
});
