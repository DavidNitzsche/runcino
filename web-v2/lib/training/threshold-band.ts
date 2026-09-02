/**
 * Where the threshold band ends, and what it means to run past it.
 *
 * Pure. Lives here rather than in `lib/plan/drift-monitor.ts` because two
 * different consumers need the same answer and one of them (`lib/coach/
 * run-recap.ts`) must stay free of the database: the drift monitor decides
 * whether to propose a plan rebuild, the recap decides what to tell the runner,
 * and those two must never disagree about whether a session left the band.
 *
 * ## Why the question matters
 *
 * Threshold adaptation is bought with TIME at the intensity where lactate
 * clearance matches production (`Research/04` §5 — "extend the velocity at
 * which lactate clearance matches production"; `Research/01` defines the
 * threshold itself as the point where lactate "begins accumulating faster than
 * it can be cleared"). Exceeding that pace does not buy more of the adaptation.
 * It ends the session sooner and banks fatigue — a smaller dose of the thing
 * the session existed to deliver.
 *
 * So "ran faster than prescribed" is genuinely ambiguous, and the two readings
 * call for opposite responses:
 *
 *   · faster, HR inside the band  → the targets are soft. A soft LEAD
 *     (`Research/01` §"Testing cadence": "+1 VDOT estimated; field-test within
 *     2 weeks"), worth a refit, still not proof of new fitness.
 *   · faster, HR above the band   → the session was overcooked. An execution
 *     finding. Nothing about the plan is wrong, and rebuilding it to chase the
 *     faster pace makes the next session hotter still.
 *
 * Before this existed the engine assumed the first unconditionally, told the
 * runner "pace targets are too soft · refit VDOT", and the recap called it
 * "pushed the tempo today" — which reads as approval for the habit that is
 * costing them the adaptation.
 */

/**
 * Top of the threshold HR band, as a multiple of the session's own HR target.
 *
 * `Research/03` §6 (Friel) puts zone 5a — "At LT · cruise intervals" — at
 * 100-102% of LTHR. The ceiling is the top of that band, not the bare target:
 * treating the target itself as the ceiling would call every session that ran
 * one beat hot an overcook.
 */
export const THRESHOLD_HR_CEILING_OF_TARGET = 1.02;

/**
 * Bottom of the threshold HR band, as a multiple of the session's HR target.
 *
 * The same Friel table: zone 5a ("At LT") runs 100-102% of LTHR, and zone 4
 * ("SubThreshold · just below LT") sits at 95-99%. So 100% is the floor of
 * being AT threshold, and below it the runner was working under the intensity
 * the session was prescribed for.
 */
export const THRESHOLD_HR_FLOOR_OF_TARGET = 1.0;

/** Did this session's heart rate go ABOVE the band it was prescribed for? */
export function ranAboveThresholdBand(
  avgHrBpm: number | null | undefined,
  hrTargetBpm: number | null | undefined,
): boolean {
  if (avgHrBpm == null || hrTargetBpm == null || !(hrTargetBpm > 0)) return false;
  return avgHrBpm > hrTargetBpm * THRESHOLD_HR_CEILING_OF_TARGET;
}

/**
 * Did this session's heart rate stay BELOW the band — i.e. the runner never
 * reached the intensity the session existed to deliver?
 *
 * The mirror of `ranAboveThresholdBand`, and it exists because the mirror was
 * missing. Every context filter in this engine was added to the branch where a
 * bug was observed and not to its opposite, so the same ambiguity that made
 * "faster than prescribed" unreadable was sitting unguarded on "slower than
 * prescribed" — where it also loops.
 */
export function ranBelowThresholdBand(
  avgHrBpm: number | null | undefined,
  hrTargetBpm: number | null | undefined,
): boolean {
  if (avgHrBpm == null || hrTargetBpm == null || !(hrTargetBpm > 0)) return false;
  return avgHrBpm < hrTargetBpm * THRESHOLD_HR_FLOOR_OF_TARGET;
}

/**
 * The floor of Friel zone 4, as a multiple of LTHR.
 *
 * `Research/03` §6 (Friel): zone 4 is "SubThreshold · just below LT" at 95-99%
 * of LTHR, and zone 5a is "At LT · cruise intervals" at 100-102%. So there are
 * TWO lines under the seam, not one, and they mean different things.
 */
export const SUBTHRESHOLD_HR_FLOOR_OF_TARGET = 0.95;

/**
 * Did this session's heart rate land in Friel zone 4 — under the seam, but
 * inside the sub-threshold band?
 *
 * WHY THIS EXISTS (2026-09-01). `ranBelowThresholdBand` alone treats 96% of
 * LTHR and 80% of LTHR as the same fact, and they are not. The first is a
 * correctly-run cruise-interval set; the second is a runner who never got
 * near the intensity.
 *
 * The distinction is not academic — it decides which of two OPPOSITE coaching
 * lines is true, on the same "ran quicker than the target" branch:
 *
 *   · quick pace, HR in Z4 → the pace cost him less than the model expected.
 *     That is the classic soft-target signal, and doctrine's own zone table
 *     says a mile rep with a 60-second jog between reps LIVES here: heart rate
 *     sawtooths across the recoveries (`Research/03` §2, half-time ~30 s), so
 *     a per-rep average pinned at 100-102% of LTHR is not physically what a
 *     correctly-executed cruise set produces.
 *   · quick pace, HR well UNDER Z4 → he did not reach the intensity at all,
 *     and calling that a soft target starts the loop `slowQualityNeverReached
 *     TheBand` already documents.
 *
 * Measured on the owner's real 2026-09-01 session: work-phase HR 158 / 161 /
 * 164 / 166, mean 162 against LTHR 168 — 96.4%, the top of Z4, climbing rep
 * over rep. The first line is the true one and the second would have been a
 * scolding.
 */
export function ranInSubThresholdBand(
  avgHrBpm: number | null | undefined,
  hrTargetBpm: number | null | undefined,
): boolean {
  if (avgHrBpm == null || hrTargetBpm == null || !(hrTargetBpm > 0)) return false;
  return avgHrBpm >= hrTargetBpm * SUBTHRESHOLD_HR_FLOOR_OF_TARGET
      && avgHrBpm < hrTargetBpm * THRESHOLD_HR_FLOOR_OF_TARGET;
}

/**
 * Across a stretch of SLOWER-than-prescribed quality work, did the runner
 * mostly stay under the intensity?
 *
 * If they did, the session was not a fitness test — they did not reach the
 * zone. Concluding "targets too aggressive, refit to a lower VDOT" from that is
 * both wrong and self-reinforcing: the lower target is easier, so the next
 * session's HR sits lower still, which produces the same finding again. Same
 * majority rule and the same absence-is-not-evidence default as the fast case.
 */
export function slowQualityNeverReachedTheBand(
  hrReadable: number,
  hrBelowThreshold: number,
): boolean {
  if (hrReadable <= 0) return false;
  return hrBelowThreshold / hrReadable > 0.5;
}

/**
 * Across a stretch of faster-than-prescribed quality work, did the runner
 * mostly leave the band?
 *
 * Returns false when no heart rate was readable at all. An unreadable session
 * is not evidence of overcooking, and defaulting the other way would silently
 * suppress every legitimate refit for runners who train without a strap — the
 * same absence-is-not-evidence rule the adaptation model holds.
 */
export function fastQualityLeftTheBand(hrReadable: number, hrAboveThreshold: number): boolean {
  if (hrReadable <= 0) return false;
  return hrAboveThreshold / hrReadable > 0.5;
}
