/**
 * Training-paces resolver, VDOT → ResolvedPaces with source-priority
 * chain for derived columns and ±10s E-range synthesis.
 *
 * Source-priority chain (locked in spot-check round 1):
 *   iMile:  published in Table 2 (higher VDOTs only)
 *           > derived from i1000S × 1.609
 *           > derived from i400S × 4.023
 *   rMile:  derived from r400S × 4.023
 *           > derived from r200S × 8.046  (fallback)
 *   r800S:  published in Table 2 (VDOT ≥60 only)
 *           > derived from r400S × 2      (synthetic, code-commented)
 *
 * E range: storage is single `eS` value (range midpoint per Daniels).
 *          Resolver returns eLow = eS + 10, eHigh = eS - 10. The ±10s
 *          width matches Daniels' published range across VDOT 30-60
 *          from the 10K-derived image; for VDOT 61-72 this is
 *          synthetic (no Daniels-published range available), caller
 *          can read `eRangeSource` to know which regime is active.
 *
 * Out-of-range VDOTs clamp to the bounded row. Linear interpolation
 * applies between integer rows for fractional VDOTs (e.g., 47.5).
 *
 * Rule 10 enforcement: this resolver is the ONLY path that should
 * convert a VDOT to training paces in the app. Anything else (legacy
 * pacesFromVdot, hand-rolled interpolation) bypasses the snapshot
 * tests and source-priority guarantees.
 */

import {
  TRAINING_PACES_TABLE,
  TRAINING_PACES_VDOT_CEILING,
  TRAINING_PACES_VDOT_FLOOR,
  type VdotTrainingRow,
} from '../coach/doctrine/training_paces_table';

/** Source of a derived per-mile pace. Useful for debug/citations. */
export type IMileSource = 'published' | 'derived-i1000' | 'derived-i400';
export type RMileSource = 'derived-r400' | 'derived-r200';
export type R800Source  = 'published' | 'derived-r400x2';
export type ERangeSource = 'daniels-10k-derived' | 'synthetic-pm10';

export interface ResolvedPaces {
  vdot: number;
  /** True when the input VDOT was outside [30, 72] and got clamped. */
  clamped: boolean;
  /** True when the row at the resolved VDOT carries
   *  "PENDING SECOND-SOURCE VERIFICATION" status (VDOT > 60). */
  pendingVerification: boolean;

  // ── Race times (all in seconds) ──────────────────────────────
  race1500S:    number;
  raceMileS:    number;
  race3kS:      number;
  race2miS:     number;
  race5kS:      number;
  race10kS:     number;
  race15kS:     number;
  raceHalfS:    number;
  raceMarathonS: number;

  // ── E pace ───────────────────────────────────────────────────
  /** Range midpoint (Daniels' single-value E pace). */
  eMidS: number;
  /** Slower end (eMid + 10). */
  eLowS: number;
  /** Faster end (eMid - 10). */
  eHighS: number;
  eRangeSource: ERangeSource;

  // ── M pace ───────────────────────────────────────────────────
  mS: number;

  // ── T pace ───────────────────────────────────────────────────
  tMileS: number;
  t400S:  number;
  t1000S: number;

  // ── I pace ───────────────────────────────────────────────────
  iMileS:  number;
  i400S:   number;
  i1000S?: number;
  i1200S?: number;
  iMileSource: IMileSource;

  // ── R pace ───────────────────────────────────────────────────
  rMileS:  number;
  r200S:   number;
  r400S?:  number;
  r800S?:  number;
  rMileSource: RMileSource;
  r800Source: R800Source;
}

/** Find the bracketing rows for a VDOT input. lo === hi for an exact
 *  integer match in the table or when the input clamps to a bound;
 *  otherwise lo and hi are the adjacent rows with t in (0,1).
 *
 *  Exact-match short-circuit matters: when source priority differs
 *  between bracketing rows (e.g. iMile published at VDOT 52 but
 *  derived below), an exact-integer caller wants the row's own
 *  source, not the weaker-of-the-two from a phantom bracket. */
