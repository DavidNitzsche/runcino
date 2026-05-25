import { describe, expect, it } from 'vitest';
import { generateBlock, generateWeek, currentWeekNumber, workoutForDate } from '../training';

describe('generateBlock', () => {
  const block = generateBlock({
    goalRaceName: 'Big Sur Marathon',
    goalRaceDate: '2026-04-26',
    weeksTotal: 18,
    peakMpw: 50,
    basePaceSPerMi: 526,
    hilly: true,
  });

  it('generates 18 weeks', () => {
    expect(block.weeks.length).toBe(18);
  });

  it('every week has 7 days', () => {
    for (const w of block.weeks) expect(w.days.length).toBe(7);
  });

  it('phases are base → build → peak → taper in order', () => {
    const phases = block.weeks.map(w => w.phase);
    const baseEnd = phases.lastIndexOf('base');
    const buildStart = phases.indexOf('build');
    const buildEnd = phases.lastIndexOf('build');
    const peakStart = phases.indexOf('peak');
    const peakEnd = phases.lastIndexOf('peak');
    const taperStart = phases.indexOf('taper');
    expect(baseEnd).toBeLessThan(buildStart);
    expect(buildEnd).toBeLessThan(peakStart);
    expect(peakEnd).toBeLessThan(taperStart);
  });

  it('peak mileage is hit near the end of peak phase', () => {
    const milesByWeek = block.weeks.map(w => w.totalDistanceMi);
    const peakIdx = milesByWeek.indexOf(Math.max(...milesByWeek));
    expect(block.weeks[peakIdx].phase).toMatch(/peak|build/);
  });

  it('taper weeks have less volume than peak weeks', () => {
    const peakAvg = block.weeks.filter(w => w.phase === 'peak')
      .reduce((s, w) => s + w.totalDistanceMi, 0) / block.weeks.filter(w => w.phase === 'peak').length;
    const taperAvg = block.weeks.filter(w => w.phase === 'taper')
      .reduce((s, w) => s + w.totalDistanceMi, 0) / block.weeks.filter(w => w.phase === 'taper').length;
    expect(taperAvg).toBeLessThan(peakAvg);
  });

  it('hilly flag yields long_hilly on Saturday during build+peak', () => {
    const peakWeek = block.weeks.find(w => w.phase === 'peak')!;
    const sat = peakWeek.days.find(d => d.dow === 'Sat');
    expect(sat!.kind).toBe('long_hilly');
  });

  it('race day (goalRaceDate, a Sunday) is in the last taper week', () => {
    const lastWeek = block.weeks[block.weeks.length - 1];
    const raceDay = lastWeek.days.find(d => d.date === '2026-04-26');
    // Sunday of the last week should be the goal date
    expect(raceDay).toBeDefined();
  });

  it('workoutForDate finds a specific day', () => {
    const hit = workoutForDate(block, block.weeks[5].days[2].date);
    expect(hit).not.toBeNull();
    expect(hit!.day.date).toBe(block.weeks[5].days[2].date);
  });

  it('currentWeekNumber on race day is 18', () => {
    expect(currentWeekNumber('2026-04-26', block)).toBe(18);
  });

  it('currentWeekNumber 18 weeks before race is 1', () => {
    const firstMonday = block.weeks[0].startDate;
    expect(currentWeekNumber(firstMonday, block)).toBe(1);
  });

  it('every non-rest day has a target pace', () => {
    for (const w of block.weeks) {
      for (const d of w.days) {
        if (d.kind !== 'rest') {
          expect(d.targetPaceSPerMi).not.toBeNull();
          expect(d.targetPaceSPerMi!).toBeGreaterThan(300);
          expect(d.targetPaceSPerMi!).toBeLessThan(800);
        }
      }
    }
  });
});
