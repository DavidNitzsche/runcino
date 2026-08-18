/**
 * Course elevation · derivation and precedence.
 *
 * The bug this locks down: `course_library.net_elevation_ft` was hand-typed by
 * migration 130 and never computed from anything. AFC was entered as a flat
 * course (0 net, 210 ft gross) when its own 5790-point GPS track measures
 * −130 net and 722 ft gross. Nothing caught it for months because the read
 * path preferred the typed number over the measured one whenever the library
 * row was labelled `editorial` — so the better data was gated out by a label
 * on the worse data.
 *
 * These tests pin both halves: the arithmetic, and the precedence.
 */
import { describe, it, expect } from 'vitest';
import {
  elevationProfileFt,
  elevationProfileFromGeometry,
  resolveCourseElevation,
  assessGeometryConfidence,
  NOISE_THRESHOLD_M,
  ELEVATION_ALGORITHM_VERSION,
} from './course-elevation';

/**
 * Build a synthetic track along a line of longitude at a given point density,
 * with a supplied elevation series. One degree of latitude is ~69 miles.
 */
function track(eles: number[], opts: { distanceMi?: number } = {}) {
  const distanceMi = opts.distanceMi ?? 13.1;
  const span = distanceMi / 69.0;
  const n = eles.length;
  return {
    trackPoints: eles.map((ele, i) => ({
      lat: 32.7 + (span * i) / Math.max(1, n - 1),
      lon: -117.2,
      ele,
    })),
  };
}
const flatish = (n: number) => Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 7) * 3);

/**
 * An AFC-shaped elevation series: starts at 108.8 m, finishes at 69.2 m
 * (−130 ft net), rolling enough on the way to accumulate real gross climbing.
 */
function afcEles(): number[] {
  const out = [108.8];
  for (let i = 1; i < 600; i++) {
    const drift = 108.8 - (i / 599) * 39.6;
    out.push(drift + Math.sin(i / 11) * 9);
  }
  out[599] = 69.2;
  return out;
}

const FT_PER_M = 3.28084;
/** Metre elevations for a course that climbs 100 m then drops 140 m. */
const rampUpDown = (upM: number, downM: number, step = 5) => {
  const out: number[] = [0];
  for (let e = step; e <= upM; e += step) out.push(e);
  for (let e = upM - step; e >= upM - downM; e -= step) out.push(e);
  return out;
};

describe('elevationProfileFt · the arithmetic', () => {
  it('reads net as finish minus start', () => {
    const p = elevationProfileFt([100, 140, 60, 70])!;
    expect(p.netFt).toBe(Math.round((70 - 100) * FT_PER_M));
  });

  it('holds the identity gain − loss = net', () => {
    // For any continuous route this is algebra, not approximation. It is the
    // reason net can be read off the endpoints and never needs a noise filter.
    const eles = rampUpDown(100, 140);
    const p = elevationProfileFt(eles, 0)!;
    expect(p.gainFt - p.lossFt).toBe(p.netFt);
  });

  it('leaves net unchanged as the noise threshold moves', () => {
    // Gross gain is threshold-sensitive by design; net must not be. A net that
    // drifted with the filter would make course difficulty depend on how
    // jittery the GPS was that day.
    const eles = rampUpDown(100, 140, 1);
    const nets = [0, 0.5, 1.6, 3, 6].map((t) => elevationProfileFt(eles, t)!.netFt);
    expect(new Set(nets).size).toBe(1);
  });

  it('suppresses jitter in gross gain but not in net', () => {
    // A dead-flat course sampled with ±0.5 m sensor noise.
    const noisy = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? 0.5 : -0.5));
    const p = elevationProfileFt(noisy, NOISE_THRESHOLD_M)!;
    expect(p.gainFt).toBe(0);
    expect(p.lossFt).toBe(0);
    expect(Math.abs(p.netFt)).toBeLessThanOrEqual(4);
  });

  it('refuses to invent a profile from too few samples', () => {
    // Returning zeroes here would assert "this course is flat", which is a
    // claim no single point supports.
    expect(elevationProfileFt([])).toBeNull();
    expect(elevationProfileFt([42])).toBeNull();
  });

  it('reads a net drop as negative', () => {
    const p = elevationProfileFt([108.8, 90, 69.2])!;
    expect(p.netFt).toBeLessThan(0);
    expect(p.netFt).toBe(-130); // the real AFC endpoints, in metres
  });
});

