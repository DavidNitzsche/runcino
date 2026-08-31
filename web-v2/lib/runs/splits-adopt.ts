/**
 * lib/runs/splits-adopt.ts · a canonical row keeps every mile it ran.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE DEFECT
 *
 * `enhanceCanonicalFromAbsorbed` adopted a sibling's splits only when the
 * canonical had NO real per-mile splits:
 *
 *     if (!splitsAreReal(canonicalVal) && splitsAreReal(incomingVal)) { adopt }
 *
 * So a PARTIAL array blocked adoption entirely. Present-but-short read as
 * present, and the absorber walked away from a sibling holding the miles the
 * canonical was missing.
 *
 * Measured on production, 2026-08-30, faff_readonly, over the owner's 267 run
 * rows (153 canonical by `NOT (data ? 'mergedIntoId')`, 114 losers): 21
 * canonical rows carry FEWER split elements than an absorbed sibling of the
 * same run. The `watch`-source winner is short 1-2 elements against its
 * `apple_watch` and `strava` siblings, and the loss is verified by MILE
 * NUMBERING to be always FROM THE END — every canonical holds a contiguous
 * 1..k while the sibling holds 1..n, n > k. Never a gap in the middle, never
 * a missing first mile.
 *
 *     2026-07-25   18.00 mi   canonical keeps miles 1-17 of 18
 *     2026-08-10    4.02 mi   canonical keeps miles 1-3  of 4
 *     2026-05-24   11.12 mi   canonical keeps ZERO against a sibling's 12
 *
 * For a marathoner whose long runs carry a fast-finish segment this deletes
 * precisely the quality portion of the session — on 2026-07-25 the recovered
 * mile 18 is 8:05/mi against a 8:22 opening mile, and on 2026-08-10 the two
 * recovered miles are 6:40 and 7:10 at HR 161 and 171. The part the coaching
 * engine most needs to read is the part that was going missing.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE PREVIOUS ATTEMPT'S "ADOPT THE LONGEST ARRAY" IS WRONG
 *
 * The three arrays on 2026-07-25 are in three INCOMPATIBLE shapes:
 *
 *     watch         { hr, mile, pace:"8:22", paceSecPerMi:502 }
 *     apple_watch   { hr, mile, pace, cadence, elev_ft, distanceMi }
 *     strava        { split, distance:1651.4 (METRES), moving_time,
 *                     average_speed (m/s), elevation_difference }
 *
 * A naive longest-array adoption injects metric Strava keys into a row whose
 * consumers read `pace`/`hr`, and picks the 19-element apple_watch array whose
 * own split distances sum to 18.893 mi against a stated 18.00 — an array that
 * does not decompose this run.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE JUDGEMENT · WHICH SOURCE WINS WHEN BOTH ARE COMPLETE
 *
 * Not the tier ladder, and not the element count. The first question is
 * whether the array decomposes THIS RUN, and the row's own `distanceMi` is the
 * authority for that — `coherence.ts` already settles it: "distanceMi wins on
 * disagreement ... the split array is the derived decomposition of it."
 *
 * The 2026-07-25 evidence is decisive and it is measured, not assumed. Strava's
 * per-mile paces reproduce the watch's to within 1 s/mi across all seventeen
 * shared miles —
 *
 *     watch    502 489 488 489 502 486 496 488 479 448 450 460 476 466 480 499 478
 *     strava   501 489 488 489 501 486 497 488 479 448 450 461 476 466 480 498 478 485
 *
 * — and supplies the eighteenth. It is the same decomposition of the same run,
 * one mile longer. The apple_watch array is a decomposition of 18.893 mi and
 * its mile 1 is 7:49 against the other two sources' 8:22: its "miles" are not
 * this run's miles, so its mile 18 is not this run's mile 18.
 *
 * So the order is:
 *
 *   1. ADMISSIBLE · the candidate normalises to at least one usable per-mile
 *      pace, every element carries a mile index, and where its elements carry
 *      distances they sum to the row's own distance within
 *      `MAX_SPLIT_SUM_DRIFT_MI`. An array carrying no distances cannot
 *      contradict the row and is admissible on the other two counts.
 *   2. RICHER · strictly more usable per-mile entries than the incumbent.
 *   3. Tie on count → higher SOURCE TIER, because once two arrays both
 *      demonstrably decompose this run, tier is the fidelity ladder this
 *      module already owns.
 *   4. Tie on tier → the incumbent stays. Churn is a cost with no benefit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND THE UNION IS BY MILE INDEX, NOT A REPLACEMENT
 *
 * Wholesale adoption would have been a second defect. On 2026-07-25 the
 * winning Strava array carries NO heart rate on any element (`withHr = 0`),
 * while the incumbent watch array carries HR on all seventeen. Replacing the
 * array to gain mile 18 would have destroyed the per-split HR that
 * `computeAerobicDecoupling` and the threshold-adherence signals read.
 *
 * So the incumbent's elements are preserved BYTE-IDENTICAL and only the mile
 * indices it lacks are filled, in the normalised shape. The operation is
 * strictly additive: no element a consumer already reads is rewritten, and the
 * worst case of an incorrect adoption is extra miles, never altered ones.
 *
 * Where the incumbent has real splits but no readable mile index, there is
 * nothing to align against and the adoption is REFUSED rather than guessed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIMULATED AGAINST PRODUCTION (2026-08-30, all 267 rows)
 *
 *   15 canonical rows repaired · 30 split-miles recovered · 8 refused.
 *
 * All 7 rows whose split count was genuinely BELOW `floor(distanceMi)` are
 * repaired (2026-05-24, 06-08, 06-09, 07-25, 08-05, 08-10, 08-24); the other 8
 * repairs add a final partial mile that is legitimately extra signal. The 8
 * refusals are all rows whose only richer sibling is an `apple_watch` array
 * whose split distances miss the row's distance by 0.265 to 0.869 mi — those
 * are refused on the evidence, per row, rather than adopted and hoped for.
 */

