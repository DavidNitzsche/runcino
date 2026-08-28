/**
 * 2026-08-28 · biometrics pipeline unit tests.
 *
 * Pins the four pure pieces of the athlete-biometrics fix:
 *
 *   1. The observed-HRmax plausibility ceiling (max-hr.ts) — a PRODUCT
 *      HEURISTIC (BuildResearch/C7-ancillary.md "Fitness baselines" table),
 *      not doctrine: reject readings above (220 − age + 15), and above
 *      230 bpm regardless of age.
 *   2. The 7-day rolling RHR (Research/15-wearable-data.md "Establishing a
 *      baseline": 7-day rolling working baseline).
 *   3. Zone-anchor precedence (Research/03 §17: LTHR > %HRmax, and the
 *      Tanaka age-predicted estimate as the loudly-labeled last resort —
 *      never 220 − age per Research/REVIEW_NOTES.md).
 *   4. Field-test LTHR capture (Research/03 "Determining LTHR — 30-Minute
 *      Time Trial (Friel)": LTHR = avg HR during final 20 min) including
 *      its refuse-to-guess gates.
 *
 * Null-safety runs through all four: no HR data at all must produce nulls,
 * never a fabricated number.
 */
import { describe, it, expect } from 'vitest';
import {
  isPlausibleMaxHr,
  maxHrPlausibilityCeiling,
  MAX_HR_CEILING_BPM,
  MAX_HR_FLOOR_BPM,
} from './max-hr';
import { rollingRestingHr, RHR_MIN_WINDOW_SAMPLES } from './biometrics-refresh';
import { computeZones, tanakaMaxHr, lthrZones } from './zones';
import {
  lthrFromFieldTestPhases,
  FIELD_TEST_FINAL_WINDOW_SEC,
  FIELD_TEST_MIN_WORK_SEC,
} from './lthr';

// ── 1 · observed-HRmax plausibility ──────────────────────────────────────

describe('maxHrPlausibilityCeiling', () => {
  it('age-aware: 220 − age + 15, never above the flat 230 band', () => {
    expect(maxHrPlausibilityCeiling(40)).toBe(195);
    expect(maxHrPlausibilityCeiling(25)).toBe(210);
    expect(maxHrPlausibilityCeiling(70)).toBe(165);
  });

  it('a very young age cannot push the ceiling past 230', () => {
    // 220 − 10 + 15 = 225 < 230, but age 10 is outside the trusted range →
    // flat band. Age 16 gives 219.
    expect(maxHrPlausibilityCeiling(16)).toBe(219);
  });

  it('null / implausible age degrades to the flat 230 band, never throws', () => {
    expect(maxHrPlausibilityCeiling(null)).toBe(MAX_HR_CEILING_BPM);
    expect(maxHrPlausibilityCeiling(undefined)).toBe(MAX_HR_CEILING_BPM);
    expect(maxHrPlausibilityCeiling(NaN)).toBe(MAX_HR_CEILING_BPM);
    expect(maxHrPlausibilityCeiling(7)).toBe(MAX_HR_CEILING_BPM);
    expect(maxHrPlausibilityCeiling(140)).toBe(MAX_HR_CEILING_BPM);
  });

  it('the observed race max 178 of a 40-year-old passes; a 212 strap artefact does not', () => {
    const ceiling = maxHrPlausibilityCeiling(40);
    expect(178).toBeLessThanOrEqual(ceiling);
    expect(212).toBeGreaterThan(ceiling);
  });
});

describe('isPlausibleMaxHr (flat band belt)', () => {
  it('accepts the band edges and rejects outside', () => {
    expect(isPlausibleMaxHr(MAX_HR_FLOOR_BPM)).toBe(true);
    expect(isPlausibleMaxHr(MAX_HR_CEILING_BPM)).toBe(true);
    expect(isPlausibleMaxHr(MAX_HR_FLOOR_BPM - 1)).toBe(false);
    expect(isPlausibleMaxHr(MAX_HR_CEILING_BPM + 1)).toBe(false);
    expect(isPlausibleMaxHr(null)).toBe(false);
    expect(isPlausibleMaxHr('garbage')).toBe(false);
  });
});

// ── 2 · rolling RHR ──────────────────────────────────────────────────────

