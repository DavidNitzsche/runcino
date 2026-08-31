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
  RUNNER_REPORTED_AUTHORITY_CAP,
  authorityTier,
  selectionAuthority,
  type AuthorityTier,
} from '@/lib/race/effort-authority';
import {
  corroboratedCorpusVdot,
  type CorpusObservation,
  type CorpusRead,
} from '@/lib/training/vdot-corpus';

/** Distance in km from a label. */
function kmFromMi(mi: number): number { return mi * 1.609344; }

/**
 * AUDIT #7 (2026-06-16) · Daniels MILE column, used to anchor the mile-range
 * path to Research/01's published table.
 *
 * AUDIT #7 originally measured the raw Daniels & Gilbert inversion "over-
 * reading by 4–6 VDOT" against this column. The 2026-08-28 table correction
 * (Research/REVIEW_NOTES.md A1) found the divergence was an artifact: the
 * doc's Mile column then held 1500m solutions mislabeled as miles, so the raw
 * mile inversion was being compared against 1500m data. The corrected column
 * is the true-mile (1609.34m) solution of the doc's own equations, which the
 * raw inversion reproduces to within rounding — so this table now agrees with
 * the equation at the mile. It is kept as the transcription the doctrine gate
 * binds (`PACE.repetition-is-mile-race-pace` walks every row), it clamps
 * cleanly at the 30/85 table edges, and it keeps mile-range behavior pinned
 * to the doc rather than to equation drift.
 *
 * Fix: for distances near the mile, interpolate the mile column
 * (Research/01 §VDOT lookup table — "Interpolate linearly between rows if
 * needed") instead of the raw equation. The 5K–marathon path is untouched.
 *
 * Column is the literal `Mile` column from Research/01, [VDOT, seconds],
 * sorted by VDOT ascending (so seconds descend). Corrected 2026-08-28: the
 * previous literals ([30, 510]…[85, 208]) were the mislabeled 1500m values
 * and priced R ~25–40 s/mi too fast.
 */
const MILE_VDOT_TABLE: ReadonlyArray<readonly [number, number]> = [
  [30, 550], [32, 520], [34, 493], [36, 469], [38, 447], [40, 427], [42, 409],
  [44, 392], [45, 384], [46, 377], [48, 363], [50, 350], [52, 338], [54, 327],
  [55, 321], [56, 316], [58, 306], [60, 297], [62, 289], [64, 281], [65, 277],
  [66, 273], [68, 266], [70, 259], [72, 253], [74, 247], [75, 244], [76, 241],
  [78, 236], [80, 231], [82, 226], [84, 221], [85, 219],
];

/** Distances (mi) for which the mile-table lookup applies. Narrowed 2026-08-28
 *  (was 0.9–1.3): the table maps a finish time to VDOT with no distance
 *  scaling, so it is only honest where the race IS a mile — the old wide
 *  window read a 1500m (0.93mi) finish as if it were a mile finish, which the
 *  corrected true-mile column would over-credit by ~4 VDOT. 1500m and other
 *  nearby distances now fall through to the raw equation, which the corrected
 *  Research/01 table shows reproduces the doc's own solutions at short
 *  distances (the old "over-reads at the mile" finding was an artifact of the
 *  mislabeled 1500m column — see Research/REVIEW_NOTES.md A1). */
const MILE_CORRECTION_MAX_MI = 1.05;
const MILE_CORRECTION_MIN_MI = 0.98;
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

/**
 * CEIL-ZONE-1 (2026-08-19) · the published table's VDOT range, named once.
 *
 * `Research/01-pace-zones-vdot.md` §Core terms: "Range: ~30 (beginner) to
 * 85+ (elite)". The pair was written as bare `30` / `85` in four places in this file
 * (`vdotFromRace`'s clamp, `vdotFromTpace`'s and `vdotFromMpace`'s search
 * bounds) and is now needed by a fifth reader (`vdotFromZonePace` in
 * plan-target.ts), which is one more copy than a range this load-bearing should
 * have. Bound by `PACE.daniels-table-range`.
 */