import {
  normalizeSplits,
  type NormalizedSplit,
} from '@/lib/runs/run-shape';
import { MAX_SPLIT_SUM_DRIFT_MI } from '@/lib/runs/coherence';

/**
 * The one shape this module ever WRITES.
 *
 * Deliberately the `faff-hr` shape the watch canonical already uses, so
 * `shapeOf` classifies an adopted element identically to an incumbent one and
 * every existing consumer keys work unchanged:
 *
 *   `hr` · read by normalizeSplits, computeAerobicDecoupling, the recap
 *   `pace` (m:ss) and `paceSecPerMi` · read by normalizeSplits and by
 *      `splitsAreReal`, which is what makes an adopted array count as real
 *   `mile` · the index every alignment in this file depends on
 *   `elev_ft` · the key `elev-sanity.ts` and `run-terrain.ts` read
 *   `distanceMi`, `cadence` · carried through when measured
 *
 * RULE 11 · a key is emitted ONLY when the value was actually measured. An
 * absent HR is an absent key, never a 0, because a 0 here would read as a
 * measured heart rate of zero everywhere downstream.
 */
export interface AdoptedSplit {
  mile: number;
  pace: string;
  paceSecPerMi: number;
  hr?: number;
  distanceMi?: number;
  elev_ft?: number;
  cadence?: number;
}

/** A candidate array, with everything the ranking needs, already measured. */
export interface SplitCandidate {
  /** `data.source` of the row the array came from. Drives the tier tie-break. */
  source: string | null;
  /** The raw array, in whatever of the six shapes it arrived in. */
  raw: unknown;
}