describe('rollingRestingHr', () => {
  it('averages a clean 7-day window', () => {
    const r = rollingRestingHr([46, 47, 48, 47, 46, 49, 48]);
    expect(r.bpm).toBe(Math.round((46 + 47 + 48 + 47 + 46 + 49 + 48) / 7));
    expect(r.usedSamples).toBe(7);
  });

  it('drops artefacts before averaging — one 220 bpm reading must not move the baseline', () => {
    const clean = rollingRestingHr([46, 47, 48]);
    const dirty = rollingRestingHr([46, 47, 48, 220]);
    expect(dirty.bpm).toBe(clean.bpm);
    expect(dirty.usedSamples).toBe(3);
  });

  it('drops sub-floor garbage (a 0 or a 12 is a sensor fault, not a heart)', () => {
    const r = rollingRestingHr([0, 12, 47, 48]);
    expect(r.usedSamples).toBe(2);
    expect(r.bpm).toBe(48); // (47+48)/2 = 47.5 → 48
  });

  it('refuses a single-sample "average" and an empty window', () => {
    expect(rollingRestingHr([47]).bpm).toBeNull();
    expect(rollingRestingHr([]).bpm).toBeNull();
    expect(rollingRestingHr([null, undefined, 'x'] as any).bpm).toBeNull();
    expect(RHR_MIN_WINDOW_SAMPLES).toBeGreaterThan(1);
  });
});

// ── 3 · zone-anchor precedence ───────────────────────────────────────────

describe('computeZones precedence · LTHR > measured HRmax > Tanaka age estimate', () => {
  it('LTHR wins even when HRmax and age are both present', () => {
    const t = computeZones({ lthr: 162, maxHr: 188, age: 40 });
    expect(t).not.toBeNull();
    expect(t!.method).toBe('lthr-friel');
    expect(t!.anchor).toEqual({ label: 'LTHR', bpm: 162 });
    // Identical to the pure-LTHR table — HRmax must not perturb the bands.
    expect(t!.zones).toEqual(lthrZones(162).zones);
  });

  it('a null HRmax does not zero out guidance for a runner who HAS an LTHR', () => {
    const t = computeZones({ lthr: 162, maxHr: null, age: null });
    expect(t).not.toBeNull();
    expect(t!.method).toBe('lthr-friel');
  });

  it('measured HRmax beats the age estimate', () => {
    const t = computeZones({ lthr: null, maxHr: 188, age: 40 });
    expect(t).not.toBeNull();
    expect(t!.method).toBe('pct-mhr');
    expect(t!.anchor.bpm).toBe(188);
    expect(t!.anchor.label).toBe('MaxHR');
  });

  it('age-only runner gets Tanaka zones, loudly labeled estimated', () => {
    const t = computeZones({ lthr: null, maxHr: null, age: 40 });
    expect(t).not.toBeNull();
    expect(t!.method).toBe('pct-mhr');
    // Tanaka 208 − 0.7 × 40 = 180 · NOT Fox 220 − 40 = 180... same at 40,
    // so pin a second age where the two formulas diverge.
    expect(t!.anchor.bpm).toBe(180);
    expect(t!.anchor.label).toBe('MaxHR (est)');
    expect(t!.note).toMatch(/estimated from age/);
    expect(t!.note).toMatch(/approximate/);

    const t30 = computeZones({ age: 30 })!;
    expect(t30.anchor.bpm).toBe(187);      // Tanaka: 208 − 21
    expect(t30.anchor.bpm).not.toBe(190);  // Fox 220 − 30 · never this
  });

  it('null-safety: no LTHR, no HRmax, no age → null, never a fabricated table', () => {
    expect(computeZones({})).toBeNull();
    expect(computeZones({ lthr: null, maxHr: null, age: null })).toBeNull();
    expect(computeZones({ age: 12 })).toBeNull();  // under the doc's trust floor
    expect(computeZones({ lthr: 90, maxHr: 120 })).toBeNull(); // both out of band, no age
  });
});

describe('tanakaMaxHr', () => {
  it('208 − 0.7 × age, rounded', () => {
    expect(tanakaMaxHr(20)).toBe(194);
    expect(tanakaMaxHr(40)).toBe(180);
    expect(tanakaMaxHr(55)).toBe(170); // 208 − 38.5 = 169.5 → 170
  });
  it('refuses ages the doc calls unreliable', () => {
    expect(tanakaMaxHr(12)).toBeNull();
    expect(tanakaMaxHr(101)).toBeNull();
    expect(tanakaMaxHr(null)).toBeNull();
    expect(tanakaMaxHr(NaN)).toBeNull();
  });
});

