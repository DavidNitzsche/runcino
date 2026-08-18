/**
 * VDOT — Daniels' fitness index derived from race performance.
 *
 * Cite: Research/01-pace-zones-vdot.md §vdot-table (Daniels Running Formula,
 * J. Daniels, 3rd ed., extended through VDOT 85 per project memory).
 *
 * Strategy:
 *   1. For each race inside the freshness window, look up the VDOT
 *      corresponding to (finish_time, distance).
 *   2. Rank by AUTHORITY BAND first, then by value. Every race is a
 *      candidate; how much weight it carries is graded by what the race was.
 *   3. Return the top of that ranking.
 *
 * 2026-08-17 · EVERY RACE COUNTS, AT THE WEIGHT IT EARNED. Step 2 used to read
 * "return the highest (best) — this naturally excludes slow C-races because a
 * C-race effort produces a lower VDOT", and step 3 dropped `priority='C'`
 * outright. The comment was wrong about its own mechanism and the filter was
 * load-bearing because of it: max-wins does NOT exclude a C race, it excludes a
 * SLOW one, so a C race run hard, or on a course that flattered it, would have
 * anchored every prescribed pace. The A/B filter in `vdot-inputs.ts` was the
 * only thing standing in the way, and `assessRepresentativeness` — the module
 * built to grade exactly this — was never consulted on this path.
 *
 * Now authority scales a candidate's WEIGHT instead of gating its membership.
 * A C race on a hilly course still means something, just less; if it is all the
 * runner has, it still anchors them. See `lib/race/effort-authority.ts` for
 * which half of rule 8 selection can charge and which half it cannot.
 *
 * Algorithm: invert the Daniels race-time table by binary-searching over
 * VDOT and computing predicted race time at each VDOT, returning the VDOT
 * whose predicted time matches the actual finish.
 *
 * Daniels' race-time formula (s):
 *   For a given distance d (km) and VDOT v:
 *   - vO2 demand of running at speed s (m/min): VO2 = 0.000104·s² + 0.182·s − 4.6
 *   - %VO2max sustainable for time t (min): %v = 0.8 + 0.1894·exp(-0.012778·t) +
 *                                                  0.2989·exp(-0.1932·t)
 *   - Find s such that VO2(s) = v · %v(t) where t = (d·1000)/s
 *   - The whole thing is solved iteratively.
 */

import {
  REPRESENTATIVE_FLOOR,
  authorityTier,
  selectionAuthority,
  type AuthorityTier,
} from '@/lib/race/effort-authority';

/** Distance in km from a label. */
function kmFromMi(mi: number): number { return mi * 1.609344; }

/**
 * AUDIT #7 (2026-06-16) · published Daniels MILE column, used to correct the
 * raw-equation divergence at short distances.
 *
 * The Daniels & Gilbert %VO2max curve (vo2Cost/pctVO2 below) reproduces the
 * published table within ~0.1 VDOT for 5K–marathon, but systematically
 * OVER-reads at the ~4–7 min mile: the raw inversion of 5:24 → VDOT 54.5 where
 * the published table maps 5:24 → VDOT 50 (+4.5), growing to ~+5.6 by VDOT 74,
 * and returning null (raw > 85 clamp) for sub-3:38 miles. A mile-goal runner's
 * required VDOT therefore reads ~4–5 points too high and the readiness verdict
 * fires pessimistically (goal-ready.ts:116).
 *
 * Fix: for distances near the mile, interpolate the PUBLISHED mile column
 * (Research/01 §VDOT lookup table — "Interpolate linearly between rows if
 * needed") instead of the raw equation. The 5K–marathon path is untouched.
 *
 * Column is the literal `Mile` column from Research/01, [VDOT, seconds],
 * sorted by VDOT ascending (so seconds descend).
 */
const MILE_VDOT_TABLE: ReadonlyArray<readonly [number, number]> = [
  [30, 510], [32, 481], [34, 456], [36, 434], [38, 414], [40, 395], [42, 379],
  [44, 363], [45, 356], [46, 349], [48, 336], [50, 324], [52, 313], [54, 303],
  [55, 298], [56, 293], [58, 284], [60, 276], [62, 269], [64, 262], [65, 258],
  [66, 255], [68, 249], [70, 243], [72, 238], [74, 232], [75, 230], [76, 227],
  [78, 223], [80, 218], [82, 214], [84, 210], [85, 208],
];

/** Distances (mi) for which the mile-table correction applies. The published
 *  short-distance anchor is the mile column; the next column (3K, 1.864mi) is
 *  far enough that the raw equation has nearly converged, and 5K+ is accurate.
 *  Covers 1500m (0.93mi)…~2km so the mile-goal path (always 1.0mi) and nearby
 *  short distances use the table; everything ≥ this stays on the raw equation. */
const MILE_CORRECTION_MAX_MI = 1.3;
const MILE_CORRECTION_MIN_MI = 0.9;
function isMileRange(distanceMi: number): boolean {
  return distanceMi >= MILE_CORRECTION_MIN_MI && distanceMi <= MILE_CORRECTION_MAX_MI;
}

/** AUDIT #7 · VDOT from a mile finish via linear interpolation of the published
 *  table. Clamps to the table edges (slower than 8:30 → 30, faster than 3:28 →
 *  85). Returns a 1-decimal VDOT, matching vdotFromRace's precision. */
function mileVdotFromSec(finishSeconds: number): number {
  const T = MILE_VDOT_TABLE;
  if (finishSeconds >= T[0][1]) return T[0][0];
  if (finishSeconds <= T[T.length - 1][1]) return T[T.length - 1][0];
  for (let i = 0; i < T.length - 1; i++) {
    const [v1, s1] = T[i];
    const [v2, s2] = T[i + 1]; // s1 > s2 (faster row)
    if (finishSeconds <= s1 && finishSeconds >= s2) {
      const f = (s1 - finishSeconds) / (s1 - s2);
      return Math.round((v1 + f * (v2 - v1)) * 10) / 10;
    }
  }
  return T[T.length - 1][0];
}

/** AUDIT #7 · mile finish (seconds) from a VDOT via linear interpolation of the
 *  published table. Clamps to the table edges. Inverse of mileVdotFromSec. */
function mileSecFromVdot(vdot: number): number {
  const T = MILE_VDOT_TABLE;
  if (vdot <= T[0][0]) return T[0][1];
  if (vdot >= T[T.length - 1][0]) return T[T.length - 1][1];
  for (let i = 0; i < T.length - 1; i++) {
    const [v1, s1] = T[i];
    const [v2, s2] = T[i + 1];
    if (vdot >= v1 && vdot <= v2) {
      const f = (vdot - v1) / (v2 - v1);
      return Math.round(s1 + f * (s2 - s1));
    }
  }
  return T[T.length - 1][1];
}

/**
 * 2026-07-07 · ultra-honesty audit P1-41/P2-70/P2-71 · the Daniels %VO2max
 * curve underlying rawVdot/predictRaceTime is fit and reported accurate for
 * "3.5–230 minutes (≈1500m to marathon)" (Research/02-race-time-
 * prediction.md §4). The doctrine's exponent table explicitly scopes
 * Daniels-style single-curve models OUT of the ultra range: §6.2's exponent
 * table marks "Ultra distances 50K–100K" as needing exponent 1.13–1.15 and
 * directs a switch to time-on-feet models beyond 100K, and §14 Practical
 * Decision Rule 6 tells callers with an ultra target to "use Cameron or
 * exponent ≥1.10" — i.e. not Daniels VDOT (Research/02-race-time-
 * prediction.md §6.2 line 182, §14 rule 6 line 446). The equation has no
 * natural discontinuity at the marathon, so a 50K/50M/100K/100M finish time
 * silently produces an in-range-looking VDOT (e.g. a 50K in 5h computes
 * VDOT 35.6 — comfortably inside [30,85]) that vdotFromRace's existing
 * range clamp does NOT catch, and predictRaceTime will happily invert to
 * fabricate an ultra "prediction" the formula was never scoped for. Gate
 * both directions at the marathon distance so ultra-goal callers get an
 * honest null instead of an extrapolated number — every existing caller
 * already null-checks (goal-projection, fitness-trajectory, goal-ready) so
 * this degrades the whole ultra chain for free instead of requiring a
 * guard at each call site.
 */
export const DANIELS_MAX_VALID_DISTANCE_MI = 26.3; // clears 26.2188/26.219/26.22 marathon constants

/** Daniels' VO2 cost of running at speed s (m/min). */
function vo2Cost(metersPerMin: number): number {
  return -4.6 + 0.182258 * metersPerMin + 0.000104 * metersPerMin * metersPerMin;
}

/** Daniels' %VO2max sustainable for time t (min). */
function pctVO2(min: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * min) +
               0.2989558 * Math.exp(-0.1932605 * min);
}

/** Unclamped VDOT for (finish_seconds, distance_mi). Internal — the raw
 *  Daniels value before the [30,85] table clamp. Used by both the public
 *  `vdotFromRace` (which clamps) and `predictRaceTime` (which inverts). */
function rawVdot(finishSeconds: number, distanceMi: number): number | null {
  if (!finishSeconds || finishSeconds <= 0 || !distanceMi || distanceMi <= 0) return null;
  const meters = kmFromMi(distanceMi) * 1000;
  const minutes = finishSeconds / 60;
  const speed = meters / minutes; // m/min
  const vo2 = vo2Cost(speed);
  const pct = pctVO2(minutes);
  const vdot = vo2 / pct;
  return isFinite(vdot) ? vdot : null;
}