export const DANIELS_VDOT_MIN = 30;
export const DANIELS_VDOT_MAX = 85;

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
  if (vdot < DANIELS_VDOT_MIN || vdot > DANIELS_VDOT_MAX) return null;
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
  return easyBandFromTPace(t);
}

/**
 * 2026-08-31 · THE OFFSETS, IN ONE PLACE. Split out of
 * `easyPaceBandFromAnchorPace` (which now calls it) so a caller that already
 * holds a THRESHOLD PACE — `lib/training/capacity-resolver.ts`'s easy-ceiling
 * fallback tier is the first — can read the easy band without either
 * reconstructing an `AnchorPace` it does not have or restating `+80/+120` as a
 * third copy. `PACE.easy-band-off-threshold` (lib/doctrine/registry.ts) already
 * gates that the spec-builder copy and this one agree literal-for-literal, and
 * that claim keeps working unchanged: there is still exactly one
 * `return { lo: t + N, hi: t + M };` in this file, it just lives here now.
 *
 * Matches spec-builder PACE-E-2 · Research/01:142 §Pace conversion (E = MP+60..90,
 * and M = T+18, so E = T+78..T+108). Do not re-cite the §Numerical equivalencies
 * VDOT-50 row here: it says T+104..T+156 and contradicts :142 by 20-40 s/mi.
 *
 * `lo` is the FAST edge — the ceiling an easy-pace prescription must not
 * cross, and the only half the 2026-08-31 "easy pace is a ceiling, not a band"
 * decision leaves a prescription reading. `hi` is kept because the band shape
 * still has non-prescription readers (and because deleting half of a
 * doctrine-gated pair would break the claim that watches it).
 */
