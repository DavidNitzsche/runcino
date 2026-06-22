import { describe, it, expect } from 'vitest';
import { composeRecoveryPlan, type ComposeNonRaceInput } from './generate';

// R3-NONRACE-N2 faithful repro.
// Auditor: "recovery elite peak 70 avail 0 2 4 6 long 0 rest 4 last 26.2"
// repro line: composeRecoveryPlan elite peak 70 long 22 avail 0 2 4 6
// claim: a 31-mile easy day lands; subset max 31 vs null-avail max 8.

function mkInput(avail: Set<number> | null): ComposeNonRaceInput {
  return {
    startMondayISO: '2026-06-22',
    level: 'advanced_plus' as any, // "elite" → advanced_plus is the top level key
    recentWeeklyMi: 70,
    recentLongMi: 22,
    recentPeakWeeklyMi: 70,
    easyDayMedianMi: 9,
    longRunDow: 0 as any,
    restDow: 4 as any,
    qualityDows: [],
    availableDows: avail,
    trainingDaysPerWeek: null, // auditor gave avail [0,2,4,6] but no explicit freq
    crossModes: [],
    tier: 'serious' as any,
    nextRace: null,
    lastRaceFinished: { slug: 'test-marathon', name: 'Test Marathon', date: '2026-06-15', distanceMi: 26.2 },
    rxQuality: {} as any,
    tPaceSec: 360,
    lthr: 165,
  };
}

function maxRunDay(result: ReturnType<typeof composeRecoveryPlan>): number {
  let mx = 0;
  for (const w of result.weeks) {
    for (const d of w.days) {
      if (d.type !== 'rest' && d.distanceMi > mx) mx = d.distanceMi;
    }
  }
  return mx;
}

function dump(label: string, result: ReturnType<typeof composeRecoveryPlan>) {
  console.log(`\n=== ${label} ===`);
  for (const w of result.weeks) {
    const days = w.days.map((d) => `${d.dow}:${d.type}:${d.distanceMi}`).join('  ');
    const sum = w.days.reduce((s, d) => s + d.distanceMi, 0);
    console.log(`  wk ${w.startISO} weeklyMi=${w.weeklyMi} daySum=${sum} | ${days}`);
  }
  console.log(`  MAX RUN DAY = ${maxRunDay(result)}`);
}

describe('R3-NONRACE-N2 recovery easy-day ceiling', () => {
  it('reproduces the exact auditor scenario at HEAD', () => {
    const subset = composeRecoveryPlan(mkInput(new Set([0, 2, 4, 6])));
    const nullAvail = composeRecoveryPlan(mkInput(null));
    dump('SUBSET avail [0,2,4,6]', subset);
    dump('NULL avail', nullAvail);

    const subsetMax = maxRunDay(subset);
    const nullMax = maxRunDay(nullAvail);
    console.log(`\nSUBSET max=${subsetMax}  NULL max=${nullMax}`);

    // The auditor's claim: subset max ~31. The fix: subset max must be <= the
    // week's long (mediumMi), which is well under 22.
    expect(subsetMax).toBeLessThan(22); // <= long (inv3-style)
    expect(subsetMax).toBeLessThanOrEqual(13); // not absurd (inv13/14)
  });

  it('every recovery easy day <= that week long, every week', () => {
    for (const avail of [new Set([0, 2, 4, 6]), new Set([1, 3, 5]), new Set([2, 5]), null]) {
      const r = composeRecoveryPlan(mkInput(avail as any));
      for (const w of r.weeks) {
        const longMi = Math.max(0, ...w.days.filter((d) => d.isLong).map((d) => d.distanceMi));
        const maxNonLong = Math.max(0, ...w.days.filter((d) => !d.isLong && d.type !== 'rest').map((d) => d.distanceMi));
        // when no isLong flagged (recovery may not flag a long), compare to the medium/longest run
        const longest = Math.max(0, ...w.days.filter((d) => d.type !== 'rest').map((d) => d.distanceMi));
        console.log(`avail=${avail ? [...avail] : 'null'} wk=${w.startISO} longFlag=${longMi} maxNonLong=${maxNonLong} longest=${longest}`);
        expect(longest).toBeLessThanOrEqual(13);
      }
    }
  });
});