/** Given (finish_seconds, distance_mi), return the VDOT that predicts
 *  exactly that finish time. Returns null if outside [30, 85] OR if
 *  distanceMi is past the marathon — the Daniels curve is scoped OUT of
 *  the ultra range (Research/02 §6.2, §14 rule 6; see
 *  DANIELS_MAX_VALID_DISTANCE_MI). */
export function vdotFromRace(finishSeconds: number, distanceMi: number): number | null {
  if (!finishSeconds || finishSeconds < 60) return null;
  if (distanceMi > DANIELS_MAX_VALID_DISTANCE_MI) return null;
  // AUDIT #7 · the raw %VO2max equation over-reads the mile ~4–5 VDOT; use the
  // published table for mile-range distances. Already table-clamped to [30,85].
  if (distanceMi > 0 && isMileRange(distanceMi)) return mileVdotFromSec(finishSeconds);
  const vdot = rawVdot(finishSeconds, distanceMi);
  if (vdot == null) return null;
  if (vdot < 30 || vdot > 85) return null;
  return Math.round(vdot * 10) / 10; // 1 decimal place
}

/**
 * 2026-07-07 · AUDIT P1-56 · ANCHOR-PACE fallback for runners whose demonstrated
 * fitness maps below Daniels' published VDOT floor of 30 (Research/01:7 "Range:
 * ~30 (beginner) to 85+"; :634 "Novice 30–40, ~30:00+ 5K"). The Daniels %VO2max
 * curve is only cited/validated across [30,85] — extrapolating the raw equation
 * below 30 would be exactly the "extrapolate beyond research" violation the
 * engine must not commit (CLAUDE.md "Engine must match research": every rule
 * needs a citation). So VDOT itself STAYS null below 30; that is doctrine-correct,
 * not a bug.
 *
 * The actual bug (P1-56): a null VDOT got treated as "no fitness data exists,"
 * when the runner plainly HAS a demonstrated pace — it just doesn't map onto the
 * VDOT scale. This module represents that pace honestly instead of discarding it:
 * an AnchorPace carries the runner's own (finish_seconds, distance_mi) and derives
 * training paces as DOCUMENTED OFFSETS FROM THAT PACE — the same relationship
 * Research/01's "Pace conversion from a race time" table already states in
 * pace-relative-to-race-pace terms (not VDOT-relative terms), so it is valid at
 * any pace, not just inside the VDOT-tabulated range:
 *
 *   Research/01:142 "T ≈ half-marathon pace to 15K pace (faster runners use HM,
 *                     slower runners use 15K)"
 *   Research/01:144 "E ≈ MP + 60–90 sec/mi (or 5K pace + 90–150 sec/mi)"
 *
 * tPaceFromAnchorPace below reuses the EXACT distance-tier offset table already
 * shipped in tPaceFromGoal (spec-builder.ts) — that table is the same doctrine,
 * already applied to a GOAL pace; here it is applied to a DEMONSTRATED pace. One
 * offset table, two anchors (goal vs. measured), matching the existing pattern
 * instead of inventing new numbers.
 */
export interface AnchorPace {
  /** Race/run finish time, seconds. */
  finishSeconds: number;
  /** Distance of that effort, miles. */
  distanceMi: number;
  /** finishSeconds / distanceMi — the runner's own demonstrated race pace. */
  paceSPerMi: number;
}

/** Build an AnchorPace from a finish time + distance, or null on bad input. */
export function anchorPaceFrom(finishSeconds: number | null | undefined, distanceMi: number | null | undefined): AnchorPace | null {
  if (!finishSeconds || finishSeconds < 60 || !distanceMi || distanceMi <= 0) return null;
  return { finishSeconds, distanceMi, paceSPerMi: finishSeconds / distanceMi };
}

/**
 * T-pace (s/mi) from a runner's OWN demonstrated race pace, using the identical
 * distance-tier offsets Daniels' pace-conversion table gives for a GOAL pace
 * (spec-builder.ts tPaceFromGoal — same numbers, same citation, applied to a
 * measured anchor instead of a target). Distance-agnostic beyond 30 — no VDOT
 * table lookup involved, so it is defined for any honest pace, including sub-
 * VDOT-30 fitness.
 *
 * Cite: Research/01-pace-zones-vdot.md §"Pace conversion from a race time".
 */
export function tPaceFromAnchorPace(anchor: AnchorPace | null | undefined): number | null {
  if (!anchor || anchor.paceSPerMi <= 0) return null;
  const { paceSPerMi, distanceMi } = anchor;
  // Same distance tiers + offsets as spec-builder.tPaceFromGoal, applied to the
  // anchor's OWN pace instead of a goal pace (mirrors "faster runners use HM,
  // slower runners use 15K" — a longer anchor race sits closer to T already).
  if (distanceMi >= 31) return null; // ultra pace is not T-adjacent; anchor T off marathon/HM/10K/5K only
  if (distanceMi >= 25) return Math.round(paceSPerMi - 18); // marathon-effort anchor
  if (distanceMi >= 12) return Math.round(paceSPerMi - 5);  // half-effort anchor
  if (distanceMi >= 5)  return Math.round(paceSPerMi + 8);  // 10K-effort anchor
  return Math.round(paceSPerMi + 15);                        // 5K-or-shorter-effort anchor
}

/**
 * Easy pace band (s/mi) directly from the anchor pace, for the case where even
 * T-pace-relative math is not wanted (e.g. a raw honest-easy display). Mirrors
 * Research/01:142 "E ≈ 5K pace + 90–150 sec/mi" applied distance-agnostically —
 * same shape as the T-pace offset above. Most callers should prefer deriving E
 * from tPaceFromAnchorPace (+80/+120, spec-builder's PACE-E-1 constants) so a
 * single anchor T-pace stays the one number every zone offsets from; this export
 * exists for callers that want the band without reproducing spec-builder's
 * offsets.
 */
export function easyPaceBandFromAnchorPace(anchor: AnchorPace | null | undefined): { lo: number; hi: number } | null {
  const tRaw = tPaceFromAnchorPace(anchor);
  if (tRaw == null) return null;
  // Same falsifiable-requirement-#3 backstop as resolveCurrentTPace's tier-2
  // branch: the marathon/half-tier offsets can land tRaw faster than the
  // anchor itself (see resolveCurrentTPace's doc comment). This export isn't
  // currently wired into any call site, but it's public API — clamp here too
  // so a future caller can't reintroduce the bug by using this function
  // instead of resolveCurrentTPace.
  const t = clampToSanePace(tRaw, anchor?.paceSPerMi);
  if (t == null) return null;
  // Matches spec-builder PACE-E-2 · Research/01:142 §Pace conversion (E = MP+60..90,
  // and M = T+18, so E = T+78..T+108). Do not re-cite the §Numerical equivalencies
  // VDOT-50 row here: it says T+104..T+156 and contradicts :142 by 20-40 s/mi.
  return { lo: t + 80, hi: t + 120 };
}

/**
 * 2026-07-07 · AUDIT P1-56 · Riegel cross-distance prediction — the doctrine-cited
 * fallback for "what would this pace-anchored runner run at a DIFFERENT distance"
 * when VDOT itself is off-table (< 30) and predictRaceTime (Daniels table
 * inversion) therefore cannot answer. Riegel's power law is NOT Daniels' VDOT
 * model — it has no VDOT floor at all, so it is doctrine-valid here without any
 * extrapolation-beyond-research concern.
 *
 * Cite: Research/02-race-time-prediction.md §2 "T2 = T1 × (D2/D1)^1.06" (Riegel,
 * 1981, "Athletic records and human endurance," American Scientist 69:285-290);
 * §2.4 "Designed for events 3.5-230 minutes (≈1500m to marathon)."
 *
 * Deliberately narrower than predictRaceTime: returns null when either distance
 * falls outside Riegel's own cited validity window (§2.4) rather than silently
 * extrapolating past it — same "don't extrapolate beyond research" discipline
 * applied to THIS formula's cited bounds, not just Daniels'. A caller with an
 * anchor/target pair outside the window has no doctrine-supported cross-distance
 * answer and should fall back to a same-distance-only honest read.
 */
const RIEGEL_EXPONENT = 1.06;
/** Riegel's own cited validity window (Research/02 §2.4): "1500m to marathon."
 *  1500m ≈ 0.932mi; full marathon = 26.2188mi. Slightly inclusive of the
 *  standard mile (1.0mi) since that sits just above 1500m and well inside the
 *  cited event-duration range (3.5-230 min) for any pace this module reaches. */
const RIEGEL_MIN_DISTANCE_MI = 0.93;
const RIEGEL_MAX_DISTANCE_MI = 26.22;

export function predictRaceTimeFromAnchor(
  anchor: AnchorPace | null | undefined,
  targetDistanceMi: number,
): number | null {
  if (!anchor || !targetDistanceMi || targetDistanceMi <= 0) return null;
  const { finishSeconds, distanceMi } = anchor;
  if (distanceMi < RIEGEL_MIN_DISTANCE_MI || distanceMi > RIEGEL_MAX_DISTANCE_MI) return null;
  if (targetDistanceMi < RIEGEL_MIN_DISTANCE_MI || targetDistanceMi > RIEGEL_MAX_DISTANCE_MI) return null;
  const t2 = finishSeconds * Math.pow(targetDistanceMi / distanceMi, RIEGEL_EXPONENT);
  return Math.round(t2);
}

