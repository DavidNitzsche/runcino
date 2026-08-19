/**
 * lifespan.test.ts · the retirement-mileage resolver.
 *
 * The doctrine gate (CONVENTION.shoe-retirement-default) already checks the
 * BANDS against Research/17 at run time, and that each default sits inside its
 * band. This file checks the behaviour around them — the parts that let five
 * different hardcoded defaults exist in the first place, and the edge cases
 * that would put a wrong number on a bar.
 */
import { describe, it, expect } from 'vitest';
import {
  SHOE_LIFESPAN,
  SHOE_TYPES,
  DEFAULT_SHOE_TYPE,
  coerceShoeType,
  defaultCapMi,
  isShoeType,
  resolveShoeCapMi,
  shoePctUsed,
} from './lifespan';

describe('shoe lifespan · categories', () => {
  it('bands every category with a low end at or below the high end', () => {
    for (const t of SHOE_TYPES) {
      const s = SHOE_LIFESPAN[t];
      expect(s.lowMi, `${t} low`).toBeGreaterThan(0);
      expect(s.lowMi, `${t} band`).toBeLessThanOrEqual(s.highMi);
    }
  });

  it('keeps every default inside its own doctrine band', () => {
    // The convention may pick a point inside doctrine, never outside it.
    for (const t of SHOE_TYPES) {
      const s = SHOE_LIFESPAN[t];
      expect(s.defaultMi, `${t} default below band`).toBeGreaterThanOrEqual(s.lowMi);
      expect(s.defaultMi, `${t} default above band`).toBeLessThanOrEqual(s.highMi);
    }
  });

  it('holds the two owner-confirmed anchors', () => {
    for (const t of ['daily_trainer', 'max_cushion', 'stability', 'trail'] as const) {
      expect(defaultCapMi(t), t).toBe(400);
    }
    for (const t of ['super_shoe', 'racing_flat'] as const) {
      expect(defaultCapMi(t), t).toBe(250);
    }
  });

  it('never retires a race-day shoe at the bottom of its band', () => {
    // 150 mi is below what the evidence supports and leaves a third of the
    // shoe unused. This is the regression the owner caught.
    expect(defaultCapMi('super_shoe')).toBeGreaterThan(SHOE_LIFESPAN.super_shoe.lowMi);
  });

  it('separates a super shoe from a daily trainer', () => {
    // The failure this whole module exists to stop: one number for every shoe.
    expect(defaultCapMi('daily_trainer')).toBeGreaterThan(defaultCapMi('super_shoe'));
  });
});

describe('shoe lifespan · coercion', () => {
  it('accepts every known category and nothing else', () => {
    for (const t of SHOE_TYPES) expect(isShoeType(t)).toBe(true);
    for (const bad of ['', 'trainer', 'Daily trainer', 'SUPER_SHOE', null, undefined, 400, {}]) {
      expect(isShoeType(bad)).toBe(false);
    }
  });

  it('falls back to the daily trainer for anything unrecognised', () => {
    expect(coerceShoeType(null)).toBe(DEFAULT_SHOE_TYPE);
    expect(coerceShoeType(undefined)).toBe(DEFAULT_SHOE_TYPE);
    expect(coerceShoeType('nonsense')).toBe(DEFAULT_SHOE_TYPE);
    expect(DEFAULT_SHOE_TYPE).toBe('daily_trainer');
  });

  it('does not inherit from Object.prototype', () => {
    // `hasOwnProperty` rather than `in` — otherwise 'constructor' and
    // 'toString' would read as valid categories.
    expect(isShoeType('constructor')).toBe(false);
    expect(isShoeType('toString')).toBe(false);
  });
});

describe('resolveShoeCapMi', () => {
  it("uses the category's default when no cap is set", () => {
    expect(resolveShoeCapMi('super_shoe', null)).toBe(250);
    expect(resolveShoeCapMi('track_spike', undefined)).toBe(SHOE_LIFESPAN.track_spike.defaultMi);
  });

  it("lets the runner's own cap win", () => {
    expect(resolveShoeCapMi('super_shoe', 275)).toBe(275);
    // Postgres NUMERIC comes back from node-pg as a string. Every read path
    // hands this function that string directly.
    expect(resolveShoeCapMi('daily_trainer', '300')).toBe(300);
  });

  it('treats a non-positive or unparseable cap as unset', () => {
    // A "0 mi" typo would otherwise make percent-used infinite.
    for (const bad of [0, -50, '', 'abc', NaN]) {
      expect(resolveShoeCapMi('racing_flat', bad as any)).toBe(SHOE_LIFESPAN.racing_flat.defaultMi);
    }
  });

  it('answers for an untyped shoe exactly as the old hardcoded 400 did', () => {
    // Every row predating migration 151 has shoe_type NULL. This is the
    // guarantee that no existing progress bar moved.
    expect(resolveShoeCapMi(null, null)).toBe(400);
  });
});

describe('shoePctUsed', () => {
  it('reads percent against the resolved target', () => {
    expect(shoePctUsed(125, 'super_shoe', null)).toBe(50); // 125 / 250
    expect(shoePctUsed(200, 'daily_trainer', null)).toBe(50); // 200 / 400
  });

  it('does not clamp at 100', () => {
    // A shoe 40% past retirement must not look like one that just arrived.
    expect(shoePctUsed(350, 'super_shoe', null)).toBe(140); // 350 / 250
  });

  it('is 0 for a shoe with no miles', () => {
    expect(shoePctUsed(0, 'trail', null)).toBe(0);
  });
});
