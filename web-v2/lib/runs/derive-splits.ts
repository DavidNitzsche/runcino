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

  // Flatten phases into a single timeline with dist + time offsets
  interface FlatSample { tSec: number; distMi: number; bpm: number | null }
  const flat: FlatSample[] = [];
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

  if (flat.length < 2) return null;
  flat.sort((a, b) => a.tSec - b.tSec);

  const splits: DerivedSplit[] = [];
  let mileNo = 1;
  let prevCrossT = 0;

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

      if (elapsedSec >= 120 && elapsedSec <= 3600) {
        // Average HR from samples in this mile's window
        const windowSamples = flat.filter(s => s.tSec >= prevCrossT && s.tSec <= crossT && s.bpm != null);
        const avgHr = windowSamples.length > 0
          ? Math.round(windowSamples.reduce((sum, s) => sum + (s.bpm!), 0) / windowSamples.length)
          : null;

        splits.push({
          mile: mileNo,
          pace: `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`,
          hr: avgHr,
          paceSecPerMi: elapsedSec,
        });
      }
      prevCrossT = crossT;
      mileNo++;
    }
  }

  return splits.length > 0 ? splits : null;
}
