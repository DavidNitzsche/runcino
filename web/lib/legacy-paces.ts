/**
 * Legacy pace formula, kept ONLY for the pace-migration banner's
 * before/after display.
 *
 * The historical formula (race-pace-derived) used:
 *   M center = marathonS / 26.219
 *   T center = halfS / 13.109     for VDOT ≥ 50
 *            = km15S / 9.321      for VDOT < 50
 *   I center = km5S / 3.107
 *   R center = mileS / 1
 *   E center = M + 75
 *
 * It systematically drifted from canonical Daniels Table 2 by
 * 15-40s/mi on E and 16-38s/mi on R (per the 2026-05-19 sim sweep).
 * pacesFromVdot now delegates to resolveTrainingPaces; this module
 * preserves the OLD math for one purpose: showing the user what
 * their bands USED to be vs. what they ARE NOW in the migration
 * banner.
 *
 * DO NOT use this for any prescription path. Display only.
 */

import { vdotRow } from './vdot';

export interface LegacyPaceCenters {
  vdot: number;
  eS: number;  // s/mi
  mS: number;
  tS: number;
  iS: number;
  rS: number;
}

export function legacyPaceCenters(vdot: number): LegacyPaceCenters | null {
  const row = vdotRow(vdot);
  if (!row) return null;
  const mS = Math.round(row.marathonS / 26.219);
  const tS = vdot >= 50 ? Math.round(row.halfS / 13.109) : Math.round(row.km15S / 9.321);
  const iS = Math.round(row.km5S / 3.107);
  const rS = row.mileS;
  const eS = mS + 75;
  return { vdot, eS, mS, tS, iS, rS };
}
