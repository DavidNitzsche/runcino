/**
 * Snapshot tests — Daniels training paces table.
 *
 * Per Rule 10 ("Memory is not a source"): pinned rows lock the
 * canonical reference data so that future edits (intentional or
 * silent drift from refactoring) trip a test failure with a
 * readable diff naming the cell that moved.
 *
 * Pinned rows (per David's UNIT A round 2 sign-off):
 *   - VDOT 30 — table floor
 *   - VDOT 40 — round-number checkpoint, mid-low fitness
 *   - VDOT 46 — round 1 spot-check verified (M from Table 2 canonical,
 *               1500 corrected to 5:50, i400 marked undefined pending
 *               re-verification)
 *   - VDOT 48 — David's anchor; round 1 spot-check verified
 *   - VDOT 50 — round 1 spot-check verified
 *   - VDOT 60 — round 1 spot-check verified; last row with
 *               10K-derived E range coverage
 *
 * NOT pinned (intentionally):
 *   - VDOT 61–72 — best-effort transcription from compressed source.
 *     PENDING SECOND-SOURCE VERIFICATION (runsmartonline.com or
 *     Daniels 3rd ed direct). Pinning them now would lock in
 *     low-confidence values; we don't get the safety net we want
 *     from a snapshot of a guess.
 *
 * Granularity: per-row toEqual. Per-cell toBe would give 100+ tests
 * for noise; per-row gives one readable diff that names the cell.
 */

import { describe, it, expect } from 'vitest';
import {
  TRAINING_PACES_TABLE,
  TRAINING_PACES_VDOT_FLOOR,
  TRAINING_PACES_VDOT_CEILING,
  type VdotTrainingRow,
} from '../../coach/doctrine/training_paces_table';
import { resolveTrainingPaces } from '../training-paces-resolver';

function row(vdot: number): VdotTrainingRow {
  const r = TRAINING_PACES_TABLE.value.find((x) => x.vdot === vdot);
  if (!r) throw new Error(`VDOT row ${vdot} missing from TRAINING_PACES_TABLE`);
  return r;
}

describe('TRAINING_PACES_TABLE · pinned rows (Rule 10)', () => {
  // VDOT 30 — table floor. Spot-check verified round 1.
  // Notable: R 400m = 2:16 (136s) corrected in round 1 (was wrongly
  // marked blank in the original draft; led to r/mile = 8:56 instead
  // of the correct 9:07).
  it('VDOT 30 row matches Daniels source (table floor)', () => {
    expect(row(30)).toEqual({
      vdot: 30,
      race1500S: 510, raceMileS: 551, race3kS: 1076, race2miS: 1159, race5kS: 1840,
      race10kS: 3826, race15kS: 5894, raceHalfS: 8464, raceMarathonS: 17357,
      eS: 735, mS: 662, tMileS: 618, t400S: 153, t1000S: 384,
      i400S: 142, r200S: 67, r400S: 136,
    });
  });

  // VDOT 40 — competitive recreational tier. Round-number checkpoint
  // not in the round 1 spot-check; transcribed best-effort from
  // source per the column-first discipline.
  it('VDOT 40 row matches Daniels source', () => {
    expect(row(40)).toEqual({
      vdot: 40,
      race1500S: 395, raceMileS: 427, race3kS: 843, race2miS: 908, race5kS: 1448,
      race10kS: 3003, race15kS: 4633, raceHalfS: 6659, raceMarathonS: 13785,
      eS: 590, mS: 526, tMileS: 492, t400S: 122, t1000S: 306,
      i400S: 112, i1000S: 282, i1200S: 339,
      r200S: 53, r400S: 107,
    });
  });

  // VDOT 46 — round 1 corrections applied:
  //   - 1500m = 5:50 (was 5:49 in original draft)
  //   - M = 7:49 / 469s from Table 2 (was 7:48 from 10K-derived)
  //   - I 400m marked undefined pending direct re-verification
  it('VDOT 46 row matches Daniels source with round 1 corrections', () => {
    expect(row(46)).toEqual({
      vdot: 46,
      race1500S: 350, raceMileS: 377, race3kS: 746, race2miS: 805, race5kS: 1285,
      race10kS: 2665, race15kS: 4102, raceHalfS: 5907, raceMarathonS: 12279,
      eS: 530, mS: 469, tMileS: 437, t400S: 109, t1000S: 273,
      // i400S deliberately undefined — provenance unclear in round 1.
      // Resolver falls back to i1000S × 1.609 for the iMile.
      i400S: undefined,
      i1000S: 252, i1200S: 300,
      r200S: 46, r400S: 94,
    });
  });

  // VDOT 48 — David's anchor (HM 1:34:54 → VDOT 48.0 exact match).
  // Every cell verified perfect by David in round 1.
  it('VDOT 48 row matches Daniels source (David anchor)', () => {
    expect(row(48)).toEqual({
      vdot: 48,
      race1500S: 336, raceMileS: 363, race3kS: 718, race2miS: 775, race5kS: 1239,
      race10kS: 2570, race15kS: 3953, raceHalfS: 5693, raceMarathonS: 11849,
      eS: 510, mS: 452, tMileS: 422, t400S: 105, t1000S: 264,
      i400S: 96, i1000S: 243, i1200S: 289,
      r200S: 44, r400S: 90,
    });
  });

  // VDOT 50 — verified perfect in round 1. First row with R 800m
  // published in Table 2 (Daniels doesn't publish R 800m below VDOT
  // 60 according to round-2 source check; we include r800S=174 at
  // VDOT 50 from the Table 2 row to support runners interpolating
  // upward).
  it('VDOT 50 row matches Daniels source', () => {
    expect(row(50)).toEqual({
      vdot: 50,
      race1500S: 324, raceMileS: 350, race3kS: 693, race2miS: 748, race5kS: 1197,
      race10kS: 2481, race15kS: 3816, raceHalfS: 5495, raceMarathonS: 11449,
      eS: 495, mS: 437, tMileS: 411, t400S: 102, t1000S: 255,
      i400S: 93, i1000S: 235, i1200S: 281,
      r200S: 43, r400S: 87, r800S: 174,
    });
  });

  // VDOT 60 — verified perfect in round 1. Last row covered by the
  // 10K-derived range image (E range = daniels-published below this
  // VDOT, synthetic ±10s above).
  it('VDOT 60 row matches Daniels source (10K-derived E ceiling)', () => {
    expect(row(60)).toEqual({
      vdot: 60,
      race1500S: 275, raceMileS: 297, race3kS: 590, race2miS: 637, race5kS: 1023,
      race10kS: 2122, race15kS: 3258, raceHalfS: 4689, raceMarathonS: 9805,
      eS: 425, mS: 374, tMileS: 354, t400S: 88, t1000S: 220,
      i400S: 81, i1000S: 203, i1200S: 243,
      r200S: 37, r400S: 75, r800S: 150,
    });
  });
});

