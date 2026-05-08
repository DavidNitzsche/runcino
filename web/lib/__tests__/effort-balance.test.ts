import { describe, expect, it } from 'vitest';
import { effortBalance } from '../strava-stats';
import type { NormalizedActivity } from '../strava-activities';

/** Build a synthetic activity for classification tests. Date is
 *  set to today so it always falls in the 14-day window. */
function makeRun(overrides: Partial<NormalizedActivity>): NormalizedActivity {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: 1,
    name: 'Morning run',
    type: 'Run',
    sportType: 'Run',
    workoutType: null,
    startLocal: today + 'T06:00:00Z',
    date: today,
    distanceMi: 5,
    movingTimeS: 2400,
    elapsedTimeS: 2400,
    paceSPerMi: 480,        // 8:00/mi
    avgHr: null,
    maxHr: null,
    avgCadence: null,
    elevGainFt: 0,
    avgSpeedMph: 7.5,
    startLatLng: null,
    endLatLng: null,
    summaryPolyline: null,
    kudosCount: 0,
    achievementCount: 0,
    sufferScore: null,
    canonicalFinishS: null,
    canonicalDistanceMi: null,
    ...overrides,
  } as NormalizedActivity;
}

describe('effortBalance — name-pattern classification', () => {
  it('classifies tempo workouts as hard', () => {
    const r = makeRun({ name: 'Tempo run 6 miles', distanceMi: 6 });
    const b = effortBalance([r], 14);
    expect(b.hardMi).toBe(6);
    expect(b.easyMi).toBe(0);
  });

  it('classifies threshold intervals as hard', () => {
    const r = makeRun({ name: '4 x 1mi threshold', distanceMi: 8 });
    const b = effortBalance([r], 14);
    expect(b.hardMi).toBe(8);
  });

  it('classifies marathon-pace miles as hard', () => {
    const r = makeRun({ name: 'Long run with 8 MP miles', distanceMi: 16 });
    const b = effortBalance([r], 14);
    expect(b.hardMi).toBe(16);
  });

  it('classifies track workouts as hard', () => {
    const r = makeRun({ name: 'Track day - 800s', distanceMi: 7 });
    const b = effortBalance([r], 14);
    expect(b.hardMi).toBe(7);
  });

  it('classifies hill repeats as hard', () => {
    const r = makeRun({ name: '6 x hill repeats', distanceMi: 5 });
    const b = effortBalance([r], 14);
    expect(b.hardMi).toBe(5);
  });

  it('classifies cutdowns as hard', () => {
    const r = makeRun({ name: 'Cutdown run', distanceMi: 6 });
    const b = effortBalance([r], 14);
    expect(b.hardMi).toBe(6);
  });

  it('classifies ladders / pyramids as hard', () => {
    expect(effortBalance([makeRun({ name: 'Pyramid workout', distanceMi: 6 })], 14).hardMi).toBe(6);
    expect(effortBalance([makeRun({ name: 'Ladder 200-400-800-1600', distanceMi: 6 })], 14).hardMi).toBe(6);
  });

  it('classifies recovery runs as easy', () => {
    const r = makeRun({ name: 'Recovery 4mi', distanceMi: 4 });
    expect(effortBalance([r], 14).easyMi).toBe(4);
  });

  it('classifies named easy runs as easy', () => {
    expect(effortBalance([makeRun({ name: 'Easy run', distanceMi: 5 })], 14).easyMi).toBe(5);
    expect(effortBalance([makeRun({ name: 'Shakeout', distanceMi: 3 })], 14).easyMi).toBe(3);
    expect(effortBalance([makeRun({ name: 'Z2 base', distanceMi: 6 })], 14).easyMi).toBe(6);
  });
});

describe('effortBalance — VDOT pace-zone classification', () => {
  // VDOT 47.1 (the AFC user): M pace ≈ 7:42/mi (462 s), E floor ≈ 9:12 (552 s)
  it('classifies a 7:30/mi run as hard with VDOT 47', () => {
    // 7:30/mi = 450 s — faster than M center 462 → hard
    const r = makeRun({ name: 'Morning miles', distanceMi: 6, paceSPerMi: 450, avgHr: null });
    const b = effortBalance([r], 14, 152, 47);
    expect(b.hardMi).toBe(6);
    expect(b.easyMi).toBe(0);
  });

  it('classifies a 9:30/mi run as easy with VDOT 47', () => {
    // 9:30 = 570 s — well past E floor (~552 s) → easy
    const r = makeRun({ name: 'Morning miles', distanceMi: 6, paceSPerMi: 570 });
    const b = effortBalance([r], 14, 152, 47);
    expect(b.easyMi).toBe(6);
  });

  it('classifies a long run with no quality signal as easy', () => {
    const r = makeRun({ name: 'Long run', distanceMi: 18, paceSPerMi: 540 });
    const b = effortBalance([r], 14, 152, 47);
    expect(b.easyMi).toBe(18);
  });
});

describe('effortBalance — unknown bucket', () => {
  it('reports unknown when no name/HR/VDOT signal at moderate pace', () => {
    // Short run, moderate pace, no name signal, no HR, no VDOT
    const r = makeRun({ name: 'Run', distanceMi: 5, paceSPerMi: 510, avgHr: null });
    const b = effortBalance([r], 14, 152, null);
    // 5 mi short run, no signal → unknown
    expect(b.unknownMi).toBe(5);
    expect(b.easyMi + b.hardMi).toBe(0);
  });

  it('easyShare denominator excludes unknown miles', () => {
    const easy = makeRun({ id: 1, name: 'Easy', distanceMi: 8 });
    const unknown = makeRun({ id: 2, name: 'Run', distanceMi: 5, paceSPerMi: 510, avgHr: null });
    const b = effortBalance([easy, unknown], 14, 152, null);
    expect(b.easyMi).toBe(8);
    expect(b.unknownMi).toBe(5);
    // ratio is over classified miles only: 8 / (8+0) = 1.0
    expect(b.easyShare).toBeCloseTo(1.0, 2);
  });

  it('low confidence flag fires when most miles are unclassified', () => {
    const unknown = makeRun({ id: 1, name: 'Run', distanceMi: 5, paceSPerMi: 510, avgHr: null });
    const b = effortBalance([unknown], 14, 152, null);
    expect(b.highConfidence).toBe(false);
  });

  it('high confidence flag fires when classification is name + pace based', () => {
    const tempo = makeRun({ id: 1, name: 'Tempo', distanceMi: 6 });
    const easy = makeRun({ id: 2, name: 'Easy', distanceMi: 10 });
    const b = effortBalance([tempo, easy], 14);
    expect(b.highConfidence).toBe(true);
  });
});

describe('effortBalance — exclusions', () => {
  it('excludes races from the intensity calculation', () => {
    const race = makeRun({ id: 1, name: 'AFC Half Marathon Race', distanceMi: 13.1, paceSPerMi: 437 });
    const easy = makeRun({ id: 2, name: 'Easy', distanceMi: 10 });
    const b = effortBalance([race, easy], 14);
    expect(b.totalMi).toBe(10);
    expect(b.hardMi).toBe(0);
    expect(b.easyMi).toBe(10);
  });
});