/** Why an adoption did not happen. Never collapsed into a silent no-op. */
export type AdoptionRefusal =
  | 'no-candidate-is-richer'
  | 'incumbent-splits-carry-no-mile-index'
  | 'candidate-does-not-decompose-this-run'
  | 'candidate-has-no-usable-pace'
  | 'candidate-elements-lack-a-mile-index';

export interface AdoptionResult {
  /** The array to store, or null when nothing is to be written. */
  splits: unknown[] | null;
  /** The source the adopted elements came from, for the provenance stamp. */
  adoptedFrom: string | null;
  /** Mile indices that were added. Empty exactly when `splits` is null. */
  milesAdded: number[];
  /** Every candidate that was NOT adopted, and why. For the caller's log. */
  refusals: Array<{ source: string | null; reason: AdoptionRefusal }>;
}

/** Seconds per mile rendered as the `m:ss` string the faff shapes carry. */
export function paceString(secPerMi: number): string {
  const total = Math.round(secPerMi);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The elements of a normalised array that carry a per-mile pace. */
function usable(ns: readonly NormalizedSplit[]): NormalizedSplit[] {
  return ns.filter((s) => s.paceSec != null && s.paceSec > 0);
}

/**
 * The candidate's own split distances, summed — or null when no element
 * carries one.
 *
 * Null is "this array makes no claim about distance", which is a different
 * fact from "this array claims a distance that is wrong", and only the second
 * is a reason to refuse.
 */
function ownDistanceMi(ns: readonly NormalizedSplit[]): number | null {
  const withDist = ns.filter((s) => s.distanceMi != null && s.distanceMi > 0);
  if (withDist.length === 0) return null;
  return withDist.reduce((a, b) => a + (b.distanceMi as number), 0);
}

/**
 * Does this array decompose a run of `rowDistanceMi`?
 *
 * `true` when its own distances land within `MAX_SPLIT_SUM_DRIFT_MI` of the
 * row's distance, and `true` when it carries no distances at all — an array
 * that makes no distance claim cannot contradict one. `false` only on a
 * measured disagreement.
 *
 * The tolerance is `coherence.ts`'s, imported rather than restated: the
 * absorber and the read-time reconciler must not disagree about what "these
 * splits describe this run" means. `reconcileSplitsTotal` would immediately
 * mark an array this function admitted-in-error as `splitsCoverRun: false`.
 */
export function decomposesRun(
  ns: readonly NormalizedSplit[],
  rowDistanceMi: number | null,
): boolean {
  const own = ownDistanceMi(ns);
  if (own == null) return true;
  if (rowDistanceMi == null || !(rowDistanceMi > 0)) return true;
  return Math.abs(own - rowDistanceMi) <= MAX_SPLIT_SUM_DRIFT_MI;
}

/** Render one normalised split in the single shape this module writes. */
function toAdopted(s: NormalizedSplit): AdoptedSplit | null {
  if (s.mile == null || s.paceSec == null || !(s.paceSec > 0)) return null;
  const out: AdoptedSplit = {
    mile: s.mile,
    pace: paceString(s.paceSec),
    paceSecPerMi: Math.round(s.paceSec),
  };
  // RULE 11 · measured values only. An absent field stays absent.
  if (s.hr != null) out.hr = s.hr;
  if (s.distanceMi != null && s.distanceMi > 0) out.distanceMi = s.distanceMi;
  if (s.elevFt != null) out.elev_ft = Math.round(s.elevFt);
  if (s.cadence != null && s.cadence > 0) out.cadence = s.cadence;
  return out;
}

/**
 * Choose what this canonical row's `data.splits` should hold, given the
 * absorbed siblings available.
 *
 * Pure — no I/O, no clock. Returns `splits: null` whenever there is nothing to
 * write, so the caller never issues a no-op UPDATE.
 *
 * @param incumbentRaw   the canonical row's current `data.splits`
 * @param candidates     absorbed siblings' arrays, any order
 * @param rowDistanceMi  the canonical row's own `data.distanceMi`
 * @param tierOf         source → tier, passed in so this module holds no
 *                       second copy of the ladder in `canonical.ts`
 */
export function chooseSplits(
  incumbentRaw: unknown,
  candidates: readonly SplitCandidate[],
  rowDistanceMi: number | null,
  tierOf: (source: string | null) => number,
): AdoptionResult {
  const refusals: AdoptionResult['refusals'] = [];
  const none: AdoptionResult = { splits: null, adoptedFrom: null, milesAdded: [], refusals };

  const incumbent = normalizeSplits(incumbentRaw);
  const incumbentUsable = usable(incumbent);

  // The incumbent must be alignable. An empty array is trivially alignable —
  // there is nothing to align — which is the 2026-05-24 case.
  if (incumbent.length > 0 && incumbent.some((s) => s.mile == null)) {
    refusals.push({ source: null, reason: 'incumbent-splits-carry-no-mile-index' });
    return none;
  }
  const held = new Set(incumbent.map((s) => s.mile).filter((m): m is number => m != null));

  interface Ranked { source: string | null; ns: NormalizedSplit[]; count: number }
  const admissible: Ranked[] = [];

  for (const c of candidates) {
    const ns = normalizeSplits(c.raw);
    const u = usable(ns);
    if (u.length === 0) {
      refusals.push({ source: c.source, reason: 'candidate-has-no-usable-pace' });
      continue;
    }
    if (u.length <= incumbentUsable.length) continue; // not richer; not a refusal
    if (u.some((s) => s.mile == null)) {
      refusals.push({ source: c.source, reason: 'candidate-elements-lack-a-mile-index' });
      continue;
    }
    if (!decomposesRun(ns, rowDistanceMi)) {
      refusals.push({ source: c.source, reason: 'candidate-does-not-decompose-this-run' });
      continue;
    }
    admissible.push({ source: c.source, ns, count: u.length });
  }

  if (admissible.length === 0) {
    if (refusals.length === 0) refusals.push({ source: null, reason: 'no-candidate-is-richer' });
    return none;
  }

  // More miles first; tier breaks a tie; source name breaks a tier tie so the
  // choice is DETERMINISTIC — the same row must resolve the same way on every
  // pass, or a re-run rewrites the array for no reason.
  admissible.sort((a, b) =>
    (b.count - a.count)
    || (tierOf(b.source) - tierOf(a.source))
    || String(a.source ?? '').localeCompare(String(b.source ?? '')));
  const winner = admissible[0];

  const additions: AdoptedSplit[] = [];
  for (const s of winner.ns) {
    if (s.mile == null || held.has(s.mile)) continue;
    const a = toAdopted(s);
    if (a) additions.push(a);
  }
  if (additions.length === 0) return none;

  // Incumbent elements survive BYTE-IDENTICAL — see the header. Only the gaps
  // are written, and the result is ordered by mile so every consumer that
  // walks the array in order reads the run in order.
  //
  // The raw array is re-filtered with `normalizeSplits`'s OWN drop rule rather
  // than indexed positionally: it skips non-object elements, so a raw array
  // containing one stray null would misalign every element after it and this
  // function would hand back somebody else's mile under the wrong index.
  const incumbentRawArr = (Array.isArray(incumbentRaw) ? incumbentRaw : [])
    .filter((el) => el && typeof el === 'object' && !Array.isArray(el));
  const keyed: Array<{ mile: number; el: unknown }> = [];
  incumbent.forEach((s, i) => {
    if (s.mile != null) keyed.push({ mile: s.mile, el: incumbentRawArr[i] });
  });
  for (const a of additions) keyed.push({ mile: a.mile, el: a });
  keyed.sort((x, y) => x.mile - y.mile);

  return {
    splits: keyed.map((k) => k.el),
    adoptedFrom: winner.source,
    milesAdded: additions.map((a) => a.mile),
    refusals,
  };
}
