/**
 * lib/plan/zone-anchors.ts · ZONE-R-1 (2026-08-19) · what a pace zone is worth,
 * in one place, for everything that needs to know.
 *
 * `Research/04-workout-vocabulary.md` §"Pace zone shorthand" is a twelve-row
 * table of zones, and every workout in the catalogue names its zones out of it.
 * The engine could price two of them. `buildWorkoutSpec` paced a `threshold`
 * slot at T and a rep slot at I *regardless of what the prescription declared*,
 * so `catalogue-rx.ts` deliberately anchored only T/HM and I/5K and declined
 * every session that named anything else — §7's R work, §5.4's sub-threshold
 * intervals, §11.3's marathon-pace sessions and §14.2's 10K-specific sessions
 * all sat in the catalogue, cited and unreachable.
 *
 * The reason for that restraint was sound and is worth restating: a label that
 * promises a pace the watch does not run is the sub_label/spec drift this
 * codebase has already paid for twice. The fix is not to relax the gate. It is
 * to make ONE function the answer to "what is this zone worth", and have the
 * selector's anchor set and the spec builder's pacing both read it — so the
 * question "does spec-builder pace everything catalogue-rx anchors" stops being
 * a thing anyone has to remember and becomes a thing that cannot be false.
 *
 * ── Where each number comes from ───────────────────────────────────────────
 *
 * Every zone here resolves to a column of Daniels' published table or to a
 * relation the docs state in words. Nothing is derived from a neighbouring zone
 * by an invented offset.
 *
 *   T, HM   · the caller's threshold pace. `Research/01` §"Pace conversion from
 *             a race time": "T | ~half-marathon pace to 15K pace", so the
 *             half's race pace and T are one LT-anchored class.
 *   I, 5K   · the caller's rep pace. Same table: "I | ~3K to 5K race pace".
 *   R, mile · `rPaceFromVdot`, the published Mile column. Same table:
 *             "R | ~mile race pace, or ~6 sec/400m faster than I". The FIRST
 *             reading, because the mile is a column and the second is an offset
 *             off a derived number.
 *   3K, 10K · the published 3K and 10K columns. `Research/04`'s shorthand table
 *             defines both as "Current 3K" / "Current 10K" — a race pace, which
 *             is what a race-pace table holds.
 *   MP, M   · the runner's own marathon pace, which the caller supplies.
 *             "M | Marathon race pace"; `Research/04`: "M | ... | Goal MP".
 *   ST      · T plus `ST_OFFSET_S_PER_MI`. See that constant.
 *   E       · deliberately absent. Easy is a BAND the day carries
 *             (`pace_target_s_per_mi_lo/hi`), never a work target, and an
 *             E-zoned catalogue entry is an easy run rather than a workout.
 *
 * ── The VDOT round trip ────────────────────────────────────────────────────
 *
 * R, 3K and 10K are read out of the table at a VDOT, and the caller has a
 * threshold pace rather than a VDOT. `vdotFromTpace` inverts it — the identical
 * round trip `generate.ts` already makes to get its I-pace
 * (`iPaceFromVdot(vdotFromTpace(weekT))`), so these zones are anchored off
 * exactly the number every other quality zone in the plan is anchored off.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 *
 * Pure. No clock, no random number, no I/O. Same inputs, same anchors.
 */
import type { PaceZone } from '@/lib/workout-catalogue/types';
import {
  TABLE_RACE_DISTANCE_MI,
  racePaceFromVdot,
  rPaceFromVdot,
  vdotFromTpace,
} from '@/lib/training/vdot';

/**
 * Sub-threshold sits `ST_OFFSET_S_PER_MI` slower than T.
 *
 * `Research/04-workout-vocabulary.md` §"Pace zone shorthand", ST row:
 * "~10–15 s/mi slower than T". §5.1's family-overview row repeats it —
 * "ST (10–15 s/mi slower than T)".
 *
 * The band's SLOW edge, not its midpoint. §5.4's contraindication row states
 * which direction the error is dangerous in — "Requires honest pace discipline
 * — going too hard collapses the model" — and the session's whole purpose row
 * is "Accumulate large weekly threshold volume WITHOUT the systemic cost of
 * tempo". A midpoint would be a number doctrine does not state, chosen against
 * the one instruction doctrine does give about which way to lean.
 *
 * Bound by `PACE.sub-threshold-offset` in lib/doctrine/registry.ts, which reads
 * the band out of the ST row and asserts this is its slow edge.
 */