export function easyBandFromTPace(tPaceSPerMi: number | null | undefined): { lo: number; hi: number } | null {
  if (tPaceSPerMi == null || !Number.isFinite(tPaceSPerMi) || tPaceSPerMi <= 0) return null;
  const t = tPaceSPerMi;
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
  let lo = DANIELS_VDOT_MIN, hi = DANIELS_VDOT_MAX;
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
  let lo = DANIELS_VDOT_MIN, hi = DANIELS_VDOT_MAX;
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
 *  '50K', '100K'). Null for 'none'/unknown. Used for the goal PLAN distance
 *  (duration, progression, race specificity — legitimately goal-shaped) and,
 *  historically, for the now-removed goal-relative VDOT floor
 *  (`vdotRunFloorMi`, see `EVIDENCE_RUN_FLOOR_MI`'s header) — do not thread
 *  this into any evidence-admissibility decision again. */
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
 * Minimum honest-effort distance (miles) a TRAINING-derived VDOT read admits.
 *
 * FIXED 2026-09-01 · doctrine violation closed. This used to be
 * `vdotRunFloorMi(goalDistanceMi)`, keyed to the runner's stated GOAL event
 * (5K goal → 3.0mi, everything else → 4.0mi) via `goalRunFloorMiForUser`,
 * which read `profile.goal_race_distance` / `tt_goal_distance` and was
 * called live from `generate.ts`, `drift-monitor.ts`,
 * `seed-from-onboarding.ts` and three API routes. That let the runner's
 * stated AMBITION decide whether their own demonstrated effort counted as
 * fitness evidence — a direct violation of "the fitness resolver should not
 * be able to see the goal at all" (`docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_
 * IMPLEMENTATION.md` §6), confirmed live in
 * `docs/reports/brain-status-2026-08-31.md`.
 *
 * `capacity-resolver.ts` (the new Runner Model layer) had already argued and
 * adopted the fix for exactly this constant — `CAPACITY_RUN_FLOOR_MI = 3.0`,
 * reasoning that "admissibility is a property of the EFFORT, not of the
 * runner's ambition. A 3.1-mile all-out effort demonstrates the same
 * physiology whoever ran it." This constant matches that number and that
 * reasoning, applied to the OLD engine's live call sites too — not only the
 * shadow one.
 *
 * 3.0mi, not 4.0mi: the shortest canonical field test (a 5K time trial) is
 * the admissibility floor for every runner, not only for one who happens to
 * say "5K" is their goal. `vdotFromRun`'s HR/quality-label gate still guards
 * honesty, and `bestRecentVdot`'s corpus ceiling still bounds any single
 * training read against what other sessions corroborate.
 *
 * Cite: Research/01-pace-zones-vdot.md §"Field-test protocols" (a 5K time
 * trial IS a valid VDOT input) + §"Field-test selection for the Coach".
 */
export const EVIDENCE_RUN_FLOOR_MI = 3.0;

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
 * ZONE-R-1 (2026-08-19) · the RACE-PACE distances the Daniels table publishes,
 * in miles, so a caller asks for a column rather than for a number.
 *
 * `Research/01-pace-zones-vdot.md` §"VDOT lookup table" is seven columns —
 * Mile, 3K, 5K, 10K, 15K, Half, Marathon — and §"Pace conversion from a race
 * time" defines every training zone as one of them ("T | ~half-marathon pace to
 * 15K pace", "I | ~3K to 5K race pace", "R | ~mile race pace"). Reading a zone
 * therefore means reading a column, and `predictRaceTime` already inverts the
 * table. The alternative — deriving R from I by an offset — is the thing this
 * file's mile-column correction exists to stop: the raw equation over-reads by
 * four to six VDOT points at the mile, so anything derived from it would be
 * systematically fast at exactly the zone where being fast hurts most.
 */
export const TABLE_RACE_DISTANCE_MI = {
  mile: 1.0,
  '3K': 1.86411,
  '5K': 3.10686,
  '10K': 6.21371,
  half: 13.10940,
  marathon: 26.21880,
} as const;

/**
 * ZONE-R-1 · the published 3K column, `[VDOT, seconds]`, ascending by VDOT.
 *
 * AUDIT #7 added `MILE_VDOT_TABLE` because the Daniels & Gilbert curve
 * over-reads at short distances, and reasoned that "the next column (3K,
 * 1.864mi) is far enough that the raw equation has nearly converged". Measured
 * against the doc, it has not: the equation is 10-15 s/mi SLOW at 3K across the
 * whole table (VDOT 40: 452 vs the published 437; VDOT 60: 317 vs 304), while
 * it reproduces the 10K column to within half a second per mile.
 *
 * That gap did not matter while nothing read 3K. `Research/04` §13.2's ladder
 * paces its 800 at "3K/5K" and §9.3's Michigan at "mile/3K effort", so it does
 * now — and a 3K rung twelve seconds a mile slow is not a 3K rung.
 *
 * Every row is verified against `Research/01`'s own table by
 * `PACE.repetition-is-mile-race-pace`, so a transcription slip fails the build
 * rather than shipping.
 */
const THREE_K_VDOT_TABLE: ReadonlyArray<readonly [number, number]> = [
  [30, 1047], [32, 990], [34, 938], [36, 893], [38, 852], [40, 815], [42, 782],
  [44, 751], [45, 737], [46, 724], [48, 696], [50, 671], [52, 647], [54, 625],
  [55, 614], [56, 604], [58, 585], [60, 567], [62, 551], [64, 535], [65, 528],
  [66, 521], [68, 507], [70, 495], [72, 482], [74, 471], [75, 465], [76, 460],
  [78, 450], [80, 441], [82, 432], [84, 424], [85, 420],
];

/** Finish seconds from a VDOT by linear interpolation of a published column,
 *  clamped to its edges. `Research/01` §"How to look up VDOT from a race":
 *  "Interpolate linearly between rows if needed". */
function secFromColumn(table: ReadonlyArray<readonly [number, number]>, vdot: number): number {
  if (vdot <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (vdot >= last[0]) return last[1];
  for (let i = 0; i < table.length - 1; i++) {
    const [v1, s1] = table[i];
    const [v2, s2] = table[i + 1];
    if (vdot >= v1 && vdot <= v2) {
      const f = (vdot - v1) / (v2 - v1);
      return Math.round(s1 + f * (s2 - s1));
    }
  }
  return last[1];
}

/** Distances (mi) for which a PUBLISHED column beats the raw equation, and the
 *  column. The mile is AUDIT #7's; the 3K is ZONE-R-1's, measured the same way.
 *  5K and beyond are left on the equation, which reproduces those columns. */
const PUBLISHED_COLUMNS: ReadonlyArray<{ lo: number; hi: number; table: ReadonlyArray<readonly [number, number]> }> = [
  { lo: MILE_CORRECTION_MIN_MI, hi: MILE_CORRECTION_MAX_MI, table: MILE_VDOT_TABLE },
  // A tight window around 3000 m · 1.864 mi. Nothing else lives here, and a
  // wide one would start correcting distances the column does not describe.
  { lo: 1.80, hi: 1.93, table: THREE_K_VDOT_TABLE },
];

/**
 * Race pace (s/mi) at one of the published table distances, from a VDOT.
 *
 * The general form of `iPaceFromVdot`. Callers name the column they mean, so a
 * zone that doctrine defines as "current 10K" is priced off the 10K column and
 * not off a nearby one with an offset bolted on.
 *
 * Cite: `Research/01-pace-zones-vdot.md` §"VDOT lookup table".
 */
export function racePaceFromVdot(
  vdot: number | null | undefined,
  distanceMi: number,
): number | null {
  if (!vdot || !Number.isFinite(vdot) || vdot <= 0) return null;
  if (!(distanceMi > 0)) return null;
  // Where `Research/01` publishes a column AND the raw equation diverges from
  // it, the column wins — the ruling AUDIT #7 already made for the mile,
  // applied to the one other column measured to diverge. Everything from 5K up
  // falls through to `predictRaceTime`, which reproduces those columns.
  //
  // Deliberately NOT folded into `predictRaceTime` itself: that function has
  // many callers with their own reasons to want the equation, and widening its
  // correction window is a change to all of them. This function's contract is
  // narrower and explicit — "read the published table at this column".
  for (const c of PUBLISHED_COLUMNS) {
    if (distanceMi >= c.lo && distanceMi <= c.hi) {
      return Math.round(secFromColumn(c.table, vdot) / distanceMi);
    }
  }
  const sec = predictRaceTime(vdot, distanceMi);
  if (sec == null) return null;
  return Math.round(sec / distanceMi);
}

/**
 * ZONE-R-1 · Daniels R-pace (repetition · speed/economy), s/mi, from a VDOT.
 *
 * `Research/01-pace-zones-vdot.md` §"Pace conversion from a race time" gives R
 * two readings — "~mile race pace, or ~6 sec/400m faster than I" — and this
 * takes the FIRST, because the mile is a column of the published table and the
 * second reading is an offset off a number that is itself derived. Research/04
 * §"Pace zone shorthand" says the same thing from the other side: R's race-pace
 * anchor is "~mile to 800m race pace".
 *
 * `predictRaceTime` at one mile routes through `MILE_VDOT_TABLE` — the literal
 * Mile column, corrected 2026-08-28 to true-mile solutions of the doc's own
 * equations (the prior values were 1500m solutions mislabeled as miles, so R
 * priced ~25–40 s/mi too fast — Research/REVIEW_NOTES.md A1). So R comes out
 * of the doc's table, at one mile, which makes the seconds the finish time
 * and the pace the same number.
 *
 * Bound by `PACE.repetition-is-mile-race-pace` in lib/doctrine/registry.ts.
 */
export function rPaceFromVdot(vdot: number | null | undefined): number | null {
  return racePaceFromVdot(vdot, TABLE_RACE_DISTANCE_MI.mile);
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
  /** Minimum honest-effort distance a training-derived VDOT read admits.
   *  Defaults to 4mi; callers pass `EVIDENCE_RUN_FLOOR_MI` (3.0, see its
   *  header in this file) so a real field-test-length effort — a 5K time
   *  trial and up — becomes VDOT-readable rather than being silently
   *  rejected. Evidence-only: never derive this value from the runner's
   *  stated goal (2026-09-01 fix; it used to be `vdotRunFloorMi(goalDistanceMi)`).
   *  The HR gate below still guards effort honesty. */
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
// 2026-08-25 · EXPORTED so ADAPTATION.training-lead-quantum can bind it. The
// cap is a ceiling and `adapt.ts`'s TRAINING_LEAD_DELTA_THRESHOLD is the floor
// that acts on it; for two years the floor sat ABOVE the ceiling and nobody
// could see it because neither constant was visible to the other.
export const TRAINING_ESTIMATE_SOFT_CAP_VDOT = 1.0;

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
  races: Array<{
    slug: string; name: string; date: string; priority: string | null;
    distance_mi: number | null; finish_seconds: number | null;
    /**
     * 2026-08-21 · race-data re-audit · the runner's OWN answer to "did this
     * race count?", stored by `POST /api/v5/race-authority` as
     * `races.actual_result.authority_tier`. Optional: every caller that never
     * had it keeps its exact previous behaviour.
     *
     * Applied DOWNWARD ONLY at the grading line below. That asymmetry is the
     * route's own stated doctrine — heat, illness, paced-a-friend and
     * ran-it-as-a-workout are things the runner knows and the engine does not,
     * so their report can lower what a result proves; but "representative" on
     * a race doctrine grades as a hard workout would be the disguised "make me
     * faster" button the route explicitly refuses to be. Same direction as
     * `effectiveEffortClass` in representativeness.ts: a downgrade can only
     * ever lower authority, so honouring one can hold a race below its
     * declared class but never above it.
     */
    runner_authority_tier?: AuthorityTier | null;
  }>,
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
  /** The honest-effort run floor. Default 4mi keeps legacy behavior for any
   *  caller that doesn't pass it; every live caller now passes
   *  `EVIDENCE_RUN_FLOOR_MI` (3.0) so a real field-test-length effort counts
   *  as a fitness candidate. Evidence-only — never derive this from the
   *  runner's stated goal (2026-09-01 fix; see `EVIDENCE_RUN_FLOOR_MI`'s
   *  header). */
  minRunDistanceMi: number = 4,
): {
  best: VdotCandidate | null;
  considered: VdotCandidate[];
  belowTableAnchor: BelowTableAnchor | null;
  /**
   * 2026-08-30 · what the TRAINING corpus corroborated, before any race was
   * consulted. Additive: every existing caller destructures `best` /
   * `considered` / `belowTableAnchor` and is unaffected.
   *
   * Exposed because the ceiling is now made of this, and a number that decides
   * every prescribed pace should be answerable to "which runs said so" without
   * re-deriving it — the observability half of Rule 21, and what
   * `_vdot_corpus_anchor.test.ts` asserts against.
   */
  corpus: CorpusRead;
} {
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
    //
    // 2026-08-21 · race-data re-audit · the runner's own report caps it,
    // downward only. `POST /api/v5/race-authority` has been storing this
    // answer in `races.actual_result.authority_tier` since it shipped, and
    // NOTHING read it: the route's one-shot `forceReanchorActivePlan` moved
    // the paces, then the nightly `snapshot-projections` cron re-ran this
    // function over the same unfiltered pool and the flagged race won
    // selection again. The runner said "I ran that sick" and by morning the
    // paces were back. Reading it here makes the answer durable through every
    // caller at once — the cron, the drift monitor, the generator — because
    // they all come through this one function.
    const declaredAuthority = selectionAuthority(r.priority);
    const reported = r.runner_authority_tier ?? null;
    const authority = (reported && reported !== 'representative')
      ? Math.min(declaredAuthority, RUNNER_REPORTED_AUTHORITY_CAP[reported])
      : declaredAuthority;
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
  //
  // 2026-08-30 (sub-representative races) · the third exclusion, and it closes
  // the case the other two could not reach. `authorityDemoted` is inert unless
  // a BETTER-graded race exists, which is right for the HEADLINE — "a floor you
  // have beats a guess you don't", so a runner whose only race was jogged still
  // anchors on it. It is wrong for the CEILING, and by this block's own
  // sentence, stated twice above: the cap anchors to the evidence the headline
  // TRUSTS. The ceiling asks one question — "what is the last hard proof of
  // fitness?" — and `Research/01` §"Triggers to retest" licenses "Update VDOT
  // from race" only for a result that was "all-out, well-paced". A race
  // doctrine grades below the representative floor is not that proof.
  //
  // It is proof of a FLOOR, and it keeps that job untouched: such a race still
  // enters the pool, still competes at face value, and still anchors when it is
  // all the runner has. What it stops doing is silently bounding every training
  // read to itself + 1. Before this, a runner who told the app "I ran that one
  // sick" through `POST /api/v5/race-authority` had their report honoured in
  // the ranking and then quietly ignored by the cap — the flagged race set the
  // ceiling anyway, so the anchor could not move more than a point off a result
  // the runner had just disowned. The runner-report lever was half-wired.
  const subRepresentative = (c: RaceVdotCandidate): boolean =>
    c.authority < REPRESENTATIVE_FLOOR;
  const excludedFromCeiling = (c: RaceVdotCandidate): boolean =>
    demotedForCeiling(c) || authorityDemoted(c) || subRepresentative(c);
  const bestRaceRaw = raceCandidates.reduce<number | null>(
    (max, c) => (excludedFromCeiling(c) ? max
      : (max == null || c.vdot_raw > max ? c.vdot_raw : max)), null);

  /** What the training corpus corroborates, independent of any race. Refusal
   *  (`ok:false`) with no runs at all, or with fewer than K qualifying ones. */
  let corpusRead: CorpusRead = { ok: false, reason: 'no_observations', observations: 0 };
  /** The bound on an individual training read. Set in the run block below. */
  let trainingCeiling: number | null = null;

  const runCandidates: RunVdotCandidate[] = [];
  if (runs && runs.length > 0) {
    // ── PASS 1 · read every run UNCAPPED, so the corpus can speak ──────────
    //
    // 2026-08-30 · THE CEILING STOPS BEING RACE-SHAPED. See
    // `lib/training/vdot-corpus.ts` for the owner's ruling and the reasoning;
    // this is the two-line consequence of it. The AUDIT #8 cap used to be
    // resolved before this loop, from `bestRaceRaw` alone, and applied inside
    // it — so a runner's entire training history was bounded by one race day
    // plus a constant, and a runner with no race was bounded by nothing at
    // all. Two different laws for one question, chosen by whether a `races`
    // row exists.
    //
    // Now the runs are read first and the ceiling is derived from what at
    // least `CORROBORATION_MIN_OBSERVATIONS` of them independently support.
    // A race no longer bounds training evidence; it competes with it, at the
    // authority its own grading gives it, in the sort below.
    // Keyed by POSITION, not by `id`. A caller that builds this array by hand
    // — which every test of this function does — may reuse an id, and a map
    // keyed on it would silently hand pass 2 another run's reading.
    const uncapped = new Map<number, number>();
    const corpusObs: CorpusObservation[] = [];
    runs.forEach((r, i) => {
      if (!r.date || r.date < cutoff) return;
      if (!r.distance_mi || !r.finish_seconds) return;
      const v = vdotFromRun({
        finishSeconds: r.finish_seconds,
        distanceMi: r.distance_mi,
        workoutType: r.workout_type,
        avgHr: r.avg_hr ?? null,
        maxHr: r.max_hr ?? null,
        zone: r.zone ?? null,
        minDistanceMi: minRunDistanceMi,
      });
      if (v == null) return;
      uncapped.set(i, v);
      corpusObs.push({ id: r.id, date: r.date, vdot: v });
    });
    corpusRead = corroboratedCorpusVdot(corpusObs);

    // The ceiling an individual training read is bounded to. Corpus-anchored
    // when the corpus can corroborate itself; the historical race-anchored
    // bound ONLY as the fallback for a runner whose training cannot yet answer
    // (fewer than K qualifying sessions — a new user's first fortnight). With
    // neither, a training read is uncapped, exactly as before: a 5K TT IS a
    // valid VDOT input, Research/01 §"Field-test protocols".
    //
    // Both arms add the SAME doctrinal +1 lead quantum (Research/01
    // §"Triggers to retest": a good tempo is "+1 VDOT estimated"), so what a
    // single standout session is allowed to say above the corroborated level
    // is unchanged. Only the thing it leads has changed, from one race to the
    // runner's own training.
    trainingCeiling = corpusRead.ok
      ? corpusRead.vdot + TRAINING_ESTIMATE_SOFT_CAP_VDOT
      : (bestRaceRaw != null ? bestRaceRaw + TRAINING_ESTIMATE_SOFT_CAP_VDOT : null);

    // ── PASS 2 · build the candidates, capped ─────────────────────────────
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (!r.date || r.date < cutoff) continue;
      if (!r.distance_mi || !r.finish_seconds) continue;
      const v = uncapped.has(i) ? uncapped.get(i)! : vdotFromRun({
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
   * 2026-08-30 · THE DATE VETO IS RETIRED. An INFERRED rule was overriding an
   * EXPLICIT one in the same document.
   *
   * ── What stood here ───────────────────────────────────────────────────────
   *
   * `supersededLead` demoted EVERY training candidate dated on or before the
   * freshest representative race below every candidate that was not, whatever
   * its magnitude. Its own doc comment named its basis honestly: "the rule
   * doctrine IMPLIES: a lead is RESOLVED by the test it asked for."
   *
   * That inference contradicts a sentence `Research/01` states outright, in
   * §"Implementation notes for the engine":
   *
   *     "Selection — pick the highest derived VDOT, not the most recent.
   *      A 6-week-old PR is a better fitness signal than a heat-affected
   *      race last weekend."
   *
   * That is this exact situation, decided the other way, by doctrine, in
   * advance. The same section also records that the engine has no
   * well-paced/heat-affected quality flag ("Currently we don't have this
   * signal and treat all races equally") — so doctrine knows a recent race can
   * be the distorted one and STILL says to take the highest derived read.
   *
   * ── The failure the veto was built for is already covered ────────────────
   *
   * Its author's case: "the day after a 1:41:53 A-race half, the anchor was a
   * 4-mile tempo from 55 days earlier ... once a runner has ANY qualifying
   * training run, their races can never anchor them."
   *
   * The first half is real; the second half is what doctrine PRESCRIBES.
   * §"Triggers to retest" row 2: "Tempo runs feel notably easier at the same
   * target pace → Add 1 VDOT point; re-derive paces; field-test within 2
   * weeks." A runner whose tempos read above their last race is supposed to be
   * anchored at race + 1 and asked for a test. The AUDIT #8 soft cap already
   * enforces the magnitude — a training candidate can NEVER say more than
   * `bestRaceRaw + 1.0`, so it cannot run away from the race no matter how old
   * or how fast it is. Nothing needed a second bound.
   *
   * The clause the author correctly noticed nothing enforced — "field-test
   * within 2 weeks" — asks the engine to REQUEST A TEST. It does not license
   * deleting the evidence. Discarding a lead is not enforcing the request for
   * a test; it is answering the question the test was meant to answer, in the
   * direction of the reading doctrine told us not to prefer.
   *
   * ── What it cost, measured on the owner's data, 2026-08-30 ───────────────
   *
   * `bestRecentVdot` resolved 44.1 off Americas Finest City (2026-08-16,
   * 1:41:53). Five training candidates in the same window read at or above the
   * ceiling — a 4mi tempo at 7:18/mi, another at 7:26, another at 7:31, a 12mi
   * long-run work block at 7:35 — every one of them capped to 45.1 and every
   * one of them vetoed for predating the race by days. Prescribed easy became
   * 9:02-9:42/mi for a runner whose 27 logged runs at avg HR 144 average
   * 8:14/mi. He described the plan as unusable.
   *
   * ── What replaces it: nothing, and that is the point ─────────────────────
   *
   * Selection is now the two rules doctrine actually states — highest derived
   * VDOT, bounded for training reads by the +1 soft-estimate quantum — plus
   * the staleness and authority tiers, which are separately cited. A race
   * still wins an EXACT tie (stable sort; races precede runs in the
   * concatenation below), so a race and a tempo that agree resolve to the race.
   *
   * The one clause kept, and it is a data-identity argument rather than a
   * doctrinal one: a run dated the SAME DAY as a race is almost always that
   * race re-ingested from Strava, or its warm-up. Letting it through would let
   * a race lead itself by +1 and inflate every runner's anchor on the day they
   * race. `loadVdotInputs` already excludes race-day runs (C1-1e, ±1 day), so
   * in production this is belt-and-braces; it matters for callers that build
   * candidate arrays directly, which is most of this function's tests.
   */
  const representativeRaceDates = new Set(
    raceCandidates.filter((r) => r.date && r.authority >= REPRESENTATIVE_FLOOR).map((r) => r.date),
  );
  const sameDayAsRace = (c: VdotCandidate): boolean =>
    c.source === 'run' && representativeRaceDates.has(c.date);
  // DOCTRINE-2 · a floor-only (56-84 day) candidate ranks below every in-window
  // candidate of either source. With no in-window evidence at all the tier term
  // is uniform and the stale anchor still wins — it is the floor doctrine says
  // to keep using until a fresh test replaces it.
  const inWindowExists = inWindowRaceExists || runCandidates.some((c) => !floorOnly(c));
  const demoted = (c: { age_days: number }): boolean => inWindowExists && floorOnly(c);
  // Tier order · staleness, then authority, then same-day race echoes, then
  // value.
  //
  // Authority sits BELOW staleness because the two answer different questions
  // and staleness is the harder one: doctrine calls a 12-week-old anchor
  // "Expired. Don't anchor pace prescription on this VDOT" with no appeal,
  // where a low-authority race is current evidence that is simply worth less.
  //
  // The same-day tier sits last because it is not a judgement about evidence at
  // all — it is the identity guard described above, keeping a race from
  // leading itself by +1 through its own re-ingested GPS row.
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
      ((sameDayAsRace(b) ? 0 : 1) - (sameDayAsRace(a) ? 0 : 1)) ||
      (sortKey(b) - sortKey(a)));

  // P1-56 · belowTableAnchor is populated ONLY when there is no real (in-table)
  // candidate at all — a runner with a valid race VDOT never falls back to a
  // sub-30 anchor even if one exists (e.g. an old slow 5K before they got
  // faster). Race beats run when both exist, matching the main sortKey's
  // "race wins ties" doctrine (no soft-cap applies here — both are honest
  // demonstrated efforts, no VDOT to bound).
  const belowTableAnchor: BelowTableAnchor | null =
    considered.length > 0 ? null : (belowTableRace ?? belowTableRun);

  return { best: considered[0] ?? null, considered, belowTableAnchor, corpus: corpusRead };
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
