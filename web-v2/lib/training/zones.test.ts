/**
 * 2026-07-06 · P1-43 fix · pins judgeEasyRunHr — the server-side easy-run HR
 * read that replaces the phone panel's hardcoded `let lthrish = 162`.
 *
 * Doctrine: Research/03-heart-rate-zones.md §6 (Friel zones) +
 * Research/06-weather-adjustments.md §1 (heat HR bump).
 *
 * ZONE-BANDS-1 (2026-08-24) · the ceiling moved 144 → 145 at LTHR 162, and
 * that is the fix rather than a side effect. Z2 is "85-89% LTHR" and Z3 is
 * "90-94%", so the band runs up to but not including 90% of LTHR; 145 is
 * 89.5%, inside Z2. The old `round(0.89 × 162)` computed a different thing —
 * where 89% lands, not where the band ends — and landed one beat low, so a
 * run averaging exactly 145 was called gray-zone while the zone bar beside it
 * drew the same beat inside Z2.
 */
import { describe, it, expect } from 'vitest';
import { computeZones, friel7Zones, judgeEasyRunHr, lthrZones, pctMaxZones, zoneIdxForBpm } from './zones';

describe('judgeEasyRunHr', () => {
  it('aerobic · easy run under the Z2 ceiling', () => {
    const j = judgeEasyRunHr({ avgHrBpm: 140, thresholdBpm: 162 });
    expect(j).toEqual({ verdict: 'aerobic', deltaBpm: -22, easyCeilingBpm: 145 });
  });

  it('gray-zone · between Z2 upper and threshold (too hard for an easy day)', () => {
    const j = judgeEasyRunHr({ avgHrBpm: 152, thresholdBpm: 162 });
    expect(j!.verdict).toBe('gray-zone');
    expect(j!.deltaBpm).toBe(-10);
  });

  it('above-threshold · quality effort wearing an easy label', () => {
    const j = judgeEasyRunHr({ avgHrBpm: 165, thresholdBpm: 162 });
    expect(j!.verdict).toBe('above-threshold');
    expect(j!.deltaBpm).toBe(3);
  });

  it('P1-43 archetypes · the same avg HR judges differently per physiology', () => {
    // Young beginner · LTHR 185 · easy at 170: the old panel said "+8 vs
    // threshold" against the constant 162. Against THEIR threshold it is
    // 15 bpm UNDER — Z3/Z4 gray-zone, not an over-threshold alarm.
    const young = judgeEasyRunHr({ avgHrBpm: 170, thresholdBpm: 185 });
    expect(young!.verdict).toBe('gray-zone');
    expect(young!.deltaBpm).toBe(-15);
    // 60-year-old · LTHR 145 · running 155: the constant said "-7, green".
    // Against THEIR threshold it is a hard effort.
    const older = judgeEasyRunHr({ avgHrBpm: 155, thresholdBpm: 145 });
    expect(older!.verdict).toBe('above-threshold');
    expect(older!.deltaBpm).toBe(10);
  });

  it('heat bump shifts the bands up (per-finding context filter)', () => {
    // 148 vs LTHR 162: ceiling 145 → gray-zone on a cool day…
    expect(judgeEasyRunHr({ avgHrBpm: 148, thresholdBpm: 162 })!.verdict).toBe('gray-zone');
    // …but aerobic with a +5 heat bump (thermoregulation, not effort).
    const hot = judgeEasyRunHr({ avgHrBpm: 148, thresholdBpm: 162, heatBumpBpm: 5 });
    expect(hot!.verdict).toBe('aerobic');
    expect(hot!.easyCeilingBpm).toBe(150);
    // The display delta stays anchored on the un-bumped threshold.
    expect(hot!.deltaBpm).toBe(-14);
  });

  it('implausible inputs → null · skip the judgment, never fabricate', () => {
    expect(judgeEasyRunHr({ avgHrBpm: 250, thresholdBpm: 162 })).toBeNull();
    expect(judgeEasyRunHr({ avgHrBpm: 40, thresholdBpm: 162 })).toBeNull();
    expect(judgeEasyRunHr({ avgHrBpm: 140, thresholdBpm: 100 })).toBeNull();
    expect(judgeEasyRunHr({ avgHrBpm: 140, thresholdBpm: 240 })).toBeNull();
  });

  it('ceiling matches the Friel Z2 upper the zone table publishes', () => {
    const z2upper = lthrZones(162).zones.find((z) => z.idx === 2)!.upper;
    expect(judgeEasyRunHr({ avgHrBpm: 140, thresholdBpm: 162 })!.easyCeilingBpm).toBe(z2upper);
  });
});

describe('computeZones bounds (unchanged · guards the resolver gates)', () => {
  it('accepts plausible LTHR, rejects implausible', () => {
    expect(computeZones({ lthr: 162 })!.method).toBe('lthr-friel');
    expect(computeZones({ lthr: 90 })).toBeNull();
    expect(computeZones({ maxHr: 190 })!.method).toBe('pct-mhr');
  });
});

