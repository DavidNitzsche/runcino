/**
 * derive-splits.ts · per-mile splits from a phase-by-phase pace stream.
 *
 * Lifted out of app/api/watch/workouts/complete/route.ts on 2026-08-21 so it
 * can be tested directly. A Next.js `route.ts` may only export its HTTP
 * handlers, so nothing inside one is reachable from a test — and this
 * function is the single reason a treadmill run does or does not get splits.
 * Behaviour is unchanged by the move.
 *
 * Who feeds it:
 *   · the watch, from its GPS pace stream (~5 s cadence)
 *   · the iPhone treadmill consoles, from the belt-speed timeline
 *     (BeltTracker.swift, added 2026-08-21 — before that they sent no
 *     samples at all and every treadmill run landed with `splits: []`)
 *   · PhoneRunTracker, from phone GPS
 */

export interface PaceSample { tSec: number; paceSPerMi?: number | null; distMi?: number; bpm?: number | null; }
export interface SplitSourcePhase {
  actualDurationSec?: number;
  actualDistanceMi?: number | null;
  paceSamples?: PaceSample[] | null;
  hrSamples?: PaceSample[] | null;
}
export interface DerivedSplit { mile: number; pace: string; hr: number | null; paceSecPerMi: number; }

/**
 * deriveSplitsFromPaceSamples — derive genuine per-mile splits from the
 * watch's 5-second paceSamples stream.
 *
 * 2026-06-06 · This replaces the prior strategy of relying on iPhone HK
 * ingest to produce splits.  The iPhone path was fragile:
 *   · The reconciliation guard (round 71, fixed round 90) was comparing
 *     sumOfFullMileTimes to workout.duration WITHOUT the trailing fractional
 *     mile, silently dropping splits on every run since 2026-05-29.
 *   · Even when fixed, the iPhone HK ingest fires ~30-60s after the watch
 *     endpoint, so the watch canonical row always wins tier-5 and the iPhone
 *     HK row (tier-2 loser) has to be absorbed. With no splits on the apple_
 *     watch row there's nothing to absorb.
 *
 * The watch already sends the FULL GPS-pace sample stream (one sample every
 * ~5 seconds, distMi cumulative, tSec from phase-start).  Walking those
 * samples to find mile-boundary crossings is identical to what iPhone's
 * perMileSplits does from HKWorkoutRoute locations — just run server-side
 * instead of on the phone.
 *
 * Algorithm:
 *   · Flatten all phases into a single distMi + tSec timeline with offsets.
 *   · Walk sample pairs; when distMi crosses a whole-mile boundary, linearly
 *     interpolate the exact tSec at the crossing.
 *   · per-mile elapsed = crossingTime[N] − crossingTime[N-1].
 *   · Average HR from hrSamples in the same time window.
 *   · Guard: 120s ≤ elapsed ≤ 3600s per mile (same sanity range as iPhone).
 *
 * Returns null when:
 *   · no phase has paceSamples with distMi populated
 *   · fewer than 1 full mile completed
 */
export function deriveSplitsFromPaceSamples(
  phases: SplitSourcePhase[]
): DerivedSplit[] | null {
  if (!Array.isArray(phases) || phases.length === 0) return null;

  const flat = flattenPhaseSamples(phases);
  if (flat.length < 2) return null;

  const walk = walkMileSplits(flat);
  return walk.splits.length > 0 ? walk.splits : null;
}

/* ══════════════════ the walk, as its own two halves ══════════════════════ */
//
// SPLIT OUT 2026-09-08 so `derive-phase-splits.ts` can run the SAME walk over
// ONE phase's stream, rebased to that phase's own start, rather than carrying
// a second copy of the interpolation (Rule 16 · one quantity, one name — and
// a mile boundary is a quantity). `deriveSplitsFromPaceSamples` above is now
// nothing but these two calls, so a change to the arithmetic cannot reach one
// caller and miss the other.
//
// Behaviour is unchanged: the flatten is the loop that used to be inline, the
// walk is the loop that used to follow it, and the whole-run entry point still
// returns whole miles only. The trailing REMAINDER the walk now reports is new
// information, not new behaviour — this function ignores it, exactly as it
// always has.

/** One sample on the flattened timeline: seconds and cumulative miles from the
 *  start of the FIRST phase handed in, plus that instant's heart rate. */
export interface FlatMileSample { tSec: number; distMi: number; bpm: number | null }

/** The piece after the last whole-mile boundary. Never a mile, so it is never
 *  numbered — see `MileBreakdownV5`'s "THE TRAILING PIECE". */
export interface MileRemainder {
  distanceMi: number;
  elapsedSec: number;
  paceSecPerMi: number;
  hr: number | null;
}

