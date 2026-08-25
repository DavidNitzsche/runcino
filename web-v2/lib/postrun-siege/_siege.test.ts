/**
 * lib/postrun-siege/_siege.test.ts · DRIVE EVERY HOSTILE ROW THROUGH THE
 * WHOLE POST-RUN PATH AND CHECK WHAT THE RUNNER WOULD HAVE READ.
 *
 * The path: a stored `runs.data` row → `reconcileRun` → `runFacts` →
 * `deriveRecap` and `deriveWin` → the sentences on the screen. Plus the three
 * pickers a merged run needs (`pickElevationGain`, `pickSplits`,
 * `reconcileHrZones`) and the zone table those shares are drawn against.
 *
 * Every shape is run through every workout type, because the branch that
 * prints the distance is per-type and a defect in one arm is invisible from
 * the others — "0mi easy + 6mi @ MP" lived in the long-run branch alone.
 *
 * See `invariants.ts` for what each check means, and `_controls.test.ts` for
 * the proof that the checks catch a planted fabrication.
 */
import { describe, it, expect } from 'vitest';
import { SHAPES } from './shapes';
import {
  checkNoDebugTokens, checkCoachVoice, checkNoDistanceInflation,
  checkTripleMultipliesOut, checkZoneShares, checkZoneTableTiles,
  checkElevationReading,
} from './invariants';
import { reconcileRun, reconcileHrZones, reconcileSplitsTotal } from '@/lib/runs/coherence';
import { runFacts } from '@/lib/runs/run-facts';
import { deriveRecap, type RecapInput } from '@/lib/coach/run-recap';
import { deriveWin } from '@/lib/coach/run-win';
import { pickElevationGain, ELEVATION_TRUST, ELEVATION_MEASURED_FLOOR } from '@/lib/runs/elevation';
import { pickSplits } from '@/lib/runs/splits-pick';
import { computeZones, lthrZones, pctMaxZones, friel7Zones } from '@/lib/training/zones';
import { bucketHrSamplesByZone, zoneSharesFromSplitHr } from '@/lib/coach/hr-zone-bucket';
import { runAvgHr, runMaxHr, type RunData } from '@/lib/runs/run-shape';
import { resolveRunTerrain } from '@/lib/terrain/run-terrain';
import { splitsContradictTotal } from '@/lib/runs/elev-sanity';
import type { WorkoutType } from '@/lib/coach/run-purpose';

/**
 * THE FLOOR. A harness that quietly shrinks stops covering the thing it was
 * built for, so removing a shape has to be a deliberate act that fails here
 * first. Raise it when you add attacks; never lower it to make a run green.
 */
const MIN_SHAPES = 40;

const TYPES: WorkoutType[] = [
  'easy', 'long', 'tempo', 'threshold', 'intervals', 'recovery', 'shakeout',
  'race', 'fartlek', 'progression', 'unplanned',
];

const TRUSTED_MEASURED = Object.entries(ELEVATION_TRUST)
  .filter(([, t]) => t >= ELEVATION_MEASURED_FLOOR)
  .map(([s]) => s);

/**
 * What the recap route and the v5 route both build, from one row.
 *
 * The plan-side fields are held constant and DELIBERATELY OVERSIZED: a
 * 20-mile prescription with a 6-mile marathon-pace finish and a 4-mile work
 * block. That is a real long-run spec, and the point of the harness is to run
 * it against rows that did not deliver it — the abandonment, the row with no
 * distance, the one whose splits describe a different run. A prescription
 * that happens to match its row cannot catch a leg the copy never clamped.
 */