export const ST_OFFSET_S_PER_MI = 15;

/**
 *  The four quality paces `Research/01` §"Dosing rules — Daniels' caps" doses.
 *  Defined here rather than in `dosing.ts` so the zone table and the dose
 *  buckets cannot drift; `dosing.ts` re-exports it unchanged. */
export type DosePace = 'M' | 'T' | 'I' | 'R';

/**
 * Which dose bucket a zone spends against.
 *
 * The T/I/R half is `Research/01`'s dosing table read through `Research/04`'s
 * shorthand, which states each race-pace anchor's physiological position: HM
 * "Slightly below T", 10K "Just above T", 5K "At/near VO2max", 3K "Above
 * VO2max", mile ≈ R ("~mile to 800m race pace"). It is deliberately the same
 * mapping `lib/workout-catalogue/select.ts#ZONE_CAP_FAMILY` uses to decide
 * affordability — a session the selector priced against one cap and the dosing
 * gate charged to another is a breach waiting for the week that cannot afford
 * it, and `_dosing_doctrine.test.ts` asserts the two agree.
 *
 * M and MP map to `M`, which `ZONE_CAP_FAMILY` writes as `null`. The two are
 * saying the same thing about different questions: doctrine gives marathon pace
 * no share OF THE WEEK (its weekly cell reads "n/a"), which is what the
 * selector asks, and it does give marathon pace a SINGLE-WORKOUT ceiling —
 * "the lesser of 18 mi or 20% of weekly mi" — which is what the doser asks.
 *
 * E carries neither.
 */
export const ZONE_DOSE_PACE: Record<PaceZone, DosePace | null> = {
  E: null,
  M: 'M',
  MP: 'M',
  T: 'T',
  ST: 'T',
  HM: 'T',
  '10K': 'I',
  I: 'I',
  '5K': 'I',
  '3K': 'I',
  R: 'R',
  mile: 'R',
};

/**
 * Loosest bucket first. A session touching two zones is charged at the TIGHTER
 * cap, because the tighter cap is the one whose doctrine would otherwise be
 * breached — the same rule `capFamilyOf` applies to affordability, stated once
 * here so the two orderings cannot diverge.
 */
const DOSE_TIGHTNESS: readonly DosePace[] = ['M', 'T', 'I', 'R'] as const;

/** The bucket a whole session spends against: the tightest of its zones. */
export function tightestDosePace(zones: readonly PaceZone[]): DosePace | null {
  let worst: DosePace | null = null;
  for (const z of zones) {
    const p = ZONE_DOSE_PACE[z];
    if (!p) continue;
    if (worst == null || DOSE_TIGHTNESS.indexOf(p) > DOSE_TIGHTNESS.indexOf(worst)) worst = p;
  }
  return worst;
}

/** What the caller already knows about this runner's week, in s/mi. */
export interface ZoneAnchorInput {
  /** The week's threshold pace. Anchors T and HM, and is the VDOT round trip's
   *  input for R, 3K and 10K. */
  tPaceSec: number | null;
  /** The week's rep pace · `iPaceFromVdot`. Anchors I and 5K. Null on the
   *  distances the composer does not thread a true I-pace for, which leaves
   *  those two zones unanchored rather than guessed. */
  iPaceSec: number | null;
  /** The runner's marathon pace, as `buildWorkoutSpec` resolves it. Anchors M
   *  and MP. Null leaves them unanchored. */
  marathonPaceSec?: number | null;
  /**
   * The runner's REPETITION pace, when a caller has resolved one directly.
   * Anchors R and mile.
   *
   * ZONE-R-CANON (2026-08-31). R has always been read out of the published Mile
   * column at `vdotFromTpace(tPaceSec)` — a VDOT round trip off the threshold
   * anchor. That is a defensible fallback and it stays the fallback, but it is
   * not the canonical answer: `resolveHighIntensityCapacity` owns "what can this
   * runner hold at 3-5K effort and above" (Constitution §C, §5), and when a
   * caller has that answer the zone table must spend it rather than re-derive a
   * second one through a table (Constitution §6 · derivation vs authority).
   *
   * Null — the default, and every pre-existing caller — falls through to the
   * round trip exactly as before, so nothing that does not thread this changes
   * by a single second.
   */
  repetitionPaceSec?: number | null;
}