describe('elevationProfileFromGeometry · stored blobs', () => {
  it('measures a stored track', () => {
    const geom = { trackPoints: [{ ele: 108.8 }, { ele: 80 }, { ele: 69.2 }] };
    expect(elevationProfileFromGeometry(geom)!.netFt).toBe(-130);
  });

  it('returns null for an editorial blob with no track', () => {
    // course_library editorial rows carry curated phases and an EMPTY
    // trackPoints array. Reading that as a flat course is exactly the failure
    // mode this module exists to prevent.
    expect(elevationProfileFromGeometry({ trackPoints: [] })).toBeNull();
    expect(elevationProfileFromGeometry({})).toBeNull();
    expect(elevationProfileFromGeometry(null)).toBeNull();
  });

  it('ignores points with no elevation', () => {
    expect(elevationProfileFromGeometry({ trackPoints: [{ lat: 1 }, { lat: 2 }] })).toBeNull();
  });
});

describe('resolveCourseElevation · precedence', () => {
  // The AFC row exactly as production holds it.
  const afcLib = { elevation_gain_ft: 210, net_elevation_ft: 0 };
  const afcTrack = track(afcEles());
  const afcArgs = { lib: afcLib, geometry: afcTrack, nominalDistanceMi: 13.1 };

  it('a trustworthy measurement beats the typed scalars', () => {
    const r = resolveCourseElevation(afcArgs);
    expect(r.provenance).toBe('measured');
    expect(r.netElevationFt).toBe(-130);
    expect(r.netElevationFt).not.toBe(0);
  });

  it('THE REGRESSION · an editorial label no longer shields a wrong number', () => {
    // Before the fix the read path gated the geometry fallback on
    // `source === 'stub'`, so AFC's editorial label made the typed 0 win.
    // Note what the fix is NOT: geometry does not win because it is geometry,
    // it wins because this trace clears the confidence bar. See the rejected
    // and low-confidence cases below for the other half of the doctrine.
    const r = resolveCourseElevation(afcArgs);
    expect(r.netElevationFt).toBe(-130);
    expect(r.elevationGainFt).toBeGreaterThan(afcLib.elevation_gain_ft);
    expect(r.confidence).toBe('high');
  });

  it('falls back to typed scalars when there is no track', () => {
    // Most course_library rows are stubs with no geometry — the typed values
    // are all we have and they must still be used.
    const r = resolveCourseElevation({ lib: { elevation_gain_ft: 2182, net_elevation_ft: -346 }, geometry: null });
    expect(r.provenance).toBe('editorial');
    expect(r.elevationGainFt).toBe(2182);
    expect(r.netElevationFt).toBe(-346);
    expect(r.lossFt).toBe(2528); // gain − net
  });

  it('reports unknown rather than guessing zero', () => {
    // A stub with nothing known must not read as flat: downstream, 0 net is a
    // positive claim that the course does not descend.
    const r = resolveCourseElevation({ lib: null, geometry: null });
    expect(r.provenance).toBe('unknown');
    expect(r.netElevationFt).toBeNull();
    expect(r.elevationGainFt).toBeNull();
  });

  it('never derives a negative gross loss from a malformed row', () => {
    const r = resolveCourseElevation({ lib: { elevation_gain_ft: 100, net_elevation_ft: 500 }, geometry: null });
    expect(r.lossFt).toBe(0);
  });

  it('tolerates the numeric-as-text shape pg returns', () => {
    const r = resolveCourseElevation({
      lib: { elevation_gain_ft: '2182' as unknown as number, net_elevation_ft: '-346' as unknown as number },
      geometry: null,
    });
    expect(r.elevationGainFt).toBe(2182);
    expect(r.netElevationFt).toBe(-346);
  });
});

// ── Geometry confidence · the doctrine's "trusted" qualifier ─────────────