function recapInputFor(data: RunData, type: WorkoutType): RecapInput {
  const c = reconcileRun(data);
  return {
    type,
    phase: 'BUILD',
    plannedMi: 20,
    // Deliberately the route's own `?? 0`: this harness attacks what the
    // routes actually hand the engine, not a tidier version of it.
    actualMi: c.distanceMi ?? 0,
    actualPaceSPerMi: c.paceSecPerMi,
    actualDurationSec: c.elapsedSec,
    actualAvgHr: runAvgHr(data),
    actualMaxHr: runMaxHr(data),
    splits: Array.isArray(data.splits) ? (data.splits as RecapInput['splits']) : undefined,
    // A long run's prescribed finish. Six miles at marathon pace is a real
    // prescription and the row may be a three-mile abandonment.
    ...(type === 'long'
      ? { finishMi: 6, finishPaceSPerMi: 400, finishLabel: 'M' as const }
      : {}),
    // The work block off a watch completion: four one-mile reps. Same trap in
    // the tempo and interval arms — a phase set can carry more distance than
    // the run it decomposes, and nothing used to check.
    workDistanceMi: 4,
    workPaceSPerMi: 420,
    repCount: 4,
    repPaces: [418, 421, 419, 424],
    prescribedRepCount: 5,
    plannedPaceSPerMi: 540,
    plannedHrCap: 150,
  };
}

describe('POST-RUN SIEGE · the catalogue', () => {
  it(`carries at least ${MIN_SHAPES} hostile shapes`, () => {
    expect(SHAPES.length).toBeGreaterThanOrEqual(MIN_SHAPES);
  });

  it('every shape has a unique id and an origin worth reading', () => {
    const ids = SHAPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHAPES) expect(s.origin.length).toBeGreaterThan(15);
  });
});

