/**
 * lib/faff/pace-zone-provenance.ts · WHICH ZONES ON THE PACES SCREEN ARE
 * MODELLED, decided from the Runner Model rather than from the event.
 *
 * `GET /api/v5/paces` (design 18a) stamps every zone's `modelled` flag off one
 * bit — `direction !== 'faster-race'` — so a race-confirmed read ships
 * Threshold, Interval AND Rep with no amber mark. The threshold half of that
 * is honest: a graded race is the strongest single observation the threshold
 * ladder admits. The interval and rep halves are not. This app has NO direct
 * high-intensity reader (`capacity-resolver.ts`, `composeHighIntensityCapacity`:
 * "NOT BUILT"), so the runner's interval pace is a Daniels-table lookup off a
 * VDOT whatever triggered the event — `resolveHighIntensityCapacity` reports
 * `vdot_fallback` on a race-anchored VDOT exactly as on a training one, and
 * the Coaching Thesis refuses to rank it for the same reason. Printing that
 * number under "Your paces moved faster · confirmed fitness" with no mark is
 * rule one broken (`docs/faff-iphone-design-contract.md` §1: "a pace derived
 * from training rather than a race" is modelled) on the two zones nobody
 * measured.
 *
 * So the flag is now per zone, and the interval/rep zones read the
 * high-intensity capacity's OWN source mode: rankable (direct / inferred /
 * race_derived — a reader that looked at this runner at that intensity) means
 * the event's direction decides, exactly as before; anything else means
 * modelled, whatever the direction. The moment a direct high-intensity reader
 * lands, the mark disappears from those two rows with no edit here.
 *
 * This is a display-provenance helper, not a second pricing path: it computes
 * no pace. The competing pricing (the screen derives its zone paces from a
 * VDOT pair rather than from `resolvePrescribedPaceAnchors`) is reported, not
 * fixed, in the 2026-09-02 beliefs report.
 *
 * NOTE ON THE DESIGN CONTRACT. §18a reads "faster-race is hard evidence: no
 * tilde". That sentence was written assuming all three zones come from the
 * race. Doctrine (Constitution §17, the capacity ladder) says a table lookup
 * is a fallback, and the contract's own §1 rule wins over its §18a example.
 * Proposed explicitly in the beliefs report rather than changed silently.
 */
import { isRankableSourceMode } from '@/lib/training/coaching-thesis';
import type { SourceMode } from '@/lib/training/capacity-resolver';

export type PaceZoneId = 'threshold' | 'interval' | 'rep';
export type PaceEventDirection = 'slower' | 'faster-training' | 'faster-race';

/**
 * Pure · `modelled` for one zone.
 *
 *   threshold      · modelled unless the event is race-confirmed (unchanged).
 *   interval / rep · modelled unless the HIGH-INTENSITY capacity itself is
 *                    rankable — a direct, inferred or race-derived read of the
 *                    runner at that intensity, which today exists for nobody.
 */
export function zoneIsModelled(
  zone: PaceZoneId,
  direction: PaceEventDirection,
  highIntensitySourceMode: SourceMode,
): boolean {
  const eventModelled = direction !== 'faster-race';
  if (zone === 'threshold') return eventModelled;
  return eventModelled || !isRankableSourceMode(highIntensitySourceMode);
}

/** The caption's honest addendum when the race confirmed threshold but the
 *  interval and rep rows are still a table lookup. Null when nothing needs
 *  saying (every zone shares one provenance). */
export function highIntensityCaption(
  direction: PaceEventDirection,
  highIntensitySourceMode: SourceMode,
): string | null {
  if (direction !== 'faster-race') return null;
  if (isRankableSourceMode(highIntensitySourceMode)) return null;
  return 'Interval and rep paces are read off the same table, not from your own interval sessions';
}
