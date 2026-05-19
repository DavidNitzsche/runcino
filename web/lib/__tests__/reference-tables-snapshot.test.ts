/**
 * Reference-tables snapshot tests — Rule 10 enforcement.
 *
 * Per the adaptive-pattern philosophy:
 *   "Memory is not a source. Self-debate is not verification.
 *    Single cited source, user spot-check, snapshot test."
 *
 * Every canonical reference table in coach/doctrine/ MUST have at
 * least one assertion in this file pinning specific known values
 * from its cited source. If a future edit changes a value (even
 * unintentionally), the snapshot test fails immediately rather than
 * silently producing wrong recommendations.
 *
 * THIS FILE IS THE SAFETY NET for canonical reference data. Add
 * pinning assertions whenever a new doctrine table or formula is
 * authored. Removal of any pin requires the same scrutiny as a
 * schema migration — these are the points where bad data leaks in.
 *
 * CITATION REQUIREMENT: every assertion below must include a code
 * comment naming the exact source the value was verified against
 * (book + edition + page, or URL with date checked).
 */

import { describe, it, expect } from 'vitest';
import { VDOT_LOOKUP_TABLE } from '../../coach/doctrine/pace_zones';

describe('VDOT_LOOKUP_TABLE · pinned race-time values', () => {
  // Source: Daniels' Running Formula, 3rd edition (Human Kinetics,
  // 2013), Appendix table of equivalent race performances by VDOT.
  // Reproduced in coach/doctrine/pace_zones.ts header comments.
  //
  // The values below are sampled from Daniels' published table to
  // pin the table against future edits. If any of these assertions
  // fail, the table has been edited away from the cited source —
  // investigate before shipping.

  function row(vdot: number) {
    const r = VDOT_LOOKUP_TABLE.value.find((x) => x.vdot === vdot);
    if (!r) throw new Error(`VDOT row ${vdot} missing from table`);
    return r;
  }

  // VDOT 30 — beginner tier. Daniels published values:
  //   5K = 30:40 (1840s), 10K = 1:03:46 (3826s), HM = 2:21:04 (8464s),
  //   Marathon = 4:49:17 (17357s), Mile = 8:30 (510s)
  it('VDOT 30 row matches Daniels 3rd ed', () => {
    const r = row(30);
    expect(r.mileS).toBe(510);
    expect(r.km5S).toBe(1840);
    expect(r.km10S).toBe(3826);
    expect(r.halfS).toBe(8464);
    expect(r.marathonS).toBe(17357);
  });

  // VDOT 40 — competitive recreational tier. Daniels published:
  //   5K = 24:08 (1448s), 10K = 50:03 (3003s), HM = 1:50:59 (6659s),
  //   Marathon = 3:49:45 (13785s), Mile = 6:35 (395s)
  it('VDOT 40 row matches Daniels 3rd ed', () => {
    const r = row(40);
    expect(r.mileS).toBe(395);
    expect(r.km5S).toBe(1448);
    expect(r.km10S).toBe(3003);
    expect(r.halfS).toBe(6659);
    expect(r.marathonS).toBe(13785);
  });

  // VDOT 50 — sub-elite tier. Daniels published:
  //   5K = 19:57 (1197s), 10K = 41:21 (2481s), HM = 1:31:35 (5495s),
  //   Marathon = 3:10:49 (11449s), Mile = 5:24 (324s)
  it('VDOT 50 row matches Daniels 3rd ed', () => {
    const r = row(50);
    expect(r.mileS).toBe(324);
    expect(r.km5S).toBe(1197);
    expect(r.km10S).toBe(2481);
    expect(r.halfS).toBe(5495);
    expect(r.marathonS).toBe(11449);
  });

  // VDOT 60 — sub-3:00 marathon tier. Daniels published:
  //   5K = 17:03 (1023s), 10K = 35:22 (2122s), HM = 1:18:09 (4689s),
  //   Marathon = 2:43:25 (9805s)
  it('VDOT 60 row matches Daniels 3rd ed', () => {
    const r = row(60);
    expect(r.mileS).toBe(276);
    expect(r.km5S).toBe(1023);
    expect(r.km10S).toBe(2122);
    expect(r.halfS).toBe(4689);
    expect(r.marathonS).toBe(9805);
  });

  // Monotonicity check — every column must strictly decrease as
  // VDOT increases. If a future edit flips a value (typo, paste
  // error), this catches it even without an explicit pin.
  it('every race time column strictly decreases as VDOT increases', () => {
    const rows = VDOT_LOOKUP_TABLE.value;
    const columns: Array<keyof typeof rows[0]> = [
      'mileS', 'km3S', 'km5S', 'km10S', 'km15S', 'halfS', 'marathonS',
    ];
    for (const col of columns) {
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1][col] as number;
        const b = rows[i][col] as number;
        expect(
          b,
          `${col}: VDOT ${rows[i - 1].vdot} (${a}s) should be slower than VDOT ${rows[i].vdot} (${b}s) — table is non-monotonic`,
        ).toBeLessThan(a);
      }
    }
  });

  // Table-completeness check — fewer rows than this means a row
  // was deleted, which would silently degrade interpolation accuracy.
  it('table has at least 32 VDOT tiers covering 30-85 range', () => {
    expect(VDOT_LOOKUP_TABLE.value.length).toBeGreaterThanOrEqual(32);
    expect(VDOT_LOOKUP_TABLE.value[0].vdot).toBe(30);
    expect(VDOT_LOOKUP_TABLE.value[VDOT_LOOKUP_TABLE.value.length - 1].vdot).toBe(85);
  });
});

// ── TEMPLATE FOR FUTURE REFERENCE TABLES ─────────────────────────
//
// When a new reference table lands (Daniels training paces, fueling
// targets, heat-adjustment factors, etc.):
//
//   1. Cite the source in the table's code comment header.
//   2. Add a describe block here that pins 3-5 known values from
//      the source — values you can spot-check against the published
//      reference in 60 seconds.
//   3. Add a monotonicity / structural check where applicable.
//   4. Get a user spot-check on the pinned values BEFORE the table
//      ships. Memory and self-debate don't count as verification.
//
// Tables that need this treatment when they're authored:
//   - TRAINING_PACES_TABLE (Daniels training-pace per-mile values)
//   - HEAT_ADJUSTMENT_FACTORS (slowdown per °F over 60°F)
//   - FUELING_CARB_TARGETS (g/hr by race duration)
//   - HR_ZONE_PCT_MAX (currently Daniels %max — pinned in
//     fitness-resolver buildHrZones; consider migrating here)
