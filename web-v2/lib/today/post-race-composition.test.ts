/**
 * post-race-composition.test · deck Decision 1 · the post-race Today state.
 *
 * The bug class this exists to prevent is specific and recent. Before
 * 52174bcd the recovery generator sized every distance off the MARATHON
 * reverse taper, so David's half mid-marathon-build produced 15 miles
 * across 14 days with five straight rest days. The fix made the window
 * context-aware: a half now gets roughly 17 then 23 miles on four then
 * six running days (Research/00b-recovery-protocols.md:196-204 and the
 * half's own protocol at :240-255).
 *
 * Which means the SURFACE must not re-introduce the same lie from the
 * other end. If this module hardcoded "7 days" or "rest week" or a fixed
 * cap, David would read a rest week on Today while the plan prescribed
 * easy running. So the fixtures below are the real shapes of both
 * protocols, and the assertions are that the composition reports what
 * the plan says — including easy runs — and never a constant.
 */
import { describe, it, expect } from 'vitest';
import {
  selectRecoveryWindow,
  composePostRaceToday,
  recoveryWeekSummary,
  recoveryDayLabel,
  formatWindowRange,
  type PhaseSpan,
  type PlanDayLite,
} from './post-race-composition';

/* ── fixtures ────────────────────────────────────────────────────────── */

const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Build one plan week of seven dated days from a compact spec. */
function week(startISO: string, spec: Array<[string, number]>): PlanDayLite[] {
  const base = Date.parse(startISO + 'T12:00:00Z');
  return spec.map(([type, mi], i) => ({
    date: new Date(base + i * 86400000).toISOString().slice(0, 10),
    dow: DOW[i],
    type,
    name: type,
    mi,
  }));
}

/**
 * The HALF's post-race window as 52174bcd generates it: two weeks, real
 * easy running, a medium-long coming back, four then six running days.
 * NOT rest.
 */
const halfPhases: PhaseSpan[] = [{ label: 'RECOVERY', startWeekIdx: 0, endWeekIdx: 1 }];
const halfWeeks: PlanDayLite[][] = [
  week('2026-08-17', [
    ['rest', 0], ['rest', 0], ['easy', 3], ['rest', 0],
    ['easy', 4], ['rest', 0], ['easy', 5],
  ]),
  week('2026-08-24', [
    ['easy', 4], ['rest', 0], ['easy', 4], ['easy', 4],
    ['easy', 4], ['rest', 0], ['long', 7],
  ]),
];
/** A build block follows, so "next block opens" has something to name. */
const halfWeeksWithNextBlock: PlanDayLite[][] = [
  ...halfWeeks,
  week('2026-08-31', [
    ['easy', 6], ['tempo', 8], ['easy', 5], ['rest', 0],
    ['easy', 6], ['easy', 5], ['long', 12],
  ]),
];

/** The MARATHON's window: four weeks, genuinely rest-dominated at first. */
const marathonPhases: PhaseSpan[] = [{ label: 'RECOVERY', startWeekIdx: 0, endWeekIdx: 3 }];
const marathonWeeks: PlanDayLite[][] = [
  week('2026-08-17', [
    ['rest', 0], ['rest', 0], ['rest', 0], ['rest', 0],
    ['easy', 3], ['rest', 0], ['easy', 3],
  ]),
  week('2026-08-24', [['rest', 0], ['easy', 4], ['rest', 0], ['easy', 4], ['rest', 0], ['easy', 4], ['rest', 0]]),
  week('2026-08-31', [['easy', 5], ['rest', 0], ['easy', 5], ['easy', 5], ['rest', 0], ['easy', 5], ['easy', 6]]),
  week('2026-09-07', [['easy', 6], ['easy', 6], ['rest', 0], ['easy', 6], ['easy', 6], ['rest', 0], ['long', 10]]),
];

const buildPhases: PhaseSpan[] = [{ label: 'BUILD', startWeekIdx: 0, endWeekIdx: 5 }];

/* ── the window is read, never assumed ───────────────────────────────── */