describe('TRAINING_PACES_TABLE · structural invariants', () => {
  it('covers VDOT 30 through 72 with no gaps', () => {
    const vdots = TRAINING_PACES_TABLE.value.map((r) => r.vdot);
    expect(vdots[0]).toBe(TRAINING_PACES_VDOT_FLOOR);
    expect(vdots[vdots.length - 1]).toBe(TRAINING_PACES_VDOT_CEILING);
    // 1-VDOT spacing across the whole table.
    for (let i = 1; i < vdots.length; i++) {
      expect(vdots[i] - vdots[i - 1], `gap at row index ${i}`).toBe(1);
    }
  });

  it('race times strictly decrease as VDOT increases (monotonicity)', () => {
    const rows = TRAINING_PACES_TABLE.value;
    const columns: Array<keyof VdotTrainingRow> = [
      'race1500S', 'raceMileS', 'race3kS', 'race2miS', 'race5kS',
      'race10kS', 'race15kS', 'raceHalfS', 'raceMarathonS',
    ];
    for (const col of columns) {
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1][col] as number;
        const b = rows[i][col] as number;
        expect(
          b,
          `${col}: VDOT ${rows[i - 1].vdot} (${a}s) should be slower than VDOT ${rows[i].vdot} (${b}s)`,
        ).toBeLessThan(a);
      }
    }
  });

  it('training paces (E, M, T-mile) strictly decrease as VDOT increases', () => {
    const rows = TRAINING_PACES_TABLE.value;
    const columns: Array<keyof VdotTrainingRow> = ['eS', 'mS', 'tMileS', 't400S', 't1000S'];
    for (const col of columns) {
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1][col] as number;
        const b = rows[i][col] as number;
        expect(
          b,
          `${col}: VDOT ${rows[i - 1].vdot} (${a}s) should be > VDOT ${rows[i].vdot} (${b}s)`,
        ).toBeLessThanOrEqual(a);  // ≤ because rounding can produce ties at adjacent VDOTs
      }
    }
  });
});

