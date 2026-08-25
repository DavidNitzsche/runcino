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
import { bucketHrSamplesByZone } from '@/lib/coach/hr-zone-bucket';
import { runAvgHr, runMaxHr, type RunData } from '@/lib/runs/run-shape';
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

/** What the recap route and the v5 route both build, from one row. */
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