/**
 * ZONE-BANDS-1 (2026-08-24) · the bands themselves.
 *
 * Four faults, one mistake: the old code rounded each band's two percent
 * bounds to bpm independently, so adjacent bands were derived from different
 * arithmetic and stopped meeting. At LTHR 162 that produced
 *
 *   Z1 0..138   Z2 138..144   Z3 146..152   Z4 154..160   Z5 162..178
 *
 * — 145, 153 and 161 in no zone, 138 in two, a zone 1 floored at 0 bpm (which
 * made every running heart rate sit near the top of a 138-wide band, so the
 * route map's ramp put 128 bpm at 0.93 and painted a Z1 mile Z2), and a top
 * capped at 1.10 x LTHR while Friel's 5c is unbounded.
 */
describe('ZONE-BANDS-1 · the bands tile the line', () => {
  const T = lthrZones(162);
  const band = (idx: number) => T.zones.find((z) => z.idx === idx)!;

  it('the exact bands at LTHR 162 · the numbers on the tile', () => {
    expect(T.zones.map((z) => [z.lower, z.upper])).toEqual([
      [null, 137],   // Z1 · open below · Friel says "< 85%", not "0 bpm and up"
      [138, 145],
      [146, 153],
      [154, 161],
      [162, null],   // Z5 · open above · a 182 bpm rep finish is still Z5
    ]);
  });

  it('the three integers that belonged to no zone now belong to one', () => {
    expect(zoneIdxForBpm(145, T)).toBe(2);
    expect(zoneIdxForBpm(153, T)).toBe(3);
    expect(zoneIdxForBpm(161, T)).toBe(4);
  });

  it('138 belonged to two zones · it is Z2, because 85.2% of LTHR is Z2', () => {
    // The old `.find()` returned the first band containing it, which was Z1's
    // ceiling. A whole year of easy runs read one beat of Recovery too many.
    expect(zoneIdxForBpm(138, T)).toBe(2);
    expect(zoneIdxForBpm(137, T)).toBe(1);
  });

  it('a hard rep finish above 1.10 x LTHR is still Z5, not off the table', () => {
    expect(zoneIdxForBpm(179, T)).toBe(5);
    expect(zoneIdxForBpm(182, T)).toBe(5);
    expect(zoneIdxForBpm(205, T)).toBe(5);
    expect(band(5).upper).toBeNull();
  });

  it('zone 1 is open below · no consumer may read a floor of 0 bpm off it', () => {
    expect(band(1).lower).toBeNull();
    expect(zoneIdxForBpm(80, T)).toBe(1);
  });

  it('every integer bpm lands in exactly one band, across every plausible LTHR', () => {
    for (const lthr of [120, 140, 162, 171, 185, 205]) {
      for (const table of [lthrZones(lthr), friel7Zones(lthr), pctMaxZones(lthr + 20)]) {
        for (let bpm = 30; bpm <= 240; bpm++) {
          const hits = table.zones.filter(
            (z) => (z.lower == null || bpm >= z.lower) && (z.upper == null || bpm <= z.upper),
          );
          // pctMaxZones is closed below (the ACSM table states a 50% floor),
          // so readings under it hit nothing and are CLAMPED to zone 1.
          expect(hits.length, `LTHR ${lthr} · ${bpm} bpm · ${table.method}`).toBeLessThanOrEqual(1);
          expect(zoneIdxForBpm(bpm, table), `LTHR ${lthr} · ${bpm} bpm`).not.toBeNull();
        }
        // Contiguity: each band starts one beat above the last.
        for (let i = 0; i + 1 < table.zones.length; i++) {
          expect(table.zones[i].upper! + 1, `${table.method} @ ${lthr} · Z${i + 1}/Z${i + 2}`)
            .toBe(table.zones[i + 1].lower);
        }
      }
    }
  });

  it('the seven-zone table splits Z5 without moving zones 1-4', () => {
    const seven = friel7Zones(162).zones;
    expect(seven.map((z) => [z.lower, z.upper])).toEqual([
      [null, 137], [138, 145], [146, 153], [154, 161],
      [162, 166],  // 5a · 100-102%
      [167, 173],  // 5b · 103-106%
      [174, null], // 5c · "> 106%", unbounded
    ]);
    for (let i = 0; i < 4; i++) {
      expect([seven[i].lower, seven[i].upper]).toEqual([T.zones[i].lower, T.zones[i].upper]);
    }
  });

  it('%HRmax bands stop overlapping too · 114 was in Z1 and Z2 at maxHr 190', () => {
    const p = pctMaxZones(190);
    expect(p.zones.map((z) => [z.lower, z.upper])).toEqual([
      [95, 113], [114, 132], [133, 151], [152, 170], [171, null],
    ]);
    expect(zoneIdxForBpm(114, p)).toBe(2);
    // An effort above an ESTIMATED HRmax is the top zone, not nothing.
    expect(zoneIdxForBpm(196, p)).toBe(5);
    // And below the table's stated 50% floor it clamps rather than refusing.
    expect(zoneIdxForBpm(70, p)).toBe(1);
  });

  it('no table · no zone. A refusal, not a default to Z1', () => {
    expect(zoneIdxForBpm(140, null)).toBeNull();
  });
});