/**
 * Every zone this runner's week can honestly price, and no others.
 *
 * A zone absent from the result is a zone the caller must DECLINE rather than
 * approximate — `selectWorkout` refuses the session, and `buildWorkoutSpec`
 * emits the rep with no pace target at all (`by_effort`) rather than a number
 * nobody agreed to.
 */
export function resolveZoneAnchors(input: ZoneAnchorInput): Partial<Record<PaceZone, number>> {
  const out: Partial<Record<PaceZone, number>> = {};
  const { tPaceSec, iPaceSec } = input;
  const mp = input.marathonPaceSec ?? null;

  if (tPaceSec != null && tPaceSec > 0) {
    out.T = tPaceSec;
    out.HM = tPaceSec;
    // §"Pace zone shorthand" ST row · "~10–15 s/mi slower than T".
    //
    // AND ONLY WHEN IT IS FASTER THAN MARATHON PACE. That table orders ST above
    // M — ST is "80–86%" of VO2max and M is "75–84%" — so a sub-threshold
    // repetition run at or slower than the same runner's marathon pace has
    // inverted two adjacent zones.
    //
    // It happens without either number being wrong on its own. ST is read off
    // the week's THRESHOLD anchor, which blends toward the goal, and marathon
    // pace is read off the CURRENT-fitness anchor (PACE-E-1), so a runner whose
    // goal is ahead of their fitness can land T+15 slower than MP.
    // `_audit_persist_realization` caught exactly that: a "2×1km @ ST pace" at
    // 518 s/mi beside a long-run marathon-pace finish at 515.
    //
    // The answer is to LEAVE IT UNANCHORED, not to clamp it onto marathon pace.
    // §5.4's purpose row is "Accumulate large weekly threshold volume without
    // the systemic cost of tempo"; a set run at marathon pace is not that
    // session, and handing the runner one under a sub-threshold label is the
    // approximation this module exists to refuse. Unanchored means the selector
    // declines §5.4 for this runner and offers something doctrine can still
    // price — which is the same refusal it already makes for every other zone
    // a week cannot honestly pay for.
    const st = tPaceSec + ST_OFFSET_S_PER_MI;
    if (mp == null || mp <= 0 || st < mp) out.ST = st;

    // The published table, at the columns doctrine names. `vdotFromTpace` is
    // memoised and returns null outside the table's 30-85 range, in which case
    // these three stay unanchored — the honest answer for a runner the table
    // does not cover.
    //
    // ZONE-R-CANON · a caller-supplied repetition pace WINS over the round trip,
    // because it came from the capacity that owns the question. The round trip
    // remains the fallback for every caller that has no such answer, and for the
    // runner whose high-intensity ladder could not price R at all (it returns
    // null there, which is Rule 11's "genuinely unknown" and must not be filled
    // in from a neighbouring zone).
    const vdot = vdotFromTpace(tPaceSec);
    const rGiven = input.repetitionPaceSec ?? null;
    if (rGiven != null && rGiven > 0) {
      out.R = rGiven;
      out.mile = rGiven;
    }
    if (vdot != null) {
      if (out.R == null) {
        const r = rPaceFromVdot(vdot);
        if (r != null && r > 0) {
          out.R = r;
          out.mile = r;
        }
      }
      const tenK = racePaceFromVdot(vdot, TABLE_RACE_DISTANCE_MI['10K']);
      if (tenK != null && tenK > 0) out['10K'] = tenK;
      const threeK = racePaceFromVdot(vdot, TABLE_RACE_DISTANCE_MI['3K']);
      if (threeK != null && threeK > 0) out['3K'] = threeK;
    }
  }

  if (iPaceSec != null && iPaceSec > 0) {
    out.I = iPaceSec;
    out['5K'] = iPaceSec;
  }

  if (mp != null && mp > 0) {
    out.M = mp;
    out.MP = mp;
  }

  return out;
}

/** One zone's pace, or null when this runner's week cannot price it. */
export function zonePaceSec(
  zone: PaceZone | null | undefined,
  anchors: Partial<Record<PaceZone, number>>,
): number | null {
  if (!zone) return null;
  const p = anchors[zone];
  return p != null && p > 0 ? p : null;
}
