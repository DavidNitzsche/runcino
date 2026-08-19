/**
 * SLOT-ROTATE · HOW MANY OF A BLOCK'S QUALITY DAYS DOCTRINE ACTUALLY NAMES.
 *
 * `lib/workout-catalogue/` holds all 59 of `Research/04-workout-vocabulary.md`'s
 * named workouts and the engine can express 43 of them. Neither number is what
 * a runner sees. What a runner sees is how many of their block's quality days
 * the catalogue was ASKED to fill, and before this gate a 14-week marathon drew
 * five distinct sessions across seventeen quality days — not because the
 * vocabulary was missing, but because `qualityFamilyFor` placed a §15 family on
 * five of the seventeen and the rest fell to one generic string per family.
 *
 * ── What this gate is, and what it deliberately is not ─────────────────────
 *
 * It measures SLOT ALLOCATION and vocabulary breadth, and nothing else. It does
 * not assert that the at-pace load rises week over week, and that omission is
 * deliberate rather than an oversight: the composed dose is Daniels' share of
 * the week's mileage, the volume curve has cutbacks in it, and a deload week
 * SHOULD carry less than the week before. A monotone assertion here would be
 * false of a correct plan.
 *
 * The overload property lives where it can be stated truthfully — on the
 * trajectory's own earned shape, before the week's affordability clamp, in
 * `_trajectory.test.ts` ("progresses instead of repeating one session for
 * fourteen weeks"). That test now also asserts the ladder steps on every
 * quality week whoever fills the slot, which is the half that makes rotation
 * and overload compatible. The two gates are the two halves of the same claim:
 * the DOSE climbs, and the IDENTITY rotates underneath it.
 *
 * Floors are set below what the engine currently produces, so a genuine
 * improvement does not turn this red and a regression does.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_slot_allocation.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import type { SimInputs, SimDistance } from './sim-constants';

interface Archetype {
  label: string;
  distance: SimDistance;
  weeks: number;
  goalSec: number;
  /** Floors, not targets · see the header. */
  minCatalogueSlots: number;
  minDistinct: number;
}

const ARCHETYPES: Archetype[] = [
  { label: '14wk marathon', distance: 'marathon', weeks: 14, goalSec: 12600, minCatalogueSlots: 9, minDistinct: 8 },
  { label: '18wk marathon', distance: 'marathon', weeks: 18, goalSec: 12600, minCatalogueSlots: 14, minDistinct: 8 },
  { label: '12wk 5K',       distance: '5k',       weeks: 12, goalSec: 1200,  minCatalogueSlots: 11, minDistinct: 9 },
  { label: '16wk half',     distance: 'half',     weeks: 16, goalSec: 5700,  minCatalogueSlots: 11, minDistinct: 8 },
];

function simFor(a: Archetype): SimInputs {
  return {
    goalMode: 'goal', distance: a.distance, startDateISO: '2026-09-07',
    planWeeks: a.weeks, goalTimeSec: a.goalSec, raceDateISO: '2027-03-01',
    experienceLevel: 'intermediate', weeklyFrequency: 5, weeklyMileageBucket: 35,
    longestRunBucket: '10+', raceHistory: [], longRunDay: 'sun', restDay: 'sat',
    availableDays: null, bestRecentVdotOverride: 48,
  } as unknown as SimInputs;
}

/** `catalogueNote` always opens `<name> · Research/04 §x.y.` — see catalogue-rx. */
const CAT_NOTE = /^(.+?) · Research\/04 (§[\d.]+)\./;

describe('SLOT-ROTATE · the catalogue fills the block, not one string per family', () => {
  for (const a of ARCHETYPES) {
    it(`${a.label} · draws ≥${a.minDistinct} distinct doctrine sessions`, () => {
      const built = buildSimPlan(simFor(a));
      expect(built.ok, `${a.label} did not build`).toBe(true);
      if (!built.ok) return;

      let quality = 0;
      let catalogue = 0;
      const distinct = new Set<string>();
      for (const w of built.composed.weeks) {
        for (const d of w.days) {
          if (!d.isQuality || d.type === 'race') continue;
          quality++;
          const m = CAT_NOTE.exec(String(d.notes ?? ''));
          if (m) { catalogue++; distinct.add(`${m[1]} ${m[2]}`); }
        }
      }

      expect(quality, `${a.label} composed no quality days at all`).toBeGreaterThan(0);
      expect(
        catalogue,
        `${a.label}: doctrine named only ${catalogue} of ${quality} quality days`,
      ).toBeGreaterThanOrEqual(a.minCatalogueSlots);
      expect(
        distinct.size,
        `${a.label} drew ${distinct.size} distinct sessions: ${[...distinct].sort().join(' ; ')}`,
      ).toBeGreaterThanOrEqual(a.minDistinct);
      // The defect in one number: a whole block on a handful of shapes. A
      // catalogue-owned day that repeats a session the block has already run
      // is fine — §5.2's tempo is a weekly session — but the block may not be
      // carried by two or three of them.
      expect(
        distinct.size / catalogue,
        `${a.label} repeated ${catalogue} catalogue days across only ${distinct.size} sessions`,
      ).toBeGreaterThan(0.4);
    });
  }

  it('regenerates byte-identically · the rotation reads no clock and no random number', () => {
    for (const a of ARCHETYPES) {
      const one = buildSimPlan(simFor(a));
      const two = buildSimPlan(simFor(a));
      expect(one.ok && two.ok).toBe(true);
      if (!one.ok || !two.ok) continue;
      const fingerprint = (r: typeof one) =>
        r.composed.weeks.map((w) =>
          w.days.map((d) => `${d.type}:${d.distanceMi}:${d.subLabel ?? ''}`).join('|'),
        ).join('\n');
      expect(fingerprint(two), `${a.label} did not regenerate identically`).toBe(fingerprint(one));
    }
  });
});
