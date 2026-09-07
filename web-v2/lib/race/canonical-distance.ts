/**
 * lib/race/canonical-distance.ts · WHICH OF THE FOUR RACE CATEGORIES IS THIS.
 *
 * ── WHY THIS FILE EXISTS (OPTIONLANE-1, 2026-09-07) ────────────────────────
 *
 * `nearestCanonicalDistance` lived inside
 * `lib/adaptation/canonical-shadow/live-input.ts` as a private function,
 * reachable only through that module's `_internal` test hatch. That was fine
 * while it had exactly one caller inside the same walled directory.
 *
 * `lib/brain/option-lane.ts` then needed the same mapping — arbitration's
 * `PriorityContext.raceDistance` is the same closed four-member union — and
 * there were only bad ways to get it:
 *
 *   · import `_internal` across the canonical-shadow wall, which
 *     `_zero_mutation_scan.test.ts` guard 3 correctly refuses (it caught this
 *     file's first cut);
 *   · widen that guard's allowlist, which weakens a wall for a four-line
 *     nearest-neighbour lookup;
 *   · re-tabulate the four distances locally, which is a second answer to one
 *     question and exactly what Rule 16 forbids.
 *
 * So the function MOVED here instead, to a neutral module both sides may
 * import. That REMOVES a wall crossing rather than adding one: nothing new
 * reaches into `canonical-shadow`, and there is still exactly one definition.
 * `live-input.ts` imports it from here and re-exports it on `_internal`
 * unchanged, so its own tests are unaffected.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ────────────────────────────────────
 *
 * · WHETHER MAPPING AN OFF-MENU DISTANCE IS RIGHT. A 10-miler becomes HALF and
 *   a 50K becomes MARATHON. That is the closed union's consequence, not this
 *   function's judgement, and a caller that needs the true distance must read
 *   the miles rather than this key.
 * · A NEGATIVE OR ABSURD INPUT. It returns the nearest category for any finite
 *   number. Callers validate the miles before asking; `option-lane.ts` refuses
 *   a non-finite or non-positive distance before it reaches here.
 */

/** The four categories doctrine prices, with their canonical distances. */
export const CANONICAL_RACE_DISTANCES:
ReadonlyArray<{ key: 'FIVE_K' | 'TEN_K' | 'HALF' | 'MARATHON'; mi: number }> = [
  { key: 'FIVE_K', mi: 3.1 },
  { key: 'TEN_K', mi: 6.2 },
  { key: 'HALF', mi: 13.1 },
  { key: 'MARATHON', mi: 26.2 },
];

/**
 * Nearest of the four canonical race-distance categories, by absolute
 * difference. `lib/adaptation/canonical/input.ts`'s `RaceCalendar
 * .raceDistance` is a closed union of exactly these four; a race at a distance
 * the union does not carry (a 10 mile, an ultra) is mapped to its nearest
 * doctrine category rather than left unrepresentable — the same posture
 * `Research/22`'s own template table takes for off-menu distances.
 */
export function nearestCanonicalDistance(
  mi: number,
): 'FIVE_K' | 'TEN_K' | 'HALF' | 'MARATHON' {
  let best = CANONICAL_RACE_DISTANCES[0]!;
  let bestDiff = Math.abs(mi - best.mi);
  for (const c of CANONICAL_RACE_DISTANCES.slice(1)) {
    const diff = Math.abs(mi - c.mi);
    if (diff < bestDiff) { best = c; bestDiff = diff; }
  }
  return best.key;
}
