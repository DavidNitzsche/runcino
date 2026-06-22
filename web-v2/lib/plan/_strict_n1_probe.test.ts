/** THROWAWAY strict N1 reproduction. Asserts the FIXED invariant (always 7 days),
 *  NOT the fix-tolerant version. Fails loudly if the <7-day bug is present. */
import { describe, it, expect } from 'vitest';
import { composeMaintenancePlan, composeRecoveryPlan, inlinePrescriptions, type ComposeNonRaceInput, type DOW } from './generate';
import { type GoalTier } from './goal-tiers';

const SM = '2026-01-05';
function baseInput(o: Partial<ComposeNonRaceInput> & { tier: GoalTier }): ComposeNonRaceInput {
  return {
    startMondayISO: SM, level: o.level ?? 'intermediate',
    recentWeeklyMi: o.recentWeeklyMi ?? 40, recentLongMi: o.recentLongMi ?? 14, recentPeakWeeklyMi: o.recentPeakWeeklyMi ?? 45,
    easyDayMedianMi: o.easyDayMedianMi ?? 6, longRunDow: (o.longRunDow ?? 0) as DOW, restDow: (o.restDow ?? 6) as DOW,
    qualityDows: o.qualityDows ?? ([3] as DOW[]), availableDows: o.availableDows ?? null,
    trainingDaysPerWeek: o.trainingDaysPerWeek ?? null, crossModes: o.crossModes ?? [], tier: o.tier,
    nextRace: o.nextRace ?? null, lastRaceFinished: o.lastRaceFinished ?? null,
    rxQuality: inlinePrescriptions('hm'), tPaceSec: o.tPaceSec ?? 360, lthr: o.lthr ?? null,
  };
}

describe('STRICT N1 — exact auditor repro', () => {
  it('the auditor’s exact case: maint avail {1,3,5} long 3 rest 1 quality 5 → MUST be 7 days', () => {
    const m = composeMaintenancePlan(baseInput({
      tier: 'intermediate', recentPeakWeeklyMi: 40, recentLongMi: 12,
      availableDows: new Set<number>([1, 3, 5]), longRunDow: 3 as DOW, restDow: 1 as DOW, qualityDows: [5] as DOW[],
    }));
    // auditor claimed days.length === 3 at the buggy baseline. Fixed = 7.
    expect(m.weeks[0].days.length).toBe(7);
    const dows = m.weeks[0].days.map((d) => d.dow).sort((a, b) => a - b);
    expect(dows).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('FULL subset sweep — every maintenance + recovery week is EXACTLY 7 contiguous days for ALL subset availabilities', () => {
    const TIERS: GoalTier[] = ['elite', 'advanced', 'intermediate', 'developing'];
    const PEAKS = [12, 25, 40, 55, 70];
    const LONGS = [4, 8, 14, 20];
    const FREQS: (number | null)[] = [null, 1, 2, 3, 4, 5, 6];
    const AVAILS: (DOW[] | null)[] = [null, [1, 3, 5] as DOW[], [0, 2, 4, 6] as DOW[], [2, 4] as DOW[], [0, 1, 2, 3, 4] as DOW[], [5, 6] as DOW[], [0] as DOW[]];
    const LONGDOWS: DOW[] = [0, 3, 6];
    const LAST = [3.1, 6.2, 13.1, 26.2, 31.0];
    const pickDays = (avail: DOW[] | null, ld: DOW) => {
      if (!avail) return { ld, rest: ((ld + 4) % 7) as DOW, qDows: [3] as DOW[] };
      const a = [...avail].sort((x, y) => x - y);
      const realLd = a.includes(ld) ? ld : a[a.length - 1];
      const rest = (a.find((d) => d !== realLd) ?? realLd) as DOW;
      const qDows = a.filter((d) => d !== realLd && d !== rest).slice(0, 1) as DOW[];
      return { ld: realLd, rest, qDows };
    };
    const bad: string[] = [];
    let combos = 0;
    for (const tier of TIERS) for (const peak of PEAKS) for (const long of LONGS) for (const freq of FREQS) for (const avail of AVAILS) for (const ld of LONGDOWS) {
      combos++;
      const p = pickDays(avail, ld);
      const baseMaint = baseInput({ tier, recentPeakWeeklyMi: peak, recentWeeklyMi: Math.round(peak * 0.9), recentLongMi: long, trainingDaysPerWeek: freq, availableDows: avail ? new Set(avail) : null, longRunDow: p.ld, restDow: p.rest, qualityDows: p.qDows, nextRace: { slug: 'r', name: 'Far 5K', date: '2026-09-01', distanceMi: 3.1, goalPaceSec: 360 } });
      const m = composeMaintenancePlan(baseMaint);
      m.weeks.forEach((w, wi) => {
        if (w.days.length !== 7) bad.push(`MAINT ${tier} p${peak} l${long} f${freq} avail${avail?.join('')||'null'} wk${wi}: ${w.days.length} days`);
        const ds = w.days.map((d) => d.dow).sort((a, b) => a - b);
        if (JSON.stringify(ds) !== JSON.stringify([0, 1, 2, 3, 4, 5, 6]) && bad.length < 20) bad.push(`MAINT-contig ${tier} avail${avail?.join('')||'null'} wk${wi}: ${ds.join(',')}`);
      });
      for (const lastMi of LAST) {
        const r = composeRecoveryPlan(baseInput({ tier, recentPeakWeeklyMi: peak, recentWeeklyMi: Math.round(peak * 0.9), recentLongMi: long, trainingDaysPerWeek: freq, availableDows: avail ? new Set(avail) : null, longRunDow: p.ld, restDow: p.rest, lastRaceFinished: { slug: 'l', name: `L${lastMi}`, date: '2026-01-01', distanceMi: lastMi } }));
        r.weeks.forEach((w, wi) => {
          if (w.days.length !== 7) bad.push(`RECOV ${tier} p${peak} last${lastMi} f${freq} avail${avail?.join('')||'null'} wk${wi}: ${w.days.length} days`);
        });
      }
    }
    if (bad.length > 0) throw new Error(`combos=${combos} · ${bad.length} non-7-day weeks:\n${bad.slice(0, 25).join('\n')}`);
    expect(bad.length).toBe(0);
  });
});