export interface MileWalk {
  /** Whole-mile splits, sanity-guarded (120 s ≤ elapsed ≤ 3600 s per mile). */
  splits: DerivedSplit[];
  /**
   * Mile boundaries the stream ACTUALLY crossed, counted before the sanity
   * guard. `splits.length` can be smaller — a mile dropped by the guard is a
   * hole in the table, and a caller that needs a complete table has to be able
   * to tell that apart from a mile that was never run (Rule 11).
   */
  wholeMilesCrossed: number;
  /** Seconds at the last crossing, from the timeline's own zero. 0 when none. */
  lastCrossingSec: number;
  /** The final sample, i.e. where the stream stops. */
  endSec: number;
  endDistMi: number;
}

/**
 * Phases → one timeline. Distance and time offsets come from each phase's own
 * ACTUAL totals, not from its last sample, so GPS rounding does not accumulate
 * across phases. Handed a single phase, both offsets stay zero and the result
 * is that phase rebased to its own start, which is exactly what a per-phase
 * mile breakdown needs.
 */
export function flattenPhaseSamples(phases: SplitSourcePhase[]): FlatMileSample[] {
  const flat: FlatMileSample[] = [];
  let distOffset = 0;
  let tOffset = 0;

  for (const phase of phases) {
    const ps = phase.paceSamples ?? [];
    const hs = phase.hrSamples ?? [];
    if (ps.length === 0) { distOffset += Number(phase.actualDistanceMi ?? 0); tOffset += Number(phase.actualDurationSec ?? 0); continue; }

    // HR lookup for this phase by tSec
    const hrByT = new Map<number, number>();
    for (const h of hs) { if (h.bpm != null && h.bpm > 0) hrByT.set(h.tSec, h.bpm); }

    for (const s of ps) {
      if (s.distMi == null) continue;
      flat.push({
        tSec: s.tSec + tOffset,
        distMi: s.distMi + distOffset,
        bpm: hrByT.get(s.tSec) ?? null,
      });
    }

    // Advance offsets by the phase's actual values (not sample-derived)
    // so rounding in GPS doesn't accumulate across phases
    distOffset += Number(phase.actualDistanceMi ?? (ps[ps.length-1]?.distMi ?? 0));
    tOffset += Number(phase.actualDurationSec ?? (ps[ps.length-1]?.tSec ?? 0));
  }

  return flat;
}

/**
 * The mile-boundary walk. Interpolates the exact second at each whole-mile
 * crossing, averages HR over the window between crossings, and reports what is
 * left over after the last one.
 *
 * Sorts `flat` in place, as the inline version always did.
 */
export function walkMileSplits(flat: FlatMileSample[]): MileWalk {
  if (flat.length < 2) {
    return { splits: [], wholeMilesCrossed: 0, lastCrossingSec: 0, endSec: 0, endDistMi: 0 };
  }
  flat.sort((a, b) => a.tSec - b.tSec);

  const splits: DerivedSplit[] = [];
  let mileNo = 1;
  let prevCrossT = 0;
  let crossed = 0;

  for (let i = 1; i < flat.length; i++) {
    const prev = flat[i - 1];
    const curr = flat[i];
    const span = curr.distMi - prev.distMi;
    if (span <= 0) continue;

    // One sample pair can cross multiple mile boundaries (e.g. a fast downhill)
    while (curr.distMi >= mileNo && prev.distMi < mileNo) {
      const frac = (mileNo - prev.distMi) / span;
      const crossT = prev.tSec + frac * (curr.tSec - prev.tSec);
      const elapsedSec = Math.round(crossT - prevCrossT);
      crossed++;

      if (elapsedSec >= 120 && elapsedSec <= 3600) {
        splits.push({
          mile: mileNo,
          pace: fmtMileClock(elapsedSec),
          hr: averageBpmBetween(flat, prevCrossT, crossT),
          paceSecPerMi: elapsedSec,
        });
      }
      prevCrossT = crossT;
      mileNo++;
    }
  }

  const last = flat[flat.length - 1];
  return {
    splits,
    wholeMilesCrossed: crossed,
    lastCrossingSec: prevCrossT,
    endSec: last.tSec,
    endDistMi: last.distMi,
  };
}

/** Average HR over a window of the timeline. Null when no sample in it carried
 *  one — never a neighbour's reading, which is a borrowed number wearing a
 *  measured number's clothes. */
export function averageBpmBetween(
  flat: FlatMileSample[], fromSec: number, toSec: number,
): number | null {
  const w = flat.filter((s) => s.tSec >= fromSec && s.tSec <= toSec && s.bpm != null);
  if (w.length === 0) return null;
  return Math.round(w.reduce((sum, s) => sum + (s.bpm as number), 0) / w.length);
}

/** Seconds → "7:14". The one formatter both the whole-run and the per-phase
 *  tables print through. */
export function fmtMileClock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