// ── 4 · field-test LTHR capture ──────────────────────────────────────────

/** Build a 30-min work phase with an HR stream at 5s cadence. `hrAt` maps
 *  tSec → bpm so tests can shape the profile of the effort. */
function workPhase(durationSec: number, hrAt: (tSec: number) => number | null) {
  const hrSamples: Array<{ tSec: number; bpm: number | null }> = [];
  for (let t = 0; t <= durationSec; t += 5) hrSamples.push({ tSec: t, bpm: hrAt(t) });
  return { type: 'tempo', label: 'FIELD TEST', actualDurationSec: durationSec, hrSamples };
}
const WARMUP = { type: 'warmup', label: 'WARM UP', actualDurationSec: 600, hrSamples: [{ tSec: 0, bpm: 120 }] };
const COOLDOWN = { type: 'cooldown', label: 'COOL DOWN', actualDurationSec: 600, hrSamples: [{ tSec: 0, bpm: 130 }] };

describe('lthrFromFieldTestPhases', () => {
  it('Friel: LTHR = average HR of the FINAL 20 minutes of the 30-min work segment', () => {
    // First 10 min at 150 (settling in), final 20 min at 164. The first 10
    // minutes must be excluded — averaging the whole 30 would give ~159.
    const r = lthrFromFieldTestPhases([
      WARMUP,
      workPhase(1800, (t) => (t < 600 ? 150 : 164)),
      COOLDOWN,
    ]);
    expect(r).not.toBeNull();
    expect(r!.lthr).toBe(164);
    expect(r!.windowSec).toBe(FIELD_TEST_FINAL_WINDOW_SEC);
  });

  it('picks the longest non-warmup/cooldown phase as the work segment', () => {
    const r = lthrFromFieldTestPhases([
      WARMUP,
      workPhase(1800, () => 162),
      COOLDOWN,
    ]);
    expect(r!.lthr).toBe(162);
  });

  it('refuses a work segment shorter than the protocol floor', () => {
    // 20 minutes of work is not a 30-min TT · the average would sit in VO2
    // territory (the 5K-proxy problem).
    expect(FIELD_TEST_MIN_WORK_SEC).toBe(1500);
    const r = lthrFromFieldTestPhases([WARMUP, workPhase(1200, () => 170), COOLDOWN]);
    expect(r).toBeNull();
  });

  it('refuses a sparse HR stream — three stray beats are not coverage', () => {
    const r = lthrFromFieldTestPhases([
      WARMUP,
      {
        type: 'tempo', label: 'FIELD TEST', actualDurationSec: 1800,
        hrSamples: [{ tSec: 1700, bpm: 160 }, { tSec: 1750, bpm: 161 }, { tSec: 1790, bpm: 162 }],
      },
      COOLDOWN,
    ]);
    expect(r).toBeNull();
  });

  it('drops artefact beats but keeps the window average honest', () => {
    const r = lthrFromFieldTestPhases([
      workPhase(1800, (t) => (t % 300 === 0 ? 250 : 160)), // periodic 250 bpm spikes
    ]);
    expect(r).not.toBeNull();
    expect(r!.lthr).toBe(160); // spikes filtered by the 60-230 sample band
  });

  it('refuses an implausible average (a cadence-locked stream is not a threshold)', () => {
    expect(lthrFromFieldTestPhases([workPhase(1800, () => 220)])).toBeNull();
    expect(lthrFromFieldTestPhases([workPhase(1800, () => 90)])).toBeNull();
  });

  it('null-safety: no phases, empty phases, no HR at all → null', () => {
    expect(lthrFromFieldTestPhases(null)).toBeNull();
    expect(lthrFromFieldTestPhases([])).toBeNull();
    expect(lthrFromFieldTestPhases([WARMUP, COOLDOWN])).toBeNull();
    expect(lthrFromFieldTestPhases([
      { type: 'tempo', label: 'FIELD TEST', actualDurationSec: 1800, hrSamples: [] },
    ])).toBeNull();
  });
});