describe('the recovery window comes from the plan, not from a constant', () => {
  it('a half mid-build reports the easy running the plan actually wrote', () => {
    const w = selectRecoveryWindow({
      phases: halfPhases, weekDays: halfWeeks, nowIdx: 0, todayISO: '2026-08-17',
    })!;
    expect(w).not.toBeNull();
    // Four running days, twelve miles. Not rest.
    expect(w.runningDays).toBe(3);
    expect(w.weekPlannedMi).toBe(12);
    expect(w.days.filter((d) => d.isRunning).map((d) => d.label))
      .toEqual(['Easy 3', 'Easy 4', 'Easy 5']);
    // 2026-08-17 · position in the window is stated once, in the strip
    // header. This line says what the week holds.
    expect(recoveryWeekSummary(w)).toBe('3 running days · 12 mi easy');
  });

  it('week two of the same window reports its own, larger shape', () => {
    const w = selectRecoveryWindow({
      phases: halfPhases, weekDays: halfWeeks, nowIdx: 1, todayISO: '2026-08-24',
    })!;
    expect(w.weekIndex).toBe(2);
    expect(w.runningDays).toBe(5);
    expect(w.weekPlannedMi).toBe(23);
    // The long run coming back is named as a long run, not flattened.
    expect(w.days.map((d) => d.label)).toContain('Long 7');
  });

  it('a marathon window spans four weeks and says so', () => {
    const w = selectRecoveryWindow({
      phases: marathonPhases, weekDays: marathonWeeks, nowIdx: 0, todayISO: '2026-08-17',
    })!;
    expect(w.weeksTotal).toBe(4);
    expect(w.daysTotal).toBe(28);
    expect(w.rangeLabel).toBe('Aug 17 to Sep 13');
    // Marathon week one really is rest-dominated. The surface reports
    // that honestly too — the point is that it is read, not assumed.
    expect(w.runningDays).toBe(2);
  });

  it('window length is never a fixed 7 or 14', () => {
    const half = selectRecoveryWindow({
      phases: halfPhases, weekDays: halfWeeks, nowIdx: 0, todayISO: '2026-08-17',
    })!;
    const marathon = selectRecoveryWindow({
      phases: marathonPhases, weekDays: marathonWeeks, nowIdx: 0, todayISO: '2026-08-17',
    })!;
    expect(half.daysTotal).toBe(14);
    expect(marathon.daysTotal).toBe(28);
    expect(half.daysTotal).not.toBe(marathon.daysTotal);
  });

  it('names the day the next block opens only when a next block exists', () => {
    const withNext = selectRecoveryWindow({
      phases: halfPhases, weekDays: halfWeeksWithNextBlock, nowIdx: 0, todayISO: '2026-08-17',
    })!;
    expect(withNext.nextBlockISO).toBe('2026-08-31');
    expect(withNext.nextBlockLabel).toBe('next block opens Aug 31');

    const withoutNext = selectRecoveryWindow({
      phases: halfPhases, weekDays: halfWeeks, nowIdx: 0, todayISO: '2026-08-17',
    })!;
    expect(withoutNext.nextBlockISO).toBeNull();
    expect(withoutNext.nextBlockLabel).toBeNull();
  });

  it('marks today, past days and completed days off the real dates', () => {
    const w = selectRecoveryWindow({
      phases: halfPhases, weekDays: halfWeeks, nowIdx: 0, todayISO: '2026-08-19',
    })!;
    const today = w.days.find((d) => d.isToday)!;
    expect(today.iso).toBe('2026-08-19');
    expect(today.label).toBe('Easy 3');
    expect(w.days.filter((d) => d.isPast).map((d) => d.iso))
      .toEqual(['2026-08-17', '2026-08-18']);
    expect(w.dayIndex).toBe(3);
  });
});

describe('degrading gracefully when there is no recovery plan', () => {
  it('returns null mid-build', () => {
    expect(selectRecoveryWindow({
      phases: buildPhases, weekDays: halfWeeks, nowIdx: 2, todayISO: '2026-08-17',
    })).toBeNull();
  });

  it('returns null when the recovery phase does not contain this week', () => {
    expect(selectRecoveryWindow({
      phases: [{ label: 'RECOVERY', startWeekIdx: 0, endWeekIdx: 0 }],
      weekDays: halfWeeks, nowIdx: 1, todayISO: '2026-08-24',
    })).toBeNull();
  });

  it('returns null with no plan at all rather than inventing a window', () => {
    expect(selectRecoveryWindow({ phases: [], weekDays: [], nowIdx: 0, todayISO: '2026-08-17' })).toBeNull();
    expect(selectRecoveryWindow({ phases: halfPhases, weekDays: [], nowIdx: 0, todayISO: '2026-08-17' })).toBeNull();
  });

  it('returns null when the phase has no dated days to place', () => {
    expect(selectRecoveryWindow({
      phases: halfPhases,
      weekDays: [[{ dow: 'MON', type: 'rest', name: 'rest', mi: 0 }]],
      nowIdx: 0, todayISO: '2026-08-17',
    })).toBeNull();
  });
});

/* ── composition state selection ─────────────────────────────────────── */

