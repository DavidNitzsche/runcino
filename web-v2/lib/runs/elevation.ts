/**
 * WHICH ELEVATION READING TO BELIEVE.
 *
 * A run can arrive carrying several climb figures from several ingests, and
 * they are not different spellings of one measurement — they are different
 * INSTRUMENTS, and one of them is much better than the others.
 *
 * `raw` is the watch's barometric altimeter: a pressure sensor, reading the
 * air the runner is actually standing in. `gps_derived` is arithmetic over GPS
 * altitude, which is the weakest axis of a GPS fix and wanders tens of feet
 * while standing still — on flat ground that wander integrates into a climb
 * that never happened.
 *
 * Measured on this database, 2026-08-24, across every row carrying a source:
 *
 *     raw            94 rows   avg    96 ft
 *     gps_derived    14 rows   avg   218 ft
 *     recomputed      7 rows   avg  1012 ft
 *     absent          8 rows   avg   890 ft
 *     watch           3 rows   avg  4285 ft
 *
 * `gps_derived` runs 2.3x the barometer. The tail is not noise, it is nonsense:
 * one 11-mile run holds 3195 ft against barometric twins reading 94 and 57.
 *
 * The runner said it first: "I have a hard time believing my elevation on
 * today's run was 128 feet. I can promise you it was not." His watch agreed —
 * 13 ft, barometric, on the twin the merge absorbed and then overwrote.
 *
 * This is the same shape as the clock family and the pace family. A member may
 * not enter a row from a weaker instrument than the one already there, and
 * provenance belongs to the FAMILY rather than the field.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ELEVTRUST-1 (2026-09-13) · `elevGainSource:'watch'` — WHY IT WAS MISSING
 * AND WHY IT IS NOT SIMPLY 'raw'
 *
 * `'watch'` is the whole-run barometric total the Faff watch app itself
 * writes (`app/api/watch/workouts/complete/route.ts`, "device-measured from
 * the watch's barometer-fused altitude"). It was ABSENT from this table
 * entirely, so every 'watch'-labeled candidate scored trust 0 — worse than
 * `gps_derived`, worse than an unlabelled figure, unconditionally excluded no
 * matter how good the reading. Confirmed on the 2026-09-13 Santa Monica 10K:
 * canonical `elevGainFt:176, elevGainSource:'watch'` lost to its own
 * HealthKit twin's `elevGainFt:466, elevGainSource:'gps_derived'` — the exact
 * inversion this table exists to prevent — and was saved from display only
 * because a THIRD candidate, Strava's own `raw` figure (179 ft), happened to
 * also be present and out-rank `gps_derived`. Remove that third candidate
 * (most races are not Strava-synced, most training runs have no twin at all)
 * and the wrong number would have shown.
 *
 * The reason 'watch' was never simply folded into 'raw': the write route ran
 * every value through `sanitizeElevGain` (`lib/runs/elev-sanity.ts`) and then
 * discarded the anchor that function computed (`'raw'` when credible,
 * `'recomputed'` when a suspicious raw reading was corrected against
 * corroborating splits), stamping the constant string `'watch'` over BOTH
 * outcomes — a Rule 10 violation (a persisted derived value must carry its
 * anchor or be recomputed). `ELEVTRUST-1` also fixes that write bug going
 * forward (see the route's own comment), so no NEW row will ever be stamped
 * `'watch'` again. But rows already written that way — including this race's
 * canonical row — do not get relabelled by a code change with no backfill,
 * and one of them is a genuine, confirmed bad reading: `runs` still holds a
 * 2026-08-26 twin at 2807 ft over 7.78 mi (361 ft/mi, zero corroborating
 * splits) — a value from BEFORE `elev-sanity.ts`'s 2026-08-30 "sparse splits"
 * fix existed, exactly the shape that fix now refuses. Trusting `'watch'` at
 * face value, unconditionally, at parity with `raw`, would let that
 * documented bad row outrank a real `gps_derived` OR unlabelled candidate for
 * ITS OWN run the same way `gps_derived` outranked this race's canonical.
 *
 * So `'watch'` is trusted at PARITY WITH `raw` (both are the same barometric
 * instrument; a value that survived `sanitizeElevGain`'s corroboration check
 * is not a weaker reading than an uncorrected one) — but `pickElevationGain`
 * additionally re-applies `sanitizeElevGain`'s own credibility band
 * (`SUSPICION_THRESHOLD_FT_PER_MI`, imported rather than restated) to any
 * `'watch'` candidate, using the run's own distance, before granting it that
 * trust. A `'watch'` reading within the band is exactly as trustworthy as
 * `raw`, because by construction it already passed the identical check when
 * it still carried the label `raw` or `recomputed` would have used; a
 * `'watch'` reading outside the band is a candidate this table has concrete
 * evidence to refuse, and refusing it (never silently downgrading it to a
 * confident-looking `gps_derived`-tier number) is Rule 11: a value that
 * cannot be vouched for is a different fact from one that can.
 */

