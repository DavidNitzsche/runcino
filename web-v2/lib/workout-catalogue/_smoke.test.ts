/**
 * lib/workout-catalogue/_smoke.test.ts · what the selector actually says.
 *
 * The other two test files assert properties. This one renders the selector's
 * whole answer for three runners so a human can read it and disagree — the
 * check that catches a session which satisfies every invariant and is still the
 * wrong thing to ask someone to run. Two of the defects fixed while building
 * this module were found exactly that way, by reading the table rather than by
 * a failing assertion: a 30 mi/wk marathoner refused a long run outright, and
 * §3's medium-long filling the long-run day.
 *
 * `FAFF_DUMP_SELECTOR=1 npx vitest run lib/workout-catalogue/_smoke.test.ts`
 * writes the table to `selector-dump.txt` in the working directory.
 */
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { selectWorkout, sessionAllowanceMi, type Slot, type SelectorInput } from './select';
import type { PaceZone } from './types';

const ANCHORS: Partial<Record<PaceZone, number>> = {
  E: 540, M: 460, MP: 460, T: 435, ST: 448, HM: 445,
  I: 400, R: 370, '10K': 415, '5K': 400, '3K': 385, mile: 370,
};

const base = (over: Partial<SelectorInput>): SelectorInput => ({
  phase: 'race_specific', distance: 'm', tier: 'intermediate', weekIndex: 0,
  weeklyMi: 50, slot: 'threshold', anchors: ANCHORS, ...over,
});

const SLOTS: Slot[] = ['tempo', 'threshold', 'intervals', 'long', 'medium_long', 'speed'];

describe('SELECTOR · a readable account of its behaviour', () => {
  it('renders three runners and a twelve-week rotation', () => {
    const out: string[] = [];
    const refusedAt: Record<number, number> = {};

    for (const weeklyMi of [15, 30, 55]) {
      out.push(`\n═══ ${weeklyMi} mi/wk · marathon · intermediate ═══`);
      refusedAt[weeklyMi] = 0;
      for (const phase of ['base', 'specific_support', 'race_specific', 'taper'] as const) {
        for (const slot of SLOTS) {
          const r = selectWorkout(base({ weeklyMi, phase, slot }));
          if (r.ok) {
            const d = r.dose;
            const shape = d.reps > 1 ? `${d.reps} reps` : 'continuous';
            out.push(
              `  ${phase.padEnd(17)} ${slot.padEnd(12)} → ${r.entry.name} (${r.entry.section}) · ` +
              `${shape} · ${d.atPaceMi.toFixed(2)} mi / ${d.atPaceMinutes.toFixed(0)} min ` +
              `[allowance ${sessionAllowanceMi(r.entry, weeklyMi).toFixed(2)} mi]`,
            );
          } else {
            refusedAt[weeklyMi]++;
            out.push(`  ${phase.padEnd(17)} ${slot.padEnd(12)} → REFUSED (${r.reason})`);
          }
        }
      }
    }

    out.push('\n═══ 12-week rotation · half · race-specific · threshold slot · 55 mi/wk ═══');
    const seen: string[] = [];
    for (let w = 0; w < 12; w++) {
      const recent = seen.map((slug, i) => ({ slug, weeksAgo: w - i })).filter((x) => x.weeksAgo > 0);
      const r = selectWorkout(base({ weekIndex: w, weeklyMi: 55, distance: 'hm', slot: 'threshold', recent }));
      if (r.ok) { seen.push(r.entry.slug); out.push(`  wk ${String(w).padStart(2)} → ${r.entry.name}`); }
    }

    if (process.env.FAFF_DUMP_SELECTOR === '1') {
      fs.writeFileSync('selector-dump.txt', out.join('\n'));
    }

    // The shape of the answer, asserted rather than merely printed: a small
    // week refuses a great deal and a real training week refuses very little.
    expect(refusedAt[15]).toBeGreaterThan(refusedAt[55]);
    expect(refusedAt[55]).toBeLessThanOrEqual(4);
    // And the rotation genuinely rotates.
    expect(new Set(seen).size).toBeGreaterThanOrEqual(3);
  });
});
