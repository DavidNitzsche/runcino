/**
 * Tests for lib/coach/coach-log.ts pure composers (coach-experience
 * pass, 2026-08-17). The DB shell (updateCoachLog/loadCoachLog) is
 * exercised in prod via the run-adaptations cron; the composed WORDS
 * are locked here.
 */
import { describe, it, expect } from 'vitest';
import {
  composeWeekCloseEntry,
  composePhaseBoundaryEntry,
  composeFirstEverEntry,
} from './coach-log';

describe('composeWeekCloseEntry', () => {
  const base = {
    weekStartISO: '2026-08-03',
    weekEndISO: '2026-08-09',
    totalMi: 42.1,
    plannedMi: 44,
    qualityPlanned: 2,
    qualityDone: 2,
    longestDayMi: 16,
    isBiggestOfBlock: false,
    isBiggestEver: false,
  };

  it('biggest week of the block · the canonical line', () => {
    const e = composeWeekCloseEntry({ ...base, isBiggestOfBlock: true });
    expect(e.title).toBe('WEEK CLOSED');
    expect(e.body).toBe('Biggest week of the block · 42.1 mi · both quality days landed.');
  });

  it('biggest ever beats biggest of block', () => {
    const e = composeWeekCloseEntry({ ...base, isBiggestOfBlock: true, isBiggestEver: true });
    expect(e.body).toBe('Biggest week you have ever logged · 42.1 mi · both quality days landed.');
  });

  it('plain week close with planned volume + partial quality', () => {
    const e = composeWeekCloseEntry({ ...base, totalMi: 35.2, qualityDone: 1 });
    expect(e.body).toBe('35.2 mi of 44 planned · 1 of 2 quality days landed.');
  });

  it('all-easy week reads by design, not as a miss', () => {
    const e = composeWeekCloseEntry({ ...base, qualityPlanned: 0, qualityDone: 0, totalMi: 30 });
    expect(e.body).toBe('30 mi of 44 planned · all easy by design.');
  });

  it('single quality day grammar', () => {
    const e = composeWeekCloseEntry({ ...base, qualityPlanned: 1, qualityDone: 1, totalMi: 28 });
    expect(e.body).toContain('the quality day landed');
  });

  it('zero week is honest, not shaming', () => {
    const e = composeWeekCloseEntry({ ...base, totalMi: 0, qualityPlanned: 2, qualityDone: 0 });
    expect(e.body).toContain('zero week');
    expect(e.body).not.toMatch(/!|—/);
  });

  it('no planned volume → no "of planned" clause', () => {
    const e = composeWeekCloseEntry({ ...base, plannedMi: null, totalMi: 31.4 });
    expect(e.body).toBe('31.4 mi · both quality days landed.');
  });

  it('race week · the race is the story, never "all easy by design"', () => {
    const e = composeWeekCloseEntry({
      ...base, totalMi: 23.2, plannedMi: 31.6, qualityPlanned: 0, qualityDone: 0, hadRace: true,
    });
    expect(e.body).toBe('23.2 mi of 31.6 planned · race week · the race is the story, not the volume.');
  });
});

describe('composePhaseBoundaryEntry', () => {
  it('the canonical base→build line', () => {
    const e = composePhaseBoundaryEntry({
      endedPhase: 'Base',
      weeks: 8,
      totalMi: 240,
      longFirstMi: 10,
      longLastMi: 16,
      nextPhase: 'Build',
      nextStartISO: '2026-08-18',
      todayISO: '2026-08-17',
    });
    expect(e.title).toBe('PHASE');
    expect(e.body).toBe('Base done · 8 weeks, 240 mi, long run 10→16. Build starts Tuesday.');
  });

  it('boundary fired on the start day says today', () => {
    const e = composePhaseBoundaryEntry({
      endedPhase: 'BUILD', weeks: 6, totalMi: 210,
      longFirstMi: 14, longLastMi: 18,
      nextPhase: 'PEAK', nextStartISO: '2026-08-17', todayISO: '2026-08-17',
    });
    expect(e.body).toBe('Build done · 6 weeks, 210 mi, long run 14→18. Peak starts today.');
  });

  it('flat long-run progression drops the long clause', () => {
    const e = composePhaseBoundaryEntry({
      endedPhase: 'taper', weeks: 2, totalMi: 40,
      longFirstMi: 10, longLastMi: 8,
      nextPhase: 'race', nextStartISO: '2026-08-17', todayISO: '2026-08-17',
    });
    expect(e.body).toBe('Taper done · 2 weeks, 40 mi. Race starts today.');
  });

  it('no next phase → clean period', () => {
    const e = composePhaseBoundaryEntry({
      endedPhase: 'Peak', weeks: 3, totalMi: 150,
      longFirstMi: null, longLastMi: null,
      nextPhase: null, nextStartISO: null, todayISO: '2026-08-17',
    });
    expect(e.body).toBe('Peak done · 3 weeks, 150 mi.');
  });
});

describe('composeFirstEverEntry', () => {
  it('longest run ever with the old mark', () => {
    const e = composeFirstEverEntry({ kind: 'longest_run', valueMi: 18, previousBestMi: 16.2 });
    expect(e.title).toBe('FIRST');
    expect(e.body).toBe('Longest run you have ever logged · 18 mi. Old mark 16.2.');
  });
  it('biggest week ever', () => {
    const e = composeFirstEverEntry({ kind: 'biggest_week', valueMi: 46.3, previousBestMi: 44.1 });
    expect(e.body).toBe('Biggest week you have ever logged · 46.3 mi. Old mark 44.1.');
  });
  it('no previous best → no old-mark clause', () => {
    const e = composeFirstEverEntry({ kind: 'longest_run', valueMi: 12, previousBestMi: null });
    expect(e.body).toBe('Longest run you have ever logged · 12 mi.');
  });
  it('voice · no em dash, no exclamation, no citation', () => {
    const e = composeFirstEverEntry({ kind: 'biggest_week', valueMi: 50, previousBestMi: 48 });
    expect(e.body).not.toMatch(/—|!|Research\//);
  });
});