/**
 * 2026-07-07 · AUDIT P1-56 · I-pace (s/mi) from an anchor pace, mirroring
 * iPaceFromVdot's own shape (predictRaceTime(vdot, 5K)) but via Riegel
 * cross-distance prediction instead of a VDOT round-trip.
 *
 * This closes a SECOND below-table leak found while testing the T-pace fix:
 * generate.ts's persistPlan computed `iPaceFromVdot(vdotFromTpace(weekT))`
 * for race_week_tuneup/goal-I-eligible quality days — vdotFromTpace's own
 * binary search is bounded [30,85], so ANY weekT slower than what VDOT 30
 * implies gets silently clamped UP to VDOT-30 territory, re-introducing the
 * exact "prescribed faster than demonstrated pace" bug one level down, even
 * after the T-pace itself was fixed to honor the anchor. Riegel has no VDOT
 * floor, so scaling the anchor directly to a 5K-equivalent time and reading
 * pace off THAT never re-enters VDOT space at all.
 *
 * Cite: Research/01-pace-zones-vdot.md §Daniels-I ("I ≈ 3K to 5K race pace")
 * + Research/02-race-time-prediction.md §2 (Riegel, same citation as
 * predictRaceTimeFromAnchor above).
 */
export function iPaceFromAnchorPace(anchor: AnchorPace | null | undefined): number | null {
  const fiveKSec = predictRaceTimeFromAnchor(anchor, 3.10686);
  if (fiveKSec == null) return null;
  const raw = Math.round(fiveKSec / 3.10686);
  // 2026-07-07 · CODE-REVIEW FINDING (below-table HM/marathon personas) · Riegel
  // projects a FASTER per-mile pace at 5K than at the anchor's own (longer)
  // distance — correct, expected behavior for a trained runner (Research/01:145
  // "I ≈ 3K to 5K race pace" is genuinely quicker than M/HM pace). But for a
  // below-table anchor, the anchor pace itself IS the only demonstrated data
  // point; Riegel's power-law extrapolation down to 5K from a single slow
  // marathon/HM effort is unvalidated at that fitness level and can land faster
  // than the runner has ever actually run (e.g. a 6:30/900s-mi marathon anchor
  // Riegel-projects a 785s/mi 5K-equivalent pace — 115s/mi faster than anything
  // the runner has demonstrated). This is the exact falsifiable-requirement-#3
  // shape clampToSanePace exists for ("no prescribed pace may be faster than
  // the runner's own demonstrated race/run pace... regardless of which tier
  // produced it") — apply the same backstop here so I-pace can never leak
  // faster than the anchor it was derived from, same as tPaceFromAnchorPace's
  // callers (resolveCurrentTPace, easyPaceBandFromAnchorPace) already do.
  //
  // Epsilon guard: `raw` is always a Math.round()'d whole-second integer, but
  // anchor.paceSPerMi is the unrounded finishSeconds/distanceMi division and
  // can carry sub-second float noise (e.g. a 2517s/3.10686mi 5K anchor's true
  // division is 810.1427...s/mi, not the whole-second 810 every other reader
  // of this anchor treats as "the" pace). When the anchor's own distance IS
  // (within rounding) the 5K target, raw and the anchor pace describe the
  // SAME demonstrated effort — clamping raw up to the unrounded float would
  // report a phantom <1s/mi "violation" that isn't a real below-anchor
  // prescription. Only clamp when raw is genuinely, more-than-rounding-noise
  // faster than the anchor (Research/01 "I ≈ 5K race pace" — a 5K effort's
  // own I-pace IS that effort's pace, exactly, when the anchor already is a 5K).
  if (Math.abs(raw - anchor!.paceSPerMi) < 0.5) return raw;
  return clampToSanePace(raw, anchor?.paceSPerMi);
}

/**
 * Invert the Daniels race-time table: given a VDOT and a distance, predict
 * the finish time (seconds). This is the projection direction — "at your
 * current fitness, racing distance D today would take ~T."
 *
 * `rawVdot` is monotonically decreasing in finish time (slower time → lower
 * VDOT), so we binary-search the time whose predicted VDOT matches the
 * target. Bounds span 2:30/mi (elite) to 25:00/mi (walk) — any realistic
 * VDOT∈[30,85] resolves inside that window. Returns null on bad input.
 *
 * 2026-07-07 · ultra-honesty audit · also returns null past the marathon
 * (DANIELS_MAX_VALID_DISTANCE_MI) — extrapolating this curve to 50K/50M/
 * 100K/100M would fabricate a race-time "prediction" the formula was never
 * scoped for (Research/02 §6.2 line 182: ultra distances need exponent
 * 1.13–1.15, "switch to time-on-feet models beyond" 100K; §14 rule 6 line
 * 446: ultra targets should "use Cameron or exponent ≥1.10," not Daniels).
 * Callers must treat null as "no honest projection" and degrade the
 * surface (effort-only guidance, no number), not substitute a
 * shorter-distance number.
 *
 * Cite: Research/01-pace-zones-vdot.md §vdot-table — the same published table
 * `vdotFromRace` reads, inverted. (Was `Daniels Running Formula §VDOT table`,
 * a book citation the gate could not open; the table itself is reproduced in
 * Research/01 with its citation, so the anchor now resolves — DOCTRINE-BOOK-17,
 * 2026-08-17.)
 */
export function predictRaceTime(vdot: number, distanceMi: number): number | null {
  if (!vdot || vdot <= 0 || !distanceMi || distanceMi <= 0) return null;
  if (distanceMi > DANIELS_MAX_VALID_DISTANCE_MI) return null;
  // AUDIT #7 · invert via the published mile table for mile-range distances so
  // the mile projection matches the table (50 → 5:24, not the raw eqn's 5:50).
  if (isMileRange(distanceMi)) return mileSecFromVdot(vdot);
  let lo = distanceMi * 150;   // 2:30/mi floor
  let hi = distanceMi * 1500;  // 25:00/mi ceiling
  let mid = (lo + hi) / 2;
  for (let i = 0; i < 60; i++) {
    mid = (lo + hi) / 2;
    const v = rawVdot(mid, distanceMi);
    if (v == null) break;
    if (v > vdot) lo = mid; // predicted VDOT too high → time too fast → go slower
    else hi = mid;
  }
  return Math.round(mid);
}

/**
 * 2026-06-03 · derive Daniels T-pace (s/mi) from a VDOT score.
 *
 * Uses predictRaceTime(vdot, 13.1) to get the runner's HM-implied
 * finish time, then applies the canonical HM → T conversion (HM pace
 * minus 5 s/mi · matches spec-builder.tPaceFromGoal for HM). This is
 * the doctrinal mapping: HM race effort is roughly T-pace, so HM-VDOT
 * is the cleanest anchor for T-pace derivation.
 *
 * Used by the plan generator's Rule 3 pace-anchor blend (mid-block
 * doctrine) · runners whose current VDOT is below goal-implied VDOT
 * get early-week paces anchored to currentT, ramping toward goalT.
 *
 * Cite: Research/01-pace-zones-vdot.md §Daniels-T-pace
 * Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 3
 */
export function tPaceFromVdot(vdot: number | null | undefined): number | null {
  if (!vdot || !Number.isFinite(vdot) || vdot <= 0) return null;
  const hmSec = predictRaceTime(vdot, 13.1);
  if (hmSec == null) return null;
  const hmPaceSPerMi = hmSec / 13.1;
  // HM pace minus 5 s/mi · same offset as spec-builder.tPaceFromGoal
  // for the half-marathon branch (lines 315-316).
  return Math.round(hmPaceSPerMi - 5);
}

/**
 * 2026-06-11 · invert tPaceFromVdot: given an observed/prescribed threshold
 * pace (s/mi), return the VDOT whose T-pace matches it. The honest read of a
 * tempo workout — "you sustained T-pace X, which is the threshold pace for
 * VDOT Y" — instead of vdotFromRace's "you raced X all-out" understatement.
 *
 * tPaceFromVdot is monotonically decreasing in VDOT (fitter → faster T-pace),
 * so binary-search the [30,85] table. Returns null on bad input.
 *
 * Cite: Research/01-pace-zones-vdot.md §Daniels-T-pace (inverse of tPaceFromVdot).
 */
/**
 * Memo for the search below. Pure function of one number, so a cache is exact
 * rather than an approximation — and the engine asks the same question over and
 * over: `persistPlan` inverts the SAME week T-pace once per workout ROW, so an
 * eighteen-week plan ran this fifty-step search well over a hundred times for
 * about a dozen distinct answers. Bounded so a long-lived server process cannot
 * accumulate one entry per pace it has ever seen.
 */
const T_PACE_VDOT_MEMO = new Map<number, number | null>();
const T_PACE_VDOT_MEMO_MAX = 512;

export function vdotFromTpace(tPaceSPerMi: number): number | null {
  if (!tPaceSPerMi || tPaceSPerMi <= 0) return null;
  const hit = T_PACE_VDOT_MEMO.get(tPaceSPerMi);
  if (hit !== undefined) return hit;
  let lo = 30, hi = 85;
  let out: number | null = null;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const tp = tPaceFromVdot(mid);
    if (tp == null) { out = null; break; }
    // T-pace slower (larger s/mi) than target → VDOT too low → search up.
    if (tp > tPaceSPerMi) lo = mid; else hi = mid;
    out = Math.round(((lo + hi) / 2) * 10) / 10;
  }
  if (T_PACE_VDOT_MEMO.size >= T_PACE_VDOT_MEMO_MAX) T_PACE_VDOT_MEMO.clear();
  T_PACE_VDOT_MEMO.set(tPaceSPerMi, out);
  return out;
}