function bracket(vdot: number): { lo: VdotTrainingRow; hi: VdotTrainingRow; t: number; clamped: boolean } {
  const rows = TRAINING_PACES_TABLE.value;
  if (vdot <= TRAINING_PACES_VDOT_FLOOR) {
    return { lo: rows[0], hi: rows[0], t: 0, clamped: true };
  }
  if (vdot >= TRAINING_PACES_VDOT_CEILING) {
    return { lo: rows[rows.length - 1], hi: rows[rows.length - 1], t: 0, clamped: true };
  }
  const exactIdx = rows.findIndex((r) => r.vdot === vdot);
  if (exactIdx >= 0) {
    return { lo: rows[exactIdx], hi: rows[exactIdx], t: 0, clamped: false };
  }
  // Strict-inequality bracket for fractional VDOTs.
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].vdot < vdot && vdot < rows[i + 1].vdot) {
      const span = rows[i + 1].vdot - rows[i].vdot;
      const t = span === 0 ? 0 : (vdot - rows[i].vdot) / span;
      return { lo: rows[i], hi: rows[i + 1], t, clamped: false };
    }
  }
  // Fallback (shouldn't happen given the bounds + exact-match checks)
  return { lo: rows[0], hi: rows[0], t: 0, clamped: true };
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function lerpOpt(a: number | undefined, b: number | undefined, t: number): number | undefined {
  if (a == null || b == null) return undefined;
  return lerp(a, b, t);
}

/** Compute iMile via the source-priority chain at a single row. Returns
 *  the value AND which tier of the chain produced it. */
function resolveIMileFor(row: VdotTrainingRow): { iMileS: number; source: IMileSource } {
  if (row.iMileS != null) return { iMileS: row.iMileS, source: 'published' };
  if (row.i1000S != null) return { iMileS: Math.round(row.i1000S * 1.609), source: 'derived-i1000' };
  return { iMileS: Math.round(row.i400S * 4.023), source: 'derived-i400' };
}

/** Compute rMile via the source-priority chain at a single row. */
function resolveRMileFor(row: VdotTrainingRow): { rMileS: number; source: RMileSource } {
  if (row.r400S != null) return { rMileS: Math.round(row.r400S * 4.023), source: 'derived-r400' };
  return { rMileS: Math.round(row.r200S * 8.046), source: 'derived-r200' };
}

/** Compute r800 via published-or-derived chain. Daniels doesn't
 *  publish R 800m below VDOT 60; the synthetic r400 × 2 fallback is
 *  marked in the returned source so callers can warn / cite. */
function resolveR800For(row: VdotTrainingRow): { r800S: number; source: R800Source } {
  if (row.r800S != null) return { r800S: row.r800S, source: 'published' };
  if (row.r400S != null) return { r800S: row.r400S * 2, source: 'derived-r400x2' };
  // Final fallback, derive from r200 ×4 (200m × 4 = 800m).
  return { r800S: row.r200S * 4, source: 'derived-r400x2' };
}

/**
 * Resolve a VDOT (integer or fractional) into the full set of Daniels
 * training paces, with the source-priority chain encoded for derived
 * columns. Out-of-range VDOTs clamp to the bounded row.
 *
 * Linear interpolation between integer rows for fractional inputs.
 * Derived columns (iMile, rMile, r800) interpolate AFTER per-row
 * resolution, so source priority is consistent at each bracketing
 * row before the interpolation combines them.
 */