describe('POST-RUN SIEGE · the reconciler answers its own questions', () => {
  for (const shape of SHAPES) {
    it(`${shape.id} · reconcileRun is internally consistent`, () => {
      const c = reconcileRun(shape.data);
      const bad: string[] = [];

      // Every number it hands out is a number.
      for (const [k, v] of Object.entries(c)) {
        if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${k} is ${v}`);
      }
      // A distance, a clock and a pace are positive or absent. Zero is not a
      // measurement of any of the three.
      for (const k of ['distanceMi', 'elapsedSec', 'movingSec', 'paceSecPerMi', 'speedMph'] as const) {
        const v = c[k];
        if (v != null && !(v > 0)) bad.push(`${k} is ${v}`);
      }
      // A moving clock never exceeds the wall clock it survived beside.
      if (c.movingSec != null && c.elapsedSec != null && c.movingSec > c.elapsedSec) {
        bad.push(`movingSec ${c.movingSec} exceeds elapsedSec ${c.elapsedSec}`);
      }
      // Pace and speed are two spellings of one quantity.
      if (c.paceSecPerMi != null && c.speedMph != null) {
        if (Math.abs(3600 / c.paceSecPerMi - c.speedMph) > 0.01) {
          bad.push(`pace ${c.paceSecPerMi} and speed ${c.speedMph} disagree`);
        }
      }
      // A pace has a basis, and a basis has a pace.
      if ((c.paceSecPerMi == null) !== (c.paceBasis == null)) {
        bad.push(`pace ${c.paceSecPerMi} with basis ${c.paceBasis}`);
      }
      // The pace is the clock its basis names, divided by the distance.
      if (c.paceSecPerMi != null && c.distanceMi != null) {
        const clock = c.paceBasis === 'moving' ? c.movingSec : c.elapsedSec;
        if (clock != null && Math.abs(c.paceSecPerMi * c.distanceMi - clock) > 1) {
          bad.push(`pace ${c.paceSecPerMi} is not ${clock}s over ${c.distanceMi} mi`);
        }
      }
      // A refusal names a real field and gives a reason.
      for (const r of c.refusals) {
        if (!r.family || !r.field || !r.detail) bad.push(`bare refusal ${JSON.stringify(r)}`);
      }
      bad.push(...checkZoneShares(c.hrZonePcts));

      expect(bad, `${shape.id} (${shape.origin})`).toEqual([]);
    });
  }
});

describe('POST-RUN SIEGE · the coherent triple', () => {
  for (const shape of SHAPES) {
    for (const basis of ['moving', 'elapsed'] as const) {
      it(`${shape.id} · runFacts(${basis}) multiplies out`, () => {
        const f = runFacts(shape.data, { basis });
        const bad = checkTripleMultipliesOut(f);
        // The basis reported is one the row actually has.
        if (f.basis === 'none' && f.timeSec != null) bad.push('basis "none" beside a clock');
        if (f.basis !== 'none' && f.timeSec == null) bad.push(`basis "${f.basis}" with no clock`);
        expect(bad, `${shape.id} (${shape.origin})`).toEqual([]);
      });
    }
  }
});

describe('POST-RUN SIEGE · the sentence the runner reads', () => {
  for (const shape of SHAPES) {
    for (const type of TYPES) {
      it(`${shape.id} · ${type} recap is true or silent`, () => {
        const input = recapInputFor(shape.data, type);
        const recap = deriveRecap(input);
        const lines = [recap.verdict, ...recap.facts,
          recap.coach_tip ?? '', recap.conditions_note ?? ''].filter(Boolean);

        const c = reconcileRun(shape.data);
        const bad = [
          ...checkNoDebugTokens(lines),
          ...checkCoachVoice(lines),
          ...checkNoDistanceInflation(lines, c.distanceMi),
        ];
        expect(bad, `${shape.id} (${shape.origin})`).toEqual([]);
      });
    }
  }
});

describe('POST-RUN SIEGE · the win line', () => {
  for (const shape of SHAPES) {
    for (const type of TYPES) {
      it(`${shape.id} · ${type} win line is true or absent`, () => {
        const input = recapInputFor(shape.data, type);
        const recap = deriveRecap(input);
        const win = deriveWin({
          type, phase: 'BUILD', plannedMi: 20,
          plannedPaceSPerMi: input.plannedPaceSPerMi ?? null,
          plannedHrCap: input.plannedHrCap ?? null,
          actualMi: input.actualMi,
          actualPaceSPerMi: input.actualPaceSPerMi,
          actualAvgHr: input.actualAvgHr,
          splits: input.splits,
          verdict: recap.verdict,
          indoor: shape.data.indoor === true,
          source: typeof shape.data.source === 'string' ? shape.data.source : undefined,
        });
        if (win == null) return; // Rule three · a refusal is a correct answer.
        const c = reconcileRun(shape.data);
        const bad = [
          ...checkNoDebugTokens([win]),
          ...checkCoachVoice([win]),
          ...checkNoDistanceInflation([win], c.distanceMi),
        ];
        // A run with no distance did not bank anything, execute anything, or
        // deliver anything. Rule three: say nothing rather than say that.
        if (c.distanceMi == null && /\b(banked|executed|delivered|earned|clean session)\b/i.test(win)) {
          bad.push(`claimed "${win}" on a row carrying no distance`);
        }
        expect(bad, `${shape.id} (${shape.origin})`).toEqual([]);
      });
    }
  }
});

describe('POST-RUN SIEGE · zone shares and the bands they are drawn against', () => {
  for (const shape of SHAPES) {
    it(`${shape.id} · a stored distribution either adds to 100 or is refused`, () => {
      expect(checkZoneShares(reconcileHrZones(shape.data)), shape.id).toEqual([]);
    });
  }

  for (const lthr of [105, 120, 140, 150, 162, 175, 190, 205]) {
    it(`LTHR ${lthr} · every beat belongs to exactly one band`, () => {
      expect(checkZoneTableTiles(lthrZones(lthr))).toEqual([]);
      expect(checkZoneTableTiles(friel7Zones(lthr))).toEqual([]);
      expect(checkZoneTableTiles(computeZones({ lthr })!)).toEqual([]);
    });
  }

  for (const maxHr of [145, 170, 188, 205, 225]) {
    it(`HRmax ${maxHr} · every beat inside the table belongs to exactly one band`, () => {
      expect(checkZoneTableTiles(pctMaxZones(maxHr))).toEqual([]);
    });
  }

  it('a heart rate that used to fall in a gap now lands in the band the legend shows', () => {
    const t = computeZones({ lthr: 162 })!;
    // 145, 153 and 161 matched no band before the tiling fix. 138 matched two.
    for (const bpm of [138, 145, 153, 161]) {
      const owners = t.zones.filter((z) => bpm >= z.lower && bpm <= z.upper);
      expect(owners.length, `${bpm} bpm at LTHR 162`).toBe(1);
      const share = bucketHrSamplesByZone([{ hrSamples: [{ bpm }] }], t)!;
      const charted = [share.z1, share.z2, share.z3, share.z4, share.z5].findIndex((v) => v === 100) + 1;
      // The bar and the legend on the same screen name the same zone.
      expect(charted, `${bpm} bpm charted vs the band it is shown in`).toBe(owners[0].idx);
    }
  });

  it('one average heart rate does not become a distribution', () => {
    /* ZONES-SUM-2 · the run-detail chart used to end "no per-mile HR, so
     * assign 100% to the band the average falls in". That is a bar chart of
     * where a heart spent an hour, drawn from the one number left after that
     * information was discarded — and it summed to 100, so every guard
     * downstream waved it through. 16 of 149 canonical runs. */
    const t = computeZones({ lthr: 162 })!;
    for (const avg of [110, 130, 145, 150, 165, 180]) {
      expect(zoneSharesFromSplitHr([], t), `avg ${avg} bpm with no per-mile HR`).toBeNull();
    }
    // A split array that carries no readable heart rate is the same absence.
    expect(zoneSharesFromSplitHr([{ hr: null }, { hr: 0 }, { hr: 4 }], t)).toBeNull();
    // A run with real per-mile heart rates still gets its chart.
    const real = zoneSharesFromSplitHr([{ hr: 130 }, { hr: 148 }, { hr: 158 }, { hr: 166 }], t);
    expect(checkZoneShares(real)).toEqual([]);
    expect(real).not.toBeNull();
    // And the two bucketers agree about which band a beat is in.
    for (const bpm of [120, 138, 145, 150, 153, 161, 170]) {
      const fromSplit = zoneSharesFromSplitHr([{ hr: bpm }], t)!;
      const fromSample = bucketHrSamplesByZone([{ hrSamples: [{ bpm }] }], t)!;
      expect(fromSplit, `${bpm} bpm bucketed two ways`).toEqual(fromSample);
    }
  });

  it('a bucketer with nothing to count refuses rather than drawing five zeros', () => {
    const t = computeZones({ lthr: 162 })!;
    expect(bucketHrSamplesByZone([], t)).toBeNull();
    expect(bucketHrSamplesByZone([{ hrSamples: [{ bpm: 0 }] }], t)).toBeNull();
    // 250 bpm is outside the readable range and is dropped, so nothing is left
    // to distribute and the answer is a refusal rather than a chart of one beat.
    expect(bucketHrSamplesByZone([{ hrSamples: [{ bpm: 250 }] }], t)).toBeNull();
    expect(bucketHrSamplesByZone([{ hrSamples: [{ bpm: 140 }] }], null)).toBeNull();
  });
});

describe('POST-RUN SIEGE · terrain, which moves a pace verdict', () => {
  for (const shape of SHAPES) {
    it(`${shape.id} · the climb never forgives a pace it cannot justify`, () => {
      const t = resolveRunTerrain(shape.data as Parameters<typeof resolveRunTerrain>[0]);
      const bad: string[] = [];
      if (!Number.isFinite(t.factor) || t.factor <= 0) bad.push(`factor ${t.factor}`);
      if (!Number.isFinite(t.deltaSPerMi)) bad.push(`deltaSPerMi ${t.deltaSPerMi}`);
      // An unmaterial adjustment is exactly a no-op, never a small nudge.
      if (!t.material && t.factor !== 1) bad.push(`immaterial but factor ${t.factor}`);
      // A treadmill has no terrain, whatever elevation the row carries.
      if (shape.data.indoor === true || shape.data.source === 'treadmill') {
        if (t.surface !== 'treadmill') bad.push(`belt run read as ${t.surface}`);
        if (t.gainFt != null) bad.push(`belt run carried ${t.gainFt} ft of climb`);
      }
      if (t.note) bad.push(...checkCoachVoice([t.note]));
      expect(bad, `${shape.id} (${shape.origin})`).toEqual([]);
    });
  }

  it('a split sum larger than the row\'s own total climb is refused, not believed', () => {
    /* A split is a NET delta over its mile, so the sum of per-mile positives
     * can only ever UNDER-count a run's gain: a mile that climbs 100 ft and
     * gives it back contributes 0 here and 100 to the true total. Over-counting
     * is impossible, and three canonical rows do it — 554 ft of splits against
     * a stored 174, 589 against 217, 2224 against 1238.
     *
     * It reached the runner because `deriveRecap` judges pace against target
     * THROUGH this factor: an invented climb forgives a tempo that was off and
     * prints "this was a harder effort than the pace shows". */
    const row = {
      source: 'watch', distanceMi: 8.15, durationSec: 8.15 * 480,
      elevGainFt: 174,
      splits: Array.from({ length: 8 }, (_, i) => ({ mile: i + 1, elev_ft: 70 })),
    };
    const t = resolveRunTerrain(row);
    expect(t.material).toBe(false);
    expect(t.factor).toBe(1);
    expect(t.note).toContain('did not add up');

    // The honest version of the same run keeps its adjustment.
    const ok = resolveRunTerrain({ ...row, elevGainFt: 620 });
    expect(ok.material).toBe(true);
    expect(ok.factor).toBeGreaterThan(1);

    // And a row with no stored total to contradict is not punished for it.
    const noTotal = resolveRunTerrain({ ...row, elevGainFt: null });
    expect(noTotal.material).toBe(true);
  });

  it('splitsContradictTotal only fires in the impossible direction', () => {
    expect(splitsContradictTotal(554, 174)).toBe(true);
    expect(splitsContradictTotal(2224, 1238)).toBe(true);
    // Under-counting is the normal case and must never fire.
    expect(splitsContradictTotal(174, 554)).toBe(false);
    expect(splitsContradictTotal(600, 620)).toBe(false);
    // Rounding slack, so a short run's independent roundings do not trip it.
    expect(splitsContradictTotal(105, 100)).toBe(false);
    // Nothing to compare against is not a contradiction.
    expect(splitsContradictTotal(500, 0)).toBe(false);
    expect(splitsContradictTotal(0, 500)).toBe(false);
  });
});

describe('POST-RUN SIEGE · the pickers a merged run needs', () => {
  for (const shape of SHAPES) {
    it(`${shape.id} · the climb figure is honest about its instrument`, () => {
      const reading = pickElevationGain([
        { ft: shape.data.elevGainFt ?? null, source: shape.data.elevGainSource ?? null },
      ]);
      expect(checkElevationReading(reading, TRUSTED_MEASURED), shape.id).toEqual([]);
    });

    it(`${shape.id} · the split array picked is the one that decomposes the run`, () => {
      const c = reconcileRun(shape.data);
      const own = Array.isArray(shape.data.splits) ? (shape.data.splits as never[]) : null;
      // A merged run offers its own array and an absorbed twin's.
      const twin = own && own.length > 0
        ? Array.from({ length: Math.max(1, Math.round(c.distanceMi ?? 1)) },
            (_, i) => ({ mile: i + 1, distanceMi: 1, hr: 140 }))
        : null;
      const choice = pickSplits(c.distanceMi, [
        { splits: own, source: 'canonical' },
        { splits: twin, source: 'apple_watch' },
      ]);
      if (choice == null) return;
      const bad: string[] = [];
      if (!Number.isFinite(choice.coverageMi) || choice.coverageMi <= 0) {
        bad.push(`coverage ${choice.coverageMi}`);
      }
      // `coversRun` may not be true when the totals disagree.
      if (choice.coversRun && c.distanceMi != null
          && Math.abs(choice.coverageMi - c.distanceMi) > 0.25) {
        bad.push(`coversRun on ${choice.coverageMi} mi of a ${c.distanceMi} mi run`);
      }
      // It never blends two observations into miles nothing recorded.
      const fromOne = choice.splits === own || choice.splits === twin;
      if (!fromOne) bad.push('the chosen array is neither candidate · arrays were merged');
      expect(bad, shape.id).toEqual([]);
    });

    it(`${shape.id} · splitsCoverRun agrees with the totals`, () => {
      const c = reconcileRun(shape.data);
      const covers = reconcileSplitsTotal(shape.data, c.distanceMi);
      if (covers !== true) return;
      const total = (shape.data.splits as Array<Record<string, number>> ?? [])
        .reduce((s, x) => s + (Number(x?.distanceMi) || 0), 0);
      if (total > 0 && c.distanceMi != null) {
        expect(Math.abs(total - c.distanceMi), shape.id).toBeLessThanOrEqual(0.25);
      }
    });
  }
});