/**
 * 2026-06-11 · invert marathon pace → VDOT. M-pace is even more sub-maximal
 * than T-pace, so reading a marathon-pace segment as an all-out race understates
 * fitness the most. M-pace(v) = predictRaceTime(v, 26.2188)/26.2188; binary
 * search the table. Cite: Research/01-pace-zones-vdot.md §Daniels-M-pace.
 */
export function vdotFromMpace(mPaceSPerMi: number): number | null {
  if (!mPaceSPerMi || mPaceSPerMi <= 0) return null;
  let lo = 30, hi = 85;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const t = predictRaceTime(mid, 26.2188);
    if (t == null) return null;
    if (t / 26.2188 > mPaceSPerMi) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

/** Map a workout-type string to its training zone, for the zone-aware VDOT read
 *  in vdotFromRun. Null when the type doesn't pin a zone. */
export function zoneFromType(t: string | null | undefined):
  'threshold' | 'marathon' | 'interval' | 'race' | null {
  const w = String(t ?? '').toLowerCase();
  if (w === 'threshold' || w === 'tempo' || w === 'cruise') return 'threshold';
  if (w === 'marathon_pace' || w === 'mp' || w === 'marathon') return 'marathon';
  if (w === 'intervals' || w === 'interval' || w === 'vo2' || w === 'vo2max') return 'interval';
  if (w === 'race' || w === 'time_trial' || w === 'tune_up' || w === 'race_week_tuneup') return 'race';
  return null;
}

/** Format seconds → "1:44:50" (h:mm:ss) or "59:30" (m:ss). */
export function formatRaceTime(seconds: number | null | undefined): string | null {
  if (seconds == null || !isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Parse a race time string → seconds.
 *
 * Accepts three shapes:
 *   · "H:MM:SS"  → hours + minutes + seconds  (e.g. "1:34:54" finish time)
 *   · "H:MM"     → hours + minutes            (e.g. "1:30" HM goal)
 *   · "MM:SS"    → minutes + seconds          (e.g. "23:15" 5K time)
 *
 * 2026-06-03 · was treating "1:30" as 90 seconds (MM:SS interpretation) ·
 * but race GOALS commonly omit seconds ("1:30" sub-1:30 HM, "3:00" sub-3
 * marathon). Heuristic: first part ≤ 9 → H:MM, else MM:SS. Real races
 * don't take 10+ hours and 5K/10K times fit in 9:99 MM:SS anyway.
 *
 * Cite: David's race meta `goalDisplay: "1:30"` for AFC Half · used to
 * silently produce 90s = 0.025 hr in vdot calcs · obviously broken.
 */
export function parseRaceTime(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  if (m[3] != null) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  // Two-part form · H:MM vs MM:SS heuristic.
  const first = +m[1];
  const second = +m[2];
  // First part ≤ 9 → H:MM (sub-9hr race · covers 5K-to-ultra goals).
  if (first <= 9) return first * 3600 + second * 60;
  // First part > 9 → MM:SS (any race longer than 10 min · 5K/10K finishes).
  return first * 60 + second;
}

export interface RaceVdotCandidate {
  source: 'race';
  slug: string;
  name: string;
  date: string;
  /**
   * As stored on `races.meta->>'priority'`. Deliberately `string | null` rather
   * than the A/B/C union: `lib/faff/types.ts` also allows `training_run` and
   * `hilly_excluded`, and now that selection admits every priority those values
   * genuinely reach this type. The union was a lie the old SQL filter hid.
   */
  priority: string | null;
  distance_mi: number;
  finish_seconds: number;
  /**
   * 0..1 · how much weight this result carries at selection, graded by what the
   * race WAS (`Research/00b`'s effort table via
   * `lib/race/effort-authority.ts#selectionAuthority`). Reported, never spent on
   * `vdot` — see the ranking note in `bestRecentVdot`.
   */
  authority: number;
  /** The band `authority` falls in, against the two doctrine floors. */
  authority_tier: AuthorityTier;
  /** Effective VDOT after the stale-anchor fade (= vdot_raw inside the
   *  full-value window). This is the value every consumer should treat
   *  as "current fitness estimate". */
  vdot: number;
  /** Raw Daniels VDOT of the performance, no age adjustment. */
  vdot_raw: number;
  /** Anchor age at evaluation time (days from race date to `today`). */
  age_days: number;
}

export interface RunVdotCandidate {
  source: 'run';
  id: string;
  date: string;
  workout_type: string | null;
  distance_mi: number;
  finish_seconds: number;
  vdot: number;
  vdot_raw: number;
  age_days: number;
}

export type VdotCandidate = RaceVdotCandidate | RunVdotCandidate;

/**
 * Workout types considered "quality" — runs done at honest, sustained effort
 * such that the pace × duration tells us something real about fitness.
 *
 * Easy/recovery runs are excluded: a conversational-pace run from a runner
 * sandbagging easy days produces a wildly understated VDOT, so we don't read
 * VDOT off them at all.
 */
const QUALITY_RUN_TYPES = new Set([
  'threshold', 'tempo', 'cruise', 'intervals', 'vo2', 'vo2max',
  'marathon_pace', 'mp', 'race', 'time_trial', 'tune_up',
]);

/** Map an onboarding/profile distance to miles — accepts BOTH the legacy
 *  onboarding codes ('5k') AND the SetGoalSheet labels ('5K', 'Half Marathon',
 *  '50K', '100K'). Null for 'none'/unknown. Used to derive the goal-relative
 *  training-VDOT floor (vdotRunFloorMi) and the goal plan distance, so the
 *  fitness read keys off the event the runner is actually training for. */
export function goalDistanceMiFromCode(code: string | null | undefined): number | null {
  switch (String(code ?? '').toLowerCase()) {
    case '1mi': case 'mile':                            return 1.0;
    case '5k':                                          return 3.10686;
    case '10k':                                         return 6.21371;
    case 'half': case 'half-marathon': case 'half marathon': return 13.1094;
    case 'marathon': case 'full':                       return 26.2188;
    case '50k':                                         return 31.0686;
    case '100k':                                        return 62.1371;
    default:                                            return null;
  }
}

/**
 * Minimum honest-effort distance (miles) for a TRAINING-derived VDOT, keyed to
 * the runner's goal event. A solo effort at ~the goal distance is the canonical
 * field test: a 5K time trial IS a valid VDOT input. A flat 4-mile floor used
 * to exclude every 5K-goal runner — whose quality sessions ARE ~3.1mi — from
 * training-derived fitness entirely. The floor never drops below the 5K TT
 * (3.0mi, the shortest canonical test) nor demands more than a sustained tempo
 * (4mi — we don't make a half/marathon runner race their event to read fitness;
 * a tempo is signal enough, and vdotFromRun's HR gate guards honesty).
 *
 * 5K goal → 3.0mi · 10K / Half / Marathon / unknown → 4.0mi.
 *
 * Cite: Research/01-pace-zones-vdot.md §"Field-test protocols" (5K TT → VDOT,
 * apply +1 solo correction) + §"Field-test selection for the Coach".
 */
export function vdotRunFloorMi(goalDistanceMi: number | null | undefined): number {
  if (!goalDistanceMi || goalDistanceMi <= 0) return 4;
  return Math.min(4, Math.max(3, goalDistanceMi * 0.9));
}

/**
 * Daniels I-pace (VO2max interval pace, s/mi) from a VDOT score.
 *
 * I-pace ≈ the runner's CURRENT 5K race pace — 3–5 min reps at ~95–100%
 * VO2max. Derived from predictRaceTime(vdot, 5K) so it scales correctly with
 * fitness, unlike the spec-builder's legacy `tPaceSec - 18` constant offset,
 * which only approximates I at high VDOT and badly understates it for a
 * novice / 5K runner (at VDOT 32 the constant offset lands near threshold —
 * ~2 min/mi slower than real I-pace, slower than the runner's own easy days).
 *
 * Cite: Research/01-pace-zones-vdot.md §Daniels-I (I-pace ≈ 3–5K race pace).
 */
export function iPaceFromVdot(vdot: number | null | undefined): number | null {
  if (!vdot || !Number.isFinite(vdot) || vdot <= 0) return null;
  const fiveKSec = predictRaceTime(vdot, 3.10686);
  if (fiveKSec == null) return null;
  return Math.round(fiveKSec / 3.10686);
}

/**
 * 2026-07-07 · AUDIT P1-56 · factored out of vdotFromRun (see its doc comment
 * below for the full gate rationale) so the below-table anchor fallback
 * (bestRecentVdot's belowTableAnchor) can apply the IDENTICAL honesty gate
 * (distance floor + quality-type-or-hard-HR) without duplicating it — an easy
 * conversational run must not become a fitness anchor just because its
 * implied VDOT happens to land below 30. Pure refactor: behavior unchanged,
 * same two conditions vdotFromRun checked inline before this split.
 */
export function passesRunHonestyGate(input: {
  finishSeconds: number;
  distanceMi: number;
  workoutType?: string | null;
  avgHr?: number | null;
  maxHr?: number | null;
  minDistanceMi?: number;
}): boolean {
  if (!input.finishSeconds || input.finishSeconds < 60) return false;
  const floorMi = input.minDistanceMi ?? 4;
  if (!input.distanceMi || input.distanceMi < floorMi) return false;
  const wType = String(input.workoutType ?? '').toLowerCase();
  const isQuality = QUALITY_RUN_TYPES.has(wType);
  const hrFloor = input.maxHr ? input.maxHr * 0.80 : null;
  const isHardEffort = input.avgHr != null && hrFloor != null && input.avgHr >= hrFloor;
  return isQuality || isHardEffort;
}

/**
 * Derive VDOT from a single sustained training run.
 *
 * Treats the run as a "virtual race" at its actual pace + distance and
 * inverts Daniels' formula (same as vdotFromRace). The catch: a run is only
 * VDOT-readable if effort was honest, otherwise pace doesn't reflect fitness.
 * Gates (factored into passesRunHonestyGate above):
 *   - Workout type is in QUALITY_RUN_TYPES (the plan called for hard work), OR
 *   - avg HR ≥ 80% of max HR (independent evidence of threshold-or-harder effort)
 * AND distance ≥ 4 miles (shorter runs are too noisy to lock VDOT off of).
 *
 * Returns null when the run doesn't pass the gate or VDOT lands outside [30,85].
 *
 * Cite: Research/01-pace-zones-vdot.md §Daniels-T-pace + §VDOT-table (same
 * Daniels formula as vdotFromRace, applied to workout pace).
 */
export function vdotFromRun(input: {
  finishSeconds: number;
  distanceMi: number;
  workoutType?: string | null;
  avgHr?: number | null;
  maxHr?: number | null;
  /** 2026-06-11 · the prescribed training zone (from the plan, when the run
   *  matched a plan quality day). Overrides the zone inferred from workoutType.
   *  Lets a threshold/marathon-pace effort read by its zone instead of as a
   *  race — see below. */
  zone?: 'threshold' | 'marathon' | 'interval' | 'race' | null;
  /** 2026-06-15 · goal-relative minimum honest-effort distance (vdotRunFloorMi).
   *  Defaults to the legacy flat 4mi floor; a 5K-goal runner passes 3.0 so their
   *  ~3.1mi quality efforts become VDOT-readable instead of being silently
   *  rejected. The HR gate below still guards effort honesty. */
  minDistanceMi?: number;
}): number | null {
  if (!passesRunHonestyGate(input)) return null;

  // 2026-06-11 · zone-aware read. A sustained sub-maximal effort (threshold,
  // marathon pace) is NOT an all-out race — reading it via vdotFromRace
  // understates VDOT ~3 points, so a tempo at the right pace could never move
  // current fitness off a stale race anchor (David's repeated ask). Invert the
  // Daniels ZONE mapping for those. Intervals (I-pace ≈ 3-5K race pace) and
  // races read correctly as a race, so they keep vdotFromRace. bestRecentVdot
  // takes the MAX, so this can only RAISE current fitness from honest training,
  // never lower it.
  const wType = String(input.workoutType ?? '').toLowerCase();
  const zone = input.zone ?? zoneFromType(wType);
  const pace = input.finishSeconds / input.distanceMi;
  if (zone === 'threshold') return vdotFromTpace(pace);
  if (zone === 'marathon') return vdotFromMpace(pace);
  return vdotFromRace(input.finishSeconds, input.distanceMi);
}

/**
 * Best (highest) VDOT from races AND optional training runs within the
 * lookback window.
 *
 * Race candidates: skip C-races; skip without finish time; cap at lookback.
 * Run candidates: gated by vdotFromRun's quality filter (see above).
 *
 * Ordering doctrine (resolved 2026-08-17, see the sort below for history):
 *   1. Fresh-race precedence — a race ≤ FRESH_RACE_PRECEDENCE_DAYS old
 *      demotes every fade-tail candidate below the in-window field.
 *   2. Races at (effective) face value; cap-bounded training runs at their
 *      capped face value (the AUDIT #8 soft cap — not a sort penalty — is
 *      what bounds training influence to the doctrinal +1 lead).
 *   3. Race wins EXACT ties against a run (stable sort, races first).
 *
 * 2026-06-09 · race-killer F1 — STALE-ANCHOR FADE. The hard window used
 * to cliff: the day an anchor crossed `lookbackDays` it vanished and the
 * next-best (often much slower) race took over overnight. Production
 * case: Disney HM (Feb 1, 47.9) was due to exit the 180-day window on
 * Aug 1 — VDOT 47.9 → 44.1 (LA Marathon), HM projection 1:34:54 →
 * 1:41:55, fifteen days before the A-race, with zero fitness change.
 *
 * Now: candidates keep FULL value through `lookbackDays`, then fade at
 * 0.1 VDOT per 14 days for up to `FADE_TAIL_DAYS` more before dropping
 * out entirely. This is estimator smoothing, not physiology — the same
 * staleness judgment the hard window already encoded, applied gradually
 * instead of as a step function. Newer evidence (a race or qualifying
 * run) still takes over the moment it scores higher — the fade only
 * governs how an aging anchor exits. Fresh anchors are unaffected:
 * age ≤ lookbackDays → effective ≡ raw. Recency-over-age precedent:
 * Research/02-race-time-prediction.md §"estimate the exponent from two
 * RECENT races". Cite: docs/ADVERSARIAL-AUDIT-REPORT.md §F1.
 *
 * 2026-08-17 · F1 REGRESSION (the fade that never fired). The fade above
 * shipped, and its unit tests passed — feeding candidates in-memory. But
 * loadVdotInputs (lib/training/vdot-inputs.ts) kept a hard `windowDays`
 * (180d) SQL cutoff, so no candidate in the fade window (age 180..300)
 * ever REACHED this function in production. The cliff this block exists
 * to prevent happened anyway, on schedule: Disney HM exited the SQL
 * window overnight on Aug 1 → 47.9 → 44.1, 15 days before the A-race.
 * Fix: FADE_TAIL_DAYS is exported and the loader fetches races over
 * `windowDays + FADE_TAIL_DAYS` — bestRecentVdot owns staleness; the
 * loader's job is only to deliver every candidate the fade can still see.
 */
export const FADE_PER_14D = 0.1;

/**
 * DOCTRINE-2 (2026-08-17) · THE FRESHNESS WINDOW IS 56 DAYS, NOT 180.
 *
 * `bestRecentVdot`'s `lookbackDays` defaulted to 180 and every caller passed
 * 180 explicitly. `Research/01-pace-zones-vdot.md` §"Freshness window" is a
 * four-row table that says the opposite:
 *
 *   | 0-4 weeks  | Fresh signal. Use without adjustment.                     |
 *   | 4-8 weeks  | Slightly stale. Still usable...                           |
 *   | 8-12 weeks | Stale... Use only as a floor, prompt for a fresh test.     |
 *   | 12+ weeks  | Expired. Don't anchor pace prescription on this VDOT.      |
 *
 * and §"Implementation notes" writes the rule directly at this engine:
 * "**Window** — use ≤56 days as the canonical freshness window."
 *
 * 180 days is 3.5× that, and this one constant sets every prescribed pace for
 * every runner in the app. Three bands now, matching the doc's own rows:
 *
 *   age ≤ 56 d   FULL VALUE. The canonical anchor.
 *   56 - 84 d    FLOOR ONLY. Still an honest read, but it cannot outrank
 *                in-window evidence however large it is — doctrine's "use only
 *                as a floor". With nothing fresher it still anchors, because a
 *                floor you have beats a guess you don't.
 *   > 84 d       EXPIRED. Not a candidate. Refuse to anchor.
 *
 * COHERENCE WITH THE F1 FADE AND FRESH-RACE PRECEDENCE (both landed earlier
 * today, `c05fad5b`). Neither is reverted; both are re-scoped onto the doctrine
 * window. The fade still smooths the exit — it now runs across the 56-84 day
 * floor-only band instead of 180-300 — so an anchor still glides out rather
 * than cliffing. Fresh-race precedence still fires; it is now a strictly
 * narrower case of the floor-only demotion below (a fresh race is one kind of
 * in-window evidence), and is kept because it is the case doctrine names
 * explicitly: "Use field test or recent race instead."
 *
 * FADE_TAIL_DAYS is the width of the floor-only band, so the loader's fetch
 * window (`windowDays + FADE_TAIL_DAYS`) lands exactly on the expiry line.
 *
 * Cite: Research/01-pace-zones-vdot.md §"Freshness window" · §"Implementation notes"
 */
export const VDOT_FULL_VALUE_DAYS = 56;
export const VDOT_EXPIRY_DAYS = 84;
export const FADE_TAIL_DAYS = VDOT_EXPIRY_DAYS - VDOT_FULL_VALUE_DAYS;

/**
 * 2026-08-17 · FRESH-RACE PRECEDENCE over faded anchors.
 *
 * The fade fixed the cliff, but max-wins across the whole candidate set
 * created the next honesty bug: a 6-month-old faded anchor (Disney,
 * effective 47.8 at age ~197d) would outrank a FRESH A-race result run
 * two days ago (AFC Half, VDOT 44.1) purely on magnitude. Doctrine says
 * the opposite. Research/01-pace-zones-vdot.md §"Freshness window":
 * 0–4 weeks is "Fresh signal. Use without adjustment"; 12+ weeks is
 * "Expired. Don't anchor pace prescription on this VDOT. Use field test
 * or recent race instead." A race inside the fresh window IS the "recent
 * race" the expired anchor must yield to.
 *
 * Rule: when any race candidate is ≤ FRESH_RACE_PRECEDENCE_DAYS old
 * (4 weeks — the doc's "0–4 weeks" fresh band), every candidate already
 * PAST the full-value window (age > lookbackDays, i.e. in the fade tail)
 * is demoted below all in-window candidates, regardless of magnitude.
 * Within the window, selection is unchanged — "pick the highest derived
 * VDOT, not the most recent" (same section, §"Implementation notes").
 * With no fresh race, faded anchors still glide out gradually — the fade
 * exists precisely for the no-fresh-evidence case.
 */
export const FRESH_RACE_PRECEDENCE_DAYS = 28;

/**
 * AUDIT #8 (2026-06-16) · TRAINING-ESTIMATE SOFT CAP.
 *
 * Research/01 §"Triggers to retest" is explicit: only a RACE/TT (all-out,
 * well-paced) UPDATES VDOT. A tempo that "feels notably easier at the same
 * target pace" is a SOFT LEAD — "+1 VDOT estimated; field-test within 2 weeks",
 * NOT a fresh fitness number. `vdotFromRun` (via vdotFromTpace/vdotFromMpace)
 * reads a sustained sub-maximal effort into its full zone-implied VDOT, which is
 * mathematically right for a runner running AT their true pace — but it lets a
 * single good-day / cool-weather / slightly-fast tempo manufacture a multi-point
 * race-grade jump off an UNCONFIRMED effort. Because `bestRecentVdot` takes the
 * MAX, that jump can only inflate current fitness, never correct back down.
 *
 * Fix: when a recent RACE anchor exists, bound any TRAINING-derived candidate to
 * `bestRaceRaw + 1.0` — the doctrinal soft-estimate quantum above the last hard
 * proof of fitness. Training can nudge the read up by +1 (the LEAD), but cannot
 * stand in for the race/field-test the doctrine requires for more. With NO race
 * anchor, nothing to cap against and the gated training read stands (a 5K TT IS
 * a valid VDOT input — Research/01 §"Field-test protocols").
 *
 * This is the live current-VDOT snapshot path (snapshot-projections cron, plan
 * generator, drift monitor). The doctrine-correct projection-space over-read
 * (goal-projection.ts, commit 3ba8529a) is a SEPARATE, intentionally-capped
 * mechanism and is unaffected.
 */
const TRAINING_ESTIMATE_SOFT_CAP_VDOT = 1.0;

/**
 * 2026-07-07 · AUDIT P1-56 · the honest sub-table read. When NOTHING in scope
 * produces a valid VDOT candidate (every race/run implies < 30), the runner is
 * NOT dataless — they have a demonstrated pace, just one below the cited
 * Daniels table. Instead of the whole read silently collapsing to null, carry
 * the best-effort AnchorPace forward (see tPaceFromAnchorPace above) so callers
 * can derive honest training paces off it. Mirrors VdotCandidate's shape
 * (source/date/name/priority/distance/finish) minus the vdot fields, since none
 * exist for a below-table effort.
 */
export interface BelowTableAnchor {
  source: 'race' | 'run';
  /** Race slug or run id, whichever produced this candidate. */
  refId: string;
  name: string | null;
  date: string;
  distance_mi: number;
  finish_seconds: number;
  age_days: number;
  anchor: AnchorPace;
}

export function bestRecentVdot(
  races: Array<{ slug: string; name: string; date: string; priority: string | null; distance_mi: number | null; finish_seconds: number | null }>,
  todayISO: string,
  lookbackDays = VDOT_FULL_VALUE_DAYS,
  runs?: Array<{
    id: string;
    date: string;
    workout_type: string | null;
    distance_mi: number | null;
    finish_seconds: number | null;
    avg_hr?: number | null;
    max_hr?: number | null;
    /** Prescribed training zone for the zone-aware read (vdotFromRun). */
    zone?: 'threshold' | 'marathon' | 'interval' | 'race' | null;
  }>,
  /** 2026-06-15 · goal-relative run floor (vdotRunFloorMi). Default 4mi keeps
   *  legacy behavior for every caller that doesn't pass it; a 5K-goal caller
   *  passes 3.0 so the runner's ~3.1mi efforts count as fitness candidates. */
  minRunDistanceMi: number = 4,
): { best: VdotCandidate | null; considered: VdotCandidate[]; belowTableAnchor: BelowTableAnchor | null } {
  const todayMs = Date.parse(todayISO + 'T12:00:00Z');
  // Hard cutoff now includes the fade tail; the fade handles 180→300.
  const cutoff = new Date(todayMs - (lookbackDays + FADE_TAIL_DAYS) * 86400000).toISOString().slice(0, 10);

  const ageDays = (dateISO: string): number =>
    Math.max(0, Math.round((todayMs - Date.parse(dateISO + 'T12:00:00Z')) / 86400000));
  const effective = (raw: number, age: number): number => {
    const over = Math.max(0, age - lookbackDays);
    const faded = raw - (over / 14) * FADE_PER_14D;
    return Math.round(faded * 10) / 10;
  };

  // P1-56 · best below-table race candidate seen, tracked alongside the normal
  // race loop so eligibility (date window) matches exactly. Race wins over run
  // for this fallback too, same doctrine as the main sortKey (race ties beat
  // training estimates) — simplified here to "any race beats any run" since
  // these are honest-effort anchors either way once we're off the VDOT table
  // (no soft-cap to apply).
  //
  // 2026-08-17 · now that a C race is a candidate, "best" is graded before it is
  // timed: a representative race beats a compromised one, and only within a band
  // does the fastest pace win. This is the below-table mirror of the authority
  // tier in the main sort. The authority is a local rather than a field on
  // `BelowTableAnchor` — that interface is constructed by callers and tests, and
  // widening it would be churn for a value nothing downstream reads.
  let belowTableRace: BelowTableAnchor | null = null;
  let belowTableRaceAuthority = 0;
  let belowTableRun: BelowTableAnchor | null = null;

  const raceCandidates: RaceVdotCandidate[] = [];
  for (const r of races) {
    if (!r.date || !r.distance_mi || !r.finish_seconds) continue;
    if (r.date < cutoff) continue;
    // 2026-08-17 · the `if (r.priority === 'C') continue` that stood here is
    // GONE, together with the `IN ('A','B')` filter in vdot-inputs.ts. Every
    // race is a candidate; `authority` below is what decides its weight.
    const authority = selectionAuthority(r.priority);
    const v = vdotFromRace(r.finish_seconds, r.distance_mi);
    if (v == null) {
      // Below (or above) the [30,85] table — not silently dropped. Below-30
      // is by far the common real case (above-85 is a data error, not a
      // runner); anchorPaceFrom is agnostic and a >85 anchor would just never
      // win a comparison against real candidates, so no extra guard needed.
      const anchor = anchorPaceFrom(r.finish_seconds, r.distance_mi);
      const beatsIncumbent =
        belowTableRace == null ||
        authority > belowTableRaceAuthority ||
        (authority === belowTableRaceAuthority &&
          anchor != null && anchor.paceSPerMi < belowTableRace.anchor.paceSPerMi);
      if (anchor && beatsIncumbent) {
        belowTableRace = {
          source: 'race', refId: r.slug, name: r.name, date: r.date,
          distance_mi: r.distance_mi, finish_seconds: r.finish_seconds,
          age_days: ageDays(r.date), anchor,
        };
        belowTableRaceAuthority = authority;
      }
      continue;
    }
    const age = ageDays(r.date);
    raceCandidates.push({
      source: 'race',
      slug: r.slug, name: r.name, date: r.date, priority: r.priority,
      distance_mi: r.distance_mi, finish_seconds: r.finish_seconds,
      vdot: effective(v, age), vdot_raw: v, age_days: age,
      authority, authority_tier: authorityTier(authority),
    });
  }

  /**
   * 2026-08-17 · THE AUTHORITY TIER · rule 8 reaches selection.
   *
   * `Research/00b` §"Recovery by Effort" grades a C race "Strong effort, no
   * taper … treat like a hard workout", and `Research/01` §"Triggers to retest"
   * only licenses "Update VDOT from race" for a result that was "all-out,
   * well-paced". A race below the B row is therefore not the thing doctrine
   * says updates VDOT, however large its number.
   *
   * Ranked, not removed, and only against BETTER-GRADED RACES. Same idiom as
   * the staleness demotion directly below: the rule bites only when the runner
   * actually has the better evidence. With no representative race in the
   * window, a C race is not demoted at all — it competes at face value, it sets
   * the training soft-cap ceiling, and if it is the only candidate it is the
   * anchor. A floor you have beats a guess you don't.
   *
   * Deliberately scoped race-against-race. Training runs carry their own two
   * bounding mechanisms (the AUDIT #8 soft cap and the superseded-lead rule);
   * inventing a cross-source ordering between a C race and a tempo would be a
   * third, unbacked one. What the C race DOES do to runs is bound them, by
   * setting the ceiling — so the anchor can never drift more than the doctrinal
   * +1 above the C race even when a tempo outranks it.
   */
  const representativeRaceExists = raceCandidates.some((c) => c.authority >= REPRESENTATIVE_FLOOR);
  const authorityDemoted = (c: VdotCandidate): boolean =>
    c.source === 'race' && representativeRaceExists && c.authority < REPRESENTATIVE_FLOOR;

  // DOCTRINE-2 · FLOOR-ONLY DEMOTION. Research/01 §"Freshness window" calls an
  // 8-12 week anchor stale and says to "use only as a floor". So a candidate
  // past the full-value window ranks below EVERY in-window candidate, however
  // much larger it is — it can still anchor when nothing fresher exists (a
  // floor you have beats a guess you don't), but it can never outrank current
  // evidence. This generalises the fresh-race precedence added earlier today:
  // a fresh race is one kind of in-window evidence, and the ≤28-day race case
  // doctrine names explicitly ("use field test or recent race instead") is
  // preserved verbatim below as the reason this rule exists.
  //
  // Note run candidates arrive from a 60-day loader window, so in practice it
  // is races that get demoted; the predicate is uniform anyway.
  const floorOnly = (c: { age_days: number }): boolean => c.age_days > lookbackDays;
  const inWindowRaceExists = raceCandidates.some((c) => !floorOnly(c));
  // The soft-cap ceiling is resolved from RACES only (runs are what it bounds,
  // so including them would be circular). Semantics are unchanged from the
  // fresh-race-precedence version — only the window moved.
  const demotedForCeiling = (c: { age_days: number }): boolean =>
    inWindowRaceExists && floorOnly(c);

  // AUDIT #8 · soft-cap ceiling for training-derived candidates. The best RAW
  // race VDOT in scope is the last hard proof of fitness; a training estimate
  // may exceed it by at most the doctrinal +1 LEAD. Null when no race anchor
  // exists → training reads are uncapped (see TRAINING_ESTIMATE_SOFT_CAP_VDOT).
  //
  // 2026-08-17 · precedence-demoted races are excluded from the ceiling: once
  // a fresh race supersedes an expired anchor for the headline, that same
  // expired anchor cannot keep licensing training reads above the fresh
  // proof (+1 off a 197-day-old 47.9 while the runner just raced 44.1 would
  // grant a ~48.9 ceiling off evidence the doctrine calls expired). The cap
  // anchors to the same evidence the headline trusts. With no fresh race,
  // scope is unchanged: the best raw race in the full fade-visible window.
  //
  // 2026-08-17 (authority) · AUTHORITY-demoted races are excluded on the same
  // principle, and it is the same sentence: the cap anchors to the evidence the
  // headline trusts. Without this, a C race that read high would be barred from
  // the headline and then hand every training run a ceiling +1 above itself —
  // laundering the demoted race straight back in through the runs. Note the
  // predicate is inert when no representative race exists, so a C-race-only
  // runner still gets a ceiling off their C race rather than none.
  const excludedFromCeiling = (c: RaceVdotCandidate): boolean =>
    demotedForCeiling(c) || authorityDemoted(c);
  const bestRaceRaw = raceCandidates.reduce<number | null>(
    (max, c) => (excludedFromCeiling(c) ? max
      : (max == null || c.vdot_raw > max ? c.vdot_raw : max)), null);
  const trainingCeiling = bestRaceRaw != null
    ? bestRaceRaw + TRAINING_ESTIMATE_SOFT_CAP_VDOT : null;

  const runCandidates: RunVdotCandidate[] = [];
  if (runs && runs.length > 0) {
    for (const r of runs) {
      if (!r.date || r.date < cutoff) continue;
      if (!r.distance_mi || !r.finish_seconds) continue;
      const v = vdotFromRun({
        finishSeconds: r.finish_seconds,
        distanceMi: r.distance_mi,
        workoutType: r.workout_type,
        avgHr: r.avg_hr ?? null,
        maxHr: r.max_hr ?? null,
        zone: r.zone ?? null,
        minDistanceMi: minRunDistanceMi,
      });
      // 2026-07-07 · CODE-REVIEW FINDING (P1-56 second regression) · v == null
      // is NOT the only below-table signal. vdotFromRun's zone-aware paths
      // (vdotFromTpace/vdotFromMpace, used for threshold/tempo/marathon-pace
      // workout types) binary-search a [30,85]-bounded VDOT and silently
      // CONVERGE TO THE 30 FLOOR instead of failing when the true implied
      // VDOT is below it — unlike vdotFromRace, which explicitly returns null
      // outside [30,85]. So a below-table hard effort read via the zone path
      // comes back as a false "VDOT 30", not null, and the `v == null` branch
      // below never saw it. Detect the clamp directly: re-derive the pace the
      // zone read is BASED ON and compare it to what VDOT 30 predicts for that
      // same zone — if the runner's actual pace is honestly slower than the
      // VDOT-30 floor's pace, the read was clamped, not a genuine VDOT-30
      // effort, regardless of whether vdotFromRun returned 30 or null.
      const isClampedToFloor = v != null && (() => {
        const wType = String(r.workout_type ?? '').toLowerCase();
        const zone = r.zone ?? zoneFromType(wType);
        if (zone !== 'threshold' && zone !== 'marathon') return false;
        if (v > 30) return false; // a real (non-boundary) VDOT read — trust it
        const pace = r.finish_seconds / r.distance_mi;
        const floorPace = zone === 'threshold' ? tPaceFromVdot(30) : predictRaceTime(30, 26.2188)! / 26.2188;
        return floorPace != null && pace > floorPace + 2; // honestly slower than VDOT 30's own pace
      })();
      if (v == null || isClampedToFloor) {
        // P1-56 · same honesty gate vdotFromRun applies (passesRunHonestyGate),
        // checked separately here so a below-30 read from a GATED effort still
        // becomes a belowTableAnchor candidate, while a gate failure (easy run,
        // too short) does not. vdotFromRun's null is ambiguous between the two;
        // re-checking the gate resolves it without duplicating the zone math.
        if (passesRunHonestyGate({
          finishSeconds: r.finish_seconds, distanceMi: r.distance_mi,
          workoutType: r.workout_type, avgHr: r.avg_hr ?? null, maxHr: r.max_hr ?? null,
          minDistanceMi: minRunDistanceMi,
        })) {
          const anchor = anchorPaceFrom(r.finish_seconds, r.distance_mi);
          if (anchor && (belowTableRun == null || anchor.paceSPerMi < belowTableRun.anchor.paceSPerMi)) {
            belowTableRun = {
              source: 'run', refId: r.id, name: r.workout_type, date: r.date,
              distance_mi: r.distance_mi, finish_seconds: r.finish_seconds,
              age_days: ageDays(r.date), anchor,
            };
          }
        }
        continue;
      }
      const age = ageDays(r.date);
      // AUDIT #8 · cap the training read at race-anchor + the soft-estimate
      // quantum before the stale fade. Math.round keeps the 1-decimal contract.
      const capped = trainingCeiling != null
        ? Math.round(Math.min(v, trainingCeiling) * 10) / 10 : v;
      runCandidates.push({
        source: 'run',
        id: r.id, date: r.date, workout_type: r.workout_type,
        distance_mi: r.distance_mi, finish_seconds: r.finish_seconds,
        // Run candidates live in a 60-day loader window — well inside
        // lookbackDays, so effective ≡ raw today; kept uniform anyway.
        vdot: effective(capped, age), vdot_raw: capped, age_days: age,
      });
    }
  }

  // Sort: two tiers, then value.
  //
  // Tier · fresh-race precedence (FRESH_RACE_PRECEDENCE_DAYS). Fade-tail
  // candidates rank below every in-window candidate when a fresh race exists;
  // otherwise tiers are uniform and this term is inert.
  //
  // Value · races at (effective) face value. Runs:
  //
  // 2026-08-17 · RESOLVED DOCTRINE (run-evidence cancellation fix). The old
  // key penalized every run by exactly 1.0 ("race wins ties"). But when a
  // race anchor exists, runs are ALREADY bounded to bestRaceRaw + 1.0 by the
  // AUDIT #8 soft cap — so the permitted +1 LEAD and the −1 penalty cancelled
  // to zero and training evidence could NEVER move the headline off a race
  // anchor, by construction (David's Aug 9 tempo: read 45.3 → capped 45.1 →
  // sortKey 44.1 → tie → the March race won). The anti-noise job the penalty
  // was doing ("a single hot GPS run must not spike VDOT") is the CAP's job,
  // and the cap does it: training may lead the last hard proof by at most the
  // doctrinal +1 soft-estimate quantum (Research/01 §"Testing cadence": tempo
  // notably easier → "+1 VDOT estimated"). So cap-bounded runs sort at their
  // capped face value — a capped run genuinely leads by up to +1, monotone in
  // evidence strength. Race still wins EXACT ties: sort() is stable (ES2019)
  // and races precede runs in the concatenation below. The −1 penalty is kept
  // only for the no-race-anchor scope (trainingCeiling == null), where no cap
  // bounds the read — there it preserves the historical run-vs-run ordering
  // and the race-wins-ties intent should an uncapped run ever meet a race.
  const runsCapBounded = trainingCeiling != null;
  const sortKey = (c: VdotCandidate) =>
    c.source === 'race' ? c.vdot : (runsCapBounded ? c.vdot : c.vdot - 1);

  /**
   * 2026-08-17 · SUPERSEDED-LEAD DOCTRINE.
   *
   * `Research/01` §"Testing cadence" is explicit about what a good training run
   * IS: a tempo that feels notably easier at target pace is worth "+1 VDOT
   * estimated; field-test within 2 weeks". A SOFT LEAD, and a request for a
   * test — not a fitness number. The AUDIT #8 cap above enforces the +1
   * magnitude faithfully. Nothing enforced the second half of the sentence.
   *
   * The failure that exposed it: David raced an A-priority half on 2026-08-16
   * in 1:41:53 → VDOT 44.1. Four training runs — the oldest a 4-mile tempo from
   * 55 days earlier — were each capped to `bestRaceRaw + 1.0` = 45.1, tied at
   * the ceiling, and outranked the race by exactly the permitted lead. His
   * anchor the day after his goal race was a two-month-old tempo run. Because
   * the cap pins every lead to the same value, this is not an edge case: once a
   * runner has ANY qualifying training run, their races can never anchor them.
   *
   * The rule doctrine implies: a lead is RESOLVED by the test it asked for. A
   * training estimate older than a race cannot outrank that race, whatever its
   * magnitude — the field test came back, and it is the answer. Training runs
   * SINCE the race still lead by up to +1, because that is new evidence
   * acquired after the last hard proof, which is precisely the case the soft
   * lead exists to describe.
   *
   * ── 2026-08-17 · IT HAS TO BE A TEST TO RESOLVE A TEST ───────────────────
   *
   * The rule shipped keyed on the freshest race's DATE with no predicate on
   * what that race was, which was safe only because the A/B filter upstream
   * guaranteed it was a graded one. Opening the pool removes that guarantee and
   * the rule inverts: a parkrun jogged as a workout becomes "the field test"
   * and demotes every legitimate training lead behind it, deleting real
   * evidence on the authority of a race nobody raced.
   *
   * Doctrine is precise about which result answers the question. `Research/01`
   * §"Triggers to retest" licenses "Update VDOT from race" for a "New race
   * result (any distance, all-out, well-paced …)", and `Research/00b`'s C row
   * is neither all-out nor tapered — it is "treat like a hard workout". A hard
   * workout does not resolve the field test that another hard workout asked
   * for. So the date that supersedes is the freshest race AT OR ABOVE THE
   * REPRESENTATIVE FLOOR: the same B row that is doctrine's boundary for a
   * result standing as a performance. Existing behaviour is unchanged for every
   * A and B race, which is every race that could reach this rule before today.
   */
  const freshestRaceDate = raceCandidates.reduce<string | null>(
    (max, r) => (r.date && r.authority >= REPRESENTATIVE_FLOOR && (!max || r.date > max) ? r.date : max),
    null,
  );
  // `<=`, not `<`. A run dated the SAME day as the race is almost always that
  // race re-ingested from Strava, or its warm-up — so treating it as fresh
  // evidence would let the race lead itself by +1 and inflate every runner's
  // anchor on the day they race. Strictly-later runs are genuine new evidence.
  const supersededLead = (c: VdotCandidate): boolean =>
    c.source === 'run' && freshestRaceDate != null && c.date <= freshestRaceDate;
  // DOCTRINE-2 · a floor-only (56-84 day) candidate ranks below every in-window
  // candidate of either source. With no in-window evidence at all the tier term
  // is uniform and the stale anchor still wins — it is the floor doctrine says
  // to keep using until a fresh test replaces it.
  const inWindowExists = inWindowRaceExists || runCandidates.some((c) => !floorOnly(c));
  const demoted = (c: { age_days: number }): boolean => inWindowExists && floorOnly(c);
  // Tier order · staleness, then authority, then superseded leads, then value.
  //
  // Authority sits BELOW staleness because the two answer different questions
  // and staleness is the harder one: doctrine calls a 12-week-old anchor
  // "Expired. Don't anchor pace prescription on this VDOT" with no appeal,
  // where a low-authority race is current evidence that is simply worth less.
  //
  // Authority sits ABOVE the superseded-lead tier because it now feeds it: a
  // race has to clear the floor to supersede anything at all.
  //
  // AUTHORITY NEVER TOUCHES `sortKey`. A candidate's `vdot` is a statement
  // about a performance that actually happened, and it is read by display
  // surfaces and by `predictRaceTime`. Scaling it would invent a finish time
  // nobody ran — the neutral-equivalent lever `Research/06` §10 offers and that
  // rule 8 deliberately declines in favour of scaling the ADJUSTMENT
  // (representativeness.ts, double-counting trap B). Selection decides WHICH
  // evidence anchors; it must not restate WHAT the evidence said.
  const considered = [...raceCandidates, ...runCandidates]
    .sort((a, b) =>
      ((demoted(b) ? 0 : 1) - (demoted(a) ? 0 : 1)) ||
      ((authorityDemoted(b) ? 0 : 1) - (authorityDemoted(a) ? 0 : 1)) ||
      ((supersededLead(b) ? 0 : 1) - (supersededLead(a) ? 0 : 1)) ||
      (sortKey(b) - sortKey(a)));

  // P1-56 · belowTableAnchor is populated ONLY when there is no real (in-table)
  // candidate at all — a runner with a valid race VDOT never falls back to a
  // sub-30 anchor even if one exists (e.g. an old slow 5K before they got
  // faster). Race beats run when both exist, matching the main sortKey's
  // "race wins ties" doctrine (no soft-cap applies here — both are honest
  // demonstrated efforts, no VDOT to bound).
  const belowTableAnchor: BelowTableAnchor | null =
    considered.length > 0 ? null : (belowTableRace ?? belowTableRun);

  return { best: considered[0] ?? null, considered, belowTableAnchor };
}

/**
 * 2026-07-07 · AUDIT P1-56 · THE resolution cascade for "what T-pace should
 * quality/easy/long work anchor to right now," replacing the
 * `tPaceFromVdot(bestRecentVdot ?? conservativeVdotFromMileage(mi))` pattern
 * that appeared at every call site (generate.ts:1844/3575, reanchor-
 * maintenance.ts:61,126). That pattern had exactly one fallback tier — mileage
 * — which floors at VDOT 30 (T-pace ~10:41/mi) regardless of how slow the
 * runner's OWN races actually are, so a 25mi/wk runner racing 12+ min/mi got
 * quality prescribed faster than their demonstrated race pace (P1-56's exact
 * failure mode).
 *
 * Three tiers, each strictly more conservative than the last, all honest:
 *   1. measuredVdot != null       → tPaceFromVdot(measuredVdot)        (real fitness read)
 *   2. belowTableAnchor present   → tPaceFromAnchorPace(anchor)        (real pace, off-table VDOT)
 *   3. neither                    → tPaceFromVdot(conservativeVdotFromMileage(mi)) (volume-only estimate — the
 *                                    ORIGINAL fallback, unchanged; genuinely no
 *                                    demonstrated-pace evidence exists yet)
 *
 * Tier 2 is what's new: an honest race/run anchor beats a volume-only guess
 * every time it exists, because it is measured pace, not inferred pace. This
 * mirrors bestRecentVdot's own precedence (a measured VDOT always beats
 * conservativeVdotFromMileage) one level down, for the runners the VDOT scale
 * itself can't represent.
 *
 * Returns `{ tPaceSec, tier, anchor }` — tier is threaded through so callers
 * (and tests) can assert which rung fired instead of only checking the number.
 */
export type TPaceResolutionTier = 'measured_vdot' | 'below_table_anchor' | 'mileage_estimate';

export function resolveCurrentTPace(
  measuredVdot: number | null | undefined,
  belowTableAnchor: BelowTableAnchor | null | undefined,
  weeklyMi: number,
  conservativeVdotFromMileageFn: (weeklyMi: number) => number,
): { tPaceSec: number | null; tier: TPaceResolutionTier; anchorPaceSPerMi: number | null } {
  if (measuredVdot != null) {
    return { tPaceSec: tPaceFromVdot(measuredVdot), tier: 'measured_vdot', anchorPaceSPerMi: null };
  }
  if (belowTableAnchor != null) {
    const t = tPaceFromAnchorPace(belowTableAnchor.anchor);
    if (t != null) {
      // Falsifiable requirement #3 backstop, WIRED (not just unit-tested in
      // isolation). tPaceFromAnchorPace reuses spec-builder's GOAL-anchored
      // offset table (-18 marathon-tier / -5 half-tier) applied to a MEASURED
      // anchor pace instead of a goal pace — for those two tiers the offset
      // can land T-pace faster than the runner's own demonstrated race pace
      // (e.g. a 900s/mi marathon anchor -> 882s/mi T, 18s/mi faster than the
      // anchor). clampToSanePace enforces the non-negotiable invariant that no
      // prescribed pace may be faster than the anchor it was derived from,
      // regardless of which distance tier or offset produced it.
      const clamped = clampToSanePace(t, belowTableAnchor.anchor.paceSPerMi);
      return { tPaceSec: clamped, tier: 'below_table_anchor', anchorPaceSPerMi: belowTableAnchor.anchor.paceSPerMi };
    }
    // tPaceFromAnchorPace returns null only for an ultra-distance anchor
    // (>=31mi — T-pace isn't ultra-adjacent per PACE-5 doctrine); fall through
    // to the mileage estimate rather than leaving T-pace null.
  }
  return {
    tPaceSec: tPaceFromVdot(conservativeVdotFromMileageFn(weeklyMi)),
    tier: 'mileage_estimate',
    anchorPaceSPerMi: null,
  };
}

/**
 * 2026-07-07 · AUDIT P1-56 falsifiable requirement #3 · SANITY CLAMP. No
 * prescribed pace (seconds/mile) may be faster than the runner's own
 * demonstrated race/run pace for a distance <= the workout's own distance —
 * regardless of which tier above produced it, and regardless of any future
 * bug in the VDOT/offset math. This is the final backstop, not the primary
 * mechanism (tiers 1–3 above should already produce sane numbers); it exists
 * so a bad anchor, a stale VDOT, or an unanticipated interaction cannot
 * output a pace that contradicts data the app has already observed.
 *
 * `fastestPaceSPerMi` should be the runner's single fastest CREDIBLE
 * demonstrated pace at >= the target distance (callers typically pass the
 * anchor's own pace, or the fastest of {race anchor, below-table anchor}).
 * Returns the input unchanged when no anchor is known (nothing to clamp
 * against) or when the prescribed pace is already honest (slower-or-equal,
 * i.e. numerically >= the anchor in s/mi).
 */
export function clampToSanePace(
  prescribedSPerMi: number | null,
  fastestPaceSPerMi: number | null | undefined,
): number | null {
  if (prescribedSPerMi == null) return prescribedSPerMi;
  if (fastestPaceSPerMi == null || fastestPaceSPerMi <= 0) return prescribedSPerMi;
  return Math.max(prescribedSPerMi, fastestPaceSPerMi);
}