describe('composePostRaceToday · state selection', () => {
  const recovery = selectRecoveryWindow({
    phases: halfPhases, weekDays: halfWeeksWithNextBlock, nowIdx: 0, todayISO: '2026-08-17',
  });

  it('fires across the whole 0 to 7 day window and not past it', () => {
    for (const daysSince of [0, 1, 4, 7]) {
      expect(composePostRaceToday({
        purposeIsPostRace: false, daysSince, recovery,
      }).active).toBe(true);
    }
    expect(composePostRaceToday({
      purposeIsPostRace: false, daysSince: 8, recovery,
    }).active).toBe(false);
  });

  it('fires on the purpose signal alone when no race row was found', () => {
    expect(composePostRaceToday({
      purposeIsPostRace: true, daysSince: null, recovery: null,
    }).active).toBe(true);
  });

  it('stays off on an ordinary day', () => {
    const c = composePostRaceToday({
      purposeIsPostRace: false, daysSince: null, recovery: null,
    });
    expect(c.active).toBe(false);
    expect(c.stripHeader).toBe('THIS WEEK');
  });

  // 2026-08-17 · the four show*Tile booleans moved to
  // lib/today/composition.ts, which now answers "which tiles render" for
  // every state rather than only the post-race one. Their assertions live
  // in composition.test.ts.

  it('the strip header carries the real range, not a fixed label', () => {
    const c = composePostRaceToday({ purposeIsPostRace: true, daysSince: 1, recovery });
    expect(c.stripHeader).toBe('RECOVERY · DAY 1 OF 14 · AUG 17 TO 30');
    expect(c.stripNote).toBe('next block opens Aug 31');
    expect(c.stripSummary).toBe('3 running days · 12 mi easy');
  });

  it('with no recovery plan the strip degrades to a header and nothing invented', () => {
    const c = composePostRaceToday({ purposeIsPostRace: true, daysSince: 2, recovery: null });
    expect(c.active).toBe(true);
    expect(c.stripHeader).toBe('RECOVERY WEEK');
    expect(c.stripNote).toBeNull();
    expect(c.stripSummary).toBeNull();
  });

  it('names how long ago the race was in coach voice', () => {
    const at = (daysSince: number) =>
      composePostRaceToday({ purposeIsPostRace: true, daysSince, recovery }).sinceLabel;
    expect(at(0)).toBe('today');
    expect(at(1)).toBe('yesterday');
    expect(at(4)).toBe('4 days ago');
  });
});

/* ── copy ───────────────────────────────────────────────────────────── */

describe('the window copy reflects the real prescription', () => {
  it('a genuinely rest-only week says rest, and only then', () => {
    const restOnly = selectRecoveryWindow({
      phases: [{ label: 'RECOVERY', startWeekIdx: 0, endWeekIdx: 0 }],
      weekDays: [week('2026-08-17', [
        ['rest', 0], ['rest', 0], ['rest', 0], ['rest', 0],
        ['rest', 0], ['rest', 0], ['rest', 0],
      ])],
      nowIdx: 0, todayISO: '2026-08-17',
    })!;
    expect(recoveryWeekSummary(restOnly)).toBe('rest only');
  });

  it('no tile copy carries an em dash, an exclamation or an emoji', () => {
    const w = selectRecoveryWindow({
      phases: halfPhases, weekDays: halfWeeks, nowIdx: 0, todayISO: '2026-08-17',
    });
    const copy = [
      recoveryWeekSummary(w!),
      composePostRaceToday({ purposeIsPostRace: true, daysSince: 1, recovery: w }).stripHeader,
      composePostRaceToday({ purposeIsPostRace: true, daysSince: 1, recovery: w }).stripNote ?? '',
      ...[0, 1, 2, 5].map((n) =>
        composePostRaceToday({ purposeIsPostRace: true, daysSince: n, recovery: w }).sinceLabel ?? ''),
    ];
    for (const line of copy) {
      expect(line).not.toMatch(/—|!|\p{Extended_Pictographic}/u);
    }
  });
});

/* ── formatting helpers ──────────────────────────────────────────────── */

describe('formatting', () => {
  it('day labels read the prescription', () => {
    expect(recoveryDayLabel({ dow: 'WED', type: 'easy', name: '', mi: 3 })).toBe('Easy 3');
    expect(recoveryDayLabel({ dow: 'SUN', type: 'long', name: '', mi: 7.5 })).toBe('Long 7.5');
    expect(recoveryDayLabel({ dow: 'TUE', type: 'recovery', name: '', mi: 2 })).toBe('Recovery 2');
    expect(recoveryDayLabel({ dow: 'MON', type: 'rest', name: '', mi: 0 })).toBe('Off');
    // A zero-mile non-rest row is still off, not "Easy 0".
    expect(recoveryDayLabel({ dow: 'MON', type: 'easy', name: '', mi: 0 })).toBe('Off');
  });

  it('the range collapses within a month and expands across one', () => {
    expect(formatWindowRange('2026-08-17', '2026-08-30')).toBe('Aug 17 to 30');
    expect(formatWindowRange('2026-08-28', '2026-09-10')).toBe('Aug 28 to Sep 10');
  });
});
