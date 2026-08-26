/**
 * Unit cover for the gpx_text → course_geometry backfill planner.
 *
 * Pure. No database. The prod dry run lives in
 * `_probe_course_geometry_backfill.test.ts`, which is skipped unless
 * PROBE_COURSE_GEOMETRY is set.
 */
import { describe, it, expect } from 'vitest';
import { geometryFromRaceRow, planGeometryHydration } from './course-geometry-source';
import { parseGPX } from './gpx-parser';

/**
 * A synthetic GPX: `n` points on a straight line, climbing `riseM` per point.
 *
 * The default step is ~18 m, which puts the default fixture comfortably above
 * `assessGeometryConfidence`'s 20-samples-per-mile floor. Widen the step to
 * build a deliberately coarse track.
 */
function gpx(n: number, riseM: number, lonStepDeg = 0.0002): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    pts.push(
      `<trkpt lat="34.0" lon="${(-118 + i * lonStepDeg).toFixed(7)}"><ele>${(100 + i * riseM).toFixed(1)}</ele></trkpt>`,
    );
  }
  return `<?xml version="1.0"?><gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

describe('geometryFromRaceRow', () => {
  it('prefers a populated column over the stored GPX', () => {
    const stored = { trackPoints: [{ lat: 1, lon: 2, ele: 3 }, { lat: 1, lon: 2.1, ele: 4 }] };
    const out = geometryFromRaceRow({ course_geometry: stored, gpx_text: gpx(50, 1) });
    expect(out.origin).toBe('course_geometry');
    expect(out.geometry).toBe(stored);
  });

  it('falls back to gpx_text when the column is empty', () => {
    const out = geometryFromRaceRow({ course_geometry: null, gpx_text: gpx(50, 1) });
    expect(out.origin).toBe('gpx_text');
    expect((out.geometry as { trackPoints: unknown[] }).trackPoints).toHaveLength(50);
  });

  it('treats a one-point column as no column at all', () => {
    const out = geometryFromRaceRow({
      course_geometry: { trackPoints: [{ lat: 1, lon: 2, ele: 3 }] },
      gpx_text: gpx(50, 1),
    });
    expect(out.origin).toBe('gpx_text');
  });

  it('names a parse failure rather than returning an honest-looking nothing', () => {
    const out = geometryFromRaceRow({ course_geometry: null, gpx_text: '<gpx></gpx>' });
    expect(out.origin).toBe('none');
    expect(out.geometry).toBeNull();
    expect(out.parseError).toMatch(/no track points/i);
  });

  it('returns none, with no error, when there is genuinely nothing', () => {
    const out = geometryFromRaceRow({ course_geometry: null, gpx_text: '' });
    expect(out.origin).toBe('none');
    expect(out.parseError).toBeNull();
  });

  it('derives the same blob the upload path would store', () => {
    const xml = gpx(200, 0.5);
    const viaFallback = geometryFromRaceRow({ course_geometry: null, gpx_text: xml }).geometry;
    // parseGPX with no filename is exactly what /api/race/gpx stores, minus the
    // raw_filename it adds. The numbers must be identical either way.
    const viaUpload = parseGPX(xml);
    expect(viaFallback).toEqual(viaUpload);
  });
});

describe('planGeometryHydration', () => {
  const nominalOf = (xml: string) => parseGPX(xml).distance_mi;

  it('plans a write and stamps an existing course_source tier', () => {
    const xml = gpx(600, 0.4);
    const plan = planGeometryHydration({
      slug: 'x', row: { course_geometry: null, gpx_text: xml }, nominalDistanceMi: nominalOf(xml),
    });
    expect(plan.verdict).toBe('write');
    expect(plan.courseSource).toBe('upload');
    expect(plan.points).toBe(600);
    expect(plan.confidence).toBe('high');
    expect(plan.measuredTrusted).toBe(true);
  });

  it('never plans a write over a populated column', () => {
    const plan = planGeometryHydration({
      slug: 'x',
      row: {
        course_geometry: { trackPoints: [{ lat: 1, lon: 2, ele: 3 }, { lat: 1, lon: 2.1, ele: 4 }] },
        gpx_text: gpx(600, 0.4),
      },
      nominalDistanceMi: 13.1,
    });
    expect(plan.verdict).toBe('already_populated');
    expect(plan.courseSource).toBeNull();
  });

  it('refuses a track that is not the course, and says which check failed', () => {
    const xml = gpx(600, 0.4);
    // Declare a marathon; hand it a track a fraction of that length.
    const plan = planGeometryHydration({
      slug: 'x', row: { course_geometry: null, gpx_text: xml }, nominalDistanceMi: 26.2,
    });
    expect(plan.verdict).toBe('refused');
    expect(plan.courseSource).toBeNull();
    expect(plan.reason).toMatch(/short of the course/);
    // A refusal still reports the numbers it refused on.
    expect(plan.points).toBe(600);
    expect(plan.measuredDistanceMi).toBeGreaterThan(0);
  });

  it('reports an unparseable GPX as unparseable, not as a flat course', () => {
    const plan = planGeometryHydration({
      slug: 'x', row: { course_geometry: null, gpx_text: '<gpx><trk/></gpx>' }, nominalDistanceMi: 13.1,
    });
    expect(plan.verdict).toBe('unparseable');
    expect(plan.gainFt).toBeNull();
    expect(plan.netFt).toBeNull();
  });

  it('divides vert-per-10mi by the NOMINAL distance, matching the plan engine', () => {
    const xml = gpx(600, 0.4);
    const measuredMi = nominalOf(xml);
    const nominal = measuredMi * 1.04; // inside the ratio band, but not equal
    const plan = planGeometryHydration({
      slug: 'x', row: { course_geometry: null, gpx_text: xml }, nominalDistanceMi: nominal,
    });
    expect(plan.verdict).toBe('write');
    expect(plan.vertPer10Mi).toBe(Math.round((plan.gainFt! / nominal) * 10));
    expect(plan.vertPer10Mi).not.toBe(Math.round((plan.gainFt! / measuredMi) * 10));
  });

  it('separates the measured value from what consumers will actually read', () => {
    const xml = gpx(600, 0.4);
    const measured = parseGPX(xml);
    const plan = planGeometryHydration({
      slug: 'x',
      row: { course_geometry: null, gpx_text: xml },
      nominalDistanceMi: nominalOf(xml),
      // A curated value far from the track, on a course the track measures well.
      lib: { elevation_gain_ft: 9000, net_elevation_ft: 9000 },
    });
    // A high-confidence track wins, so the two agree and the conflict survives.
    expect(plan.gainFt).toBe(measured.elevation_gain_ft);
    expect(plan.resolvedGainFt).toBe(measured.elevation_gain_ft);
    expect(plan.resolvedProvenance).toBe('measured');
    expect(plan.conflict?.status).toBe('SOURCE_CONFLICT');
  });

  it('says so when the write will not change what anyone reads', () => {
    // A sparse track over a long course: passes the distance band, degrades to
    // low confidence on sampling density, and therefore loses to the curated
    // value. It is still stored — it is the real course line.
    const xml = gpx(60, 6, 0.02);
    const plan = planGeometryHydration({
      slug: 'x',
      row: { course_geometry: null, gpx_text: xml },
      nominalDistanceMi: nominalOf(xml),
      lib: { elevation_gain_ft: 2182, net_elevation_ft: 260 },
    });
    expect(plan.verdict).toBe('write');
    expect(plan.confidence).toBe('low');
    expect(plan.measuredTrusted).toBe(false);
    expect(plan.resolvedProvenance).toBe('editorial');
    expect(plan.resolvedGainFt).toBe(2182);
    expect(plan.reason).toMatch(/Curated course_library value still wins/);
  });
});