describe('resolveTrainingPaces · source-priority chain', () => {
  // VDOT 46 has i400S undefined per round 1. Resolver should fall
  // back to i1000S × 1.609 = 252 × 1.609 = 405.468 → rounds to 405s.
  it('falls back to i1000 × 1.609 when i400 is undefined', () => {
    const r = resolveTrainingPaces(46);
    expect(r.iMileS).toBe(405);
    expect(r.iMileSource).toBe('derived-i1000');
  });

  // VDOT 48 has i400S = 96 AND i1000S = 243. Priority chain prefers
  // i1000 over i400, so iMile = 243 × 1.609 = 390.987 → 391s.
  it('prefers i1000 × 1.609 over i400 × 4.023 when both are published', () => {
    const r = resolveTrainingPaces(48);
    expect(r.iMileS).toBe(391);
    expect(r.iMileSource).toBe('derived-i1000');
  });

  // VDOT 61 is the first row carrying a (best-effort) published
  // iMileS in the table data — the canonical Daniels Table 2 likely
  // begins publishing the column around this VDOT, though exact
  // start row pending second-source verification. Priority chain
  // prefers published over derived.
  //
  // VDOT 61 is below the table ceiling (72) so the exact-integer
  // bracket short-circuit applies and source = 'published' from the
  // single row, not weaker-of-bracketing-rows.
  it('prefers published iMile over derivation when available', () => {
    const r = resolveTrainingPaces(61);
    expect(r.iMileS).toBe(322);     // VDOT 61 iMileS in table
    expect(r.iMileSource).toBe('published');
  });

  // rMile always derives from r400 × 4.023 when r400 exists.
  // VDOT 48: r400 = 90 → rMile = 90 × 4.023 = 362.07 → 362s.
  it('derives rMile from r400 × 4.023 (preferred path)', () => {
    const r = resolveTrainingPaces(48);
    expect(r.rMileS).toBe(362);
    expect(r.rMileSource).toBe('derived-r400');
  });

  // r800 falls back to r400 × 2 when not published (VDOT < 60).
  // VDOT 48: r400 = 90 → r800 = 180s.
  it('derives r800 from r400 × 2 below VDOT 60 (synthetic)', () => {
    const r = resolveTrainingPaces(48);
    expect(r.r800S).toBe(180);
    expect(r.r800Source).toBe('derived-r400x2');
  });

  // VDOT 60 has r800 published (150s).
  it('uses published r800 from VDOT 60 upward', () => {
    const r = resolveTrainingPaces(60);
    expect(r.r800S).toBe(150);
    expect(r.r800Source).toBe('published');
  });
});

describe('resolveTrainingPaces · E range synthesis', () => {
  // E range stored as single midpoint; resolver expands ±10s.
  // VDOT 48: eS = 510 → eHigh = 500, eLow = 520.
  it('expands eS to ±10s range', () => {
    const r = resolveTrainingPaces(48);
    expect(r.eMidS).toBe(510);
    expect(r.eLowS).toBe(520);   // slower
    expect(r.eHighS).toBe(500);  // faster
  });

  // VDOT 30-60 uses the Daniels-published range source flag.
  it('reports Daniels-derived E range source for VDOT ≤60', () => {
    expect(resolveTrainingPaces(30).eRangeSource).toBe('daniels-10k-derived');
    expect(resolveTrainingPaces(48).eRangeSource).toBe('daniels-10k-derived');
    expect(resolveTrainingPaces(60).eRangeSource).toBe('daniels-10k-derived');
  });

  // VDOT 61+ uses the synthetic ±10s flag.
  it('reports synthetic E range source for VDOT >60', () => {
    expect(resolveTrainingPaces(65).eRangeSource).toBe('synthetic-pm10');
    expect(resolveTrainingPaces(72).eRangeSource).toBe('synthetic-pm10');
  });
});

describe('resolveTrainingPaces · clamping + interpolation', () => {
  it('clamps below VDOT 30 to the table floor', () => {
    const r = resolveTrainingPaces(25);
    expect(r.clamped).toBe(true);
    expect(r.vdot).toBe(30);
    expect(r.mS).toBe(662);  // VDOT 30 M pace
  });

  it('clamps above VDOT 72 to the table ceiling', () => {
    const r = resolveTrainingPaces(80);
    expect(r.clamped).toBe(true);
    expect(r.vdot).toBe(72);
    expect(r.mS).toBe(320);  // VDOT 72 M pace
  });

  it('interpolates between integer rows', () => {
    // VDOT 47.5: midpoint of VDOT 47 (M=460) and VDOT 48 (M=452) → 456
    const r = resolveTrainingPaces(47.5);
    expect(r.clamped).toBe(false);
    expect(r.mS).toBe(456);
  });

  it('flags pendingVerification for VDOT > 60', () => {
    expect(resolveTrainingPaces(48).pendingVerification).toBe(false);
    expect(resolveTrainingPaces(60).pendingVerification).toBe(false);
    expect(resolveTrainingPaces(65).pendingVerification).toBe(true);
    expect(resolveTrainingPaces(72).pendingVerification).toBe(true);
  });
});