import { SUSPICION_THRESHOLD_FT_PER_MI } from '@/lib/runs/elev-sanity';

/** Sources in descending order of trust. Anything unlisted is untrusted. */
export const ELEVATION_TRUST: Record<string, number> = {
  // A pressure sensor. The only direct measurement of altitude here.
  raw: 100,
  // The whole-run barometric total the Faff watch app writes directly. Same
  // instrument as `raw`; kept as its own key rather than folded into `raw`
  // because `pickElevationGain` re-checks it against `elev-sanity.ts`'s own
  // credibility band before honouring this score — see ELEVTRUST-1 above.
  watch: 100,
  // The treadmill's own incline setting, times the distance. Not a sensor,
  // but an exact statement of what the machine was set to.
  treadmill_incline: 90,
  // Arithmetic over GPS altitude. Systematically high, sometimes wildly.
  gps_derived: 40,
  // Recomputed by us from stored samples, provenance already lost.
  recomputed: 20,
};

/** `ELEVATION_TRUST` sources that must clear `elev-sanity.ts`'s own
 *  credibility band (ft/mi against the run's own distance) before their
 *  table trust is honoured — see ELEVTRUST-1. Every other source either
 *  already passed that check at write time on every writer that stamps it
 *  (`raw`, `recomputed`), or is deliberately scored low enough that
 *  re-checking it would not change an outcome (`gps_derived`). */
const REQUIRES_CREDIBILITY_RECHECK = new Set<string>(['watch']);

/** Below this, a figure may be carried but must never be presented as measured. */
export const ELEVATION_MEASURED_FLOOR = 90;

export interface ElevationCandidate {
  ft: number | null | undefined;
  source: string | null | undefined;
  /** For the message only — which ingest wrote it. */
  ingest?: string | null;
}

export interface ElevationReading {
  ft: number;
  source: string;
  /** True only when a real instrument measured it. Rule 1 lives here. */
  measured: boolean;
}

function trustOf(source: string | null | undefined): number {
  if (!source) return 0;
  return ELEVATION_TRUST[source] ?? 0;
}

/**
 * ELEVTRUST-1 · does this candidate clear `elev-sanity.ts`'s own credibility
 * band, applied fresh at read time?
 *
 * Only asked of sources in `REQUIRES_CREDIBILITY_RECHECK`. With no run
 * distance to check ft/mi against, the candidate is let through rather than
 * refused on a check that cannot run — the same "cannot judge" posture
 * `pickSplits` takes with no run distance, and the opposite failure mode from
 * refusing a genuinely good reading for want of a denominator.
 */
function clearsCredibilityRecheck(
  source: string,
  ft: number,
  runDistanceMi: number | null | undefined,
): boolean {
  if (!REQUIRES_CREDIBILITY_RECHECK.has(source)) return true;
  const mi = Number(runDistanceMi);
  if (!Number.isFinite(mi) || mi <= 0) return true;
  return ft / mi <= SUSPICION_THRESHOLD_FT_PER_MI;
}

/**
 * The best climb figure among everything a run and its absorbed twins carry.
 *
 * Returns null when nothing is trustworthy enough to print. A refusal is a
 * correct answer: an invented 3195 ft is worse than no number, because the
 * runner cannot tell it is invented.
 *
 * `runDistanceMi` is the physical run's own distance — one value shared by
 * every candidate, since they all describe the same run — and is read ONLY
 * to re-check a `REQUIRES_CREDIBILITY_RECHECK` source's ft/mi against
 * `elev-sanity.ts`'s own suspicion band. See ELEVTRUST-1 above for why
 * `'watch'` needs this and `'raw'`/`'recomputed'` do not.
 */
export function pickElevationGain(
  candidates: ElevationCandidate[],
  runDistanceMi?: number | null,
): ElevationReading | null {
  let best: ElevationReading | null = null;
  let bestTrust = -1;

  for (const c of candidates) {
    const ft = typeof c.ft === 'number' ? c.ft : Number(c.ft);
    if (!Number.isFinite(ft) || ft < 0) continue;
    const source = c.source ?? undefined;
    const t = trustOf(source);
    // Untrusted sources are not ranked at all. `gps_derived`, `absent` and an
    // unlabelled figure average four-figure climbs on this data; taking the
    // best of several bad instruments still leaves a bad instrument.
    if (t <= 0) continue;
    if (source != null && !clearsCredibilityRecheck(source, ft, runDistanceMi)) continue;
    if (t > bestTrust) {
      bestTrust = t;
      best = { ft: Math.round(ft), source: String(c.source), measured: t >= ELEVATION_MEASURED_FLOOR };
    }
  }
  return best;
}