export function resolveTrainingPaces(vdotInput: number): ResolvedPaces {
  const { lo, hi, t, clamped } = bracket(vdotInput);

  // Per-row derived-column resolution (priority chain applied at each
  // bracketing endpoint, then lerped).
  const loIMile = resolveIMileFor(lo);
  const hiIMile = resolveIMileFor(hi);
  const loRMile = resolveRMileFor(lo);
  const hiRMile = resolveRMileFor(hi);
  const loR800  = resolveR800For(lo);
  const hiR800  = resolveR800For(hi);

  const eMidS = lerp(lo.eS, hi.eS, t);
  const eAt61 = lo.vdot >= 61 || hi.vdot >= 61;

  return {
    vdot: clamped ? (vdotInput <= TRAINING_PACES_VDOT_FLOOR ? TRAINING_PACES_VDOT_FLOOR : TRAINING_PACES_VDOT_CEILING) : vdotInput,
    clamped,
    pendingVerification: lo.vdot > 60 || hi.vdot > 60,

    race1500S:    lerp(lo.race1500S, hi.race1500S, t),
    raceMileS:    lerp(lo.raceMileS, hi.raceMileS, t),
    race3kS:      lerp(lo.race3kS, hi.race3kS, t),
    race2miS:     lerp(lo.race2miS, hi.race2miS, t),
    race5kS:      lerp(lo.race5kS, hi.race5kS, t),
    race10kS:     lerp(lo.race10kS, hi.race10kS, t),
    race15kS:     lerp(lo.race15kS, hi.race15kS, t),
    raceHalfS:    lerp(lo.raceHalfS, hi.raceHalfS, t),
    raceMarathonS: lerp(lo.raceMarathonS, hi.raceMarathonS, t),

    eMidS,
    eLowS:  eMidS + 10,
    eHighS: eMidS - 10,
    // ±10s range is Daniels-published for VDOT 30-60; synthetic above.
    eRangeSource: eAt61 ? 'synthetic-pm10' : 'daniels-10k-derived',

    mS: lerp(lo.mS, hi.mS, t),

    tMileS: lerp(lo.tMileS, hi.tMileS, t),
    t400S:  lerp(lo.t400S,  hi.t400S,  t),
    t1000S: lerp(lo.t1000S, hi.t1000S, t),

    iMileS:      lerp(loIMile.iMileS, hiIMile.iMileS, t),
    i400S:       lerp(lo.i400S, hi.i400S, t),
    i1000S:      lerpOpt(lo.i1000S, hi.i1000S, t),
    i1200S:      lerpOpt(lo.i1200S, hi.i1200S, t),
    // When the two bracketing rows agree on source, use it; when they
    // disagree (e.g., one published, one derived), report the LOWER
    // tier as the source, that's the weaker guarantee, and being
    // honest about it lets callers warn appropriately.
    iMileSource: pickWeakerISource(loIMile.source, hiIMile.source),

    rMileS:      lerp(loRMile.rMileS, hiRMile.rMileS, t),
    r200S:       lerp(lo.r200S, hi.r200S, t),
    r400S:       lerpOpt(lo.r400S, hi.r400S, t),
    r800S:       lerp(loR800.r800S, hiR800.r800S, t),
    rMileSource: pickWeakerRSource(loRMile.source, hiRMile.source),
    r800Source:  pickWeakerR800Source(loR800.source, hiR800.source),
  };
}

function pickWeakerISource(a: IMileSource, b: IMileSource): IMileSource {
  // Lower confidence wins (honest reporting): derived-i400 > derived-i1000 > published
  const rank: Record<IMileSource, number> = { 'published': 0, 'derived-i1000': 1, 'derived-i400': 2 };
  return rank[a] >= rank[b] ? a : b;
}

function pickWeakerRSource(a: RMileSource, b: RMileSource): RMileSource {
  const rank: Record<RMileSource, number> = { 'derived-r400': 0, 'derived-r200': 1 };
  return rank[a] >= rank[b] ? a : b;
}

function pickWeakerR800Source(a: R800Source, b: R800Source): R800Source {
  const rank: Record<R800Source, number> = { 'published': 0, 'derived-r400x2': 1 };
  return rank[a] >= rank[b] ? a : b;
}
