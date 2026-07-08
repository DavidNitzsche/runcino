/**
 * VDOT — Daniels' fitness index derived from race performance.
 *
 * Cite: Research/01-pace-zones-vdot.md §vdot-table (Daniels Running Formula,
 * J. Daniels, 3rd ed., extended through VDOT 85 per project memory).
 *
 * Strategy:
 *   1. For each race in the past 6 months, look up the VDOT corresponding
 *      to (finish_time, distance).
 *   2. Return the highest (best). This naturally excludes slow C-races
 *      because a C-race effort produces a lower VDOT.
 *   3. Also exclude races flagged priority='C' explicitly.
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
 *  exactly that finish time. Returns null if outside [30, 85]. */
export function vdotFromRace(finishSeconds: number, distanceMi: number): number | null {
  if (!finishSeconds || finishSeconds < 60) return null;
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
  return { lo: t + 80, hi: t + 120 }; // matches spec-builder PACE-E-1 (Research/01 §VDOT-50 table: E = T+104..T+156, T+80 floor).
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
 * Cite: Daniels Running Formula §VDOT table (same formula as `vdotFromRace`).
 */
export function predictRaceTime(vdot: number, distanceMi: number): number | null {
  if (!vdot || vdot <= 0 || !distanceMi || distanceMi <= 0) return null;
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
export function vdotFromTpace(tPaceSPerMi: number): number | null {
  if (!tPaceSPerMi || tPaceSPerMi <= 0) return null;
  let lo = 30, hi = 85;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const tp = tPaceFromVdot(mid);
    if (tp == null) return null;
    // T-pace slower (larger s/mi) than target → VDOT too low → search up.
    if (tp > tPaceSPerMi) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
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
  priority: 'A' | 'B' | 'C' | null;
  distance_mi: number;
  finish_seconds: number;
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
 * Tie-break: race VDOT counts at face value; run VDOT is penalized by 1
 * point for sort purposes (a single real race always wins ties against
 * a training-derived estimate). This is the "race wins ties" doctrine.
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
 */
const FADE_PER_14D = 0.1;
const FADE_TAIL_DAYS = 120;

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
  races: Array<{ slug: string; name: string; date: string; priority: 'A'|'B'|'C'|null; distance_mi: number | null; finish_seconds: number | null }>,
  todayISO: string,
  lookbackDays = 180,
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

  // P1-56 · best (fastest pace) below-table race candidate seen, tracked
  // alongside the normal race loop so eligibility (date window, C-race
  // exclusion) matches exactly. Race wins over run for this fallback too,
  // same doctrine as the main sortKey (race ties beat training estimates) —
  // simplified here to "any race beats any run" since these are honest-effort
  // anchors either way once we're off the VDOT table (no soft-cap to apply).
  let belowTableRace: BelowTableAnchor | null = null;
  let belowTableRun: BelowTableAnchor | null = null;

  const raceCandidates: RaceVdotCandidate[] = [];
  for (const r of races) {
    if (!r.date || !r.distance_mi || !r.finish_seconds) continue;
    if (r.date < cutoff) continue;
    if (r.priority === 'C') continue;
    const v = vdotFromRace(r.finish_seconds, r.distance_mi);
    if (v == null) {
      // Below (or above) the [30,85] table — not silently dropped. Below-30
      // is by far the common real case (above-85 is a data error, not a
      // runner); anchorPaceFrom is agnostic and a >85 anchor would just never
      // win a comparison against real candidates, so no extra guard needed.
      const anchor = anchorPaceFrom(r.finish_seconds, r.distance_mi);
      if (anchor && (belowTableRace == null || anchor.paceSPerMi < belowTableRace.anchor.paceSPerMi)) {
        belowTableRace = {
          source: 'race', refId: r.slug, name: r.name, date: r.date,
          distance_mi: r.distance_mi, finish_seconds: r.finish_seconds,
          age_days: ageDays(r.date), anchor,
        };
      }
      continue;
    }
    const age = ageDays(r.date);
    raceCandidates.push({
      source: 'race',
      slug: r.slug, name: r.name, date: r.date, priority: r.priority,
      distance_mi: r.distance_mi, finish_seconds: r.finish_seconds,
      vdot: effective(v, age), vdot_raw: v, age_days: age,
    });
  }

  // AUDIT #8 · soft-cap ceiling for training-derived candidates. The best RAW
  // race VDOT in scope is the last hard proof of fitness; a training estimate
  // may exceed it by at most the doctrinal +1 LEAD. Null when no race anchor
  // exists → training reads are uncapped (see TRAINING_ESTIMATE_SOFT_CAP_VDOT).
  const bestRaceRaw = raceCandidates.reduce<number | null>(
    (max, c) => (max == null || c.vdot_raw > max ? c.vdot_raw : max), null);
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

  // Sort key: races at (effective) face value, runs -1 so a real race
  // wins ties against a training-derived estimate.
  const sortKey = (c: VdotCandidate) => (c.source === 'race' ? c.vdot : c.vdot - 1);
  const considered = [...raceCandidates, ...runCandidates]
    .sort((a, b) => sortKey(b) - sortKey(a));

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