describe('assessGeometryConfidence · a trace must earn authority', () => {
  it('accepts a dense track that matches the nominal distance', () => {
    const a = assessGeometryConfidence(track(flatish(600)), { nominalDistanceMi: 13.1 });
    expect(a.confidence).toBe('high');
    expect(a.distanceRatio).toBeGreaterThan(0.95);
  });

  it('REJECTS a track well short of the course', () => {
    // The runner stopped their watch early, or lost signal for miles. This is
    // not the course and must never redefine it.
    const a = assessGeometryConfidence(track(flatish(600), { distanceMi: 11.8 }), { nominalDistanceMi: 13.1 });
    expect(a.confidence).toBe('reject');
    expect(a.reasons.join(' ')).toMatch(/short of the course/);
  });

  it('REJECTS a track much longer than the course', () => {
    const a = assessGeometryConfidence(track(flatish(600), { distanceMi: 16 }), { nominalDistanceMi: 13.1 });
    expect(a.confidence).toBe('reject');
  });

  it('REJECTS impossible altitude spikes', () => {
    const eles = flatish(600);
    eles[300] = 900; // barometric glitch
    const a = assessGeometryConfidence(track(eles), { nominalDistanceMi: 13.1 });
    expect(a.confidence).toBe('reject');
    expect(a.reasons.join(' ')).toMatch(/corrupt altitude/);
  });

  it('downgrades a sparse track to low', () => {
    const a = assessGeometryConfidence(track(flatish(30)), { nominalDistanceMi: 13.1 });
    expect(a.confidence).toBe('low');
    expect(a.reasons.join(' ')).toMatch(/samples per mile/);
  });

  it('caps at medium when there is no nominal distance to check against', () => {
    const a = assessGeometryConfidence(track(flatish(600)), {});
    expect(a.confidence).toBe('medium');
  });

  it('treats a track with no coordinates as low, not authoritative', () => {
    const a = assessGeometryConfidence({ trackPoints: flatish(600).map((ele) => ({ ele })) }, { nominalDistanceMi: 13.1 });
    expect(a.confidence).toBe('low');
  });

  it('rejects a track with no elevation at all', () => {
    expect(assessGeometryConfidence(track([]).trackPoints.length ? { trackPoints: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] } : null).confidence).toBe('reject');
  });
});

describe('resolveCourseElevation · trust, not record type', () => {
  const curated = { elevation_gain_ft: 210, net_elevation_ft: 0 };

  it('a high-confidence trace overrides curated values', () => {
    const r = resolveCourseElevation({
      lib: curated,
      geometry: track(flatish(600)),
      nominalDistanceMi: 13.1,
    });
    expect(r.provenance).toBe('measured');
    expect(r.confidence).toBe('high');
  });

  it('THE DOCTRINE FIX · a rejected trace never overrides curated values', () => {
    // The old rule was "two elevation points and geometry wins". A watch trace
    // that covers 90% of the course would have silently redefined it.
    const r = resolveCourseElevation({
      lib: { elevation_gain_ft: 2182, net_elevation_ft: -346 },
      geometry: track(flatish(600), { distanceMi: 11.8 }),
      nominalDistanceMi: 13.1,
    });
    expect(r.provenance).toBe('editorial');
    expect(r.elevationGainFt).toBe(2182);
  });

  it('a low-confidence trace loses to curated data but beats nothing', () => {
    const sparse = track(flatish(30));
    const withLib = resolveCourseElevation({ lib: curated, geometry: sparse, nominalDistanceMi: 13.1 });
    expect(withLib.provenance).toBe('editorial');

    const noLib = resolveCourseElevation({ lib: null, geometry: sparse, nominalDistanceMi: 13.1 });
    expect(noLib.provenance).toBe('measured');
    expect(noLib.confidence).toBe('low');
  });

  it('records the conflict even though one source won', () => {
    // Resolving a value must not erase the fact that the sources disagreed.
    const eles = [108.8];
    for (let i = 0; i < 300; i++) eles.push(108.8 - (i / 300) * 39.6 + Math.sin(i / 3) * 8);
    eles.push(69.2);
    const r = resolveCourseElevation({
      lib: curated, geometry: track(eles), nominalDistanceMi: 13.1,
    });
    expect(r.provenance).toBe('measured');
    expect(r.conflict).not.toBeNull();
    expect(r.conflict!.status).toBe('SOURCE_CONFLICT');
    expect(r.conflict!.curatedNetFt).toBe(0);
    expect(r.conflict!.measuredNetFt).toBe(-130);
    expect(r.conflict!.detail).toMatch(/net/);
  });

  it('reports no conflict when the sources agree', () => {
    const r = resolveCourseElevation({
      lib: { elevation_gain_ft: 0, net_elevation_ft: 0 },
      geometry: track(Array.from({ length: 600 }, () => 100)),
      nominalDistanceMi: 13.1,
    });
    expect(r.conflict).toBeNull();
  });

  it('carries an algorithm version for future recalibration', () => {
    const r = resolveCourseElevation({ lib: curated, geometry: null });
    expect(r.algorithmVersion).toBe(ELEVATION_ALGORITHM_VERSION);
  });

  it('honours a low editorial confidence for a value known to be contested', () => {
    // Big Sur: stored +260, published profile and the runner's watch say −346.
    const r = resolveCourseElevation({
      lib: { elevation_gain_ft: 2182, net_elevation_ft: 260 },
      geometry: null,
      editorialConfidence: 'low',
    });
    expect(r.provenance).toBe('editorial');
    expect(r.confidence).toBe('low');
  });
});
